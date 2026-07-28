import {execSync, spawn, type ChildProcess} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {strToU8, unzipSync} from "fflate";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import type {CommentDto, FavoriteStateDto, ItemVersionDto, LikeStateDto, PackageFileContentDto, PackageFileListDto, PageDto, PublicUserDto, ReportDto, WorkshopItemDto, WorkshopMetaDto} from "../shared/dto/workshop.dto";
import type {RegistrationCodeDto} from "../shared/dto/access-code.dto";
import {buildPackageZip, readDirAsZipEntries} from "./helpers/zip";

// API v1 真实 HTTP 集成测试：build 产物起真实 server，走完整主体流程——
// admin 签发注册码 → 注册 → 登录 → 创建条目 → 上传 skill/profile zip 版本 →
// 公开列表/详情/版本可见 → 下载字节一致 → 点赞/收藏/评论/举报 → unlisted/removed 公开面不可达。

const repoRoot = resolve(import.meta.dirname, "..");
const runDir = join(repoRoot, ".agent", `integration-${process.pid}`);
const dbPath = join(runDir, "workshop.db").replaceAll("\\", "/");
const filesDir = join(runDir, "files");
const port = 34600 + (process.pid % 400);
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
    json?: object; // JSON body（与 form 互斥）
    form?: FormData; // multipart body
};

