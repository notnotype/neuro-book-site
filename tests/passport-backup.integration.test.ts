import {execSync, spawn, type ChildProcess} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {createClient} from "@libsql/client";
import {strToU8} from "fflate";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import type {AuthorizationDto, DeviceCodeDto, PendingDeviceDto, TokenGrantDto} from "../shared/dto/passport.dto";
import type {BackupDto, BackupListDto} from "../shared/dto/backup.dto";
import type {InviteCodeDto, ItemVersionDto, PageDto, WorkshopItemDto} from "../shared/dto/workshop.dto";
import {buildPackageZip} from "./helpers/zip";

// Passport + Backup 真实 HTTP 集成测试：build 产物起真实 server，覆盖
// 设备码全状态机 / refresh 轮换与重放撤链 / Bearer scope 面 / 备份往返与配额 rotate。
// 时序契约：轮询间隔放大到 60s 稳定 slow_down 判定；过期用例直接改库中 expiresAt。

const repoRoot = resolve(import.meta.dirname, "..");
const runDir = join(repoRoot, ".agent", `passport-integration-${process.pid}`);
const dbPath = join(runDir, "workshop.db").replaceAll("\\", "/");
const filesDir = join(runDir, "files");
const backupsDir = join(runDir, "backups");
const port = 35100 + (process.pid % 400);
const baseUrl = `http://127.0.0.1:${port}`;

let server: ChildProcess | null = null;

/** 手写 Cookie 罐：保存 session cookie 以维持登录态 */
class CookieJar {
    private cookies = new Map<string, string>();

    store(response: Response): void {
        for (const raw of response.headers.getSetCookie()) {
            const pair = raw.split(";", 1)[0] ?? "";
            const eq = pair.indexOf("=");
            if (eq <= 0) {
                continue;
            }
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            if (value) {
                this.cookies.set(name, value);
            } else {
                this.cookies.delete(name);
            }
        }
    }

    header(): string | null {
        if (this.cookies.size === 0) {
            return null;
        }
        return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    }
}

type ApiOptions = {
    method?: string;
    jar?: CookieJar;
    token?: string; // Bearer access token（与 jar 可并存，Bearer 优先由服务端裁决）
    json?: object;
    form?: FormData;
};

/** 请求真实 server；带 jar 时自动附带并回存 cookie，带 token 时附 Bearer 头 */
async function api(path: string, options: ApiOptions = {}): Promise<Response> {
    const headers: HeadersInit = {};
    const cookie = options.jar?.header();
    if (cookie) {
        headers.Cookie = cookie;
    }
    if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.json);
    } else if (options.form) {
        body = options.form;
    }
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? (body ? "POST" : "GET"),
        headers,
        body,
        redirect: "manual",
    });
    options.jar?.store(response);
    return response;
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** 读取错误响应中的 OAuth 风格错误码（data.error，spec §6.4 契约） */
async function grantErrorCode(response: Response): Promise<string | undefined> {
    const payload = (await response.json()) as {data?: {error?: string}};
    return payload.data?.error;
}

/** 申请设备码 */
async function createDeviceCode(scopes: string[], instanceName: string): Promise<DeviceCodeDto> {
    const response = await api("/api/v1/passport/device/code", {json: {instanceName, scopes}});
    expect(response.status).toBe(200);
    return (await response.json()) as DeviceCodeDto;
}

/** 用设备码轮询 token 端点 */
async function pollToken(deviceCode: string): Promise<Response> {
    return await api("/api/v1/passport/token", {json: {grantType: "device_code", deviceCode}});
}

/** 用 refresh token 请求轮换 */
async function refreshToken(token: string): Promise<Response> {
    return await api("/api/v1/passport/token", {json: {grantType: "refresh_token", refreshToken: token}});
}

/** 批准设备码（cookie session） */
async function approveDevice(jar: CookieJar, userCode: string, instanceName: string): Promise<Response> {
    return await api(`/api/v1/passport/device/${encodeURIComponent(userCode)}/approve`, {jar, json: {instanceName}});
}

