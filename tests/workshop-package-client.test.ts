import {strToU8, zipSync} from "fflate";
import {describe, expect, it} from "vitest";
import {
    addDraftEntry,
    buildDraftZip,
    bumpDraftVersion,
    createPackageDraft,
    deleteDraftEntry,
    draftFromZip,
    mergeDraftEntries,
    moveDraftEntry,
    parseDraftPackage,
    renameDraftEntry,
    updateDraftFile,
    updateDraftPackage,
} from "../app/utils/workshop-package";
import {parseWorkshopPackage} from "../server/utils/workshop-package";

describe("资产包浏览器草稿", () => {
    it("三类模板都能生成后端接受的统一包", () => {
        for (const assetType of ["skill", "workflow", "profile"] as const) {
            const draft = createPackageDraft(assetType, `demo-${assetType}`);
            const built = buildDraftZip(draft, `demo-${assetType}`);
            expect(built.ok).toBe(true);
            if (!built.ok) continue;
            expect(parseWorkshopPackage(built.bytes).packageJson.neurobook.assetType).toBe(assetType);
        }
    });

    it("新建、改名、移动和删除会保持树结构合法", () => {
        let draft = createPackageDraft("skill", "demo-skill");
        const directory = addDraftEntry(draft, {path: "references", kind: "directory", bytes: new Uint8Array()});
        expect(directory.ok).toBe(true);
        if (!directory.ok) return;
        draft = directory.draft;

        const file = addDraftEntry(draft, {path: "notes.md", kind: "file", bytes: strToU8("notes")});
        expect(file.ok).toBe(true);
        if (!file.ok) return;
        draft = file.draft;

        const moved = moveDraftEntry(draft, {sourceId: "notes.md", targetId: "references", position: "inside"});
        expect(moved.ok).toBe(true);
        if (!moved.ok) return;
        expect(moved.selectedPath).toBe("references/notes.md");
        expect(moved.draft.entries.some((entry) => entry.path === "references/notes.md")).toBe(true);

        const renamed = renameDraftEntry(moved.draft, "references", "docs");
        expect(renamed.ok).toBe(true);
        if (!renamed.ok) return;
        expect(renamed.draft.entries.some((entry) => entry.path === "docs/notes.md")).toBe(true);
        expect(deleteDraftEntry(renamed.draft, "docs").entries.some((entry) => entry.path.startsWith("docs"))).toBe(false);
    });

    it("拒绝目录移动到自身、保留大小写冲突并要求显式覆盖", () => {
        const withDirectory = addDraftEntry(createPackageDraft("skill", "demo-skill"), {path: "docs/inside", kind: "directory", bytes: new Uint8Array()});
        expect(withDirectory.ok).toBe(true);
        if (!withDirectory.ok) return;
        expect(moveDraftEntry(withDirectory.draft, {sourceId: "docs", targetId: "docs/inside", position: "inside"})).toMatchObject({ok: false});

        const imported = [{path: "skill.md", kind: "file" as const, bytes: strToU8("replace")}];
        const blocked = mergeDraftEntries(withDirectory.draft, imported, false);
        expect(blocked.ok).toBe(true);
        if (!blocked.ok) return;
        expect(blocked.conflicts).toEqual(["skill.md"]);
        const overwritten = mergeDraftEntries(withDirectory.draft, imported, true);
        expect(overwritten.ok).toBe(true);
        if (!overwritten.ok) return;
        expect(overwritten.conflicts).toEqual(["skill.md"]);
        expect(new TextDecoder().decode(overwritten.draft.entries.find((entry) => entry.path.toLowerCase() === "skill.md")?.bytes)).toBe("replace");
    });

    it("目录 ZIP 与完整包可导入，二进制字节保持不变", () => {
        const bytes = zipSync({
            "demo/package.json": strToU8(JSON.stringify({name: "demo-skill", version: "1.0.0", type: "module", neurobook: {schemaVersion: 1, assetType: "skill"}})),
            "demo/SKILL.md": strToU8("# demo"),
            "demo/media/icon.png": new Uint8Array([0, 1, 2, 255]),
        });
        const directory = draftFromZip(bytes, true);
        expect(directory.ok).toBe(true);
        if (!directory.ok) return;
        expect(directory.draft.entries.find((entry) => entry.path === "media/icon.png")?.bytes).toEqual(new Uint8Array([0, 1, 2, 255]));
        expect(parseDraftPackage(directory.draft).ok).toBe(true);
    });

    it("结构化更新 package.json 保留作者字段并支持 SemVer bump", () => {
        let draft = createPackageDraft("skill", "demo-skill", "1.2.3");
        const packageEntry = draft.entries.find((entry) => entry.path === "package.json")!;
        const enriched = JSON.parse(new TextDecoder().decode(packageEntry.bytes)) as {scripts?: {check: string}};
        enriched.scripts = {check: "bun test"};
        draft = updateDraftFile(draft, "package.json", `${JSON.stringify(enriched, null, 4)}\n`);
        draft = updateDraftPackage(draft, {version: bumpDraftVersion("1.2.3", "minor") ?? ""});
        const parsed = parseDraftPackage(draft);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.packageJson.version).toBe("1.3.0");
        expect(parsed.packageJson.scripts).toEqual({check: "bun test"});
    });

    it("500 条目和危险路径在浏览器侧直接拒绝", () => {
        const draft = createPackageDraft("skill", "demo-skill");
        expect(addDraftEntry(draft, {path: "CON.txt", kind: "file", bytes: strToU8("bad")})).toMatchObject({ok: false});
        const many = Array.from({length: 501}, (_, index) => ({path: `files/${index}.txt`, kind: "file" as const, bytes: strToU8("x")}));
        expect(mergeDraftEntries(draft, many, true)).toMatchObject({ok: false, error: expect.stringMatching(/500/)});
    });
});
