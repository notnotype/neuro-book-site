import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {createClient, type Client} from "@libsql/client";
import {strToU8, unzipSync, zipSync} from "fflate";
import {afterEach, describe, expect, it} from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const cleanupRoots: string[] = [];

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        // libsql 的 Windows SQLite 句柄异步释放；临时夹不影响测试语义，重试后仍占用则留给系统清理。
        for (let attempt = 0; attempt < 4; attempt += 1) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
            try {
                await rm(root, {recursive: true, force: true});
                break;
            } catch {
                // 下一次重试。
            }
        }
    }
});

/** 在子进程执行资产迁移命令，避免测试进程复用 Prisma 单例。 */
function runMigration(dbPath: string, filesDir: string, apply: boolean): string {
    const result = spawnSync("bun", ["scripts/migrate-agent-assets.ts", ...(apply ? ["--apply"] : [])], {
        cwd: repoRoot,
        env: {...process.env, DATABASE_URL: `file:${dbPath}`, WORKSHOP_FILES_DIR: filesDir},
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error(`资产迁移命令失败：${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

/** 写入旧协议 ZIP，返回原始字节。 */
async function writeLegacyArchive(path: string, version: number): Promise<Uint8Array> {
    const bytes = zipSync({
        "nbook-package.json": strToU8(JSON.stringify({
            manifestVersion: 1,
            type: "skill",
            name: "demo-skill",
            version,
        })),
        "SKILL.md": strToU8("# demo\n"),
    });
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, bytes);
    return bytes;
}

describe("Agent 资产真实迁移", () => {
    it("保留 ordinal，把整数版本映射为 SemVer 并把包迁移命令保持为 dry-run + 幂等 apply", async () => {
        const root = await mkdtemp(join(tmpdir(), "agent-asset-real-migration-"));
        cleanupRoots.push(root);
        const dbPath = join(root, "site.db");
        const filesDir = join(root, "files");
        const setupDb = createClient({url: `file:${dbPath}`});
        await createLegacyTables(setupDb);
        await setupDb.execute("INSERT INTO WorkshopItem (id) VALUES (1)");
        await setupDb.execute({
            sql: "INSERT INTO ItemVersion (id, itemId, version, fileName, fileSize, sha256) VALUES (?, ?, ?, ?, ?, ?)",
            args: [7, 1, 3, "demo.zip", 1, "old"],
        });

        const migrationSql = await readFile(join(repoRoot, "prisma/migrations/20260728090000_agent_asset_package/migration.sql"), "utf8");
        await setupDb.executeMultiple(migrationSql);
        setupDb.close();
        expect(await queryVersion(dbPath, "id, ordinal, version, packageSchemaVersion"))
            .toMatchObject({id: 7, ordinal: 3, version: "3.0.0", packageSchemaVersion: 0});

        const archivePath = join(filesDir, "1", "3.zip");
        const originalArchive = await writeLegacyArchive(archivePath, 3);
        const dryRunOutput = runMigration(dbPath, filesDir, false);
        expect(dryRunOutput).toContain("Dry run found 1 version(s).");
        expect(new Uint8Array(await readFile(archivePath))).toEqual(originalArchive);
        expect(await queryVersion(dbPath, "packageSchemaVersion, sha256"))
            .toMatchObject({packageSchemaVersion: 0, sha256: "old"});

        const applyOutput = runMigration(dbPath, filesDir, true);
        expect(applyOutput).toContain("Migrated 1 version(s).");
        const appliedArchive = new Uint8Array(await readFile(archivePath));
        const entries = unzipSync(appliedArchive);
        expect(entries["nbook-package.json"]).toBeUndefined();
        expect(entries["package.json"]).toBeDefined();
        expect(await queryVersion(dbPath, "packageSchemaVersion, fileSize, sha256"))
            .toMatchObject({
                packageSchemaVersion: 1,
                fileSize: appliedArchive.byteLength,
                sha256: createHash("sha256").update(appliedArchive).digest("hex"),
            });

        const secondOutput = runMigration(dbPath, filesDir, true);
        expect(secondOutput).toContain("Migrated 0 version(s).");
        expect(new Uint8Array(await readFile(archivePath))).toEqual(appliedArchive);
    }, 30_000);
});

/** 使用短连接读取迁移行，避免 Windows SQLite 文件句柄阻塞子进程或清理。 */
async function queryVersion(dbPath: string, columns: string): Promise<object | undefined> {
    const db = createClient({url: `file:${dbPath}`});
    try {
        return (await db.execute(`SELECT ${columns} FROM ItemVersion WHERE id = 7`)).rows[0];
    } finally {
        db.close();
    }
}

/** 建立迁移前所需的最小真实 SQLite 表。 */
async function createLegacyTables(db: Client): Promise<void> {
    await db.executeMultiple(`
        CREATE TABLE WorkshopItem (id INTEGER NOT NULL PRIMARY KEY);
        CREATE TABLE ItemVersion (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            itemId INTEGER NOT NULL,
            version INTEGER NOT NULL,
            changelog TEXT NOT NULL DEFAULT '',
            fileName TEXT NOT NULL,
            fileSize INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            minAppVersion TEXT,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (itemId) REFERENCES WorkshopItem(id)
        );
        CREATE UNIQUE INDEX ItemVersion_itemId_version_key ON ItemVersion(itemId, version);
    `);
}