/** 构造备份上传 multipart（meta JSON 字符串 + 归档字节） */
function backupForm(
    bytes: Uint8Array,
    meta: object,
    file: {mimeType: string; fileName: string} = {
        mimeType: "application/vnd.neurobook.backup",
        fileName: "backup.nbbackup",
    },
): FormData {
    const form = new FormData();
    form.append("meta", JSON.stringify({keyId: "0123456789abcdef", ...meta}));
    form.append("file", new Blob([bytes as BlobPart], {type: file.mimeType}), file.fileName);
    return form;
}

/** 生成确定性伪随机字节（测试归档内容） */
function makeBytes(size: number, seed: number): Uint8Array {
    const bytes = new Uint8Array(size);
    let state = seed;
    for (let i = 0; i < size; i++) {
        state = (state * 1103515245 + 12345) % 2147483648;
        bytes[i] = state % 256;
    }
    bytes.set(new TextEncoder().encode("NBOOKBK1"), 0);
    return bytes;
}

// ---------- 共享测试状态（同文件内串行执行） ----------

const adminJar = new CookieJar();
const userJar = new CookieJar(); // 批准者（author1）
const otherJar = new CookieJar(); // 越权检查用第二用户

const ALL_SCOPES = ["workshop:publish", "backup:read", "backup:write"];

let mainGrant: TokenGrantDto | null = null; // 主授权：三 scope，绝大多数 Bearer 用例使用
let mainUserCode = "";
let mainDeviceCode = ""; // 主授权设备码（批准用例与兑换用例分离，跨用例共享）
let publishOnlyGrant: TokenGrantDto | null = null; // 仅 workshop:publish，越权用例
let backupIds: number[] = []; // b1(manual) b2(auto) b3(auto) 的 id

beforeAll(async () => {
    const serverEntry = join(repoRoot, ".output", "server", "index.mjs");
    if (!existsSync(serverEntry)) {
        throw new Error("缺少 .output/server/index.mjs：集成测试跑真实 build 产物，请先运行 bun run build");
    }

    rmSync(runDir, {recursive: true, force: true});
    mkdirSync(filesDir, {recursive: true});
    writeFileSync(dbPath, "");
    const env = {
        ...process.env,
        DATABASE_URL: `file:${dbPath}`,
        ADMIN_USERNAME: "admin",
    };
    execSync("bunx prisma migrate deploy", {cwd: repoRoot, env, stdio: "pipe"});
    execSync("bun scripts/init-db.ts", {cwd: repoRoot, env, input: "admin1234567890-test\n", stdio: "pipe"});

    server = spawn(process.execPath, [serverEntry], {
        cwd: repoRoot,
        env: {
            ...env,
            PORT: String(port),
            HOST: "127.0.0.1",
            WORKSHOP_FILES_DIR: filesDir,
            NB_BACKUP_DIR: backupsDir,
            NUXT_SESSION_PASSWORD: "integration-test-session-password-0123456789",
            // 注册限流放开，避免与账号面限流用例（account-admin 文件）互相干扰
            NB_REGISTER_RATE_LIMIT: "1000",
            // 轮询间隔放大：任意连续两次 pending 轮询必命中 slow_down，消除时序 flaky
            NB_PASSPORT_POLL_INTERVAL_SECONDS: "60",
            // 小配额便于触发 413 / rotate：总量 4 KiB、单份 1 MiB、3 份
            NB_BACKUP_QUOTA_BYTES: "4096",
            NB_BACKUP_MAX_FILE_BYTES: String(1024 * 1024),
            NB_BACKUP_MAX_COUNT: "3",
            NB_BACKUP_UPLOAD_RATE_LIMIT: "1000",
        },
        stdio: "pipe",
    });

    const deadline = Date.now() + 30_000;
    while (true) {
        try {
            const response = await fetch(`${baseUrl}/api/v1/meta`);
            if (response.ok) {
                break;
            }
        } catch {
            // server 未就绪，继续轮询
        }
        if (Date.now() > deadline) {
            throw new Error("集成测试 server 启动超时（30s）");
        }
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 300));
    }
}, 90_000);

