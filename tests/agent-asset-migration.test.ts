import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {strToU8, unzipSync, zipSync} from "fflate";
import {afterEach, describe, expect, it} from "vitest";
import {replaceArchive} from "../scripts/migrate-agent-assets";
import {migrateAgentAssetArchive} from "../server/utils/agent-asset-migration";

const cleanupRoots: string[] = [];

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

describe("migrateAgentAssetArchive", () => {
    it("合并已有 package.json、删除旧清单并保持 ordinal 对应的版本", () => {
        const source = zipSync({
            "nbook-package.json": strToU8(JSON.stringify({manifestVersion: 1, type: "skill", name: "demo-skill", version: 3, minAppVersion: "0.8.0"})),
            "package.json": strToU8(JSON.stringify({name: "old", version: "0.0.1", dependencies: {yaml: "^2.0.0"}, scripts: {check: "echo ok"}})),
            "SKILL.md": strToU8("# demo"),
            "references/notes.md": strToU8("kept"),
        });
        const result = migrateAgentAssetArchive(source, "3.0.0");
        expect(result.changed).toBe(true);
        const entries = unzipSync(result.bytes);
        expect(entries["nbook-package.json"]).toBeUndefined();
        expect(new TextDecoder().decode(entries["references/notes.md"])).toBe("kept");
        const packageJson = JSON.parse(new TextDecoder().decode(entries["package.json"])) as {
            name: string;
            version: string;
            dependencies: {yaml: string};
            scripts: {check: string};
            neurobook: {schemaVersion: number; assetType: string; minAppVersion: string};
        };
        expect(packageJson).toMatchObject({
            name: "demo-skill",
            version: "3.0.0",
            type: "module",
            dependencies: {yaml: "^2.0.0"},
            scripts: {check: "echo ok"},
            neurobook: {schemaVersion: 1, assetType: "skill", minAppVersion: "0.8.0"},
        });
        expect(migrateAgentAssetArchive(result.bytes, "3.0.0")).toEqual({bytes: result.bytes, changed: false});
    });

    it("数据库版本与旧包整数版本不一致时拒绝", () => {
        const source = zipSync({
            "nbook-package.json": strToU8(JSON.stringify({manifestVersion: 1, type: "skill", name: "demo-skill", version: 2})),
            "SKILL.md": strToU8("# demo"),
        });
        expect(() => migrateAgentAssetArchive(source, "3.0.0")).toThrow(/不一致/);
    });
});

describe("replaceArchive", () => {
    it("数据库更新失败时恢复原 ZIP", async () => {
        const root = await mkdtemp(join(tmpdir(), "agent-asset-migration-"));
        cleanupRoots.push(root);
        const path = join(root, "1.zip");
        await writeFile(path, "old");
        await expect(replaceArchive(path, strToU8("new"), async () => {
            throw new Error("database failed");
        })).rejects.toThrow(/database failed/);
        expect(await readFile(path, "utf8")).toBe("old");
    });
});
