import {strToU8, unzipSync} from "fflate";
import {describe, expect, it} from "vitest";
import {migrateAgentAssetEntries} from "../server/utils/agent-asset-migration";

describe("migrateAgentAssetEntries", () => {
    it("合并已有 package.json、删除旧清单并保持数据库 SemVer", () => {
        const source = new Map<string, Uint8Array>([
            ["nbook-package.json", strToU8(JSON.stringify({manifestVersion: 1, type: "skill", name: "demo-skill", version: 3, minAppVersion: "0.8.0"}))],
            ["package.json", strToU8(JSON.stringify({name: "old", version: "0.0.1", dependencies: {yaml: "^2.0.0"}, scripts: {check: "echo ok"}}))],
            ["SKILL.md", strToU8("---\nname: demo-skill\ndescription: demo\n---\n\n# demo\n")],
            ["bun.lock", strToU8("lockfileVersion = 1")],
            ["references/notes.md", strToU8("kept")],
        ]);

        const result = migrateAgentAssetEntries(source, "3.0.0");
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

        const migratedEntries = new Map(Object.entries(entries));
        expect(migrateAgentAssetEntries(migratedEntries, "3.0.0").changed).toBe(false);
    });

    it("数据库版本与旧包整数版本不一致时拒绝", () => {
        const source = new Map<string, Uint8Array>([
            ["nbook-package.json", strToU8(JSON.stringify({manifestVersion: 1, type: "skill", name: "demo-skill", version: 2}))],
            ["SKILL.md", strToU8("---\nname: demo-skill\ndescription: demo\n---\n")],
        ]);
        expect(() => migrateAgentAssetEntries(source, "3.0.0")).toThrow(/不一致/);
    });

    it("拒绝无效旧清单和无效已有 package.json", () => {
        expect(() => migrateAgentAssetEntries(new Map([
            ["nbook-package.json", strToU8("null")],
        ]), "1.0.0")).toThrow(/字段无效/);
        expect(() => migrateAgentAssetEntries(new Map([
            ["nbook-package.json", strToU8(JSON.stringify({manifestVersion: 1, type: "skill", name: "demo-skill", version: 1}))],
            ["package.json", strToU8("[]")],
        ]), "1.0.0")).toThrow(/必须是对象/);
    });
});
