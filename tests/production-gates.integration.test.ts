import {execSync, spawn, type ChildProcess} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const runDir = join(repoRoot, ".agent", `production-gates-${process.pid}`);
const dbPath = join(runDir, "site.db").replaceAll("\\", "/");
const workshopDir = join(runDir, "workshop");
const backupsDir = join(runDir, "backups");
const logFile = join(runDir, "logs", "site.jsonl");
const port = 35900 + (process.pid % 300);
const baseUrl = `http://127.0.0.1:${port}`;

let server: ChildProcess | null = null;
let serverStdout = "";

/** 构造可通过启动门禁的 owner-only 生产环境。 */
function productionEnv(targetPort: number): NodeJS.ProcessEnv {
    return {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(targetPort),
        HOST: "127.0.0.1",
        DATABASE_URL: `file:${dbPath}`,
        WORKSHOP_FILES_DIR: workshopDir,
        NB_BACKUP_DIR: backupsDir,
        NB_MIGRATIONS_DIR: join(repoRoot, "prisma", "migrations"),
        NUXT_SESSION_PASSWORD: "integration-production-session-secret-0123456789-ABCDEFG",
        NB_SITE_ORIGIN: "https://nbook.notnotype.com",
        NB_TRUSTED_PROXY_ADDRESSES: "127.0.0.1",
        NB_PRIVATE_MODE: "1",
        NUXT_PUBLIC_REGISTRATION_ENABLED: "1",
        NUXT_PUBLIC_GITHUB_OAUTH_ENABLED: "0",
        NB_LOG_LEVEL: "info",
        NB_LOG_FILE: logFile,
        NB_STORAGE_MAX_BYTES: String(6 * 1024 * 1024 * 1024),
        NB_STORAGE_RESERVED_BYTES: "1",
        NB_BACKUP_MAX_FILE_BYTES: String(1024 * 1024 * 1024),
        NB_BACKUP_QUOTA_BYTES: String(2 * 1024 * 1024 * 1024),
        NB_BACKUP_MAX_COUNT: "5",
        NB_WORKSHOP_MAX_FILE_BYTES: String(20 * 1024 * 1024),
        NB_WORKSHOP_MAX_UNCOMPRESSED_BYTES: String(100 * 1024 * 1024),
        NB_WORKSHOP_MAX_ENTRIES: "500",
        ADMIN_USERNAME: "admin",
    };
}

/** 轮询到服务可响应，超时给出确定性失败。 */
async function waitUntilLive(): Promise<void> {
    await waitUntilLiveAt(baseUrl);
}

/** 轮询指定生产实例到 live，供不同注册门禁配置共用。 */
async function waitUntilLiveAt(origin: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() <= deadline) {
        try {
            const response = await fetch(`${origin}/api/health/live`);
            if (response.ok) {
                return;
            }
        } catch {
            // 进程尚未监听，继续轮询。
        }
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
    }
    throw new Error("生产门禁测试 server 启动超时");
}

/** 等待异步 Pino destination 出现匹配记录。 */
async function waitForLogEntry(predicate: (entry: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 5_000;
    while (Date.now() <= deadline) {
        if (existsSync(logFile)) {
            const entries = readFileSync(logFile, "utf8")
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            const match = entries.find(predicate);
            if (match) {
                return match;
            }
        }
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
    }
    throw new Error("等待结构化日志超时");
}

/** 等待 stdout 出现匹配的 Pino JSONL，验证持久文件不是唯一日志出口。 */
async function waitForStdoutEntry(predicate: (entry: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 5_000;
    while (Date.now() <= deadline) {
        const entries = serverStdout
            .split("\n")
            .filter(Boolean)
            .flatMap((line) => {
                try {
                    return [JSON.parse(line) as Record<string, unknown>];
                } catch {
                    return [];
                }
            });
        const match = entries.find(predicate);
        if (match) {
            return match;
        }
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
    }
    throw new Error("等待 stdout 结构化日志超时");
}

beforeAll(async () => {
    const serverEntry = join(repoRoot, ".output", "server", "index.mjs");
    if (!existsSync(serverEntry)) {
        throw new Error("缺少 .output/server/index.mjs：请先运行 bun run build");
    }
    rmSync(runDir, {recursive: true, force: true});
    mkdirSync(runDir, {recursive: true});
    writeFileSync(dbPath, "");
    const env = productionEnv(port);
    execSync("bunx prisma migrate deploy", {cwd: repoRoot, env, stdio: "pipe"});
    execSync("node dist/init-db.mjs", {
        cwd: repoRoot,
        env,
        input: "admin-production-test-password\n",
        stdio: "pipe",
    });
    execSync("node dist/admin-password.mjs reset", {
        cwd: repoRoot,
        env,
        input: "admin-production-reset-password\n",
        stdio: "pipe",
    });
    server = spawn(process.execPath, [serverEntry], {cwd: repoRoot, env, stdio: "pipe"});
    server.stdout?.setEncoding("utf8");
    server.stdout?.on("data", (chunk: string) => {
        serverStdout += chunk;
    });
    await waitUntilLive();
}, 90_000);

afterAll(async () => {
    server?.kill();
    for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 300));
        try {
            rmSync(runDir, {recursive: true, force: true});
            return;
        } catch {
            // Windows 文件句柄尚未释放。
        }
    }
});

