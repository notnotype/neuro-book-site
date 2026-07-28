import type * as TypeScript from "typescript";
import {parse} from "semver";
import {parseDocument} from "yaml";
import {z} from "zod";

/** Agent 资产发布包协议版本。 */
export const AGENT_ASSET_PACKAGE_SCHEMA_VERSION = 1 as const;

/** 当前允许发布的资产类型。 */
export const AGENT_ASSET_TYPES = ["skill", "workflow", "profile"] as const;

export type AgentAssetType = (typeof AGENT_ASSET_TYPES)[number];

/** Workshop ZIP 的统一资源限制。 */
export const AGENT_ASSET_LIMITS = {
    compressedBytes: 20 * 1024 * 1024,
    uncompressedBytes: 100 * 1024 * 1024,
    entries: 500,
    packageJsonBytes: 64 * 1024,
    sourceBytes: 1024 * 1024,
    previewBytes: 200 * 1024,
} as const;

/** Bun install fingerprint 使用的 package.json 字段。 */
export const BUN_INSTALL_FIELDS = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "peerDependenciesMeta",
    "bundledDependencies",
    "bundleDependencies",
    "overrides",
    "resolutions",
    "trustedDependencies",
    "patchedDependencies",
    "workspaces",
    "packageManager",
    "engines",
    "os",
    "cpu",
    "scripts",
] as const;

export type AgentAssetValidationIssue = {
    code: string;
    path: string;
    message: string;
};

export type AgentAssetPackageParseResult =
    | {ok: true; packageJson: AgentAssetPackageJson}
    | {ok: false; issues: AgentAssetValidationIssue[]};

const dependencyMapSchema = z.record(z.string(), z.string());
const stringArraySchema = z.array(z.string());
const jsonObjectSchema = z.record(z.string(), z.json());
const kebabCasePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const profileKeyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const windowsReservedNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/** 只接受 canonical SemVer，同时保留合法的 prerelease 与 build metadata。 */
export const AgentAssetSemVerSchema = z.string().trim().refine((value) => {
    const parsed = parse(value);
    if (!parsed) {
        return false;
    }
    const prerelease = parsed.prerelease.length > 0 ? `-${parsed.prerelease.join(".")}` : "";
    const build = parsed.build.length > 0 ? `+${parsed.build.join(".")}` : "";
    return `${parsed.major}.${parsed.minor}.${parsed.patch}${prerelease}${build}` === value;
}, "必须是合法 SemVer");

/** 根 package.json schema；passthrough 用于保留作者声明的其它标准字段。 */
export const AgentAssetPackageSchema = z.object({
    name: z.string().min(1),
    version: AgentAssetSemVerSchema,
    type: z.literal("module", "type 必须是 module"),
    neurobook: z.object({
        schemaVersion: z.literal(AGENT_ASSET_PACKAGE_SCHEMA_VERSION, "neurobook.schemaVersion 必须为 1"),
        assetType: z.enum(AGENT_ASSET_TYPES),
        minAppVersion: AgentAssetSemVerSchema.optional(),
    }).passthrough(),
    dependencies: dependencyMapSchema.optional(),
    devDependencies: dependencyMapSchema.optional(),
    optionalDependencies: dependencyMapSchema.optional(),
    peerDependencies: dependencyMapSchema.optional(),
    peerDependenciesMeta: jsonObjectSchema.optional(),
    bundledDependencies: stringArraySchema.optional(),
    bundleDependencies: stringArraySchema.optional(),
    overrides: jsonObjectSchema.optional(),
    resolutions: jsonObjectSchema.optional(),
    trustedDependencies: stringArraySchema.optional(),
    patchedDependencies: jsonObjectSchema.optional(),
    workspaces: z.union([
        stringArraySchema,
        z.object({packages: stringArraySchema, nohoist: stringArraySchema.optional()}).passthrough(),
    ]).optional(),
    packageManager: z.string().min(1).optional(),
    engines: dependencyMapSchema.optional(),
    os: stringArraySchema.optional(),
    cpu: stringArraySchema.optional(),
    scripts: dependencyMapSchema.optional(),
    bin: z.union([z.string().min(1), dependencyMapSchema]).optional(),
}).passthrough().superRefine((packageJson, context) => {
    const namePattern = packageJson.neurobook.assetType === "profile" ? profileKeyPattern : kebabCasePattern;
    if (!namePattern.test(packageJson.name)) {
        context.addIssue({
            code: "custom",
            path: ["name"],
            message: packageJson.neurobook.assetType === "profile"
                ? "Profile name 必须是小写点分 key，每段只使用字母、数字和连字符"
                : "Skill / Workflow name 必须是 kebab-case",
        });
    }
    if (packageJson.neurobook.assetType !== "skill") {
        for (const field of [...BUN_INSTALL_FIELDS, "bin"] as const) {
            if (Object.hasOwn(packageJson, field)) {
                context.addIssue({
                    code: "custom",
                    path: [field],
                    message: `${packageJson.neurobook.assetType} 不能声明 ${field}`,
                });
            }
        }
    }
});

