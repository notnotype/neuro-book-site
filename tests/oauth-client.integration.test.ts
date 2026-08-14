import {execSync, spawn, type ChildProcess} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {createClient} from "@libsql/client";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {redactSensitiveText} from "../server/utils/site-logger";

const repoRoot = resolve(import.meta.dirname, "..");
const runDir = join(repoRoot, ".agent", `oauth-client-integration-${process.pid}`);
const dbPath = join(runDir, "oauth.db").replaceAll("\\", "/");
const port = 35200 + (process.pid % 300);
const baseUrl = `http://127.0.0.1:${port}`;
const adminPassword = "admin1234567890-test";
const clientSecret = "oauth-client-secret-012345678901234567890";

let server: ChildProcess | null = null;

class CookieJar {
    private cookies = new Map<string, string>();

    store(response: Response): void {
        for (const raw of response.headers.getSetCookie()) {
            const pair = raw.split(";", 1)[0] ?? "";
            const separator = pair.indexOf("=");
            if (separator <= 0) {
                continue;
            }
            const name = pair.slice(0, separator).trim();
            const value = pair.slice(separator + 1).trim();
            if (value) {
                this.cookies.set(name, value);
            } else {
                this.cookies.delete(name);
            }
        }
    }

    header(): string | undefined {
        if (this.cookies.size === 0) {
            return undefined;
        }
        return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    }
}

type RequestOptions = {
    method?: string;
    jar?: CookieJar;
    headers?: Record<string, string>;
    body?: BodyInit;
};

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    const cookie = options.jar?.header();
    if (cookie) {
        headers.set("Cookie", cookie);
    }
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? (options.body ? "POST" : "GET"),
        headers,
        body: options.body,
        redirect: "manual",
    });
    options.jar?.store(response);
    return response;
}

function sha256Base64Url(value: string): string {
    return createHash("sha256").update(value).digest("base64url");
}

function authorizeQuery(verifier: string, state = "state-integration-1"): string {
    const query = new URLSearchParams({
        client_id: "llmlint-web",
        redirect_uri: "https://llmlint.notnotype.com/auth/neurobook",
        response_type: "code",
        scope: "profile",
        state,
        code_challenge: sha256Base64Url(verifier),
        code_challenge_method: "S256",
    });
    return `?${query}`;
}

function basicHeader(): string {
    return `Basic ${Buffer.from(`llmlint-web:${clientSecret}`).toString("base64")}`;
}

async function json<T>(response: Response): Promise<T> {
    return await response.json() as T;
}

async function waitForServer(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        try {
            const response = await request("/.well-known/oauth-authorization-server");
            if (response.ok) {
                return;
            }
        } catch {
            // Nitro 尚未监听，继续等待。
        }
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
    }
    throw new Error("OAuth integration server startup timeout");
}

const adminJar = new CookieJar();
let db: ReturnType<typeof createClient> | null = null;

beforeAll(async () => {
    const serverEntry = join(repoRoot, ".output", "server", "index.mjs");
    if (!existsSync(serverEntry)) {
        throw new Error("缺少 .output/server/index.mjs：先运行 bun run build");
    }
    rmSync(runDir, {recursive: true, force: true});
    mkdirSync(runDir, {recursive: true});
    writeFileSync(dbPath, "");
    db = createClient({url: `file:${dbPath}`});
    const env = {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: `file:${dbPath}`,
        ADMIN_USERNAME: "admin",
        NB_SITE_ORIGIN: baseUrl,
    };
    execSync("bunx prisma migrate deploy", {cwd: repoRoot, env, stdio: "pipe"});
    execSync("bun scripts/init-db.ts", {cwd: repoRoot, env, input: `${adminPassword}\n`, stdio: "pipe"});
    execSync("bun scripts/oauth-client.ts --ensure llmlint-web", {cwd: repoRoot, env, input: `${clientSecret}\n`, stdio: "pipe"});

    server = spawn(process.execPath, [serverEntry], {
        cwd: repoRoot,
        env: {
            ...env,
            HOST: "127.0.0.1",
            PORT: String(port),
            NUXT_SESSION_PASSWORD: "integration-test-session-password-0123456789",
            NB_TRUSTED_PROXY_ADDRESSES: "127.0.0.1",
            NB_OAUTH_TOKEN_RATE_LIMIT: "100",
        },
        stdio: "pipe",
    });
    server.stdout?.resume();
    server.stderr?.resume();
    await waitForServer();
    const login = await request("/api/auth/login", {
        method: "POST",
        jar: adminJar,
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username: "admin", password: adminPassword}),
    });
    expect(login.status).toBe(200);
}, 90_000);

