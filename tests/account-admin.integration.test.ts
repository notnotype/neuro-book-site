import {execSync, spawn, type ChildProcess} from "node:child_process";
import {existsSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {createClient, type Client} from "@libsql/client";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import type {AdminBackupDto, AdminBackupUsageDto, AdminStatsDto, AdminUserDto} from "../shared/dto/admin.dto";
import type {MeProfileDto} from "../shared/dto/auth.dto";
import type {DeviceCodeDto, PassportIdentityDto, TokenGrantDto} from "../shared/dto/passport.dto";
import type {PageDto, PublicUserDto, WorkshopItemDto} from "../shared/dto/workshop.dto";
import type {InviteCodeDto, RegistrationCodeDto} from "../shared/dto/access-code.dto";

// 账号第二轮 + admin 后台真实 HTTP 集成测试：build 产物起真实 server，覆盖
// OAuth 补全注册守卫 / 身份绑定解绑（免密守卫）/ profile / 改密与踢线 / admin 用户管理与封禁 /
// 统计 / 注册码 / 用户邀请码 / admin 备份用量与删除 / 登录限流 429（放最后）。
// GitHub 真实回调无法在测试内走通（需上游交互），三分支决策由 tests/github-oauth.test.ts 单测覆盖，
// 绑定态在这里直接写库构造（PassportIdentity 行），验证的是绑定之后的管理面契约。

const repoRoot = resolve(import.meta.dirname, "..");
const runDir = join(repoRoot, ".agent", `account-admin-integration-${process.pid}`);
const dbPath = join(runDir, "workshop.db").replaceAll("\\", "/");
const filesDir = join(runDir, "files");
const backupsDir = join(runDir, "backups");
const port = 35600 + (process.pid % 400);
const baseUrl = `http://127.0.0.1:${port}`;

let server: ChildProcess | null = null;
let db: Client | null = null;
// Prisma/libsql 的 DateTime 落库格式（number=毫秒时间戳 / string=ISO），运行时探测
let dateIsNumber = false;

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
    token?: string; // Bearer access token
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

/** 当前会话的登录态（/api/auth/me），user 为 null 即会话已失效 */
async function sessionUser(jar: CookieJar): Promise<{username: string} | null> {
    const response = await api("/api/auth/me", {jar});
    const payload = (await response.json()) as {user: {username: string} | null};
    return payload.user;
}

/** 直接写库：按探测到的格式生成 DateTime 值 */
function dbNow(): number | string {
    return dateIsNumber ? Date.now() : new Date().toISOString();
}

/** 查库取用户 id */
async function userIdOf(username: string): Promise<number> {
    const result = await db!.execute({sql: "SELECT id FROM User WHERE username = ?", args: [username]});
    const id = result.rows[0]?.id;
    expect(id, `用户 ${username} 应存在`).toBeDefined();
    return Number(id);
}

// ---------- 共享测试状态（同文件内串行执行） ----------

const adminJar = new CookieJar();
const u1Jar = new CookieJar(); // au1：主用户（profile / 改密 / 身份）
const u2Jar = new CookieJar(); // au2：封禁与 Bearer 用例
const u3Jar = new CookieJar(); // au3：免密账号（模拟 OAuth 注册形态）

let u2Grant: TokenGrantDto | null = null; // au2 的设备码授权（封禁 Bearer 面用）
let registrationCode = "";

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
            // 注册限流放开（本文件注册多个用户）；登录限流保持默认 10 次/5min，末尾用例验证 429
            NB_REGISTER_RATE_LIMIT: "1000",
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

    db = createClient({url: `file:${dbPath}`});
    const probe = await db.execute("SELECT createdAt FROM User LIMIT 1");
    dateIsNumber = typeof probe.rows[0]?.createdAt === "number";
}, 90_000);