afterAll(async () => {
    server?.kill();
    // Windows 上 server 释放 SQLite / 备份文件句柄需要时间：重试删除；
    // 清理失败不拖垮测试结果（.agent 下残留目录无害，下次同 pid 运行会先清）
    for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
        try {
            rmSync(runDir, {recursive: true, force: true});
            return;
        } catch {
            // 句柄尚未释放，继续等
        }
    }
});

describe("Passport 设备授权流", () => {
    it("准备：admin 登录、邀请码注册两个用户", async () => {
        const login = await api("/api/auth/login", {jar: adminJar, json: {username: "admin", password: "admin1234567890-test"}});
        expect(login.status).toBe(200);
        const issued = await api("/api/v1/admin/invite-codes", {jar: adminJar, json: {count: 2}});
        const codes = ((await issued.json()) as InviteCodeDto[]).map((code) => code.code);

        const register1 = await api("/api/auth/register", {jar: userJar, json: {username: "author1", password: "password123", inviteCode: codes[0]}});
        expect(register1.status).toBe(200);
        const register2 = await api("/api/auth/register", {jar: otherJar, json: {username: "other1", password: "password123", inviteCode: codes[1]}});
        expect(register2.status).toBe(200);
    });

    it("设备码申请：scope 非法 / 不在集合内被拒", async () => {
        const bogus = await api("/api/v1/passport/device/code", {json: {instanceName: "x", scopes: ["bogus:scope"]}});
        expect(bogus.status).toBe(400);
        const empty = await api("/api/v1/passport/device/code", {json: {instanceName: "x", scopes: []}});
        expect(empty.status).toBe(400);
    });

    it("轮询状态机：pending → slow_down", async () => {
        const code = await createDeviceCode(ALL_SCOPES, "开发机实例");
        mainUserCode = code.userCode;
        expect(code.userCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        expect(code.verificationUriComplete).toContain(`/link?code=${code.userCode}`);

        const first = await pollToken(code.deviceCode);
        expect(first.status).toBe(400);
        expect(await grantErrorCode(first)).toBe("authorization_pending");

        // interval 已放大到 60s：紧随其后的第二次轮询必命中 slow_down
        const second = await pollToken(code.deviceCode);
        expect(second.status).toBe(400);
        expect(await grantErrorCode(second)).toBe("slow_down");

        // 主授权码留给后续批准用例；deviceCode 存回共享状态
        mainDeviceCode = code.deviceCode;
    });

    it("/link 查询：未登录 401、归一化输入可查、乱码 404", async () => {
        const anonymous = await api(`/api/v1/passport/device/${mainUserCode}`);
        expect(anonymous.status).toBe(401);

        // 小写、无横线、混淆字符（0↔O）也能查到
        const sloppy = mainUserCode.toLowerCase().replace("-", "").replaceAll("0", "o");
        const found = await api(`/api/v1/passport/device/${encodeURIComponent(sloppy)}`, {jar: userJar});
        expect(found.status).toBe(200);
        const pending = (await found.json()) as PendingDeviceDto;
        expect(pending.status).toBe("pending");
        expect(pending.instanceName).toBe("开发机实例");
        expect(pending.scopes).toEqual(ALL_SCOPES);

        const missing = await api("/api/v1/passport/device/ZZZZ-ZZZZ", {jar: userJar});
        expect(missing.status).toBe(404);
    });

    it("批准（可改实例名）并兑换 token；双兑与二次批准被拒", async () => {
        const approve = await approveDevice(userJar, mainUserCode, "我的测试实例");
        expect(approve.status).toBe(200);

        const exchange = await pollToken(mainDeviceCode);
        expect(exchange.status).toBe(200);
        mainGrant = (await exchange.json()) as TokenGrantDto;
        expect(mainGrant.accessToken).toMatch(/^nbp_at_/);
        expect(mainGrant.refreshToken).toMatch(/^nbp_rt_/);
        expect(mainGrant.scopes).toEqual(ALL_SCOPES);
        expect(mainGrant.account.username).toBe("author1");

        // 同一设备码双兑：consumed → invalid_grant
        const again = await pollToken(mainDeviceCode);
        expect(again.status).toBe(400);
        expect(await grantErrorCode(again)).toBe("invalid_grant");

        // 已消费的码再批准 → 409
        const reApprove = await approveDevice(userJar, mainUserCode, "x");
        expect(reApprove.status).toBe(409);
    });

    it("Bearer 发布链路：建条目 / 传版本 / me items / 编辑；admin 面拒绝 Bearer", async () => {
        const token = mainGrant!.accessToken;

        const created = await api("/api/v1/items", {token, json: {slug: "passport-e2e-skill", type: "skill", title: "Passport E2E"}});
        expect(created.status).toBe(200);
        const item = (await created.json()) as WorkshopItemDto;

        const zip = buildPackageZip(
            {manifestVersion: 1, type: "skill", name: "passport-e2e-skill", version: 1},
            {"SKILL.md": strToU8("# passport e2e\n")},
        );
        const form = new FormData();
        form.append("file", new Blob([zip as BlobPart], {type: "application/zip"}), "pkg.zip");
        const uploaded = await api(`/api/v1/items/${item.slug}/versions`, {token, form});
        expect(uploaded.status).toBe(200);
        expect(((await uploaded.json()) as ItemVersionDto).version).toBe(1);

        const mine = await api("/api/v1/me/items", {token});
        expect(mine.status).toBe(200);
        const page = (await mine.json()) as PageDto<WorkshopItemDto>;
        expect(page.items.some((entry) => entry.slug === "passport-e2e-skill")).toBe(true);

        const patched = await api(`/api/v1/items/${item.slug}`, {token, method: "PATCH", json: {title: "Passport E2E v2"}});
        expect(patched.status).toBe(200);

        // admin 端点永不接受 Bearer
        const admin = await api("/api/v1/admin/invite-codes", {token, json: {count: 1}});
        expect(admin.status).toBe(401);
    });

    it("scope 越权：publish-only token 访问备份面 → 403 insufficient_scope", async () => {
        const code = await createDeviceCode(["workshop:publish"], "受限实例");
        await approveDevice(userJar, code.userCode, "受限实例");
        const exchange = await pollToken(code.deviceCode);
        expect(exchange.status).toBe(200);
        publishOnlyGrant = (await exchange.json()) as TokenGrantDto;

        const denied = await api("/api/v1/backups", {token: publishOnlyGrant.accessToken});
        expect(denied.status).toBe(403);
        expect(await grantErrorCode(denied)).toBe("insufficient_scope");
    });
});

describe("Backup 上传下载与配额", () => {
    const b1Bytes = makeBytes(600, 1);

    it("硬切拒绝旧 zip、错误 MIME、错误扩展名和错误 magic", async () => {
        const token = mainGrant!.accessToken;
        const meta = {sha256: sha256Hex(b1Bytes), appVersion: "0.9.0", kind: "manual"};
        const oldZip = new TextEncoder().encode("PK\u0003\u0004legacy-plaintext-archive");
        const cases = [
            backupForm(oldZip, {...meta, sha256: sha256Hex(oldZip)}, {mimeType: "application/zip", fileName: "backup.zip"}),
            backupForm(b1Bytes, meta, {mimeType: "application/zip", fileName: "backup.nbbackup"}),
            backupForm(b1Bytes, meta, {mimeType: "application/vnd.neurobook.backup", fileName: "backup.zip"}),
            backupForm(oldZip, {...meta, sha256: sha256Hex(oldZip)}),
        ];

        for (const form of cases) {
            const response = await api("/api/v1/backups", {token, form});
            expect(response.status).toBe(400);
            expect(await grantErrorCode(response)).toBe("invalid_backup_format");
        }
    });

    it("上传 manual 备份：sha256 复算一致；不符拒收", async () => {
        const token = mainGrant!.accessToken;

        const bad = await api("/api/v1/backups", {token, form: backupForm(b1Bytes, {sha256: sha256Hex(makeBytes(600, 99)), appVersion: "0.9.0", kind: "manual"})});
        expect(bad.status).toBe(400);

        const ok = await api("/api/v1/backups", {token, form: backupForm(b1Bytes, {sha256: sha256Hex(b1Bytes), appVersion: "0.9.0", kind: "manual", comment: "首个备份"})});
        expect(ok.status).toBe(200);
        const backup = (await ok.json()) as BackupDto;
        expect(backup.instanceLabel).toBe("我的测试实例");
        expect(backup.kind).toBe("manual");
        expect(backup.keyId).toBe("0123456789abcdef");
        expect(backup.fileSize).toBe(600);
        backupIds = [backup.id];
    });

    it("session 也可读列表；下载字节与 sha256 头一致", async () => {
        const list = await api("/api/v1/backups", {jar: userJar});
        expect(list.status).toBe(200);
        const data = (await list.json()) as BackupListDto;
        expect(data.items).toHaveLength(1);
        expect(data.quota.usedBytes).toBe(600);
        expect(data.quota.maxCount).toBe(3);

        const download = await api(`/api/v1/backups/${backupIds[0]}/download`, {token: mainGrant!.accessToken});
        expect(download.status).toBe(200);
        expect(download.headers.get("x-nb-sha256")).toBe(sha256Hex(b1Bytes));
        expect(download.headers.get("content-type")).toBe("application/vnd.neurobook.backup");
        expect(download.headers.get("content-disposition")).toContain(".nbbackup");
        const bytes = new Uint8Array(await download.arrayBuffer());
        expect(sha256Hex(bytes)).toBe(sha256Hex(b1Bytes));
    });

    it("份数配额：满 3 份后 413 quota_exceeded；rotate 只淘汰同 label 的 auto", async () => {
        const token = mainGrant!.accessToken;
        const b2 = makeBytes(600, 2);
        const b3 = makeBytes(600, 3);
        const upload2 = await api("/api/v1/backups", {token, form: backupForm(b2, {sha256: sha256Hex(b2), appVersion: "0.9.0", kind: "auto"})});
        expect(upload2.status).toBe(200);
        const backup2 = (await upload2.json()) as BackupDto;
        const upload3 = await api("/api/v1/backups", {token, form: backupForm(b3, {sha256: sha256Hex(b3), appVersion: "0.9.0", kind: "auto"})});
        expect(upload3.status).toBe(200);
        const backup3 = (await upload3.json()) as BackupDto;

        // 第 4 份（不带 rotate）→ 413，附配额信息
        const b4 = makeBytes(600, 4);
        const over = await api("/api/v1/backups", {token, form: backupForm(b4, {sha256: sha256Hex(b4), appVersion: "0.9.0", kind: "auto"})});
        expect(over.status).toBe(413);
        expect(await grantErrorCode(over)).toBe("quota_exceeded");

        // rotate=true：淘汰最旧的 auto（backup2），manual（b1）幸存
        const rotated = await api("/api/v1/backups", {token, form: backupForm(b4, {sha256: sha256Hex(b4), appVersion: "0.9.0", kind: "auto", rotate: true})});
        expect(rotated.status).toBe(200);
        const backup4 = (await rotated.json()) as BackupDto;

        const list = await api("/api/v1/backups", {token});
        const data = (await list.json()) as BackupListDto;
        const ids = data.items.map((entry) => entry.id).sort((a, b) => a - b);
        expect(ids).toEqual([backupIds[0], backup3.id, backup4.id].sort((a, b) => a - b));
        expect(ids).not.toContain(backup2.id);
        backupIds = [backupIds[0]!, backup3.id, backup4.id];
    });

    it("单份体积超限 → 413", async () => {
        const huge = makeBytes(1024 * 1024 + 200 * 1024, 5); // 1.2 MiB > 1 MiB 上限
        const response = await api("/api/v1/backups", {
            token: mainGrant!.accessToken,
            form: backupForm(huge, {sha256: sha256Hex(huge), appVersion: "0.9.0", kind: "manual", rotate: true}),
        });
        expect(response.status).toBe(413);
    });

    it("越权与匿名：他人备份 404、匿名 401；删除幂等", async () => {
        const anonymous = await api("/api/v1/backups");
        expect(anonymous.status).toBe(401);

        const foreign = await api(`/api/v1/backups/${backupIds[0]}`, {jar: otherJar});
        expect(foreign.status).toBe(404);

        const removed = await api(`/api/v1/backups/${backupIds[2]}`, {token: mainGrant!.accessToken, method: "DELETE"});
        expect(removed.status).toBe(200);
        const again = await api(`/api/v1/backups/${backupIds[2]}`, {token: mainGrant!.accessToken, method: "DELETE"});
        expect(again.status).toBe(200);

        const list = await api("/api/v1/backups", {token: mainGrant!.accessToken});
        expect(((await list.json()) as BackupListDto).items).toHaveLength(2);
    });
});

describe("refresh 轮换、撤链与吊销", () => {
    it("refresh 轮换出新对；旧 token 重放 → 整链撤销", async () => {
        const code = await createDeviceCode(ALL_SCOPES, "轮换实例");
        await approveDevice(userJar, code.userCode, "轮换实例");
        const grant = (await (await pollToken(code.deviceCode)).json()) as TokenGrantDto;

        const rotated = await refreshToken(grant.refreshToken);
        expect(rotated.status).toBe(200);
        const next = (await rotated.json()) as TokenGrantDto;
        expect(next.refreshToken).not.toBe(grant.refreshToken);
        expect(next.accessToken).not.toBe(grant.accessToken);

        // 旧 refresh 重放：invalid_grant 且整链（含新 token）作废
        const replay = await refreshToken(grant.refreshToken);
        expect(replay.status).toBe(400);
        expect(await grantErrorCode(replay)).toBe("invalid_grant");

        const newRefreshDead = await refreshToken(next.refreshToken);
        expect(newRefreshDead.status).toBe(400);
        expect(await grantErrorCode(newRefreshDead)).toBe("invalid_grant");

        const accessDead = await api("/api/v1/me/items", {token: next.accessToken});
        expect(accessDead.status).toBe(401);
    });

    it("实例主动 revoke：链上 token 全失效，幂等 200", async () => {
        const code = await createDeviceCode(ALL_SCOPES, "注销实例");
        await approveDevice(userJar, code.userCode, "注销实例");
        const grant = (await (await pollToken(code.deviceCode)).json()) as TokenGrantDto;

        const revoke = await api("/api/v1/passport/revoke", {json: {refreshToken: grant.refreshToken}});
        expect(revoke.status).toBe(200);

        const accessDead = await api("/api/v1/me/items", {token: grant.accessToken});
        expect(accessDead.status).toBe(401);
        const refreshDead = await refreshToken(grant.refreshToken);
        expect(await grantErrorCode(refreshDead)).toBe("invalid_grant");

        const revokeAgain = await api("/api/v1/passport/revoke", {json: {refreshToken: grant.refreshToken}});
        expect(revokeAgain.status).toBe(200);
    });

    it("过期设备码 → expired_token，/link 显示过期", async () => {
        const code = await createDeviceCode(ALL_SCOPES, "过期实例");
        // 直接把库中 expiresAt 改到过去（按实际存储类型选择同型值）
        const client = createClient({url: `file:${dbPath}`});
        try {
            const row = await client.execute({sql: "SELECT expiresAt FROM PassportDeviceCode WHERE userCode = ?", args: [code.userCode]});
            const current = row.rows[0]?.expiresAt;
            const past = typeof current === "number" ? 1000 : "2000-01-01T00:00:00.000Z";
            await client.execute({sql: "UPDATE PassportDeviceCode SET expiresAt = ? WHERE userCode = ?", args: [past, code.userCode]});
        } finally {
            client.close();
        }

        const poll = await pollToken(code.deviceCode);
        expect(poll.status).toBe(400);
        expect(await grantErrorCode(poll)).toBe("expired_token");

        const view = await api(`/api/v1/passport/device/${code.userCode}`, {jar: userJar});
        expect(((await view.json()) as PendingDeviceDto).status).toBe("expired");
    });

    it("拒绝流：deny 后轮询 → access_denied", async () => {
        const code = await createDeviceCode(ALL_SCOPES, "拒绝实例");
        const deny = await api(`/api/v1/passport/device/${code.userCode}/deny`, {jar: userJar, method: "POST"});
        expect(deny.status).toBe(200);

        const poll = await pollToken(code.deviceCode);
        expect(poll.status).toBe(400);
        expect(await grantErrorCode(poll)).toBe("access_denied");
    });
});

describe("授权管理面板", () => {
    it("列表 / 重命名 / 越权 404", async () => {
        const list = await api("/api/v1/passport/authorizations", {jar: userJar});
        expect(list.status).toBe(200);
        const authorizations = (await list.json()) as AuthorizationDto[];
        const main = authorizations.find((auth) => auth.instanceName === "我的测试实例");
        expect(main).toBeDefined();
        // 轮换实例已被重放撤链，revokedAt 非空
        const rotatedAuth = authorizations.find((auth) => auth.instanceName === "轮换实例");
        expect(rotatedAuth?.revokedAt).not.toBeNull();

        const renamed = await api(`/api/v1/passport/authorizations/${main!.id}`, {jar: userJar, method: "PATCH", json: {instanceName: "改名实例"}});
        expect(renamed.status).toBe(200);
        expect(((await renamed.json()) as AuthorizationDto).instanceName).toBe("改名实例");

        // 他人视角：404 不泄露存在性
        const foreign = await api(`/api/v1/passport/authorizations/${main!.id}`, {jar: otherJar, method: "PATCH", json: {instanceName: "x"}});
        expect(foreign.status).toBe(404);
    });

    it("面板吊销主授权：Bearer 全 401、refresh 作废", async () => {
        const list = await api("/api/v1/passport/authorizations", {jar: userJar});
        const authorizations = (await list.json()) as AuthorizationDto[];
        const main = authorizations.find((auth) => auth.instanceName === "改名实例");
        expect(main).toBeDefined();

        const revoked = await api(`/api/v1/passport/authorizations/${main!.id}`, {jar: userJar, method: "DELETE"});
        expect(revoked.status).toBe(200);

        const accessDead = await api("/api/v1/backups", {token: mainGrant!.accessToken});
        expect(accessDead.status).toBe(401);
        const refreshDead = await refreshToken(mainGrant!.refreshToken);
        expect(await grantErrorCode(refreshDead)).toBe("invalid_grant");
    });

    it("设备码申请限流：超 10 次/小时 → 429", async () => {
        let hit429 = false;
        for (let i = 0; i < 12; i++) {
            const response = await api("/api/v1/passport/device/code", {json: {instanceName: `limit-${i}`, scopes: ["workshop:publish"]}});
            if (response.status === 429) {
                hit429 = true;
                break;
            }
            expect(response.status).toBe(200);
        }
        expect(hit429).toBe(true);
    });
});
