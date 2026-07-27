import {strToU8, unzipSync, zipSync} from "fflate";
import {describe, expect, it} from "vitest";
import {buildUploadFile, parseCanonicalZip, validateSource, type ContentSource} from "../app/utils/workshop-package";
import {parseWorkshopPackage} from "../server/utils/workshop-package";

// 前端资产打包工具单测：核心契约是「客户端友好输入 → 打成的 canonical zip 必须被后端
// parseWorkshopPackage 接受」。跨端复用后端 util 做交叉校验，防止前端生成的包后端不认。

/** 取出打包结果字节，失败直接抛，便于断言。 */
async function fileBytes(result: ReturnType<typeof buildUploadFile>): Promise<Uint8Array> {
    if (!result.ok) {
        throw new Error(`打包失败：${result.error}`);
    }
    return new Uint8Array(await result.file.arrayBuffer());
}

describe("buildUploadFile → 后端可解析", () => {
    it("profile 在线编辑：生成 <name>.profile.tsx + manifest，后端接受", async () => {
        const source: ContentSource = {kind: "profile", bytes: strToU8("export const profileManifest = {};")};
        const bytes = await fileBytes(buildUploadFile(source, {slug: "my-writer", name: "my-writer", version: 1}));
        // 后端交叉校验
        const parsed = parseWorkshopPackage(bytes);
        expect(parsed.manifest).toEqual({manifestVersion: 1, type: "profile", name: "my-writer", version: 1});
        expect(parsed.entryNames).toContain("my-writer.profile.tsx");
    });

    it("profile 单文件字节：入口按 name 命名，绕开原文件名", async () => {
        // 模拟用户上传名为 leader.default.profile.tsx 的文件字节，平台按 slug 重命名入口
        const source: ContentSource = {kind: "profile", bytes: strToU8("// tsx")};
        const bytes = await fileBytes(buildUploadFile(source, {slug: "renamed", name: "renamed", version: 2}));
        const entries = unzipSync(bytes);
        expect(Object.keys(entries)).toContain("renamed.profile.tsx");
        expect(Object.keys(entries)).not.toContain("leader.default.profile.tsx");
    });

    it("skill 在线编辑：生成 SKILL.md + manifest，后端接受，可选 minAppVersion 落入", async () => {
        const source: ContentSource = {kind: "skill", bytes: strToU8("# demo\n"), isDirZip: false};
        const bytes = await fileBytes(buildUploadFile(source, {slug: "demo-skill", name: "demo-skill", version: 1, minAppVersion: "0.5.0"}));
        const parsed = parseWorkshopPackage(bytes);
        expect(parsed.manifest.type).toBe("skill");
        expect(parsed.manifest.minAppVersion).toBe("0.5.0");
        expect(parsed.entryNames).toContain("SKILL.md");
    });

    it("skill 目录 zip：剥离单层顶层文件夹并注入 manifest，保留子文件", async () => {
        // Windows 右键压缩「文件夹」的典型形态：my-skill/ 前缀
        const dirZip = zipSync({
            "my-skill/SKILL.md": strToU8("# my-skill\n"),
            "my-skill/reference/notes.md": strToU8("notes"),
        });
        const source: ContentSource = {kind: "skill", bytes: dirZip, isDirZip: true};
        const bytes = await fileBytes(buildUploadFile(source, {slug: "my-skill", name: "my-skill", version: 1}));
        const entries = unzipSync(bytes);
        // SKILL.md 回到根部、manifest 注入、子文件前缀剥离
        expect(Object.keys(entries)).toContain("SKILL.md");
        expect(Object.keys(entries)).toContain("reference/notes.md");
        expect(Object.keys(entries)).toContain("nbook-package.json");
        expect(Object.keys(entries)).not.toContain("my-skill/SKILL.md");
        // 后端接受
        expect(parseWorkshopPackage(bytes).manifest.name).toBe("my-skill");
    });

    it("skill 目录 zip：覆盖用户自带的旧 manifest（表单为真相源）", async () => {
        const dirZip = zipSync({
            "SKILL.md": strToU8("# x\n"),
            "nbook-package.json": strToU8(JSON.stringify({manifestVersion: 1, type: "skill", name: "stale", version: 99})),
        });
        const source: ContentSource = {kind: "skill", bytes: dirZip, isDirZip: true};
        const bytes = await fileBytes(buildUploadFile(source, {slug: "fresh", name: "fresh", version: 1}));
        expect(parseWorkshopPackage(bytes).manifest).toEqual({manifestVersion: 1, type: "skill", name: "fresh", version: 1});
    });

    it("skill 目录 zip 缺 SKILL.md：打包失败并给出可读错误", () => {
        const dirZip = zipSync({"README.md": strToU8("no entry")});
        const source: ContentSource = {kind: "skill", bytes: dirZip, isDirZip: true};
        const result = buildUploadFile(source, {slug: "x", name: "x", version: 1});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/SKILL\.md/);
        }
    });

    it("advanced 完整包：原样透传，不重打包", async () => {
        const canonical = zipSync({
            "nbook-package.json": strToU8(JSON.stringify({manifestVersion: 1, type: "skill", name: "as-is", version: 5})),
            "SKILL.md": strToU8("# as-is\n"),
        });
        const parsed = parseCanonicalZip(canonical);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const file = new File([canonical as BlobPart], "as-is.zip", {type: "application/zip"});
        const source: ContentSource = {kind: "advanced", file, parsed: parsed.manifest};
        const result = buildUploadFile(source, {slug: "as-is", name: "ignored", version: 999});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.file).toBe(file); // 同一个 File 引用，未重打包
        }
    });
});

describe("validateSource 即时校验", () => {
    it("空 profile / 空 SKILL.md 判为无效", () => {
        expect(validateSource({kind: "profile", bytes: new Uint8Array()}).ok).toBe(false);
        expect(validateSource({kind: "skill", bytes: new Uint8Array(), isDirZip: false}).ok).toBe(false);
    });

    it("目录 zip 含/缺 SKILL.md 分别判有效/无效（支持单层文件夹剥离）", () => {
        const good = zipSync({"pack/SKILL.md": strToU8("# ok")});
        const bad = zipSync({"pack/README.md": strToU8("no")});
        expect(validateSource({kind: "skill", bytes: good, isDirZip: true}).ok).toBe(true);
        expect(validateSource({kind: "skill", bytes: bad, isDirZip: true}).ok).toBe(false);
    });
});