afterAll(async () => {
    db?.close();
    server?.kill();
    // Windows 上句柄释放需要时间：重试删除，清理失败不拖垮测试（.agent 下残留无害）
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

describe("账号第二轮：OAuth 注册面与身份管理", () => {
    it("准备：admin 登录、签发不限次数注册码、注册三个用户", async () => {
        const login = await api("/api/auth/login", {jar: adminJar, json: {username: "admin", password: "admin1234567890-test"}});
        expect(login.status).toBe(200);

        const issued = await api("/api/v1/admin/registration-codes", {jar: adminJar, json: {count: 1, note: "账号测试批次", maxUses: null, expiresAt: null}});
        expect(issued.status).toBe(200);
        registrationCode = ((await issued.json()) as RegistrationCodeDto[])[0]!.code;

        for (const [index, jar] of [u1Jar, u2Jar, u3Jar].entries()) {
            const register = await api("/api/auth/register", {jar, json: {username: `au${index + 1}`, password: "password123", registrationCode}});
            expect(register.status).toBe(200);
        }
    });

    it("注册码设置：限次、到期、停用和权限", async () => {
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const spare = await api("/api/v1/admin/registration-codes", {jar: adminJar, json: {count: 1, note: "活动码", maxUses: 2, expiresAt: future}});
        expect(spare.status).toBe(200);
        const created = ((await spare.json()) as RegistrationCodeDto[])[0]!;
        expect(created.maxUses).toBe(2);
        expect(created.expiresAt).toBe(future);

        const listed = await api("/api/v1/admin/registration-codes", {jar: adminJar});
        const page = (await listed.json()) as PageDto<RegistrationCodeDto>;
        expect(page.total).toBe(2);
        expect(page.items.find((code) => code.id === created.id)?.note).toBe("活动码");

        const shared = page.items.find((code) => code.code === registrationCode)!;
        const belowUsedCount = await api(`/api/v1/admin/registration-codes/${shared.id}`, {method: "PATCH", jar: adminJar, json: {maxUses: 2}});
        expect(belowUsedCount.status).toBe(400);
        expect(((await belowUsedCount.json()) as {message?: string}).message).toContain("使用上限不能小于已使用次数");

        const disabled = await api(`/api/v1/admin/registration-codes/${created.id}`, {method: "PATCH", jar: adminJar, json: {disabled: true}});
        expect(disabled.status).toBe(200);
        const deniedDisabled = await api("/api/auth/register", {json: {username: "disabled-code-user", password: "password123", registrationCode: created.code}});
        expect(deniedDisabled.status).toBe(400);
        expect(((await deniedDisabled.json()) as {message?: string}).message).toContain("注册码已停用");

        await api(`/api/v1/admin/registration-codes/${created.id}`, {method: "PATCH", jar: adminJar, json: {disabled: false}});
        const past = dateIsNumber ? Date.now() - 1000 : new Date(Date.now() - 1000).toISOString();
        await db!.execute({sql: "UPDATE RegistrationCode SET expiresAt = ? WHERE id = ?", args: [past, created.id]});
        const deniedExpired = await api("/api/auth/register", {json: {username: "expired-code-user", password: "password123", registrationCode: created.code}});
        expect(deniedExpired.status).toBe(400);
        expect(((await deniedExpired.json()) as {message?: string}).message).toContain("注册码已过期");

        // 非 admin 不可见
        const forbidden = await api("/api/v1/admin/registration-codes", {jar: u1Jar});
        expect(forbidden.status).toBe(403);
    });

    it("用户邀请码：可选归属、分享次数和创建者权限", async () => {
        const createdResponse = await api("/api/v1/me/invite-codes", {jar: u1Jar, json: {note: "好友", maxUses: 2, expiresAt: null}});
        expect(createdResponse.status).toBe(200);
        const invite = (await createdResponse.json()) as InviteCodeDto;

        const foreign = await api(`/api/v1/me/invite-codes/${invite.id}`, {method: "PATCH", jar: u2Jar, json: {disabled: true}});
        expect(foreign.status).toBe(404);

        const invited = await api("/api/auth/register", {json: {username: "invited-user", password: "password123", registrationCode, inviteCode: invite.code}});
        expect(invited.status).toBe(200);
        const mine = (await (await api("/api/v1/me/invite-codes", {jar: u1Jar})).json()) as InviteCodeDto[];
        expect(mine[0]?.usedCount).toBe(1);

        const disabled = await api(`/api/v1/me/invite-codes/${invite.id}`, {method: "PATCH", jar: u1Jar, json: {disabled: true}});
        expect(disabled.status).toBe(200);
        const denied = await api("/api/auth/register", {json: {username: "invite-disabled-user", password: "password123", registrationCode, inviteCode: invite.code}});
        expect(denied.status).toBe(400);
        expect(((await denied.json()) as {message?: string}).message).toContain("邀请码已停用");
    });

    it("OAuth 补全注册守卫：无 pending 身份时 GET 404 / POST 400", async () => {
        const read = await api("/api/auth/register/oauth");
        expect(read.status).toBe(404);

        const complete = await api("/api/auth/register/oauth", {json: {username: "ghosty", registrationCode: "nbr-whatever"}});
        expect(complete.status).toBe(400);
    });

    it("身份管理：列表 / 解绑（有密码可解绑，越权 404）", async () => {
        const u1Id = await userIdOf("au1");
        await db!.execute({
            sql: "INSERT INTO PassportIdentity (provider, providerUserId, providerUsername, userId, createdAt) VALUES (?, ?, ?, ?, ?)",
            args: ["github", "9001", "au1-gh", u1Id, dbNow()],
        });

        const list = await api("/api/v1/passport/identities", {jar: u1Jar});
        expect(list.status).toBe(200);
        const identities = (await list.json()) as PassportIdentityDto[];
        expect(identities).toHaveLength(1);
        expect(identities[0]!.provider).toBe("github");
        expect(identities[0]!.providerUsername).toBe("au1-gh");

        // 他人解绑 → 404（不泄露存在性）
        const foreign = await api(`/api/v1/passport/identities/${identities[0]!.id}`, {method: "DELETE", jar: u2Jar});
        expect(foreign.status).toBe(404);

        // 本人有密码 → 解绑成功且幂等面收敛
        const unlink = await api(`/api/v1/passport/identities/${identities[0]!.id}`, {method: "DELETE", jar: u1Jar});
        expect(unlink.status).toBe(200);
        const relist = (await (await api("/api/v1/passport/identities", {jar: u1Jar})).json()) as PassportIdentityDto[];
        expect(relist).toHaveLength(0);
    });

    it("免密账号：密码登录拒绝、解绑被禁止、补设密码后解锁", async () => {
        // 把 au3 改造成 OAuth 免密形态：清空密码 + 绑一个 GitHub 身份
        const u3Id = await userIdOf("au3");
        await db!.execute({sql: "UPDATE User SET passwordHash = NULL WHERE id = ?", args: [u3Id]});
        await db!.execute({
            sql: "INSERT INTO PassportIdentity (provider, providerUserId, providerUsername, userId, createdAt) VALUES (?, ?, ?, ?, ?)",
            args: ["github", "9003", "au3-gh", u3Id, dbNow()],
        });

        // 免密账号密码登录 → 统一 401，不泄露账号形态
        const passwordLogin = await api("/api/auth/login", {json: {username: "au3", password: "password123"}});
        expect(passwordLogin.status).toBe(401);

        // hasPassword 如实反映
        const profile = (await (await api("/api/v1/me/profile", {jar: u3Jar})).json()) as MeProfileDto;
        expect(profile.hasPassword).toBe(false);

        // 未设密码时解绑被拒（唯一登录方式不可移除）
        const identities = (await (await api("/api/v1/passport/identities", {jar: u3Jar})).json()) as PassportIdentityDto[];
        const denied = await api(`/api/v1/passport/identities/${identities[0]!.id}`, {method: "DELETE", jar: u3Jar});
        expect(denied.status).toBe(400);

        // 补设密码：免旧密分支
        const setPassword = await api("/api/v1/me/password", {jar: u3Jar, json: {newPassword: "newpass12345"}});
        expect(setPassword.status).toBe(200);

        // 补设后可密码登录、可解绑
        const relogin = await api("/api/auth/login", {json: {username: "au3", password: "newpass12345"}});
        expect(relogin.status).toBe(200);
        const unlink = await api(`/api/v1/passport/identities/${identities[0]!.id}`, {method: "DELETE", jar: u3Jar});
        expect(unlink.status).toBe(200);
    });
});

describe("Profile 与展示位透出", () => {
    it("资料更新：合法字段生效、危险 avatarUrl 被拒", async () => {
        const patch = await api("/api/v1/me/profile", {
            method: "PATCH",
            jar: u1Jar,
            json: {displayName: "作者一号", bio: "写作是把噪声炼成信号。", websiteUrl: "https://au1.example.com", avatarUrl: "https://au1.example.com/avatar.png"},
        });
        expect(patch.status).toBe(200);
        const updated = (await patch.json()) as MeProfileDto;
        expect(updated.displayName).toBe("作者一号");
        expect(updated.bio).toBe("写作是把噪声炼成信号。");

        // javascript: 伪协议进 <img src> 是 XSS 面，必须 400
        const evil = await api("/api/v1/me/profile", {
            method: "PATCH",
            jar: u1Jar,
            json: {displayName: "作者一号", bio: "", websiteUrl: "", avatarUrl: "javascript:alert(1)"},
        });
        expect(evil.status).toBe(400);

        // bio 超长 400
        const longBio = await api("/api/v1/me/profile", {
            method: "PATCH",
            jar: u1Jar,
            json: {displayName: "作者一号", bio: "长".repeat(201), websiteUrl: "", avatarUrl: ""},
        });
        expect(longBio.status).toBe(400);
    });

    it("作者公开页与条目作者摘要透出新字段", async () => {
        const publicUser = (await (await api("/api/v1/users/au1")).json()) as PublicUserDto;
        expect(publicUser.bio).toBe("写作是把噪声炼成信号。");
        expect(publicUser.avatarUrl).toBe("https://au1.example.com/avatar.png");
        expect(publicUser.websiteUrl).toBe("https://au1.example.com");

        // 建一个条目验证 ItemAuthorDto.avatarUrl 全链透出
        const created = await api("/api/v1/items", {jar: u1Jar, json: {slug: "au1-demo-skill", type: "skill", title: "演示条目"}});
        expect(created.status).toBe(200);
        const detail = (await (await api("/api/v1/items/au1-demo-skill")).json()) as WorkshopItemDto;
        expect(detail.author.avatarUrl).toBe("https://au1.example.com/avatar.png");
    });
});

describe("修改密码与会话治理", () => {
    it("旧密错 401；改密成功后其他会话失效、当前会话保活、新密码可登录", async () => {
        // 第二个设备的会话：改密后应被踢
        const secondDevice = new CookieJar();
        const secondLogin = await api("/api/auth/login", {jar: secondDevice, json: {username: "au1", password: "password123"}});
        expect(secondLogin.status).toBe(200);

        const wrong = await api("/api/v1/me/password", {jar: u1Jar, json: {currentPassword: "wrong-password", newPassword: "rotated12345"}});
        expect(wrong.status).toBe(401);

        const change = await api("/api/v1/me/password", {jar: u1Jar, json: {currentPassword: "password123", newPassword: "rotated12345"}});
        expect(change.status).toBe(200);

        // 其他设备被踢（sessionVersion 不匹配 → user 清空），当前会话保活
        expect(await sessionUser(secondDevice)).toBeNull();
        expect((await sessionUser(u1Jar))?.username).toBe("au1");

        // 新密码可登录，旧密码不可
        const oldLogin = await api("/api/auth/login", {json: {username: "au1", password: "password123"}});
        expect(oldLogin.status).toBe(401);
        const newLogin = await api("/api/auth/login", {json: {username: "au1", password: "rotated12345"}});
        expect(newLogin.status).toBe(200);
    });
});

describe("Admin 用户管理与封禁", () => {
    it("用户列表：搜索 + 字段完整性", async () => {
        const page = await api("/api/v1/admin/users?search=au1", {jar: adminJar});
        expect(page.status).toBe(200);
        const users = (await page.json()) as PageDto<AdminUserDto>;
        const au1 = users.items.find((user) => user.username === "au1");
        expect(au1).toBeDefined();
        expect(au1!.itemCount).toBe(1);
        expect(au1!.hasPassword).toBe(true);
        expect(au1!.status).toBe("active");

        // 非 admin 403
        const forbidden = await api("/api/v1/admin/users", {jar: u1Jar});
        expect(forbidden.status).toBe(403);
    });

    it("封禁：cookie 会话即死、密码登录拒、Bearer 面拒；解封恢复", async () => {
        // 先给 au2 建立设备码授权（封禁要同时打死 Bearer 面）
        const codeResponse = await api("/api/v1/passport/device/code", {json: {instanceName: "au2 实例", scopes: ["workshop:publish", "backup:read", "backup:write"]}});
        const device = (await codeResponse.json()) as DeviceCodeDto;
        const approve = await api(`/api/v1/passport/device/${encodeURIComponent(device.userCode)}/approve`, {jar: u2Jar, json: {instanceName: "au2 实例"}});
        expect(approve.status).toBe(200);
        const grantResponse = await api("/api/v1/passport/token", {json: {grantType: "device_code", deviceCode: device.deviceCode}});
        expect(grantResponse.status).toBe(200);
        u2Grant = (await grantResponse.json()) as TokenGrantDto;

        const bearerOk = await api("/api/v1/me/items", {token: u2Grant.accessToken});
        expect(bearerOk.status).toBe(200);

        // 封禁
        const u2Id = await userIdOf("au2");
        const disable = await api(`/api/v1/admin/users/${u2Id}/status`, {method: "PATCH", jar: adminJar, json: {status: "disabled"}});
        expect(disable.status).toBe(200);

        expect(await sessionUser(u2Jar)).toBeNull();
        const loginBanned = await api("/api/auth/login", {json: {username: "au2", password: "password123"}});
        expect(loginBanned.status).toBe(401);
        const bearerBanned = await api("/api/v1/me/items", {token: u2Grant.accessToken});
        expect(bearerBanned.status).toBe(401);

        // 作者页 404（封禁不泄露）
        const publicPage = await api("/api/v1/users/au2");
        expect(publicPage.status).toBe(404);

        // 解封后可重新登录
        const enable = await api(`/api/v1/admin/users/${u2Id}/status`, {method: "PATCH", jar: adminJar, json: {status: "active"}});
        expect(enable.status).toBe(200);
        const reLogin = await api("/api/auth/login", {jar: u2Jar, json: {username: "au2", password: "password123"}});
        expect(reLogin.status).toBe(200);
    });

    it("self-guard：admin 不能封禁自己 / 不能变更自己角色", async () => {
        const adminId = await userIdOf("admin");
        const banSelf = await api(`/api/v1/admin/users/${adminId}/status`, {method: "PATCH", jar: adminJar, json: {status: "disabled"}});
        expect(banSelf.status).toBe(400);
        const demoteSelf = await api(`/api/v1/admin/users/${adminId}/role`, {method: "PATCH", jar: adminJar, json: {role: "user"}});
        expect(demoteSelf.status).toBe(400);
    });

    it("角色授予/收回：目标被踢线重登后权限生效/失效", async () => {
        const u1Id = await userIdOf("au1");
        const promote = await api(`/api/v1/admin/users/${u1Id}/role`, {method: "PATCH", jar: adminJar, json: {role: "admin"}});
        expect(promote.status).toBe(200);

        // 授予后旧会话被踢线，重登后可访问 admin 面
        expect(await sessionUser(u1Jar)).toBeNull();
        const reLogin = await api("/api/auth/login", {jar: u1Jar, json: {username: "au1", password: "rotated12345"}});
        expect(reLogin.status).toBe(200);
        const statsAsAdmin = await api("/api/v1/admin/stats", {jar: u1Jar});
        expect(statsAsAdmin.status).toBe(200);

        // 收回后重登，admin 面 403
        const demote = await api(`/api/v1/admin/users/${u1Id}/role`, {method: "PATCH", jar: adminJar, json: {role: "user"}});
        expect(demote.status).toBe(200);
        await api("/api/auth/login", {jar: u1Jar, json: {username: "au1", password: "rotated12345"}});
        const statsAsUser = await api("/api/v1/admin/stats", {jar: u1Jar});
        expect(statsAsUser.status).toBe(403);
    });
});

describe("Admin 统计与备份用量", () => {
    it("站点统计：数字口径合理", async () => {
        const stats = (await (await api("/api/v1/admin/stats", {jar: adminJar})).json()) as AdminStatsDto;
        expect(stats.userTotal).toBeGreaterThanOrEqual(4); // admin + au1..au3
        expect(stats.userRecent30d).toBeGreaterThanOrEqual(3);
        expect(stats.itemPublished).toBeGreaterThanOrEqual(1);
        expect(stats.registrationCodeTotal).toBe(2);
        expect(stats.reportPending).toBe(0);
        expect(stats.backupCount).toBe(0);
    });

    it("备份用量：上传后聚合可见，admin 可删除任意账号备份", async () => {
        // au2 用 Bearer 上传一份小备份（封禁解除后授权链未吊销，token 仍有效）
        const bytes = new TextEncoder().encode("NBOOKBK1fake-encrypted-backup-bytes");
        const sha256 = await (async () => {
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        })();
        const form = new FormData();
        form.append("meta", JSON.stringify({sha256, keyId: "0123456789abcdef", appVersion: "0.0.0-test", kind: "manual"}));
        form.append("file", new Blob([bytes], {type: "application/vnd.neurobook.backup"}), "backup.nbbackup");
        const upload = await api("/api/v1/backups", {token: u2Grant!.accessToken, form});
        expect(upload.status).toBe(200);

        // 聚合行
        const usage = (await (await api("/api/v1/admin/backup-usage", {jar: adminJar})).json()) as AdminBackupUsageDto[];
        expect(usage).toHaveLength(1);
        expect(usage[0]!.username).toBe("au2");
        expect(usage[0]!.count).toBe(1);
        expect(usage[0]!.totalBytes).toBe(bytes.length);

        // 行明细 + admin 删除
        const rows = (await (await api(`/api/v1/admin/backups?userId=${usage[0]!.userId}`, {jar: adminJar})).json()) as PageDto<AdminBackupDto>;
        expect(rows.total).toBe(1);
        const remove = await api(`/api/v1/admin/backups/${rows.items[0]!.id}`, {method: "DELETE", jar: adminJar});
        expect(remove.status).toBe(200);

        const usageAfter = (await (await api("/api/v1/admin/backup-usage", {jar: adminJar})).json()) as AdminBackupUsageDto[];
        expect(usageAfter).toHaveLength(0);

        // 非 admin 全家 403
        expect((await api("/api/v1/admin/backup-usage", {jar: u1Jar})).status).toBe(403);
        expect((await api("/api/v1/admin/stats", {jar: u1Jar})).status).toBe(403);
    });
});

describe("登录限流（放最后：会占满目标用户名的窗口）", () => {
    it("同 IP+用户名连续错密 10 次后第 11 次 429；其他用户名不受影响", async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
            const response = await api("/api/auth/login", {json: {username: "rl-target", password: "wrong-password"}});
            expect(response.status).toBe(401);
        }
        const throttled = await api("/api/auth/login", {json: {username: "rl-target", password: "wrong-password"}});
        expect(throttled.status).toBe(429);

        // 键含用户名：别的账号不被殃及
        const other = await api("/api/auth/login", {json: {username: "au3", password: "newpass12345"}});
        expect(other.status).toBe(200);
    });
});
