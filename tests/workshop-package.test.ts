import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {strToU8, zipSync} from "fflate";
import {afterEach, describe, expect, it} from "vitest";
import {assertUploadAllowed, parseWorkshopPackageFile, sanitizeWorkshopEntryPath} from "../server/utils/workshop-package";
import {buildPackageZip} from "./helpers/zip";

const cleanupRoots: string[] = [];
const skillPackage = {
    name: "demo-skill",
    version: "1.0.0",
    type: "module",
    neurobook: {schemaVersion: 1, assetType: "skill"},
};

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

/** 构造符合 Skill 协议的 frontmatter。 */
function skillSource(name = "demo-skill", description = "演示 Skill"): Uint8Array {
    return strToU8(`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

/** 把 ZIP 字节放到仓库外临时目录，再走生产文件解析入口。 */
async function parseZip(bytes: Uint8Array) {
    const root = await mkdtemp(join(tmpdir(), "nbook-package-contract-"));
    cleanupRoots.push(root);
    const path = join(root, "package.zip");
    await writeFile(path, bytes);
    return await parseWorkshopPackageFile(path);
}

describe("parseWorkshopPackageFile", () => {
    it("拒绝无法解析的 ZIP 与缺少 package.json", async () => {
        await expect(parseZip(strToU8("not a zip"))).rejects.toThrow(/ZIP 文件损坏/);
        await expect(parseZip(buildPackageZip(null, {"SKILL.md": skillSource()}))).rejects.toThrow(/缺少 package\.json/);
    });

    it("拒绝 package.json 语法、null 与错误字段形状，同时保留未知标准字段", async () => {
        const entries = {"SKILL.md": skillSource()};
        await expect(parseZip(zipSync({...entries, "package.json": strToU8("{oops")}))).rejects.toThrow(/package\.json 不是合法 UTF-8 JSON/);
        await expect(parseZip(buildPackageZip({...skillPackage, type: "commonjs"}, entries))).rejects.toThrow(/type 必须是 module/);
        await expect(parseZip(buildPackageZip({...skillPackage, name: "Bad_Name"}, entries))).rejects.toThrow(/kebab-case/);
        await expect(parseZip(buildPackageZip({...skillPackage, version: "v1.0.0"}, entries))).rejects.toThrow(/合法 SemVer/);
        await expect(parseZip(buildPackageZip({...skillPackage, version: "1.0.0-beta.1+build.2"}, entries))).resolves.toBeDefined();
        await expect(parseZip(buildPackageZip({...skillPackage, dependencies: null}, entries))).rejects.toThrow(/dependencies/);
        await expect(parseZip(buildPackageZip({...skillPackage, neurobook: {...skillPackage.neurobook, schemaVersion: 2}}, entries))).rejects.toThrow(/schemaVersion 必须为 1/);

        const parsed = await parseZip(buildPackageZip({...skillPackage, license: "MIT", customField: {kept: true}}, entries));
        expect(parsed.packageJson).toMatchObject({license: "MIT", customField: {kept: true}});
    });

    it("校验 Skill frontmatter、三类固定入口和点分 Profile key", async () => {
        await expect(parseZip(buildPackageZip(skillPackage, {"README.md": strToU8("no")}))).rejects.toThrow(/SKILL\.md/);
        await expect(parseZip(buildPackageZip(skillPackage, {"SKILL.md": strToU8("# no frontmatter")}))).rejects.toThrow(/frontmatter/);
        await expect(parseZip(buildPackageZip(skillPackage, {"SKILL.md": skillSource("other")}))).rejects.toThrow(/name 必须与 package.json.name 一致/);
        await expect(parseZip(buildPackageZip(skillPackage, {"SKILL.md": skillSource("demo-skill", "")}))).rejects.toThrow(/description 不能为空/);

        const workflowPackage = {...skillPackage, name: "draft-book", neurobook: {schemaVersion: 1, assetType: "workflow"}};
        const workflow = await parseZip(buildPackageZip(workflowPackage, {
            "workflow.ts": strToU8('export default { key: "draft-book", async run() { return {}; } };'),
        }));
        expect(workflow.packageJson.neurobook.assetType).toBe("workflow");

        const profilePackage = {...skillPackage, name: "leader.default", neurobook: {schemaVersion: 1, assetType: "profile"}};
        await expect(parseZip(buildPackageZip(profilePackage, {"leader-default.profile.tsx": strToU8("export default {};")})))
            .rejects.toThrow(/leader\.default\.profile\.tsx/);
        const profile = await parseZip(buildPackageZip(profilePackage, {
            "leader.default.profile.tsx": strToU8("export default function LeaderProfile() { return null; }"),
        }));
        expect(profile.packageJson.name).toBe("leader.default");
        await expect(parseZip(buildPackageZip(profilePackage, {
            "leader.default.profile.tsx": strToU8("export default class LeaderProfile {}"),
        }))).resolves.toBeDefined();
    });

    it("Skill 只有实际 Bun 安装输入或运行字段才要求非空 bun.lock", async () => {
        const entries = {"SKILL.md": skillSource()};
        await expect(parseZip(buildPackageZip({...skillPackage, scripts: {check: "bun test"}}, entries))).rejects.toThrow(/bun\.lock/);
        await expect(parseZip(buildPackageZip({...skillPackage, bin: "cli.ts"}, entries))).rejects.toThrow(/bun\.lock/);
        await expect(parseZip(buildPackageZip({...skillPackage, dependencies: {yaml: "^2.0.0"}}, {...entries, "bun.lock": new Uint8Array()})))
            .rejects.toThrow(/非空 bun\.lock/);
        await expect(parseZip(buildPackageZip({...skillPackage, scripts: {}}, entries))).resolves.toBeDefined();
        await expect(parseZip(buildPackageZip({...skillPackage, dependencies: {yaml: "^2.0.0"}}, {...entries, "bun.lock": strToU8("lockfileVersion = 1")})))
            .resolves.toBeDefined();
    });

    it("Workflow AST 拒绝所有模块入口、语法错误和错误默认导出", async () => {
        const workflowPackage = {...skillPackage, name: "draft-book", neurobook: {schemaVersion: 1, assetType: "workflow"}};
        await expect(parseZip(buildPackageZip({...workflowPackage, dependencies: {lodash: "^4.0.0"}}, {
            "workflow.ts": strToU8('export default { key: "draft-book", run() {} };'),
        }))).rejects.toThrow(/不能声明 dependencies/);
        for (const source of [
            'import x from "x"; export default { key: "draft-book", run() {} };',
            'import x = require("x"); export default { key: "draft-book", run() {} };',
            'export {x} from "x"; export default { key: "draft-book", run() {} };',
            'const x = import("x"); export default { key: "draft-book", run() {} };',
            'const x = require("x"); export default { key: "draft-book", run() {} };',
        ]) {
            await expect(parseZip(buildPackageZip(workflowPackage, {"workflow.ts": strToU8(source)}))).rejects.toThrow(/不允许/);
        }
        await expect(parseZip(buildPackageZip(workflowPackage, {"workflow.ts": strToU8('export default { key: "wrong", run: 1 };')})))
            .rejects.toThrow(/Workflow key|run 函数/);
        await expect(parseZip(buildPackageZip(workflowPackage, {"workflow.ts": strToU8('export default { key: "draft-book", run() {')})))
            .rejects.toThrow(/语法错误/);
    });

    it("Workflow 的注释和字符串不被误判，非法 UTF-8 返回稳定错误", async () => {
        const workflowPackage = {...skillPackage, name: "draft-book", neurobook: {schemaVersion: 1, assetType: "workflow"}};
        const validSource = `// import x from "x"\nexport default {\n    key: "draft-book",\n    run() { return "require('x') and import('x')"; },\n};`;
        await expect(parseZip(buildPackageZip(workflowPackage, {"workflow.ts": strToU8(validSource)}))).resolves.toBeDefined();
        await expect(parseZip(buildPackageZip(workflowPackage, {"workflow.ts": new Uint8Array([0xff, 0xfe])})))
            .rejects.toThrow(/workflow.ts 不是合法 UTF-8 文本/);
    });

    it("拒绝危险路径并保留大小写折叠规则", () => {
        for (const path of ["/root", "C:/root", "a\\b", "a//b", "./a", "a/../b", "CON.txt", "folder/name. "]) {
            expect(sanitizeWorkshopEntryPath(path), path).toBeNull();
        }
        expect(sanitizeWorkshopEntryPath("docs/Guide.md")).toBe("docs/Guide.md");
    });
});

describe("assertUploadAllowed", () => {
    const item = {type: "skill" as const, name: "demo-skill"};

    it("首版校验类型，但允许安装名首次落库", () => {
        const profilePackage = {...skillPackage, neurobook: {schemaVersion: 1 as const, assetType: "profile" as const}};
        expect(() => assertUploadAllowed(profilePackage, item, null)).toThrowError(/包类型必须保持为 skill/);
        expect(() => assertUploadAllowed(skillPackage, {type: "skill", name: ""}, null)).not.toThrow();
    });

    it("后续版本保持安装名并按 SemVer precedence 严格递增", () => {
        expect(() => assertUploadAllowed({...skillPackage, name: "renamed"}, item, "1.0.0")).toThrowError(/安装名/);
        expect(() => assertUploadAllowed({...skillPackage, version: "1.0.0+build.2"}, item, "1.0.0+build.1")).toThrowError(/严格大于/);
        expect(() => assertUploadAllowed({...skillPackage, version: "1.1.0-beta.1"}, item, "1.0.9")).not.toThrow();
        expect(() => assertUploadAllowed({...skillPackage, version: "2.0.0"}, item, "1.9.9")).not.toThrow();
    });
});