export type AgentAssetPackageJson = z.infer<typeof AgentAssetPackageSchema>;

/** 解析 package.json 字节并返回稳定的结构化错误。 */
export function parseAgentAssetPackage(bytes: Uint8Array): AgentAssetPackageParseResult {
    if (bytes.byteLength > AGENT_ASSET_LIMITS.packageJsonBytes) {
        return invalid("package_json_too_large", "package.json", "package.json 超过 64 KiB 上限");
    }
    let raw: unknown;
    try {
        raw = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    } catch {
        return invalid("invalid_package_json", "package.json", "package.json 不是合法 UTF-8 JSON");
    }
    const parsed = AgentAssetPackageSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            issues: parsed.error.issues.map((issue) => ({
                code: "invalid_package_field",
                path: issue.path.join("."),
                message: `${issue.path.length > 0 ? `${issue.path.join(".")} ` : ""}${issue.message}`,
            })),
        };
    }
    return {ok: true, packageJson: parsed.data};
}

/** 返回资产包固定入口。 */
export function assetEntryPath(assetType: AgentAssetType, name: string): string {
    if (assetType === "skill") {
        return "SKILL.md";
    }
    if (assetType === "workflow") {
        return "workflow.ts";
    }
    return `${name}.profile.tsx`;
}

/** 校验 ZIP 内相对路径；返回规范路径，非法时返回 null。 */
export function normalizeAgentAssetPath(entryName: string): string | null {
    if (!entryName || entryName.includes("\0") || entryName.includes("\\") || entryName.startsWith("/") || /^[A-Za-z]:/.test(entryName)) {
        return null;
    }
    const path = entryName.endsWith("/") ? entryName.slice(0, -1) : entryName;
    const parts = path.split("/");
    if (parts.length === 0 || parts.some((part) => !part || part === "." || part === ".." || /[ .]$/.test(part) || windowsReservedNamePattern.test(part))) {
        return null;
    }
    return parts.join("/");
}

/** 判断 Skill 是否声明了会改变 Bun install 结果的字段。 */
export function hasBunInstallInput(packageJson: AgentAssetPackageJson): boolean {
    return BUN_INSTALL_FIELDS.some((field) => meaningful(packageJson[field]));
}

/** 可运行 Skill 必须携带 frozen bun.lock。 */
export function skillRequiresLockfile(packageJson: AgentAssetPackageJson): boolean {
    return packageJson.neurobook.assetType === "skill" && (hasBunInstallInput(packageJson) || meaningful(packageJson.bin));
}

/** Workflow/Profile 恒含可执行代码；Skill 按运行字段判断。 */
export function packageRunsCode(packageJson: AgentAssetPackageJson): boolean {
    return packageJson.neurobook.assetType !== "skill" || skillRequiresLockfile(packageJson);
}

/** 校验固定入口、源码大小和 Skill 锁文件。 */
export function validateAgentAssetLayout(
    packageJson: AgentAssetPackageJson,
    entries: ReadonlyMap<string, {size: number}>,
): AgentAssetValidationIssue[] {
    const issues: AgentAssetValidationIssue[] = [];
    const entryPath = assetEntryPath(packageJson.neurobook.assetType, packageJson.name);
    const source = entries.get(entryPath);
    if (!source) {
        issues.push({code: "missing_entry", path: entryPath, message: `包根目录必须包含 ${entryPath}`});
    } else if (source.size > AGENT_ASSET_LIMITS.sourceBytes) {
        issues.push({code: "source_too_large", path: entryPath, message: `${entryPath} 超过 1 MiB 上限`});
    }
    if (skillRequiresLockfile(packageJson)) {
        const lockfile = entries.get("bun.lock");
        if (!lockfile || lockfile.size === 0) {
            issues.push({code: "missing_bun_lock", path: "bun.lock", message: "可运行 Skill 必须携带非空 bun.lock"});
        }
    }
    return issues;
}

