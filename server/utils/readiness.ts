import {randomUUID} from "node:crypto";
import {open, mkdir, readdir, rm} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {prisma} from "../database/prisma";
import {backupDir} from "./backup-files";
import {databaseFilePath} from "./sqlite-file";
import {storageCapacityViolation, useStorageCapacityService} from "./storage-capacity";
import {workshopFilesDir} from "./workshop-files";
import {assertAgentAssetArchivesReady} from "./agent-asset-maintenance";

export type ReadyCheckStatus = "ok" | "degraded" | "error";

export type ReadyCheck = {
    status: ReadyCheckStatus;
};

export type ReadinessResult = {
    status: "ready" | "degraded" | "not_ready";
    checks: {
        database: ReadyCheck;
        migrations: ReadyCheck;
        agentAssets: ReadyCheck;
        databaseStorage: ReadyCheck;
        workshopStorage: ReadyCheck;
        backupStorage: ReadyCheck;
        capacity: ReadyCheck;
    };
    time: string;
};

export type ReadinessDependencies = {
    database: () => Promise<void>;
    migrations: () => Promise<void>;
    agentAssets: () => Promise<void>;
    databaseStorage: () => Promise<void>;
    workshopStorage: () => Promise<void>;
    backupStorage: () => Promise<void>;
    /** true 表示逻辑容量或物理保留空间已经耗尽。 */
    capacityExhausted: () => Promise<boolean>;
};

type MigrationRow = {
    migrationName: string;
    finishedAt: string | null;
    rolledBackAt: string | null;
};

/** 聚合所有 readiness 探针；容量耗尽降级但不阻断流量。 */
export async function evaluateReadiness(dependencies: ReadinessDependencies): Promise<ReadinessResult> {
    const [database, migrations, agentAssets, databaseStorage, workshopStorage, backupStorage, capacity] = await Promise.all([
        criticalCheck(dependencies.database),
        criticalCheck(dependencies.migrations),
        criticalCheck(dependencies.agentAssets),
        criticalCheck(dependencies.databaseStorage),
        criticalCheck(dependencies.workshopStorage),
        criticalCheck(dependencies.backupStorage),
        capacityCheck(dependencies.capacityExhausted),
    ]);
    const checks = {database, migrations, agentAssets, databaseStorage, workshopStorage, backupStorage, capacity};
    const statuses = Object.values(checks).map((check) => check.status);
    return {
        status: statuses.includes("error") ? "not_ready" : statuses.includes("degraded") ? "degraded" : "ready",
        checks,
        time: new Date().toISOString(),
    };
}

/** 执行真实生产探针。 */
export async function inspectReadiness(): Promise<ReadinessResult> {
    return await evaluateReadiness({
        database: async () => {
            await prisma.$queryRaw`SELECT 1`;
        },
        migrations: assertMigrationsReady,
        agentAssets: assertAgentAssetArchivesReady,
        databaseStorage: async () => await assertDirectoryWritable(dirname(databaseFilePath())),
        workshopStorage: async () => await assertDirectoryWritable(workshopFilesDir()),
        backupStorage: async () => await assertDirectoryWritable(backupDir()),
        capacityExhausted: async () => {
            const snapshot = await useStorageCapacityService().snapshot(backupDir(), 1);
            return storageCapacityViolation(snapshot, false) !== null;
        },
    });
}

/** 返回未成功应用的 migration 名称。 */
export function pendingMigrationNames(expected: string[], rows: MigrationRow[]): string[] {
    const applied = new Set(rows
        .filter((row) => row.finishedAt !== null && row.rolledBackAt === null)
        .map((row) => row.migrationName));
    return expected.filter((name) => !applied.has(name));
}

/** 校验镜像携带的所有 migration 已成功应用。 */
async function assertMigrationsReady(): Promise<void> {
    const migrationsRoot = resolve(process.env.NB_MIGRATIONS_DIR?.trim() || "prisma/migrations");
    const entries = await readdir(migrationsRoot, {withFileTypes: true});
    const expected = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(
        "SELECT migration_name AS migrationName, finished_at AS finishedAt, rolled_back_at AS rolledBackAt FROM _prisma_migrations",
    );
    if (pendingMigrationNames(expected, rows).length > 0) {
        throw new Error("存在未应用 migration");
    }
}

/** 创建、同步并删除同目录探针文件，验证持久目录可写。 */
async function assertDirectoryWritable(directory: string): Promise<void> {
    await mkdir(directory, {recursive: true});
    const probePath = join(directory, `.health-${process.pid}-${randomUUID()}.tmp`);
    const file = await open(probePath, "wx", 0o600);
    try {
        await file.writeFile("ready", "utf8");
        await file.sync();
    } finally {
        await file.close();
        await rm(probePath, {force: true});
    }
}

/** 运行阻断型探针，不向公网响应暴露异常细节。 */
async function criticalCheck(probe: () => Promise<void>): Promise<ReadyCheck> {
    try {
        await probe();
        return {status: "ok"};
    } catch {
        return {status: "error"};
    }
}

/** 容量不足是可读服务降级；读取容量本身失败才是不就绪。 */
async function capacityCheck(probe: () => Promise<boolean>): Promise<ReadyCheck> {
    try {
        return {status: await probe() ? "degraded" : "ok"};
    } catch {
        return {status: "error"};
    }
}
