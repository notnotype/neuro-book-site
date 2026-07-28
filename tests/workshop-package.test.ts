import {strToU8, zipSync} from "fflate";
import {describe, expect, it} from "vitest";
import {assertUploadAllowed, parseWorkshopPackage, sanitizeWorkshopEntryPath} from "../server/utils/workshop-package";
import {buildPackageZip} from "./helpers/zip";

const skillPackage = {
    name: "demo-skill",
    version: "1.0.0",
    type: "module",
    neurobook: {schemaVersion: 1, assetType: "skill"},
};
const skillEntries = {"SKILL.md": strToU8("# demo-skill\n")};

describe("parseWorkshopPackage", () => {
    it("拒绝无法解析的 zip 与缺少 package.json", () => {
        expect(() => parseWorkshopPackage(strToU8("not a zip"))).toThrowError(/无法解析 zip 文件/);
        expect(() => parseWorkshopPackage(buildPackageZip(null, skillEntries))).toThrowError(/缺少 package\.json/);
    });

    it("拒绝 package.json 语法或协议字段错误", () => {
        const invalidJson = zipSync({...skillEntries, "package.json": strToU8("{oops")});
        expect(() => parseWorkshopPackage(invalidJson)).toThrowError(/package\.json 不是合法 JSON/);
        expect(() => parseWorkshopPackage(buildPackageZip({...skillPackage, type: "commonjs"}, skillEntries))).toThrowError(/type 必须是 module/);
        expect(() => parseWorkshopPackage(buildPackageZip({...skillPackage, name: "Bad_Name"}, skillEntries))).toThrowError(/name 必须是 kebab-case/);
        expect(() => parseWorkshopPackage(buildPackageZip({...skillPackage, version: "v1.0.0"}, skillEntries))).toThrowError(/version 必须是合法 SemVer/);
        expect(() => parseWorkshopPackage(buildPackageZip({...skillPackage, neurobook: {...skillPackage.neurobook, schemaVersion: 2}}, skillEntries))).toThrowError(/schemaVersion 必须为 1/);
    });

    it("校验三种资产的固定入口", () => {
        expect(() => parseWorkshopPackage(buildPackageZip(skillPackage, {"README.md": strToU8("no")}))).toThrowError(/SKILL\.md/);

        const workflowPackage = {...skillPackage, name: "draft-book", neurobook: {schemaVersion: 1, assetType: "workflow"}};
        expect(parseWorkshopPackage(buildPackageZip(workflowPackage, {"workflow.ts": strToU8("export default defineWorkflow({});")})).packageJson.neurobook.assetType).toBe("workflow");

        const profilePackage = {...skillPackage, name: "mini-writer", neurobook: {schemaVersion: 1, assetType: "profile"}};
        expect(() => parseWorkshopPackage(buildPackageZip(profilePackage, {"other.profile.tsx": strToU8("export default {};")}))).toThrowError(/mini-writer\.profile\.tsx/);
        expect(parseWorkshopPackage(buildPackageZip(profilePackage, {"mini-writer.profile.tsx": strToU8("export default {};")})).packageJson.name).toBe("mini-writer");
    });

    it("Workflow 拒绝依赖、静态导入、动态导入和 require", () => {
        const workflowPackage = {...skillPackage, name: "draft-book", neurobook: {schemaVersion: 1, assetType: "workflow"}};
        expect(() => parseWorkshopPackage(buildPackageZip({...workflowPackage, dependencies: {lodash: "^4.0.0"}}, {"workflow.ts": strToU8("export default {};")}))).toThrowError(/不能声明运行时或开发依赖/);
        for (const source of [
            'import x from "x";',
            'const x = await import("x");',
            'const x = require("x");',
            'export {x} from "x";',
        ]) {
            expect(() => parseWorkshopPackage(buildPackageZip(workflowPackage, {"workflow.ts": strToU8(source)}))).toThrowError(/不允许使用 import/);
        }
    });

    it("Workflow 非法 UTF-8 返回稳定的协议错误", () => {
        const workflowPackage = {...skillPackage, name: "draft-book", neurobook: {schemaVersion: 1, assetType: "workflow"}};
        expect(() => parseWorkshopPackage(buildPackageZip(workflowPackage, {"workflow.ts": new Uint8Array([0xff, 0xfe])})))
            .toThrowError(/workflow.ts 不是合法 UTF-8 文本/);
    });

    it("拒绝危险路径和大小写折叠重复路径", () => {
        for (const path of ["/root", "C:/root", "a\\b", "a//b", "./a", "a/../b", "CON.txt", "folder/name. "]) {
            expect(sanitizeWorkshopEntryPath(path), path).toBeNull();
        }
        const duplicate = zipSync({
            "package.json": strToU8(JSON.stringify(skillPackage)),
            "SKILL.md": strToU8("# one"),
            "skill.md": strToU8("# two"),
        });
        expect(() => parseWorkshopPackage(duplicate)).toThrowError(/重复路径/);
    });
});

describe("assertUploadAllowed", () => {
    const item = {type: "skill" as const, name: "demo-skill"};

    it("首版校验类型，但允许安装名首次落库", () => {
        const profilePackage = {...skillPackage, neurobook: {schemaVersion: 1 as const, assetType: "profile" as const}};
        expect(() => assertUploadAllowed(profilePackage, item, null)).toThrowError(/assetType/);
        expect(() => assertUploadAllowed(skillPackage, {type: "skill", name: ""}, null)).not.toThrow();
    });

    it("后续版本保持安装名并按 SemVer precedence 严格递增", () => {
        expect(() => assertUploadAllowed({...skillPackage, name: "renamed"}, item, "1.0.0")).toThrowError(/安装名/);
        expect(() => assertUploadAllowed({...skillPackage, version: "1.0.0+build.2"}, item, "1.0.0+build.1")).toThrowError(/严格大于/);
        expect(() => assertUploadAllowed({...skillPackage, version: "1.1.0-beta.1"}, item, "1.0.9")).not.toThrow();
        expect(() => assertUploadAllowed({...skillPackage, version: "2.0.0"}, item, "1.9.9")).not.toThrow();
    });
});