/** 校验资产类型源码；站点只做静态检查，不执行作者代码。 */
export function validateAgentAssetSource(
    packageJson: AgentAssetPackageJson,
    bytes: Uint8Array,
    typescript?: typeof import("typescript"),
): AgentAssetValidationIssue[] {
    const entryPath = assetEntryPath(packageJson.neurobook.assetType, packageJson.name);
    if (bytes.byteLength > AGENT_ASSET_LIMITS.sourceBytes) {
        return [{code: "source_too_large", path: entryPath, message: `${entryPath} 超过 1 MiB 上限`}];
    }
    let source: string;
    try {
        source = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
        return [{code: "invalid_source_encoding", path: entryPath, message: `${entryPath} 不是合法 UTF-8 文本`}];
    }
    if (packageJson.neurobook.assetType === "skill") {
        return validateSkillSource(packageJson, source);
    }
    if (!typescript) {
        return [{code: "typescript_required", path: entryPath, message: "源码校验器尚未加载"}];
    }
    return packageJson.neurobook.assetType === "workflow"
        ? validateWorkflowSource(typescript, packageJson, source)
        : validateProfileSource(typescript, entryPath, source);
}

/** 校验上传包与既有条目的不可变身份。 */
export function validateAgentAssetIdentity(
    packageJson: AgentAssetPackageJson,
    expected: {type: AgentAssetType; name?: string},
): AgentAssetValidationIssue[] {
    const issues: AgentAssetValidationIssue[] = [];
    if (packageJson.neurobook.assetType !== expected.type) {
        issues.push({code: "asset_type_mismatch", path: "neurobook.assetType", message: `包类型必须保持为 ${expected.type}`});
    }
    if (expected.name && packageJson.name !== expected.name) {
        issues.push({code: "asset_name_mismatch", path: "name", message: `安装名必须保持为 ${expected.name}`});
    }
    return issues;
}

/** 把结构化问题转换为当前 UI/API 使用的一行消息。 */
export function formatAgentAssetIssues(issues: readonly AgentAssetValidationIssue[]): string {
    return issues.map((issue) => issue.message).join("；");
}

function validateSkillSource(packageJson: AgentAssetPackageJson, source: string): AgentAssetValidationIssue[] {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
    if (!match) {
        return [{code: "missing_skill_frontmatter", path: "SKILL.md", message: "SKILL.md 必须以 YAML frontmatter 开头"}];
    }
    const document = parseDocument(match[1] ?? "", {strict: true, uniqueKeys: true});
    if (document.errors.length > 0) {
        return [{code: "invalid_skill_frontmatter", path: "SKILL.md", message: `SKILL.md frontmatter 无效：${document.errors[0]?.message ?? "无法解析"}`}];
    }
    const value: unknown = document.toJS({maxAliasCount: 50});
    if (!isPlainObject(value)) {
        return [{code: "invalid_skill_frontmatter", path: "SKILL.md", message: "SKILL.md frontmatter 必须是对象"}];
    }
    const issues: AgentAssetValidationIssue[] = [];
    if (value.name !== packageJson.name) {
        issues.push({code: "skill_name_mismatch", path: "SKILL.md.name", message: "SKILL.md name 必须与 package.json.name 一致"});
    }
    if (typeof value.description !== "string" || value.description.trim().length === 0) {
        issues.push({code: "missing_skill_description", path: "SKILL.md.description", message: "SKILL.md description 不能为空"});
    }
    return issues;
}

