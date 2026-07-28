import {describe, expect, it, vi} from "vitest";
import {evaluateReadiness, pendingMigrationNames, type ReadinessDependencies} from "./readiness";

/** 构造全部通过的探针集合。 */
function readyDependencies(): ReadinessDependencies {
    return {
        database: vi.fn(async () => undefined),
        migrations: vi.fn(async () => undefined),
        agentAssets: vi.fn(async () => undefined),
        databaseStorage: vi.fn(async () => undefined),
        workshopStorage: vi.fn(async () => undefined),
        backupStorage: vi.fn(async () => undefined),
        capacityExhausted: vi.fn(async () => false),
    };
}

describe("evaluateReadiness", () => {
    it("全部探针通过时 ready", async () => {
        const result = await evaluateReadiness(readyDependencies());

        expect(result.status).toBe("ready");
        expect(Object.values(result.checks).every((check) => check.status === "ok")).toBe(true);
    });

    it("容量耗尽只 degraded，不进入 not_ready", async () => {
        const dependencies = readyDependencies();
        dependencies.capacityExhausted = vi.fn(async () => true);

        const result = await evaluateReadiness(dependencies);

        expect(result.status).toBe("degraded");
        expect(result.checks.capacity.status).toBe("degraded");
    });

    it("数据库、migration 或持久目录失败时 not_ready", async () => {
        const dependencies = readyDependencies();
        dependencies.migrations = vi.fn(async () => {
            throw new Error("pending");
        });

        const result = await evaluateReadiness(dependencies);

        expect(result.status).toBe("not_ready");
        expect(result.checks.migrations.status).toBe("error");
    });

    it("容量探针自身失败属于 not_ready", async () => {
        const dependencies = readyDependencies();
        dependencies.capacityExhausted = vi.fn(async () => {
            throw new Error("statfs failed");
        });

        const result = await evaluateReadiness(dependencies);

        expect(result.status).toBe("not_ready");
        expect(result.checks.capacity.status).toBe("error");
    });
});

describe("pendingMigrationNames", () => {
    it("只接受已完成且未回滚的 migration", () => {
        const pending = pendingMigrationNames(["001_init", "002_backup", "003_site"], [
            {migrationName: "001_init", finishedAt: "done", rolledBackAt: null},
            {migrationName: "002_backup", finishedAt: null, rolledBackAt: null},
            {migrationName: "003_site", finishedAt: "done", rolledBackAt: "rolled-back"},
        ]);

        expect(pending).toEqual(["002_backup", "003_site"]);
    });
});