describe("生产健康接口", () => {
    it("live 与 ready 可用，旧 health 路由已移除", async () => {
        const live = await fetch(`${baseUrl}/api/health/live`);
        expect(live.status).toBe(200);
        expect((await live.json()) as {status: string}).toMatchObject({status: "live"});

        const ready = await fetch(`${baseUrl}/api/health/ready`);
        expect(ready.status).toBe(200);
        expect((await ready.json()) as {status: string}).toMatchObject({status: "ready"});

        expect((await fetch(`${baseUrl}/api/health`)).status).toBe(404);
    });
});

describe("生产结构化日志", () => {
    it("返回 requestId，并持久化不含 query/header 密钥的请求摘要", async () => {
        const secret = `registration-secret-${process.pid}`;
        const response = await fetch(`${baseUrl}/api/health?registrationCode=${secret}`, {
            headers: {
                authorization: `Bearer ${secret}`,
                cookie: `session=${secret}`,
            },
        });
        expect(response.status).toBe(404);
        const requestId = response.headers.get("x-request-id");
        expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);

        const entry = await waitForLogEntry((candidate) => candidate.requestId === requestId
            && candidate.event === "http.request.completed");
        const stdoutEntry = await waitForStdoutEntry((candidate) => candidate.requestId === requestId
            && candidate.event === "http.request.completed");
        expect(entry).toMatchObject({
            level: "info",
            service: "neuro-book-site",
            method: "GET",
            path: "/api/health",
            statusCode: 404,
        });
        expect(stdoutEntry).toMatchObject(entry);
        const persisted = readFileSync(logFile, "utf8");
        expect(persisted).not.toContain(secret);
        expect(persisted).not.toContain("registrationCode");
        expect(persisted).not.toContain("authorization");
        expect(persisted).not.toContain("cookie");
    });

    it("请求解析异常写独立 error 事件，且不记录 body", async () => {
        const secret = `password-secret-${process.pid}`;
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: `{"password":"${secret}"`,
        });
        expect(response.status).toBeGreaterThanOrEqual(400);
        const requestId = response.headers.get("x-request-id");
        expect(requestId).not.toBeNull();

        await waitForLogEntry((candidate) => candidate.requestId === requestId
            && candidate.event === "http.request.error");
        expect(readFileSync(logFile, "utf8")).not.toContain(secret);
    });
});

describe("生产公网门禁", () => {
    it("显式开启后注册页公开配置生效，接口进入正常参数校验，OAuth 仍返回 404", async () => {
        const page = await fetch(`${baseUrl}/register?registrationCode=redacted`);
        expect(page.status).toBe(200);
        expect(await page.text()).toMatch(/registrationEnabled:(?:true|1|"1")/u);

        const register = await fetch(`${baseUrl}/api/auth/register`, {method: "POST"});
        expect(register.status).toBe(400);
        const payload = (await register.json()) as {data?: {error?: string}};
        expect(payload.data?.error).not.toBe("registration_disabled");

        expect((await fetch(`${baseUrl}/api/auth/register/oauth`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/auth/github`, {redirect: "manual"})).status).toBe(404);
    });

    it("显式关闭后注册接口保持稳定 403", async () => {
        const disabledPort = port + 2;
        const disabledUrl = `http://127.0.0.1:${disabledPort}`;
        const env = productionEnv(disabledPort);
        env.NUXT_PUBLIC_REGISTRATION_ENABLED = "0";
        env.NB_LOG_FILE = join(runDir, "logs", "site-disabled.jsonl");
        const child = spawn(process.execPath, [join(repoRoot, ".output", "server", "index.mjs")], {
            cwd: repoRoot,
            env,
            stdio: "pipe",
        });
        try {
            await waitUntilLiveAt(disabledUrl);
            const register = await fetch(`${disabledUrl}/api/auth/register`, {method: "POST"});
            expect(register.status).toBe(403);
            const payload = (await register.json()) as {data?: {error?: string}};
            expect(payload.data?.error).toBe("registration_disabled");
        } finally {
            child.kill();
        }
    });

    it("设备码只返回 canonical HTTPS origin", async () => {
        const response = await fetch(`${baseUrl}/api/v1/passport/device/code`, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({instanceName: "生产门禁测试", scopes: ["backup:read"]}),
        });
        expect(response.status).toBe(200);
        const device = (await response.json()) as {verificationUri: string; verificationUriComplete: string};
        expect(device.verificationUri).toBe("https://nbook.notnotype.com/link");
        expect(device.verificationUriComplete.startsWith("https://nbook.notnotype.com/link?code=")).toBe(true);
    });

    it("canonical HTTPS origin 强制登录 Cookie 使用 Secure", async () => {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({username: "admin", password: "admin-production-reset-password"}),
        });
        expect(response.status).toBe(200);
        expect(response.headers.getSetCookie().some((cookie) => /;\s*Secure(?:;|$)/i.test(cookie))).toBe(true);
    });
});

describe("生产启动 fail-closed", () => {
    it("示例 Session secret 使进程在提供服务前退出", async () => {
        const invalidPort = port + 1;
        const env = productionEnv(invalidPort);
        env.NUXT_SESSION_PASSWORD = "replace-with-at-least-48-random-characters-example";
        const child = spawn(process.execPath, [join(repoRoot, ".output", "server", "index.mjs")], {
            cwd: repoRoot,
            env,
            stdio: "pipe",
        });
        const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
            const timeout = setTimeout(() => {
                child.kill();
                rejectExit(new Error("无效生产配置未在 10 秒内退出"));
            }, 10_000);
            child.once("exit", (code) => {
                clearTimeout(timeout);
                resolveExit(code);
            });
        });

        expect(exitCode).not.toBe(0);
        await expect(fetch(`http://127.0.0.1:${invalidPort}/api/health/live`)).rejects.toThrow();
    });
});
