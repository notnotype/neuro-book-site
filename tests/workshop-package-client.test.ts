import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {strToU8, zipSync} from "fflate";
import {afterEach, describe, expect, it} from "vitest";
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
    updateDraftIdentity,
    updateDraftPackage,
} from "../app/utils/workshop-package";
import {parseWorkshopPackageFile} from "../server/utils/workshop-package";

const cleanupRoots: string[] = [];

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

/** 将浏览器生成的包送入生产文件解析入口，验证跨端合同。 */
async function parseBuiltPackage(bytes: Uint8Array) {
    const root = await mkdtemp(join(tmpdir(), "nbook-browser-package-"));
    cleanupRoots.push(root);
    const path = join(root, "package.zip");
    await writeFile(path, bytes);
    return await parseWorkshopPackageFile(path);
}

describe("资产包浏览器草稿", () => {
    it("三类模板都能生成后端接受的统一包", async () => {
        for (const assetType of ["skill", "workflow", "profile"] as const) {
            const draft = createPackageDraft(assetType, `demo-${assetType}`);
            const built = await buildDraftZip(draft, `demo-${assetType}`);
            expect(built.ok).toBe(true);
            if (!built.ok) continue;
            expect((await parseBuiltPackage(built.bytes)).packageJson.neurobook.assetType).toBe(assetType);
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

    it("目录 ZIP 与完整包可导入，二进制字节保持不变", async () => {
        const bytes = zipSync({
            "demo/package.json": strToU8(JSON.stringify({name: "demo-skill", version: "1.0.0", type: "module", neurobook: {schemaVersion: 1, assetType: "skill"}})),
            "demo/SKILL.md": strToU8("---\nname: demo-skill\ndescription: demo\n---\n\n# demo\n"),
            "demo/media/icon.png": new Uint8Array([0, 1, 2, 255]),
        });
        const directory = await draftFromZip(bytes, true);
        expect(directory.ok).toBe(true);
        if (!directory.ok) return;
        expect(directory.draft.entries.find((entry) => entry.path === "media/icon.png")?.bytes).toEqual(new Uint8Array([0, 1, 2, 255]));
        expect(parseDraftPackage(directory.draft).ok).toBe(true);
    });

    it("拒绝伪装成目录但实际带有输出内容的 ZIP 条目", async () => {
        const imported = await draftFromZip(zipSync({"fake-directory/": strToU8("payload")}));
        expect(imported).toMatchObject({ok: false, issues: [{code: "zip_directory_content", path: "fake-directory"}]});
    });

    it("结构化更新 package.json 保留作者字段、执行锁门禁并支持 SemVer bump", () => {
        let draft = createPackageDraft("skill", "demo-skill", "1.2.3");
        const packageEntry = draft.entries.find((entry) => entry.path === "package.json")!;
        const enriched = JSON.parse(new TextDecoder().decode(packageEntry.bytes)) as {scripts?: {check: string}};
        enriched.scripts = {check: "bun test"};
        draft = updateDraftFile(draft, "package.json", `${JSON.stringify(enriched, null, 4)}\n`);
        draft = updateDraftPackage(draft, {version: bumpDraftVersion("1.2.3", "minor") ?? ""});
        expect(parseDraftPackage(draft)).toMatchObject({ok: false, issues: [{code: "missing_bun_lock", path: "bun.lock"}]});
        const withLock = addDraftEntry(draft, {path: "bun.lock", kind: "file", bytes: strToU8("lockfileVersion = 1")});
        expect(withLock.ok).toBe(true);
        if (!withLock.ok) return;
        const parsed = parseDraftPackage(withLock.draft);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.packageJson.version).toBe("1.3.0");
        expect(parsed.packageJson.scripts).toEqual({check: "bun test"});
    });

    it("修改安装名会原子同步三类源码身份并保持服务端可接受", async () => {
        const cases = [
            {type: "skill" as const, previous: "demo-skill", next: "renamed-skill"},
            {type: "workflow" as const, previous: "demo-workflow", next: "renamed-workflow"},
            {type: "profile" as const, previous: "demo-profile", next: "leader.default"},
        ];
        for (const testCase of cases) {
            const result = await updateDraftIdentity(createPackageDraft(testCase.type, testCase.previous), testCase.next);
            expect(result.ok).toBe(true);
            if (!result.ok) continue;
            const built = await buildDraftZip(result.draft, "renamed-package");
            expect(built.ok).toBe(true);
            if (!built.ok) continue;
            const parsed = await parseBuiltPackage(built.bytes);
            expect(parsed.packageJson.name).toBe(testCase.next);
        }
    });

    it("500 条目和危险路径在浏览器侧直接拒绝", () => {
        const draft = createPackageDraft("skill", "demo-skill");
        expect(addDraftEntry(draft, {path: "CON.txt", kind: "file", bytes: strToU8("bad")})).toMatchObject({ok: false});
        const many = Array.from({length: 501}, (_, index) => ({path: `files/${index}.txt`, kind: "file" as const, bytes: strToU8("x")}));
        expect(mergeDraftEntries(draft, many, true)).toMatchObject({ok: false, issues: [{code: "entry_limit", count: 500}]});
    });
});