/** 请求真实 server；带 jar 时自动附带并回存 cookie */
async function api(path: string, options: ApiOptions = {}): Promise<Response> {
    const headers: HeadersInit = {};
    const cookie = options.jar?.header();
    if (cookie) {
        headers.Cookie = cookie;
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

/** 构造 multipart 上传表单 */
function uploadForm(zipBytes: Uint8Array, changelog?: string): FormData {
    const form = new FormData();
    form.append("file", new Blob([zipBytes as BlobPart], {type: "application/zip"}), "package.zip");
    if (changelog !== undefined) {
        form.append("changelog", changelog);
    }
    return form;
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

// ---------- 共享测试状态（同文件内串行执行） ----------

const adminJar = new CookieJar();
const authorJar = new CookieJar();
const readerJar = new CookieJar();

const skillSlug = "stop-slop-fork";
const profileSlug = "mini-writer-pack";

let registrationCodes: string[] = [];
let skillItemId = 0;
let skillZipV1 = new Uint8Array();
let skillZipV2 = new Uint8Array();
let profileZipV1 = new Uint8Array();
let adminCommentId = 0;

const skillEntries = readDirAsZipEntries(join(repoRoot, "tests", "fixtures", "skill-stop-slop"));
const profileEntries = readDirAsZipEntries(join(repoRoot, "tests", "fixtures", "profile-mini"));

beforeAll(async () => {
    const serverEntry = join(repoRoot, ".output", "server", "index.mjs");
    if (!existsSync(serverEntry)) {
        throw new Error("缺少 .output/server/index.mjs：集成测试跑真实 build 产物，请先运行 bun run build");
    }

    // 每次全新的临时数据库与文件目录
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

    // node-server 产物用当前 node 运行（vitest 即 node），避免 Windows spawn bun 的 PATH 问题
    server = spawn(process.execPath, [serverEntry], {
        cwd: repoRoot,
        env: {
            ...env,
            PORT: String(port),
            HOST: "127.0.0.1",
            WORKSHOP_FILES_DIR: filesDir,
            NUXT_SESSION_PASSWORD: "integration-test-session-password-0123456789",
            // 本文件同 IP 注册 8 次：放开注册限流（默认 5 次/时/IP），限流行为由 account-admin 测试覆盖
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
}, 90_000);

afterAll(async () => {
    server?.kill();
    // 等进程释放 SQLite 文件句柄后再清理
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
    rmSync(runDir, {recursive: true, force: true});
});

describe("API v1 主体流程", () => {
    it("meta 公开可达", async () => {
        const response = await api("/api/v1/meta");
        expect(response.status).toBe(200);
        const meta = (await response.json()) as WorkshopMetaDto;
        expect(meta.platform).toBe("neuro-book-site");
        expect(meta.platformVersion).toMatch(/^\d+\.\d+\.\d+/);
        expect(meta.packageSchemaVersion).toBe(1);
        expect(meta.itemTypes).toEqual(["skill", "workflow", "profile"]);
    });

    it("admin 登录并签发不限次数注册码", async () => {
        const login = await api("/api/auth/login", {jar: adminJar, json: {username: "admin", password: "admin1234567890-test"}});
        expect(login.status).toBe(200);

        const issued = await api("/api/v1/admin/registration-codes", {jar: adminJar, json: {count: 1, maxUses: null, expiresAt: null}});
        expect(issued.status).toBe(200);
        const codes = (await issued.json()) as RegistrationCodeDto[];
        expect(codes).toHaveLength(1);
        expect(codes[0]?.maxUses).toBeNull();
        expect(codes[0]?.usedCount).toBe(0);
        registrationCodes = codes.map((code) => code.code);
    });

    it("普通用户无法签发注册码", async () => {
        const anonymous = await api("/api/v1/admin/registration-codes", {json: {count: 1}});
        expect(anonymous.status).toBe(401);
    });

    it("无注册码 / 无效注册码注册被拒", async () => {
        const missing = await api("/api/auth/register", {json: {username: "author1", password: "password123"}});
        expect(missing.status).toBe(400);

        const bogus = await api("/api/auth/register", {json: {username: "author1", password: "password123", registrationCode: "nbr-bogus"}});
        expect(bogus.status).toBe(400);
        expect(((await bogus.json()) as {message?: string}).message).toContain("注册码无效");
    });

    it("同一不限次数注册码可注册多个账号", async () => {
        const register = await api("/api/auth/register", {
            jar: authorJar,
            json: {username: "author1", password: "password123", registrationCode: registrationCodes[0]},
        });
        expect(register.status).toBe(200);

        const reader = await api("/api/auth/register", {
            jar: readerJar,
            json: {username: "reader1", password: "password123", registrationCode: registrationCodes[0]},
        });
        expect(reader.status).toBe(200);

        const listed = await api("/api/v1/admin/registration-codes", {jar: adminJar});
        const page = (await listed.json()) as PageDto<RegistrationCodeDto>;
        expect(page.items[0]?.usedCount).toBe(2);
    });

    it("未登录不能创建条目；登录作者创建 skill 条目；slug 重复被拒", async () => {
        const itemBody = {slug: skillSlug, type: "skill", title: "Stop Slop（fork）", summary: "去 AI 味写作 skill", tags: ["writing", "润色"]};

        const anonymous = await api("/api/v1/items", {json: itemBody});
        expect(anonymous.status).toBe(401);

        const created = await api("/api/v1/items", {jar: authorJar, json: itemBody});
        expect(created.status).toBe(200);
        const item = (await created.json()) as WorkshopItemDto;
        expect(item.slug).toBe(skillSlug);
        expect(item.name).toBe(""); // 首版上传前安装名为空
        expect(item.latestVersion).toBeNull();
        skillItemId = item.id;

        const duplicated = await api("/api/v1/items", {jar: authorJar, json: itemBody});
        expect(duplicated.status).toBe(409);
    });

    it("上传 skill 首版：sha256 落库、安装名从 package.json 落库", async () => {
        skillZipV1 = buildPackageZip({manifestVersion: 1, type: "skill", name: "stop-slop", version: 1}, skillEntries);
        const uploaded = await api(`/api/v1/items/${skillSlug}/versions`, {jar: authorJar, form: uploadForm(skillZipV1, "首个版本")});
        expect(uploaded.status).toBe(200);
        const version = (await uploaded.json()) as ItemVersionDto;
        expect(version.version).toBe("1.0.0");
        expect(version.sha256).toBe(sha256Hex(skillZipV1));
        expect(version.fileSize).toBe(skillZipV1.byteLength);

        const detail = await api(`/api/v1/items/${skillSlug}`);
        const item = (await detail.json()) as WorkshopItemDto;
        expect(item.name).toBe("stop-slop");
        expect(item.latestVersion).toBe("1.0.0");
    });

    it("上传拒绝用例：缺 package.json / version 不递增 / name 变更 / type 不一致 / 非作者", async () => {
        const noManifest = await api(`/api/v1/items/${skillSlug}/versions`, {jar: authorJar, form: uploadForm(buildPackageZip(null, skillEntries))});
        expect(noManifest.status).toBe(400);
        expect(((await noManifest.json()) as {message?: string}).message).toContain("缺少 package.json");

        const sameVersion = await api(`/api/v1/items/${skillSlug}/versions`, {
            jar: authorJar,
            form: uploadForm(buildPackageZip({manifestVersion: 1, type: "skill", name: "stop-slop", version: 1}, skillEntries)),
        });
        expect(sameVersion.status).toBe(400);
        expect(((await sameVersion.json()) as {message?: string}).message).toContain("严格大于当前最新版本 1.0.0");

        const renamed = await api(`/api/v1/items/${skillSlug}/versions`, {
            jar: authorJar,
            form: uploadForm(buildPackageZip({manifestVersion: 1, type: "skill", name: "renamed-slop", version: 2}, skillEntries)),
        });
        expect(renamed.status).toBe(400);
        expect(((await renamed.json()) as {message?: string}).message).toContain("与条目安装名（stop-slop）不一致");

        const wrongType = await api(`/api/v1/items/${skillSlug}/versions`, {
            jar: authorJar,
            form: uploadForm(buildPackageZip({manifestVersion: 1, type: "profile", name: "stop-slop", version: 2}, {"stop-slop.profile.tsx": skillEntries["SKILL.md"] ?? new Uint8Array()})),
        });
        expect(wrongType.status).toBe(400);
        expect(((await wrongType.json()) as {message?: string}).message).toContain("assetType（profile）与条目类型（skill）不一致");

        const notOwner = await api(`/api/v1/items/${skillSlug}/versions`, {
            jar: readerJar,
            form: uploadForm(buildPackageZip({manifestVersion: 1, type: "skill", name: "stop-slop", version: 2}, skillEntries)),
        });
        expect(notOwner.status).toBe(403);
    });

    it("上传 skill v2 与 profile 条目全流程；profile 缺入口被拒", async () => {
        skillZipV2 = buildPackageZip({manifestVersion: 1, type: "skill", name: "stop-slop", version: 2}, skillEntries);
        const uploadedV2 = await api(`/api/v1/items/${skillSlug}/versions`, {jar: authorJar, form: uploadForm(skillZipV2, "第二版")});
        expect(uploadedV2.status).toBe(200);

        const createdProfile = await api("/api/v1/items", {
            jar: authorJar,
            json: {slug: profileSlug, type: "profile", title: "Mini Writer Profile", summary: "最小 profile 样本", tags: ["profile"]},
        });
        expect(createdProfile.status).toBe(200);

        const missingEntry = await api(`/api/v1/items/${profileSlug}/versions`, {
            jar: authorJar,
            form: uploadForm(buildPackageZip({manifestVersion: 1, type: "profile", name: "mini-writer", version: 1}, {"mini-writer.home/notes.md": profileEntries["mini-writer.home/notes.md"] ?? new Uint8Array()})),
        });
        expect(missingEntry.status).toBe(400);
        expect(((await missingEntry.json()) as {message?: string}).message).toContain("mini-writer.profile.tsx");

        profileZipV1 = buildPackageZip({manifestVersion: 1, type: "profile", name: "mini-writer", version: 1, minAppVersion: "0.5.6"}, profileEntries);
        const uploadedProfile = await api(`/api/v1/items/${profileSlug}/versions`, {jar: authorJar, form: uploadForm(profileZipV1)});
        expect(uploadedProfile.status).toBe(200);
        const profileVersion = (await uploadedProfile.json()) as ItemVersionDto;
        expect(profileVersion.minAppVersion).toBe("0.5.6");
    });

    it("公开列表 / 筛选 / 搜索 / 详情 / 版本列表可见（无需登录）", async () => {
        const list = (await (await api("/api/v1/items")).json()) as PageDto<WorkshopItemDto>;
        expect(list.total).toBe(2);
        expect(list.hasMore).toBe(false);

        const skillOnly = (await (await api("/api/v1/items?type=skill")).json()) as PageDto<WorkshopItemDto>;
        expect(skillOnly.total).toBe(1);
        expect(skillOnly.items[0]?.slug).toBe(skillSlug);

        const byTag = (await (await api(`/api/v1/items?tags=${encodeURIComponent("润色")}`)).json()) as PageDto<WorkshopItemDto>;
        expect(byTag.total).toBe(1);

        const byQuery = (await (await api("/api/v1/items?q=stop")).json()) as PageDto<WorkshopItemDto>;
        expect(byQuery.total).toBe(1);

        const versions = (await (await api(`/api/v1/items/${skillSlug}/versions`)).json()) as ItemVersionDto[];
        expect(versions.map((version) => version.version)).toEqual(["2.0.0", "1.0.0"]);

        const author = (await (await api("/api/v1/users/author1")).json()) as PublicUserDto;
        expect(author.items).toHaveLength(2);
    });

    it("下载 round-trip：字节与上传一致、内容一致、计数递增", async () => {
        const latest = await api(`/api/v1/items/${skillSlug}/download`);
        expect(latest.status).toBe(200);
        expect(latest.headers.get("content-type")).toContain("application/zip");
        const latestBytes = new Uint8Array(await latest.arrayBuffer());
        expect(sha256Hex(latestBytes)).toBe(sha256Hex(skillZipV2));

        // 解压对比：条目集合与 SKILL.md 字节与原始 fixture 完全一致
        const unzipped = unzipSync(latestBytes);
        const expectedNames = [...Object.keys(skillEntries), "package.json"].sort();
        expect(Object.keys(unzipped).sort()).toEqual(expectedNames);
        expect(Buffer.from(unzipped["SKILL.md"] ?? new Uint8Array())).toEqual(Buffer.from(skillEntries["SKILL.md"] ?? new Uint8Array()));

        const pinned = await api(`/api/v1/items/${skillSlug}/download?version=1.0.0`);
        expect(sha256Hex(new Uint8Array(await pinned.arrayBuffer()))).toBe(sha256Hex(skillZipV1));

        const profileDownload = await api(`/api/v1/items/${profileSlug}/download`);
        expect(sha256Hex(new Uint8Array(await profileDownload.arrayBuffer()))).toBe(sha256Hex(profileZipV1));

        const missing = await api(`/api/v1/items/${skillSlug}/download?version=99.0.0`);
        expect(missing.status).toBe(404);

        const detail = (await (await api(`/api/v1/items/${skillSlug}`)).json()) as WorkshopItemDto;
        expect(detail.downloadCount).toBe(2);
    });

    it("点赞 / 取消幂等，计数正确", async () => {
        const liked = (await (await api(`/api/v1/items/${skillSlug}/like`, {method: "PUT", jar: readerJar})).json()) as LikeStateDto;
        expect(liked).toEqual({liked: true, likeCount: 1});

        const likedAgain = (await (await api(`/api/v1/items/${skillSlug}/like`, {method: "PUT", jar: readerJar})).json()) as LikeStateDto;
        expect(likedAgain.likeCount).toBe(1);

        const detail = (await (await api(`/api/v1/items/${skillSlug}`, {jar: readerJar})).json()) as WorkshopItemDto;
        expect(detail.viewer).toEqual({liked: true, favorited: false});

        const unliked = (await (await api(`/api/v1/items/${skillSlug}/like`, {method: "DELETE", jar: readerJar})).json()) as LikeStateDto;
        expect(unliked).toEqual({liked: false, likeCount: 0});

        const unlikedAgain = (await (await api(`/api/v1/items/${skillSlug}/like`, {method: "DELETE", jar: readerJar})).json()) as LikeStateDto;
        expect(unlikedAgain.likeCount).toBe(0);

        const anonymous = await api(`/api/v1/items/${skillSlug}/like`, {method: "PUT"});
        expect(anonymous.status).toBe(401);
    });

    it("收藏后 /me/favorites 可见，取消后消失", async () => {
        const favorited = (await (await api(`/api/v1/items/${profileSlug}/favorite`, {method: "PUT", jar: readerJar})).json()) as FavoriteStateDto;
        expect(favorited).toEqual({favorited: true});

        const mine = (await (await api("/api/v1/me/favorites", {jar: readerJar})).json()) as PageDto<WorkshopItemDto>;
        expect(mine.total).toBe(1);
        expect(mine.items[0]?.slug).toBe(profileSlug);

        await api(`/api/v1/items/${profileSlug}/favorite`, {method: "DELETE", jar: readerJar});
        const emptied = (await (await api("/api/v1/me/favorites", {jar: readerJar})).json()) as PageDto<WorkshopItemDto>;
        expect(emptied.total).toBe(0);
    });

    it("评论：发表可见、本人可删、admin 可删任意、他人不可删", async () => {
        const first = await api(`/api/v1/items/${skillSlug}/comments`, {jar: readerJar, json: {content: "好用，推荐！"}});
        expect(first.status).toBe(200);
        const firstComment = (await first.json()) as CommentDto;

        const second = await api(`/api/v1/items/${skillSlug}/comments`, {jar: adminJar, json: {content: "管理员留言"}});
        adminCommentId = ((await second.json()) as CommentDto).id;

        const listed = (await (await api(`/api/v1/items/${skillSlug}/comments`)).json()) as PageDto<CommentDto>;
        expect(listed.total).toBe(2);
        expect(listed.items[0]?.content).toBe("好用，推荐！"); // 楼层序：先发在前

        // 他人（作者也不是评论作者、非 admin）不能删 reader 的评论
        const forbidden = await api(`/api/v1/comments/${firstComment.id}`, {method: "DELETE", jar: authorJar});
        expect(forbidden.status).toBe(403);

        // 本人软删
        const selfDeleted = await api(`/api/v1/comments/${firstComment.id}`, {method: "DELETE", jar: readerJar});
        expect(selfDeleted.status).toBe(200);

        // admin 删任意评论
        const adminDeleted = await api(`/api/v1/comments/${adminCommentId}`, {method: "DELETE", jar: adminJar});
        expect(adminDeleted.status).toBe(200);

        const emptied = (await (await api(`/api/v1/items/${skillSlug}/comments`)).json()) as PageDto<CommentDto>;
        expect(emptied.total).toBe(0);

        const detail = (await (await api(`/api/v1/items/${skillSlug}`)).json()) as WorkshopItemDto;
        expect(detail.commentCount).toBe(0);
    });

    it("举报与 admin 处理", async () => {
        const reported = await api(`/api/v1/items/${profileSlug}/report`, {jar: readerJar, json: {reason: "测试举报理由"}});
        expect(reported.status).toBe(200);

        const reports = (await (await api("/api/v1/admin/reports", {jar: adminJar})).json()) as PageDto<ReportDto>;
        expect(reports.total).toBe(1);
        const report = reports.items[0];
        expect(report?.itemSlug).toBe(profileSlug);
        expect(report?.resolvedAt).toBeNull();

        const resolved = (await (await api(`/api/v1/admin/reports/${report?.id}/resolve`, {method: "POST", jar: adminJar})).json()) as ReportDto;
        expect(resolved.resolvedAt).not.toBeNull();

        // 非 admin 不可见举报列表
        const forbidden = await api("/api/v1/admin/reports", {jar: readerJar});
        expect(forbidden.status).toBe(403);
    });

    it("作者 unlisted 后公开面（列表/详情/下载）不可达，作者可自行恢复", async () => {
        const unlisted = await api(`/api/v1/items/${skillSlug}`, {method: "PATCH", jar: authorJar, json: {status: "unlisted"}});
        expect(unlisted.status).toBe(200);

        const list = (await (await api("/api/v1/items")).json()) as PageDto<WorkshopItemDto>;
        expect(list.items.map((item) => item.slug)).not.toContain(skillSlug);
        expect((await api(`/api/v1/items/${skillSlug}`)).status).toBe(404);
        expect((await api(`/api/v1/items/${skillSlug}/download`)).status).toBe(404);

        // 作者公开页同样隐藏
        const author = (await (await api("/api/v1/users/author1")).json()) as PublicUserDto;
        expect(author.items.map((item) => item.slug)).not.toContain(skillSlug);

        const republished = await api(`/api/v1/items/${skillSlug}`, {method: "PATCH", jar: authorJar, json: {status: "published"}});
        expect(republished.status).toBe(200);
        expect((await api(`/api/v1/items/${skillSlug}`)).status).toBe(200);
    });

    it("作者 /me/items 可见自己全部状态条目（含 unlisted），未登录被拒", async () => {
        // 未登录访问被拒
        const anonymous = await api("/api/v1/me/items");
        expect(anonymous.status).toBe(401);

        // 此刻 author1 名下两条均 published，全部可见
        const before = (await (await api("/api/v1/me/items", {jar: authorJar})).json()) as PageDto<WorkshopItemDto>;
        expect(before.total).toBe(2);
        expect(before.items.map((item) => item.slug).sort()).toEqual([profileSlug, skillSlug].sort());

        // 下架 skill：公开列表隐藏，但 /me/items 仍可见（这是与公开面的关键区别）
        await api(`/api/v1/items/${skillSlug}`, {method: "PATCH", jar: authorJar, json: {status: "unlisted"}});

        const publicList = (await (await api("/api/v1/items")).json()) as PageDto<WorkshopItemDto>;
        expect(publicList.items.map((item) => item.slug)).not.toContain(skillSlug);

        const mine = (await (await api("/api/v1/me/items", {jar: authorJar})).json()) as PageDto<WorkshopItemDto>;
        expect(mine.total).toBe(2);
        expect(mine.items.find((item) => item.slug === skillSlug)?.status).toBe("unlisted");

        const source = await api(`/api/v1/me/items/${skillSlug}/package?version=1.0.0`, {jar: authorJar});
        expect(source.status).toBe(200);
        expect(sha256Hex(new Uint8Array(await source.arrayBuffer()))).toBe(sha256Hex(skillZipV1));
        expect((await api(`/api/v1/me/items/${skillSlug}/package`, {jar: readerJar})).status).toBe(403);

        // 各看各的：reader 名下无条目
        const readerItems = (await (await api("/api/v1/me/items", {jar: readerJar})).json()) as PageDto<WorkshopItemDto>;
        expect(readerItems.total).toBe(0);

        // 恢复 published，不给后续用例留下架状态
        await api(`/api/v1/items/${skillSlug}`, {method: "PATCH", jar: authorJar, json: {status: "published"}});
    });

    it("admin removed 后公开面不可达且作者不可恢复；admin 可恢复", async () => {
        const removed = await api(`/api/v1/admin/items/${skillItemId}/status`, {method: "PATCH", jar: adminJar, json: {status: "removed"}});
        expect(removed.status).toBe(200);

        expect((await api(`/api/v1/items/${skillSlug}`)).status).toBe(404);
        expect((await api(`/api/v1/items/${skillSlug}/download`)).status).toBe(404);

        // 作者不能编辑，也不能借 PATCH 恢复
        const authorAttempt = await api(`/api/v1/items/${skillSlug}`, {method: "PATCH", jar: authorJar, json: {status: "published"}});
        expect(authorAttempt.status).toBe(403);
        expect(((await authorAttempt.json()) as {message?: string}).message).toContain("管理员下架");

        // 作者也不能给 removed 条目传新版本
        const uploadAttempt = await api(`/api/v1/items/${skillSlug}/versions`, {
            jar: authorJar,
            form: uploadForm(buildPackageZip({manifestVersion: 1, type: "skill", name: "stop-slop", version: 3}, skillEntries)),
        });
        expect(uploadAttempt.status).toBe(403);

        // 作者仍能读取 removed 资产源包，便于在工作台修订后等待管理员恢复。
        expect((await api(`/api/v1/me/items/${skillSlug}/package`, {jar: authorJar})).status).toBe(200);

        // 普通用户不能调用 admin 状态接口
        const readerAttempt = await api(`/api/v1/admin/items/${skillItemId}/status`, {method: "PATCH", jar: readerJar, json: {status: "published"}});
        expect(readerAttempt.status).toBe(403);

        const restored = await api(`/api/v1/admin/items/${skillItemId}/status`, {method: "PATCH", jar: adminJar, json: {status: "published"}});
        expect(restored.status).toBe(200);
        expect((await api(`/api/v1/items/${skillSlug}`)).status).toBe(200);
    });

    it("并发使用限次注册码：不会穿透 maxUses", async () => {
        const issued = await api("/api/v1/admin/registration-codes", {jar: adminJar, json: {count: 1, maxUses: 1, expiresAt: null}});
        const [code] = ((await issued.json()) as RegistrationCodeDto[]).map((item) => item.code);

        const [a, b] = await Promise.all([
            api("/api/auth/register", {json: {username: "race-user-a", password: "password123", registrationCode: code}}),
            api("/api/auth/register", {json: {username: "race-user-b", password: "password123", registrationCode: code}}),
        ]);
        const statuses = [a.status, b.status].sort();
        expect(statuses[0]).toBe(200);
        expect(statuses[1]).toBe(400);

        const third = await api("/api/auth/register", {json: {username: "race-user-c", password: "password123", registrationCode: code}});
        expect(third.status).toBe(400);
        expect(((await third.json()) as {message?: string}).message).toContain("使用次数已达上限");
    });

    it("并发上传同版本：恰好一个成功，下载字节与成功记录一致", async () => {
        const zipA = buildPackageZip({manifestVersion: 1, type: "skill", name: "stop-slop", version: 3}, {...skillEntries, "SKILL.md": strToU8("# race A")});
        const zipB = buildPackageZip({manifestVersion: 1, type: "skill", name: "stop-slop", version: 3}, {...skillEntries, "SKILL.md": strToU8("# race B")});

        const [a, b] = await Promise.all([
            api(`/api/v1/items/${skillSlug}/versions`, {jar: authorJar, form: uploadForm(zipA)}),
            api(`/api/v1/items/${skillSlug}/versions`, {jar: authorJar, form: uploadForm(zipB)}),
        ]);
        // 输者可能撞唯一约束（409）或在赢者提交后才校验递增（400），两者都算正确拒绝
        const results = [
            {response: a, zip: zipA},
            {response: b, zip: zipB},
        ];
        const winners = results.filter((entry) => entry.response.status === 200);
        expect(winners).toHaveLength(1);
        expect(results.some((entry) => entry.response.status >= 400)).toBe(true);

        const winner = winners[0]!;
        const created = (await winner.response.json()) as ItemVersionDto;
        expect(created.sha256).toBe(sha256Hex(winner.zip));

        // 磁盘字节必须与库内记录对应同一次上传（修复前并发覆盖会导致不一致）
        const downloaded = new Uint8Array(await (await api(`/api/v1/items/${skillSlug}/download?version=3.0.0`)).arrayBuffer());
        expect(sha256Hex(downloaded)).toBe(created.sha256);
    });

    it("条目下架后仍可取消收藏 / 取消点赞", async () => {
        // published 状态下先建立关系
        await api(`/api/v1/items/${profileSlug}/favorite`, {method: "PUT", jar: readerJar});
        const liked = (await (await api(`/api/v1/items/${profileSlug}/like`, {method: "PUT", jar: readerJar})).json()) as LikeStateDto;
        expect(liked.liked).toBe(true);

        const unlisted = await api(`/api/v1/items/${profileSlug}`, {method: "PATCH", jar: authorJar, json: {status: "unlisted"}});
        expect(unlisted.status).toBe(200);

        // 下架后公开面不可达，但撤销自己的关系仍可用
        expect((await api(`/api/v1/items/${profileSlug}`)).status).toBe(404);
        const unfavorited = await api(`/api/v1/items/${profileSlug}/favorite`, {method: "DELETE", jar: readerJar});
        expect(unfavorited.status).toBe(200);
        expect((await unfavorited.json()) as FavoriteStateDto).toEqual({favorited: false});

        const unliked = (await (await api(`/api/v1/items/${profileSlug}/like`, {method: "DELETE", jar: readerJar})).json()) as LikeStateDto;
        expect(unliked.liked).toBe(false);
        expect(unliked.likeCount).toBe(liked.likeCount - 1);

        // 收尾恢复 published，不给后续用例留下架状态
        await api(`/api/v1/items/${profileSlug}`, {method: "PATCH", jar: authorJar, json: {status: "published"}});
    });

    it("包内容在线预览：文件列表与文本内容可读，不计下载数", async () => {
        const before = (await (await api(`/api/v1/items/${skillSlug}`)).json()) as WorkshopItemDto;

        const filesRes = await api(`/api/v1/items/${skillSlug}/files`);
        expect(filesRes.status).toBe(200);
        const fileList = (await filesRes.json()) as PackageFileListDto;
        expect(fileList.version).toBe("3.0.0"); // 缺省取最新版（并发用例后最新为 v3）
        const paths = fileList.files.map((file) => file.path);
        expect(paths).toContain("SKILL.md");
        expect(paths).toContain("package.json");
        expect(fileList.files.find((file) => file.path === "SKILL.md")?.previewable).toBe(true);

        // 指定版本读文本：v1 的 SKILL.md 与原始 fixture 完全一致
        const contentRes = await api(`/api/v1/items/${skillSlug}/file-content?version=1.0.0&path=${encodeURIComponent("SKILL.md")}`);
        expect(contentRes.status).toBe(200);
        const content = (await contentRes.json()) as PackageFileContentDto;
        expect(content.content).toBe(new TextDecoder().decode(skillEntries["SKILL.md"] ?? new Uint8Array()));

        // 不存在的 path 404
        expect((await api(`/api/v1/items/${skillSlug}/file-content?path=nope.md`)).status).toBe(404);

        // 预览不递增下载计数
        const after = (await (await api(`/api/v1/items/${skillSlug}`)).json()) as WorkshopItemDto;
        expect(after.downloadCount).toBe(before.downloadCount);
    });

    it("包内容预览遵循可见性：unlisted 后 404", async () => {
        await api(`/api/v1/items/${profileSlug}`, {method: "PATCH", jar: authorJar, json: {status: "unlisted"}});
        expect((await api(`/api/v1/items/${profileSlug}/files`)).status).toBe(404);
        expect((await api(`/api/v1/items/${profileSlug}/file-content?path=SKILL.md`)).status).toBe(404);
        // 收尾恢复
        await api(`/api/v1/items/${profileSlug}`, {method: "PATCH", jar: authorJar, json: {status: "published"}});
    });

    it("Workflow 使用统一包协议发布，且 import 与依赖均被拒绝", async () => {
        const workflowSlug = "draft-book-workflow";
        const created = await api("/api/v1/items", {
            jar: authorJar,
            json: {slug: workflowSlug, type: "workflow", title: "Draft Book Workflow"},
        });
        expect(created.status).toBe(200);

        const packageJson = {
            name: workflowSlug,
            version: "1.0.0",
            type: "module",
            neurobook: {schemaVersion: 1, assetType: "workflow"},
        };
        const uploaded = await api(`/api/v1/items/${workflowSlug}/versions`, {
            jar: authorJar,
            form: uploadForm(buildPackageZip(packageJson, {"workflow.ts": strToU8("export default defineWorkflow({});")})),
        });
        expect(uploaded.status).toBe(200);
        expect(((await uploaded.json()) as ItemVersionDto).version).toBe("1.0.0");

        const imported = await api(`/api/v1/items/${workflowSlug}/versions`, {
            jar: authorJar,
            form: uploadForm(buildPackageZip({...packageJson, version: "1.1.0"}, {"workflow.ts": strToU8('import x from "x";')})),
        });
        expect(imported.status).toBe(400);
        expect(((await imported.json()) as {message?: string}).message).toContain("不允许使用 import");

        const dependencies = await api(`/api/v1/items/${workflowSlug}/versions`, {
            jar: authorJar,
            form: uploadForm(buildPackageZip({...packageJson, version: "1.1.0", dependencies: {x: "1.0.0"}}, {"workflow.ts": strToU8("export default {};")})),
        });
        expect(dependencies.status).toBe(400);
        expect(((await dependencies.json()) as {message?: string}).message).toContain("不能声明运行时或开发依赖");
    });

    it("admin 精选：打标后 featured=1 过滤命中；非 admin 被拒", async () => {
        const forbidden = await api(`/api/v1/admin/items/${skillItemId}/featured`, {method: "PATCH", jar: readerJar, json: {featured: true}});
        expect(forbidden.status).toBe(403);

        const marked = await api(`/api/v1/admin/items/${skillItemId}/featured`, {method: "PATCH", jar: adminJar, json: {featured: true}});
        expect(marked.status).toBe(200);
        expect(((await marked.json()) as WorkshopItemDto).featured).toBe(true);

        const featuredList = (await (await api("/api/v1/items?featured=1")).json()) as PageDto<WorkshopItemDto>;
        expect(featuredList.total).toBe(1);
        expect(featuredList.items[0]?.slug).toBe(skillSlug);
        expect(featuredList.items[0]?.featured).toBe(true);

        // 取消精选后过滤为空
        await api(`/api/v1/admin/items/${skillItemId}/featured`, {method: "PATCH", jar: adminJar, json: {featured: false}});
        const emptied = (await (await api("/api/v1/items?featured=1")).json()) as PageDto<WorkshopItemDto>;
        expect(emptied.total).toBe(0);
    });
});
