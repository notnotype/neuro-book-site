import {strToU8} from "fflate";
import {describe, expect, it} from "vitest";
import {assertUploadAllowed, parseWorkshopPackage} from "../server/utils/workshop-package";
import {buildPackageZip} from "./helpers/zip";

// 上传数据校验单测：manifest 解析 / entry 存在 / 与条目一致性 / version 递增。

const skillManifest = {manifestVersion: 1, type: "skill", name: "demo-skill", version: 1};
const skillEntries = {"SKILL.md": strToU8("# demo-skill\n")};

describe("parseWorkshopPackage", () => {
    it("拒绝无法解析的 zip 字节", () => {
        expect(() => parseWorkshopPackage(strToU8("not a zip"))).toThrowError(/无法解析 zip 文件/);
    });

    it("拒绝缺少 nbook-package.json 的包", () => {
        const zip = buildPackageZip(null, skillEntries);
        expect(() => parseWorkshopPackage(zip)).toThrowError(/包根部缺少 nbook-package\.json/);
    });

    it("拒绝 manifest 不是合法 JSON", () => {
        const zip = buildPackageZip(null, {...skillEntries, "nbook-package.json": strToU8("{oops")});
        expect(() => parseWorkshopPackage(zip)).toThrowError(/不是合法 JSON/);
    });

    it("拒绝 manifestVersion 不为 1", () => {
        const zip = buildPackageZip({...skillManifest, manifestVersion: 2}, skillEntries);
        expect(() => parseWorkshopPackage(zip)).toThrowError(/manifestVersion 必须为 1/);
    });

    it("拒绝非法 type", () => {
        const zip = buildPackageZip({...skillManifest, type: "theme"}, skillEntries);
        expect(() => parseWorkshopPackage(zip)).toThrowError(/type 必须是 skill 或 profile/);
    });

    it("拒绝非 kebab-case 的 name", () => {
        const zip = buildPackageZip({...skillManifest, name: "Bad_Name"}, skillEntries);
        expect(() => parseWorkshopPackage(zip)).toThrowError(/name 必须是 kebab-case/);
    });

    it("拒绝非正整数 version", () => {
        expect(() => parseWorkshopPackage(buildPackageZip({...skillManifest, version: 0}, skillEntries))).toThrowError(/version 必须是正整数/);
        expect(() => parseWorkshopPackage(buildPackageZip({...skillManifest, version: 1.5}, skillEntries))).toThrowError(/version 必须是整数/);
    });

    it("拒绝缺少 SKILL.md 的 skill 包", () => {
        const zip = buildPackageZip(skillManifest, {"README.md": strToU8("no entry")});
        expect(() => parseWorkshopPackage(zip)).toThrowError(/skill 包根部必须包含 SKILL\.md/);
    });

    it("拒绝缺少 <name>.profile.tsx 的 profile 包", () => {
        const manifest = {manifestVersion: 1, type: "profile", name: "mini-writer", version: 1};
        const zip = buildPackageZip(manifest, {"mini-writer.home/notes.md": strToU8("notes")});
        expect(() => parseWorkshopPackage(zip)).toThrowError(/profile 包根部必须包含 mini-writer\.profile\.tsx/);
    });

    it("解析合法 skill 包", () => {
        const zip = buildPackageZip(skillManifest, skillEntries);
        const parsed = parseWorkshopPackage(zip);
        expect(parsed.manifest).toEqual(skillManifest);
        expect(parsed.entryNames).toContain("SKILL.md");
    });

    it("解析合法 profile 包（含 home 目录与可选 minAppVersion）", () => {
        const manifest = {manifestVersion: 1, type: "profile", name: "mini-writer", version: 3, minAppVersion: "0.5.6"};
        const zip = buildPackageZip(manifest, {
            "mini-writer.profile.tsx": strToU8("export const profileManifest = {};"),
            "mini-writer.home/notes.md": strToU8("notes"),
        });
        const parsed = parseWorkshopPackage(zip);
        expect(parsed.manifest.minAppVersion).toBe("0.5.6");
        expect(parsed.entryNames).toContain("mini-writer.home/notes.md");
    });
});

describe("assertUploadAllowed", () => {
    const skillItem = {type: "skill" as const, name: "demo-skill"};

    it("拒绝包 type 与条目类型不一致（首版同样校验）", () => {
        const manifest = {manifestVersion: 1 as const, type: "profile" as const, name: "demo-skill", version: 1};
        expect(() => assertUploadAllowed(manifest, skillItem, null)).toThrowError(/包 type（profile）与条目类型（skill）不一致/);
    });

    it("首版放行：安装名以 manifest 为准", () => {
        const manifest = {manifestVersion: 1 as const, type: "skill" as const, name: "any-new-name", version: 1};
        expect(() => assertUploadAllowed(manifest, {type: "skill", name: ""}, null)).not.toThrow();
    });

    it("非首版拒绝 name 与条目安装名不一致", () => {
        const manifest = {manifestVersion: 1 as const, type: "skill" as const, name: "renamed-skill", version: 2};
        expect(() => assertUploadAllowed(manifest, skillItem, 1)).toThrowError(/包 name（renamed-skill）与条目安装名（demo-skill）不一致/);
    });

    it("拒绝 version 不递增，并直接提示应改为 N+1", () => {
        const manifest = {manifestVersion: 1 as const, type: "skill" as const, name: "demo-skill", version: 2};
        expect(() => assertUploadAllowed(manifest, skillItem, 2)).toThrowError(/请把 manifest version 改为 3/);
        expect(() => assertUploadAllowed(manifest, skillItem, 5)).toThrowError(/请把 manifest version 改为 6/);
    });

    it("version 严格递增时放行（允许跳号）", () => {
        const manifest = {manifestVersion: 1 as const, type: "skill" as const, name: "demo-skill", version: 7};
        expect(() => assertUploadAllowed(manifest, skillItem, 2)).not.toThrow();
    });
});
