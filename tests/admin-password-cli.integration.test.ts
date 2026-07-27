import {execFileSync, execSync} from "node:child_process";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {createClient, type Client} from "@libsql/client";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {verifyUserPassword} from "../server/utils/password";

const repoRoot = resolve(import.meta.dirname, "..");
const runDir = join(repoRoot, ".agent", `admin-password-cli-${process.pid}`);
const dbPath = join(runDir, "site.db").replaceAll("\\", "/");
const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    ADMIN_USERNAME: "owner-admin",
};

let db: Client | null = null;

/** 调用真实 Bun CLI；密码通过 stdin 输入，不进入命令参数。 */
function runAdmin(command: "create" | "reset", password: string, username = "owner-admin"): string {
    return execFileSync("bun", ["scripts/admin-password.ts", command], {
        cwd: repoRoot,
        env: {...env, ADMIN_USERNAME: username},
        input: `${password}\n`,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
    });
}

/** 读取管理员密码状态，不把哈希写入测试输出。 */
async function adminState(): Promise<{passwordHash: string; role: string; sessionVersion: number}> {
    const result = await db!.execute({
        sql: "SELECT passwordHash, role, sessionVersion FROM User WHERE username = ?",
        args: ["owner-admin"],
    });
    const row = result.rows[0];
    if (!row || typeof row.passwordHash !== "string" || typeof row.role !== "string" || typeof row.sessionVersion !== "number") {
        throw new Error("测试管理员状态无效");
    }
    return {
        passwordHash: row.passwordHash,
        role: row.role,
        sessionVersion: row.sessionVersion,
    };
}

beforeAll(() => {
    rmSync(runDir, {recursive: true, force: true});
    mkdirSync(runDir, {recursive: true});
    writeFileSync(dbPath, "");
    execSync("bunx prisma migrate deploy", {cwd: repoRoot, env, stdio: "pipe"});
    db = createClient({url: `file:${dbPath}`});
}, 60_000);

afterAll(async () => {
    db?.close();
    for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 300));
        try {
            rmSync(runDir, {recursive: true, force: true});
            return;
        } catch {
            // Windows 文件句柄尚未释放，继续等待。
        }
    }
});

describe("管理员密码 CLI", () => {
    it("显式新建与重置，并拒绝覆盖、短密码和错误账号类型", async () => {
        const originalPassword = "owner-admin-original-password";
        const resetPassword = "owner-admin-reset-password";

        const createOutput = runAdmin("create", originalPassword);
        expect(createOutput).toContain("已创建管理员：owner-admin");
        expect(createOutput).not.toContain(originalPassword);

        const created = await adminState();
        expect(created.role).toBe("admin");
        expect(await verifyUserPassword(originalPassword, created.passwordHash)).toBe(true);

        expect(() => runAdmin("create", "must-not-overwrite-password")).toThrow();
        const notOverwritten = await adminState();
        expect(await verifyUserPassword(originalPassword, notOverwritten.passwordHash)).toBe(true);

        const resetOutput = runAdmin("reset", resetPassword);
        expect(resetOutput).toContain("已重置管理员密码并注销旧会话：owner-admin");
        expect(resetOutput).not.toContain(resetPassword);

        const reset = await adminState();
        expect(reset.sessionVersion).toBe(created.sessionVersion + 1);
        expect(await verifyUserPassword(originalPassword, reset.passwordHash)).toBe(false);
        expect(await verifyUserPassword(resetPassword, reset.passwordHash)).toBe(true);

        expect(() => runAdmin("reset", "short")).toThrow();
        expect(() => runAdmin("reset", "missing-admin-password", "missing-admin")).toThrow();

        await db!.execute({sql: "UPDATE User SET role = 'user' WHERE username = ?", args: ["owner-admin"]});
        expect(() => runAdmin("reset", "must-not-promote-user-password")).toThrow();
        const ordinaryUser = await adminState();
        expect(ordinaryUser.role).toBe("user");
        expect(await verifyUserPassword(resetPassword, ordinaryUser.passwordHash)).toBe(true);
    });
});