afterAll(async () => {
    server?.kill();
    db?.close();
    for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 300));
        try {
            rmSync(runDir, {recursive: true, force: true});
            return;
        } catch {
            // Windows 可能仍有 SQLite 句柄，继续等待。
        }
    }
});

describe("官方 OAuth provider", () => {
    it("metadata 使用绝对 endpoint URL 与固定能力集合", async () => {
        const response = await request("/.well-known/oauth-authorization-server");
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/oauth/authorize`,
            token_endpoint: `${baseUrl}/api/v1/oauth/token`,
            userinfo_endpoint: `${baseUrl}/api/v1/oauth/userinfo`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
            scopes_supported: ["profile"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["client_secret_basic"],
        });
    });

    it("未知 redirect、plain PKCE 与重复 query 在生成 code 前拒绝", async () => {
        const verifier = randomBytes(32).toString("base64url");
        const unknownRedirect = authorizeQuery(verifier).replace(
            encodeURIComponent("https://llmlint.notnotype.com/auth/neurobook"),
            encodeURIComponent("https://evil.example/callback"),
        );
        const unknown = await request(`/api/v1/oauth/authorize${unknownRedirect}`, {jar: adminJar});
        expect(unknown.status).toBe(400);
        expect(unknown.headers.get("location")).toBeNull();

        const plain = authorizeQuery(verifier).replace("code_challenge_method=S256", "code_challenge_method=plain");
        expect((await request(`/api/v1/oauth/authorize${plain}`, {jar: adminJar})).status).toBe(400);
        const duplicate = `${authorizeQuery(verifier)}&scope=profile`;
        expect((await request(`/api/v1/oauth/authorize${duplicate}`, {jar: adminJar})).status).toBe(400);
        const rows = await db!.execute("SELECT COUNT(*) AS count FROM OAuthAuthorizationCode");
        expect(Number(rows.rows[0]?.count)).toBe(0);
    });

    it("完整 S256 批准、一次性兑换和 userinfo 闭环不发 refresh token", async () => {
        const verifier = randomBytes(32).toString("base64url");
        const query = authorizeQuery(verifier);
        const preview = await request(`/api/v1/oauth/authorize${query}`, {jar: adminJar});
        expect(preview.status).toBe(200);
        await expect(preview.json()).resolves.toMatchObject({clientId: "llmlint-web", scope: "profile"});

        const approved = await request(`/api/v1/oauth/authorize${query}`, {
            method: "POST",
            jar: adminJar,
            headers: {"Content-Type": "application/json", Origin: baseUrl},
            body: JSON.stringify({allowed: true}),
        });
        expect(approved.status).toBe(302);
        const location = approved.headers.get("location");
        expect(location).toContain("https://llmlint.notnotype.com/auth/neurobook");
        const code = new URL(location ?? "https://invalid").searchParams.get("code");
        expect(code).toBeTruthy();
        expect(new URL(location ?? "https://invalid").searchParams.get("state")).toBe("state-integration-1");

        const token = await request("/api/v1/oauth/token", {
            method: "POST",
            headers: {
                Authorization: basicHeader(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: code ?? "",
                redirect_uri: "https://llmlint.notnotype.com/auth/neurobook",
                code_verifier: verifier,
            }),
        });
        expect(token.status).toBe(200);
        const tokenBody = await json<{access_token: string; token_type: string; expires_in: number; refresh_token?: string}>(token);
        expect(tokenBody.expires_in).toBeGreaterThanOrEqual(299);
        expect(tokenBody.expires_in).toBeLessThanOrEqual(300);
        expect(tokenBody.token_type).toBe("Bearer");
        expect(tokenBody.access_token).toBeTruthy();
        expect("refresh_token" in tokenBody).toBe(false);
        const stored = await db!.execute("SELECT COUNT(*) AS count FROM OAuthAccessToken");
        expect(Number(stored.rows[0]?.count)).toBe(1);

        const profile = await request("/api/v1/oauth/userinfo", {
            headers: {Authorization: `Bearer ${tokenBody.access_token}`},
        });
        expect(profile.status).toBe(200);
        expect(await profile.json()).toEqual({
            sub: "1",
            id: 1,
            username: "admin",
            displayName: "admin",
            status: "active",
        });

        const replay = await request("/api/v1/oauth/token", {
            method: "POST",
            headers: {Authorization: basicHeader(), "Content-Type": "application/x-www-form-urlencoded"},
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: code ?? "",
                redirect_uri: "https://llmlint.notnotype.com/auth/neurobook",
                code_verifier: verifier,
            }),
        });
        expect(replay.status).toBe(400);
        expect((await replay.json() as {error: string}).error).toBe("invalid_grant");
    });

    it("拒绝缺失或错误 Basic、refresh grant、错误 verifier 与非官方 Origin", async () => {
        const verifier = randomBytes(32).toString("base64url");
        const query = authorizeQuery(verifier, "state-integration-2");
        const missingOrigin = await request(`/api/v1/oauth/authorize${query}`, {
            method: "POST",
            jar: adminJar,
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({allowed: true}),
        });
        expect(missingOrigin.status).toBe(403);
        const countAfterOrigin = await db!.execute("SELECT COUNT(*) AS count FROM OAuthAuthorizationCode");
        expect(Number(countAfterOrigin.rows[0]?.count)).toBe(1);

        const noBasic = await request("/api/v1/oauth/token", {
            method: "POST",
            headers: {"Content-Type": "application/x-www-form-urlencoded"},
            body: new URLSearchParams({grant_type: "authorization_code"}),
        });
        expect(noBasic.status).toBe(401);
        expect(noBasic.headers.get("www-authenticate")).toBe('Basic realm="oauth"');
        expect((await noBasic.json() as {error: string}).error).toBe("invalid_client");

        const refresh = await request("/api/v1/oauth/token", {
            method: "POST",
            headers: {Authorization: basicHeader(), "Content-Type": "application/x-www-form-urlencoded"},
            body: new URLSearchParams({grant_type: "refresh_token", refresh_token: "not-issued"}),
        });
        expect(refresh.status).toBe(400);
        expect((await refresh.json() as {error: string}).error).toBe("unsupported_grant_type");

        const approved = await request(`/api/v1/oauth/authorize${query}`, {
            method: "POST",
            jar: adminJar,
            headers: {"Content-Type": "application/json", Origin: baseUrl},
            body: JSON.stringify({allowed: true}),
        });
        const code = new URL(approved.headers.get("location") ?? "https://invalid").searchParams.get("code");
        const wrong = await request("/api/v1/oauth/token", {
            method: "POST",
            headers: {Authorization: basicHeader(), "Content-Type": "application/x-www-form-urlencoded"},
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: code ?? "",
                redirect_uri: "https://llmlint.notnotype.com/auth/neurobook",
                code_verifier: `${verifier.slice(0, -1)}x`,
            }),
        });
        expect(wrong.status).toBe(400);
        expect((await wrong.json() as {error: string}).error).toBe("invalid_grant");
        const correctAfterWrong = await request("/api/v1/oauth/token", {
            method: "POST",
            headers: {Authorization: basicHeader(), "Content-Type": "application/x-www-form-urlencoded"},
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: code ?? "",
                redirect_uri: "https://llmlint.notnotype.com/auth/neurobook",
                code_verifier: verifier,
            }),
        });
        expect(correctAfterWrong.status).toBe(400);
        expect((await correctAfterWrong.json() as {error: string}).error).toBe("invalid_grant");
    });

    it("userinfo 只接受 Bearer，日志脱敏覆盖 OAuth 凭据", async () => {
        const cookieOnly = await request("/api/v1/oauth/userinfo", {jar: adminJar});
        expect(cookieOnly.status).toBe(401);
        expect((await cookieOnly.json() as {error: string}).error).toBe("invalid_access_token");
        expect(redactSensitiveText("authorization=Basic dGVzdA== code_verifier=secret code_challenge=hash?token=x")).not.toContain("dGVzdA==");
        expect(redactSensitiveText("code=nb_oac_secret-value access_token=nb_oat_secret-value")).not.toContain("secret-value");
    });
});
