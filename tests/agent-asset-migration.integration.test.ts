import {spawnSync, type SpawnSyncReturns} from "node:child_process";
import {createHash} from "node:crypto";
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {createClient, type Client} from "@libsql/client";
import {strToU8, unzipSync, zipSync} from "fflate";
import {afterEach, describe, expect, it} from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const cleanupRoots: string[] = [];

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        // libsql 的 Windows SQLite 句柄异步释放；重试后仍占用则留给系统清理。
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

type Fixture = {
    root: string;
    dbPath: string;
    filesDir: string;
    archivePath: string;
    originalArchive: Uint8Array;
};

/** 在子进程执行资产维护命令，避免测试进程复用 Prisma 单例。 */
function spawnMigration(fixture: Fixture, mode: "preflight" | "apply"): SpawnSyncReturns<string> {
    return spawnSync("bun", ["scripts/migrate-agent-assets.ts", mode === "apply" ? "--apply" : "--preflight"], {
        cwd: repoRoot,
        env: {...process.env, DATABASE_URL: `file:${fixture.dbPath}`, WORKSHOP_FILES_DIR: fixture.filesDir},
        encoding: "utf8",
    });
}

/** 要求维护命令成功并返回 stdout。 */
function runMigration(fixture: Fixture, mode: "preflight" | "apply"): string {
    const result = spawnMigration(fixture, mode);
    if (result.status !== 0) {
        throw new Error(`资产迁移命令失败：${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

/** 建立尚未执行 Task 01 Prisma migration 的数据库与匹配旧归档。 */
async function createLegacyFixture(): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), "agent-asset-real-migration-"));
    cleanupRoots.push(root);
    const dbPath = join(root, "site.db");
    const filesDir = join(root, "files");
    const archivePath = join(filesDir, "1", "3.zip");
    const originalArchive = zipSync({
        "nbook-package.json": strToU8(JSON.stringify({manifestVersion: 1, type: "skill", name: "demo-skill", version: 3})),
        "SKILL.md": strToU8("# migration fixture\n"),
    });
    await mkdir(dirname(archivePath), {recursive: true});
    await writeFile(archivePath, originalArchive);

    const db = createClient({url: `file:${dbPath}`});
    await createLegacyTables(db);
    await db.execute("INSERT INTO User (id) VALUES (1)");
    await db.execute({
        sql: `INSERT INTO WorkshopItem
            (id, slug, name, type, title, authorId, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [1, "demo-skill", "demo-skill", "skill", "Demo", 1, "published"],
    });
    await db.execute({
        sql: "INSERT INTO ItemVersion (id, itemId, version, fileName, fileSize, sha256) VALUES (?, ?, ?, ?, ?, ?)",
        args: [7, 1, 3, "demo.zip", originalArchive.byteLength, sha256(originalArchive)],
    });
    db.close();
    return {root, dbPath, filesDir, archivePath, originalArchive};
}

/** 应用本任务两段真实 Prisma SQL，模拟 entrypoint 的 migrate deploy。 */
async function applyTaskMigrations(dbPath: string): Promise<void> {
    const db = createClient({url: `file:${dbPath}`});
    try {
        for (const migration of ["20260728090000_agent_asset_package", "20260729090000_agent_asset_publish_integrity"]) {
            await db.executeMultiple(await readFile(join(repoRoot, "prisma/migrations", migration, "migration.sql"), "utf8"));
        }
    } finally {
        db.close();
    }
}

describe("Agent 资产真实迁移", () => {
    it("旧表 preflight 零写入，Prisma migration 后 apply 保留 ordinal 并保持幂等", async () => {
        const fixture = await createLegacyFixture();

        const dryRunOutput = runMigration(fixture, "preflight");
        expect(dryRunOutput).toContain("preflight migrate item=1 version=3.0.0");
        expect(new Uint8Array(await readFile(fixture.archivePath))).toEqual(fixture.originalArchive);
        expect(await tableColumns(fixture.dbPath, "ItemVersion")).not.toContain("ordinal");
        expect(await sidecars(fixture.archivePath)).toEqual({temporary: false, backup: false});

        const prematureApply = spawnMigration(fixture, "apply");
        expect(prematureApply.status).not.toBe(0);
        expect(`${prematureApply.stderr}${prematureApply.stdout}`).toMatch(/ordinal|ItemVersion/);

        await applyTaskMigrations(fixture.dbPath);
        expect(await queryVersion(fixture.dbPath, "id, ordinal, version, packageSchemaVersion, containsExecutableCode"))
            .toMatchObject({id: 7, ordinal: 3, version: "3.0.0", packageSchemaVersion: 0, containsExecutableCode: 1});
        expect(await foreignKeyViolations(fixture.dbPath)).toEqual([]);

        const migratedPreflight = runMigration(fixture, "preflight");
        expect(migratedPreflight).toContain("preflight migrate item=1 version=3.0.0");
        expect(new Uint8Array(await readFile(fixture.archivePath))).toEqual(fixture.originalArchive);

        const applyOutput = runMigration(fixture, "apply");
        expect(applyOutput).toContain("apply migrate item=1 version=3.0.0");
        const appliedArchive = new Uint8Array(await readFile(fixture.archivePath));
        const entries = unzipSync(appliedArchive);
        expect(entries["nbook-package.json"]).toBeUndefined();
        expect(entries["package.json"]).toBeDefined();
        expect(new TextDecoder().decode(entries["SKILL.md"])).toBe(
            "---\nname: demo-skill\ndescription: migration fixture\n---\n# migration fixture\n",
        );
        expect(await queryVersion(fixture.dbPath, "packageSchemaVersion, fileSize, sha256, containsExecutableCode"))
            .toMatchObject({
                packageSchemaVersion: 1,
                fileSize: appliedArchive.byteLength,
                sha256: sha256(appliedArchive),
                containsExecutableCode: 0,
            });
        expect(await sidecars(fixture.archivePath)).toEqual({temporary: false, backup: false});

        const secondOutput = runMigration(fixture, "apply");
        expect(secondOutput).toContain('"migrated":0');
        expect(new Uint8Array(await readFile(fixture.archivePath))).toEqual(appliedArchive);

        const orphan = join(dirname(fixture.archivePath), "99.zip");
        await writeFile(orphan, "orphan after file commit");
        expect(runMigration(fixture, "preflight")).toContain("preflight remove-orphan 1/99.zip");
        expect(await exists(orphan)).toBe(true);
        expect(runMigration(fixture, "apply")).toContain("apply remove-orphan 1/99.zip");
        expect(await exists(orphan)).toBe(false);
    }, 30_000);

    it("schema 0 从确定性 backup 恢复后重跑，schema 1 只在正式文件匹配时清理 sidecar", async () => {
        const fixture = await createLegacyFixture();
        await applyTaskMigrations(fixture.dbPath);
        const temporary = join(dirname(fixture.archivePath), ".agent-asset-7.tmp");
        const backup = join(dirname(fixture.archivePath), ".agent-asset-7.backup");
        await writeFile(backup, fixture.originalArchive);
        await writeFile(temporary, "partial candidate");
        await writeFile(fixture.archivePath, "new file before database commit");

        const output = runMigration(fixture, "apply");
        expect(output).toContain("apply restore-backup item=1 version=3.0.0");
        expect(output).toContain("apply migrate item=1 version=3.0.0");
        expect(await sidecars(fixture.archivePath)).toEqual({temporary: false, backup: false});

        const currentArchive = await readFile(fixture.archivePath);
        await writeFile(backup, fixture.originalArchive);
        const preflight = runMigration(fixture, "preflight");
        expect(preflight).toContain("preflight remove-sidecar .agent-asset-7.backup");
        expect((await sidecars(fixture.archivePath)).backup).toBe(true);
        runMigration(fixture, "apply");
        expect(await sidecars(fixture.archivePath)).toEqual({temporary: false, backup: false});
        expect(await readFile(fixture.archivePath)).toEqual(currentArchive);
    }, 30_000);

    it("摘要不符和无法归属的 sidecar 都会失败关闭", async () => {
        const fixture = await createLegacyFixture();
        await applyTaskMigrations(fixture.dbPath);
        runMigration(fixture, "apply");
        await writeFile(fixture.archivePath, "corrupt");
        const corrupt = spawnMigration(fixture, "preflight");
        expect(corrupt.status).not.toBe(0);
        expect(`${corrupt.stderr}${corrupt.stdout}`).toMatch(/大小与数据库不一致|SHA-256/);

        const fixtureWithUnknownSidecar = await createLegacyFixture();
        await writeFile(join(dirname(fixtureWithUnknownSidecar.archivePath), ".agent-asset-999.tmp"), "unknown");
        const unknown = spawnMigration(fixtureWithUnknownSidecar, "preflight");
        expect(unknown.status).not.toBe(0);
        expect(`${unknown.stderr}${unknown.stdout}`).toMatch(/无法归属数据库版本/);
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

async function tableColumns(dbPath: string, table: string): Promise<string[]> {
    const db = createClient({url: `file:${dbPath}`});
    try {
        return (await db.execute(`PRAGMA table_info("${table}")`)).rows.map((row) => String(row.name));
    } finally {
        db.close();
    }
}

async function foreignKeyViolations(dbPath: string): Promise<object[]> {
    const db = createClient({url: `file:${dbPath}`});
    try {
        return [...(await db.execute("PRAGMA foreign_key_check")).rows];
    } finally {
        db.close();
    }
}

async function sidecars(archivePath: string): Promise<{temporary: boolean; backup: boolean}> {
    const directory = dirname(archivePath);
    return {
        temporary: await exists(join(directory, ".agent-asset-7.tmp")),
        backup: await exists(join(directory, ".agent-asset-7.backup")),
    };
}

async function exists(path: string): Promise<boolean> {
    return await access(path).then(() => true).catch(() => false);
}

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** 建立本任务之前足够执行两段真实迁移的最小表。 */
async function createLegacyTables(db: Client): Promise<void> {
    await db.executeMultiple(`
        CREATE TABLE User (id INTEGER NOT NULL PRIMARY KEY);
        CREATE TABLE WorkshopItem (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            tagsJson TEXT NOT NULL DEFAULT '[]',
            authorId INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'published',
            featured BOOLEAN NOT NULL DEFAULT false,
            downloadCount INTEGER NOT NULL DEFAULT 0,
            likeCount INTEGER NOT NULL DEFAULT 0,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (authorId) REFERENCES User(id)
        );
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