function validateWorkflowSource(
    typescript: typeof import("typescript"),
    packageJson: AgentAssetPackageJson,
    source: string,
): AgentAssetValidationIssue[] {
    const sourceFile = typescript.createSourceFile("workflow.ts", source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TS);
    const issues = syntaxIssues(typescript, sourceFile, "workflow.ts");
    const visit = (node: TypeScript.Node): void => {
        if (typescript.isImportDeclaration(node) || typescript.isImportEqualsDeclaration(node)) {
            issues.push({code: "workflow_import_forbidden", path: "workflow.ts", message: "Workflow 不允许使用 import"});
        }
        if (typescript.isExportDeclaration(node) && node.moduleSpecifier) {
            issues.push({code: "workflow_export_from_forbidden", path: "workflow.ts", message: "Workflow 不允许使用 export from"});
        }
        if (typescript.isCallExpression(node)
            && (node.expression.kind === typescript.SyntaxKind.ImportKeyword
                || (typescript.isIdentifier(node.expression) && node.expression.text === "require"))) {
            issues.push({code: "workflow_dynamic_import_forbidden", path: "workflow.ts", message: "Workflow 不允许使用动态 import 或 require"});
        }
        typescript.forEachChild(node, visit);
    };
    visit(sourceFile);
    const defaultExport = sourceFile.statements.find((statement): statement is TypeScript.ExportAssignment =>
        typescript.isExportAssignment(statement) && !statement.isExportEquals);
    const defaultExpression = defaultExport ? unwrapExpression(typescript, defaultExport.expression) : null;
    const defaultObject = defaultExpression && typescript.isObjectLiteralExpression(defaultExpression) ? defaultExpression : null;
    if (!defaultObject) {
        issues.push({code: "workflow_default_object_required", path: "workflow.ts", message: "Workflow 必须直接 default export 一个对象"});
        return dedupeIssues(issues);
    }
    const properties = defaultObject.properties;
    const key = properties.find((property) => propertyName(typescript, property.name) === "key");
    if (!key || !typescript.isPropertyAssignment(key)
        || !(typescript.isStringLiteral(key.initializer) || typescript.isNoSubstitutionTemplateLiteral(key.initializer))
        || key.initializer.text !== packageJson.name) {
        issues.push({code: "workflow_key_mismatch", path: "workflow.ts.key", message: `Workflow key 必须是字符串 ${packageJson.name}`});
    }
    const run = properties.find((property) => propertyName(typescript, property.name) === "run");
    const validRun = run && (typescript.isMethodDeclaration(run)
        || (typescript.isPropertyAssignment(run) && (typescript.isArrowFunction(run.initializer) || typescript.isFunctionExpression(run.initializer))));
    if (!validRun) {
        issues.push({code: "workflow_run_required", path: "workflow.ts.run", message: "Workflow 必须直接声明 run 函数"});
    }
    return dedupeIssues(issues);
}

function validateProfileSource(
    typescript: typeof import("typescript"),
    path: string,
    source: string,
): AgentAssetValidationIssue[] {
    const sourceFile = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TSX);
    const issues = syntaxIssues(typescript, sourceFile, path);
    const hasDefaultExport = sourceFile.statements.some((statement) => {
        if (typescript.isExportAssignment(statement)) {
            return !statement.isExportEquals;
        }
        return (typescript.isFunctionDeclaration(statement) || typescript.isClassDeclaration(statement))
            && Boolean(statement.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.DefaultKeyword));
    });
    if (!hasDefaultExport) {
        issues.push({code: "profile_default_export_required", path, message: "Profile 必须提供 default export"});
    }
    return issues;
}

function syntaxIssues(
    typescript: typeof import("typescript"),
    sourceFile: TypeScript.SourceFile,
    path: string,
): AgentAssetValidationIssue[] {
    const diagnostics = (sourceFile as TypeScript.SourceFile & {parseDiagnostics: readonly TypeScript.Diagnostic[]}).parseDiagnostics;
    return diagnostics.map((diagnostic) => ({
        code: "source_syntax_error",
        path,
        message: `${path} 语法错误：${typescript.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    }));
}

function unwrapExpression(
    typescript: typeof import("typescript"),
    expression: TypeScript.Expression,
): TypeScript.Expression {
    let current = expression;
    while (typescript.isParenthesizedExpression(current) || typescript.isAsExpression(current) || typescript.isSatisfiesExpression(current)) {
        current = current.expression;
    }
    return current;
}

function propertyName(typescript: typeof import("typescript"), name: TypeScript.PropertyName | undefined): string | null {
    if (!name) {
        return null;
    }
    return typescript.isIdentifier(name) || typescript.isStringLiteral(name) || typescript.isNumericLiteral(name) ? name.text : null;
}

function meaningful(value: unknown): boolean {
    if (typeof value === "string") {
        return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    return isPlainObject(value) && Object.keys(value).length > 0;
}

function isPlainObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(code: string, path: string, message: string): AgentAssetPackageParseResult {
    return {ok: false, issues: [{code, path, message}]};
}

function dedupeIssues(issues: AgentAssetValidationIssue[]): AgentAssetValidationIssue[] {
    return [...new Map(issues.map((issue) => [`${issue.code}:${issue.path}:${issue.message}`, issue])).values()];
}
