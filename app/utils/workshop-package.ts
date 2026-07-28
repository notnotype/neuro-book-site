import type {FileTreeMove, FileTreeNode} from "@notnotype/nb-ui/components";
import {strToU8, Unzip, UnzipInflate, zipSync} from "fflate";
import {gt, inc} from "semver";
import {parseDocument} from "yaml";
import type {AgentAssetPackageJson, AgentAssetType} from "../../shared/agent-asset-package";
import {
    AGENT_ASSET_LIMITS,
    assetEntryPath,
    formatAgentAssetIssues,
    normalizeAgentAssetPath,
    parseAgentAssetPackage,
    validateAgentAssetIdentity,
    validateAgentAssetLayout,
    validateAgentAssetSource,
} from "../../shared/agent-asset-package";

export type DraftEntry = {
    path: string;
    kind: "file" | "directory";
    bytes: Uint8Array;
};

export type PackageDraft = {entries: DraftEntry[]};

export type PackageWorkbenchState = {
    draft: PackageDraft;
    packageJson: AgentAssetPackageJson | null;
    error: string;
    validating: boolean;
    dirty: boolean;
};

export type DraftPackageResult =
    | {ok: true; packageJson: AgentAssetPackageJson}
    | {ok: false; error: string};

export type DraftBuildResult =
    | {ok: true; file: File; bytes: Uint8Array; packageJson: AgentAssetPackageJson}
    | {ok: false; error: string};

export type DraftMergeResult =
    | {ok: true; draft: PackageDraft; conflicts: string[]}
    | {ok: false; error: string};

export type DraftMoveResult =
    | {ok: true; draft: PackageDraft; selectedPath: string}
    | {ok: false; error: string};

const TEXT_EXTENSIONS = new Set([
    "md", "markdown", "txt", "json", "ts", "tsx", "js", "jsx", "mjs", "cjs", "yaml", "yml", "toml",
    "css", "html", "htm", "vue", "csv", "xml", "sh", "ps1", "py", "gitignore", "npmrc",
]);

/** 创建某类资产的最小可发布模板。 */
export function createPackageDraft(assetType: AgentAssetType, name = "new-asset", version = "1.0.0"): PackageDraft {
    const packageJson: AgentAssetPackageJson = {
        name,
        version,
        type: "module",
        neurobook: {schemaVersion: 1, assetType},
    };
    const entry = assetEntryPath(assetType, name);
    const template = assetType === "skill"
        ? `---\nname: ${name}\ndescription: 请说明这个 Skill 何时使用。\n---\n\n# ${name}\n`
        : assetType === "workflow"
            ? `export default {\n    key: "${name}",\n    title: "新工作流",\n    run: async (_wf, args) => ({args}),\n};\n`
            : `/** @jsxImportSource nbook/profile-sdk */\n/** @jsxRuntime automatic */\nimport {Type, defineAgentProfile, ProfilePrompt, System} from "nbook/profile-sdk";\n\nexport const profileManifest = {\n    key: "${name}",\n    name: "新 Agent",\n    description: "请说明这个 Agent 适合处理什么任务。",\n} as const;\n\nexport const InitialSchema = Type.Object({});\nexport const OutputSchema = Type.Object({});\n\nexport default defineAgentProfile({\n    manifest: profileManifest,\n    initialSchema: InitialSchema,\n    outputSchema: OutputSchema,\n    context() {\n        return <ProfilePrompt><System>请在这里编写系统提示词。</System></ProfilePrompt>;\n    },\n});\n`;
    return {
        entries: [
            {path: "package.json", kind: "file", bytes: encodePackageJson(packageJson)},
            {path: entry, kind: "file", bytes: strToU8(template)},
        ],
    };
}

/** 从完整 ZIP 流式建立草稿；超限或损坏时不返回任何半成品。 */
export async function draftFromZip(input: File | Uint8Array, stripSingleRoot = false): Promise<{ok: true; draft: PackageDraft} | {ok: false; error: string}> {
    const compressedBytes = input instanceof Uint8Array ? input.byteLength : input.size;
    if (compressedBytes > AGENT_ASSET_LIMITS.compressedBytes) {
        return {ok: false, error: "ZIP 超过 20 MiB 上限"};
    }
    const entries: DraftEntry[] = [];
    const seen = new Set<string>();
    let outputBytes = 0;
    let failure = "";
    const unzip = new Unzip((file) => {
        if (failure) {
            file.terminate();
            return;
        }
        const path = normalizeAgentAssetPath(file.name);
        if (!path) {
            failure = `ZIP 包含非法路径：${file.name}`;
            file.terminate();
            return;
        }
        const folded = path.toLowerCase();
        if (seen.has(folded)) {
            failure = `ZIP 包含重复路径：${path}`;
            file.terminate();
            return;
        }
        seen.add(folded);
        if (seen.size > AGENT_ASSET_LIMITS.entries) {
            failure = `文件数超过 ${AGENT_ASSET_LIMITS.entries} 个上限`;
            file.terminate();
            return;
        }
        if (file.name.endsWith("/")) {
            entries.push({path, kind: "directory", bytes: new Uint8Array()});
            file.ondata = (error, data) => {
                if (error) {
                    failure = "无法解析 ZIP 文件";
                    return;
                }
                outputBytes += data.byteLength;
                if (data.byteLength > 0) {
                    failure = `ZIP 目录条目包含文件内容：${path}`;
                    file.terminate();
                    return;
                }
                if (outputBytes > AGENT_ASSET_LIMITS.uncompressedBytes) {
                    failure = "文件实际总量超过 100 MiB 上限";
                    file.terminate();
                }
            };
            file.start();
            return;
        }
        const chunks: Uint8Array[] = [];
        file.ondata = (error, data, final) => {
            if (error) {
                failure = "无法解析 ZIP 文件";
                return;
            }
            outputBytes += data.byteLength;
            if (outputBytes > AGENT_ASSET_LIMITS.uncompressedBytes) {
                failure = "文件实际总量超过 100 MiB 上限";
                file.terminate();
                return;
            }
            chunks.push(data.slice());
            if (final) {
                const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.byteLength;
                }
                entries.push({path, kind: "file", bytes});
            }
        };
        file.start();
    });
    unzip.register(UnzipInflate);

    try {
        if (input instanceof Uint8Array) {
            for (let offset = 0; offset < input.byteLength && !failure; offset += 256 * 1024) {
                unzip.push(input.subarray(offset, Math.min(offset + 256 * 1024, input.byteLength)), false);
            }
        } else {
            const reader = input.stream().getReader();
            while (!failure) {
                const chunk = await reader.read();
                if (chunk.done) {
                    break;
                }
                unzip.push(chunk.value, false);
            }
            if (failure) {
                await reader.cancel();
            }
        }
        if (!failure) {
            unzip.push(new Uint8Array(), true);
        }
    } catch {
        failure = failure || "无法解析 ZIP 文件";
    }
    if (failure) {
        return {ok: false, error: failure};
    }
    return normalizeDraftEntries(entries, stripSingleRoot);
}

/** 从浏览器多文件选择建立目录草稿片段。 */
export async function draftEntriesFromFiles(files: File[]): Promise<{ok: true; entries: DraftEntry[]} | {ok: false; error: string}> {
    if (files.length > AGENT_ASSET_LIMITS.entries) {
        return {ok: false, error: `文件数超过 ${AGENT_ASSET_LIMITS.entries} 个上限`};
    }
    if (files.reduce((total, file) => total + file.size, 0) > AGENT_ASSET_LIMITS.uncompressedBytes) {
        return {ok: false, error: "文件实际总量超过 100 MiB 上限"};
    }
    const entries: DraftEntry[] = [];
    for (const file of files) {
        const relativePath = file.webkitRelativePath || file.name;
        entries.push({path: relativePath, kind: "file", bytes: new Uint8Array(await file.arrayBuffer())});
    }
    const normalized = normalizeDraftEntries(entries, true);
    return normalized.ok ? {ok: true, entries: normalized.draft.entries} : normalized;
}

/** 合并导入条目；覆盖冲突与结构校验失败使用不同结果，避免把上限错误当成确认提示。 */
export function mergeDraftEntries(draft: PackageDraft, imported: DraftEntry[], overwrite: boolean): DraftMergeResult {
    const next = new Map(draft.entries.map((entry) => [entry.path.toLowerCase(), entry]));
    const conflicts = imported.filter((entry) => next.has(entry.path.toLowerCase())).map((entry) => entry.path);
    if (conflicts.length > 0 && !overwrite) {
        return {ok: true, draft, conflicts};
    }
    for (const entry of imported) {
        next.set(entry.path.toLowerCase(), entry);
    }
    const normalized = normalizeDraftEntries([...next.values()]);
    return normalized.ok ? {ok: true, draft: normalized.draft, conflicts} : normalized;
}

export type DraftValidationExpectation = {
    type: AgentAssetType;
    name?: string;
    latestVersion?: string;
};

/** 同步解析 package.json、固定入口和 Skill frontmatter。 */
export function parseDraftPackage(draft: PackageDraft): DraftPackageResult {
    const packageEntry = draft.entries.find((entry) => entry.kind === "file" && entry.path === "package.json");
    if (!packageEntry) {
        return {ok: false, error: "根目录缺少 package.json"};
    }
    const parsed = parseAgentAssetPackage(packageEntry.bytes);
    if (!parsed.ok) {
        return {ok: false, error: formatAgentAssetIssues(parsed.issues)};
    }
    const packageJson = parsed.packageJson;
    const files = new Map(draft.entries.filter((entry) => entry.kind === "file").map((entry) => [entry.path, {size: entry.bytes.byteLength}]));
    const layoutIssues = validateAgentAssetLayout(packageJson, files);
    if (layoutIssues.length > 0) {
        return {ok: false, error: formatAgentAssetIssues(layoutIssues)};
    }
    const entryPath = assetEntryPath(packageJson.neurobook.assetType, packageJson.name);
    if (packageJson.neurobook.assetType === "skill") {
        const source = draft.entries.find((entry) => entry.kind === "file" && entry.path === entryPath)?.bytes;
        const sourceIssues = source ? validateAgentAssetSource(packageJson, source) : [];
        if (sourceIssues.length > 0) {
            return {ok: false, error: formatAgentAssetIssues(sourceIssues)};
        }
    }
    return {ok: true, packageJson};
}

/** 懒加载 TypeScript 后执行完整源码、身份和版本预检。 */
export async function validateDraftPackage(draft: PackageDraft, expected?: DraftValidationExpectation): Promise<DraftPackageResult> {
    const parsed = parseDraftPackage(draft);
    if (!parsed.ok) {
        return parsed;
    }
    const packageJson = parsed.packageJson;
    if (expected) {
        const identityIssues = validateAgentAssetIdentity(packageJson, {type: expected.type, ...(expected.name ? {name: expected.name} : {})});
        if (identityIssues.length > 0) {
            return {ok: false, error: formatAgentAssetIssues(identityIssues)};
        }
        if (expected.latestVersion && !gt(packageJson.version, expected.latestVersion)) {
            return {ok: false, error: `版本必须严格高于 ${expected.latestVersion}`};
        }
    }
    if (packageJson.neurobook.assetType !== "skill") {
        const typescript = await import("typescript");
        const entryPath = assetEntryPath(packageJson.neurobook.assetType, packageJson.name);
        const source = draft.entries.find((entry) => entry.kind === "file" && entry.path === entryPath)?.bytes;
        const sourceIssues = source ? validateAgentAssetSource(packageJson, source, typescript) : [];
        if (sourceIssues.length > 0) {
            return {ok: false, error: formatAgentAssetIssues(sourceIssues)};
        }
    }
    return parsed;
}

/** 构建最终 ZIP；最终压缩字节与解压总量使用与服务端相同的上限。 */
export async function buildDraftZip(draft: PackageDraft, slug: string, expected?: DraftValidationExpectation): Promise<DraftBuildResult> {
    const normalized = normalizeDraftEntries(draft.entries);
    if (!normalized.ok) {
        return normalized;
    }
    const parsed = await validateDraftPackage(normalized.draft, expected);
    if (!parsed.ok) {
        return parsed;
    }
    const zipEntries: Record<string, Uint8Array> = {};
    for (const entry of normalized.draft.entries) {
        zipEntries[entry.kind === "directory" ? `${entry.path}/` : entry.path] = entry.bytes;
    }
    const bytes = zipSync(zipEntries);
    if (bytes.byteLength > AGENT_ASSET_LIMITS.compressedBytes) {
        return {ok: false, error: "最终 ZIP 超过 20 MiB 上限"};
    }
    return {
        ok: true,
        bytes,
        packageJson: parsed.packageJson,
        file: new File([bytes as BlobPart], `${slug}-v${parsed.packageJson.version}.zip`, {type: "application/zip"}),
    };
}

/** 结构化修改 package.json，同时保留作者的其它字段。 */
export function updateDraftPackage(draft: PackageDraft, patch: Partial<Pick<AgentAssetPackageJson, "name" | "version">> & {assetType?: AgentAssetType; minAppVersion?: string}): PackageDraft {
    const parsed = parseDraftPackageLoosely(draft);
    if (!parsed) {
        return draft;
    }
    const previousEntry = assetEntryPath(parsed.neurobook.assetType, parsed.name);
    const next: AgentAssetPackageJson = {
        ...parsed,
        ...(patch.name ? {name: patch.name} : {}),
        ...(patch.version ? {version: patch.version} : {}),
        neurobook: {
            ...parsed.neurobook,
            ...(patch.assetType ? {assetType: patch.assetType} : {}),
            ...(patch.minAppVersion !== undefined
                ? patch.minAppVersion ? {minAppVersion: patch.minAppVersion} : {minAppVersion: undefined}
                : {}),
        },
    };
    const nextEntry = assetEntryPath(next.neurobook.assetType, next.name);
    return {
        entries: draft.entries.map((entry) => {
            if (entry.path === "package.json") {
                return {...entry, bytes: encodePackageJson(next)};
            }
            if (entry.path === previousEntry && previousEntry !== nextEntry) {
                return {...entry, path: nextEntry};
            }
            return entry;
        }),
    };
}

/**
 * 原子更新安装身份以及协议要求的源码身份。失败时返回原草稿，不留下半重命名入口。
 */
export async function updateDraftIdentity(
    draft: PackageDraft,
    name: string,
): Promise<{ok: true; draft: PackageDraft} | {ok: false; error: string}> {
    const parsed = parseDraftPackageLoosely(draft);
    if (!parsed) {
        return {ok: false, error: "package.json 当前无法解析"};
    }
    const previousEntry = assetEntryPath(parsed.neurobook.assetType, parsed.name);
    const sourceEntry = draft.entries.find((entry) => entry.kind === "file" && entry.path === previousEntry);
    if (!sourceEntry) {
        return {ok: false, error: `包中缺少 ${previousEntry}`};
    }

    let source = new TextDecoder().decode(sourceEntry.bytes);
    if (parsed.neurobook.assetType === "skill") {
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
        if (!frontmatter) {
            return {ok: false, error: "SKILL.md 必须以 YAML frontmatter 开头"};
        }
        const document = parseDocument(frontmatter[1] ?? "", {strict: true, uniqueKeys: true});
        if (document.errors.length > 0) {
            return {ok: false, error: `SKILL.md frontmatter 无效：${document.errors[0]?.message ?? "无法解析"}`};
        }
        document.set("name", name);
        source = `---\n${document.toString().trimEnd()}\n---\n${source.slice(frontmatter[0].length)}`;
    } else {
        const typescript = await import("typescript");
        const sourceFile = typescript.createSourceFile(previousEntry, source, typescript.ScriptTarget.Latest, true,
            parsed.neurobook.assetType === "profile" ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS);
        let identity: import("typescript").Expression | null = null;
        if (parsed.neurobook.assetType === "workflow") {
            const assignment = sourceFile.statements.find((statement): statement is import("typescript").ExportAssignment =>
                typescript.isExportAssignment(statement) && !statement.isExportEquals);
            let expression = assignment?.expression;
            while (expression && (typescript.isParenthesizedExpression(expression) || typescript.isAsExpression(expression) || typescript.isSatisfiesExpression(expression))) {
                expression = expression.expression;
            }
            const object = expression && typescript.isObjectLiteralExpression(expression) ? expression : null;
            const key = object?.properties.find((property) => property.name && (typescript.isIdentifier(property.name) || typescript.isStringLiteral(property.name)) && property.name.text === "key");
            identity = key && typescript.isPropertyAssignment(key) ? key.initializer : null;
            if (!identity || !(typescript.isStringLiteral(identity) || typescript.isNoSubstitutionTemplateLiteral(identity))) {
                return {ok: false, error: "Workflow 必须直接声明静态字符串 key"};
            }
        } else {
            for (const statement of sourceFile.statements) {
                if (!typescript.isVariableStatement(statement)) {
                    continue;
                }
                const declaration = statement.declarationList.declarations.find((candidate) =>
                    typescript.isIdentifier(candidate.name) && candidate.name.text === "profileManifest");
                let expression = declaration?.initializer;
                while (expression && (typescript.isParenthesizedExpression(expression) || typescript.isAsExpression(expression) || typescript.isSatisfiesExpression(expression))) {
                    expression = expression.expression;
                }
                const object = expression && typescript.isObjectLiteralExpression(expression) ? expression : null;
                const key = object?.properties.find((property) => property.name && (typescript.isIdentifier(property.name) || typescript.isStringLiteral(property.name)) && property.name.text === "key");
                identity = key && typescript.isPropertyAssignment(key) ? key.initializer : null;
                break;
            }
        }
        if (identity && (typescript.isStringLiteral(identity) || typescript.isNoSubstitutionTemplateLiteral(identity))) {
            source = `${source.slice(0, identity.getStart(sourceFile))}${JSON.stringify(name)}${source.slice(identity.end)}`;
        }
    }

    const next = updateDraftPackage(draft, {name});
    const nextEntry = assetEntryPath(parsed.neurobook.assetType, name);
    return {ok: true, draft: updateDraftFile(next, nextEntry, source)};
}

/** 根据当前版本生成 patch/minor/major 建议版本。 */
export function bumpDraftVersion(version: string, release: "patch" | "minor" | "major"): string | null {
    return inc(version, release);
}

/** 更新单个文本文件内容。 */
export function updateDraftFile(draft: PackageDraft, path: string, content: string): PackageDraft {
    return {entries: draft.entries.map((entry) => entry.path === path ? {...entry, bytes: strToU8(content)} : entry)};
}

/** 新建文件或目录；非法或冲突时返回错误。 */
export function addDraftEntry(draft: PackageDraft, entry: DraftEntry): {ok: true; draft: PackageDraft} | {ok: false; error: string} {
    return normalizeDraftEntries([...draft.entries, entry]);
}

/** 重命名文件/目录；目录下全部后代同步改路径。 */
export function renameDraftEntry(draft: PackageDraft, sourcePath: string, nextName: string): {ok: true; draft: PackageDraft} | {ok: false; error: string} {
    const parent = parentPath(sourcePath);
    const nextPath = parent ? `${parent}/${nextName}` : nextName;
    const entries = draft.entries.map((entry) => entry.path === sourcePath || entry.path.startsWith(`${sourcePath}/`)
        ? {...entry, path: `${nextPath}${entry.path.slice(sourcePath.length)}`}
        : entry);
    return normalizeDraftEntries(entries);
}

/** 删除文件或目录及其全部后代。 */
export function deleteDraftEntry(draft: PackageDraft, path: string): PackageDraft {
    return {entries: draft.entries.filter((entry) => entry.path !== path && !entry.path.startsWith(`${path}/`))};
}

/** 应用 nb-ui FileTree 的四种拖拽落点。 */
export function moveDraftEntry(draft: PackageDraft, move: FileTreeMove): DraftMoveResult {
    const source = draft.entries.find((entry) => entry.path === move.sourceId);
    if (!source) {
        return {ok: false, error: "待移动条目不存在"};
    }
    const targetParent = move.position === "root" || !move.targetId
        ? ""
        : move.position === "inside" ? move.targetId : parentPath(move.targetId);
    if (source.kind === "directory" && (targetParent === source.path || targetParent.startsWith(`${source.path}/`))) {
        return {ok: false, error: "目录不能移动到自身内部"};
    }
    const name = baseName(source.path);
    const nextPath = targetParent ? `${targetParent}/${name}` : name;
    if (nextPath === source.path) {
        return {ok: true, draft, selectedPath: source.path};
    }
    const entries = draft.entries.map((entry) => entry.path === source.path || entry.path.startsWith(`${source.path}/`)
        ? {...entry, path: `${nextPath}${entry.path.slice(source.path.length)}`}
        : entry);
    const normalized = normalizeDraftEntries(entries);
    return normalized.ok ? {ok: true, draft: normalized.draft, selectedPath: nextPath} : normalized;
}

/** 把平面草稿构造成 nb-ui FileTree 节点。 */
export function draftFileTree(draft: PackageDraft): FileTreeNode[] {
    const nodes = new Map<string, FileTreeNode>();
    for (const entry of [...draft.entries].sort((a, b) => a.path.localeCompare(b.path))) {
        const parts = entry.path.split("/");
        for (let index = 0; index < parts.length; index += 1) {
            const path = parts.slice(0, index + 1).join("/");
            const isLeaf = index === parts.length - 1;
            if (!nodes.has(path)) {
                nodes.set(path, {
                    id: path,
                    label: parts[index] ?? path,
                    kind: isLeaf ? entry.kind : "directory",
                    iconClass: isLeaf && entry.kind === "file" ? fileIcon(path) : undefined,
                    children: [],
                });
            }
        }
    }
    const roots: FileTreeNode[] = [];
    for (const node of nodes.values()) {
        const parent = nodes.get(parentPath(node.id));
        (parent?.children ?? roots).push(node);
    }
    const sort = (items: FileTreeNode[]): void => {
        items.sort((left, right) => left.kind === right.kind ? left.label.localeCompare(right.label) : left.kind === "directory" ? -1 : 1);
        items.forEach((item) => sort(item.children ?? []));
    };
    sort(roots);
    return roots;
}

/** 判断文件是否适合 UTF-8 文本编辑。 */
export function isEditableText(entry?: DraftEntry): boolean {
    if (!entry || entry.kind !== "file" || entry.bytes.byteLength > 1024 * 1024 || entry.bytes.includes(0)) {
        return false;
    }
    const name = baseName(entry.path).toLowerCase();
    const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
    return TEXT_EXTENSIONS.has(extension) || ["license", "readme", "changelog", "notice"].includes(name);
}

/** 推断 CodeMirror 高亮类型。 */
export function editorLanguage(path: string): "tsx" | "markdown" | "plain" {
    const lower = path.toLowerCase();
    return lower.endsWith(".md") || lower.endsWith(".markdown") ? "markdown"
        : /\.(?:ts|tsx|js|jsx|mjs|cjs|json|vue|css)$/.test(lower) ? "tsx" : "plain";
}

/** 统一校验路径、大小写冲突、父文件冲突和容量上限。 */
function normalizeDraftEntries(entries: DraftEntry[], stripSingleRoot = false): {ok: true; draft: PackageDraft} | {ok: false; error: string} {
    let working = entries.filter((entry) => entry.path.length > 0);
    if (stripSingleRoot && working.length > 0) {
        const roots = new Set(working.map((entry) => entry.path.split("/")[0]));
        const root = [...roots][0];
        if (roots.size === 1 && root && working.some((entry) => entry.path.includes("/"))) {
            working = working
                .filter((entry) => entry.path !== root)
                .map((entry) => ({...entry, path: entry.path.slice(root.length + 1)}));
        }
    }
    const explicitPaths = new Set(working.map((entry) => entry.path.toLowerCase()));
    const syntheticDirectories: DraftEntry[] = [];
    for (const entry of working) {
        let parent = parentPath(entry.path);
        while (parent) {
            if (!explicitPaths.has(parent.toLowerCase())) {
                explicitPaths.add(parent.toLowerCase());
                syntheticDirectories.push({path: parent, kind: "directory", bytes: new Uint8Array()});
            }
            parent = parentPath(parent);
        }
    }
    working = [...working, ...syntheticDirectories];
    if (working.length > AGENT_ASSET_LIMITS.entries) {
        return {ok: false, error: `文件数超过 ${AGENT_ASSET_LIMITS.entries} 个上限`};
    }
    let totalBytes = 0;
    const seen = new Map<string, DraftEntry>();
    const ordered = [...working].sort((left, right) => left.path.split("/").length - right.path.split("/").length);
    for (const entry of ordered) {
        const error = validateDraftPath(entry.path);
        if (error) {
            return {ok: false, error: `${entry.path}：${error}`};
        }
        const folded = entry.path.toLowerCase();
        if (seen.has(folded)) {
            return {ok: false, error: `路径与已有条目冲突：${entry.path}`};
        }
        let parent = parentPath(entry.path);
        while (parent) {
            if (seen.get(parent.toLowerCase())?.kind === "file") {
                return {ok: false, error: `文件不能作为目录：${parent}`};
            }
            parent = parentPath(parent);
        }
        totalBytes += entry.kind === "file" ? entry.bytes.byteLength : 0;
        if (totalBytes > AGENT_ASSET_LIMITS.uncompressedBytes) {
            return {ok: false, error: "文件实际总量超过 100 MiB 上限"};
        }
        seen.set(folded, entry);
    }
    return {ok: true, draft: {entries: [...seen.values()].sort((left, right) => left.path.localeCompare(right.path))}};
}

/** 返回单个相对路径的用户可读错误；空串表示合法。 */
function validateDraftPath(path: string): string {
    return normalizeAgentAssetPath(path) === path ? "" : "必须是安全的 / 分隔相对路径，且不能含保留名或尾随空格/点";
}

/** 宽松读取当前 package.json，供结构化控件修正一个暂时不完整的包。 */
function parseDraftPackageLoosely(draft: PackageDraft): AgentAssetPackageJson | null {
    const entry = draft.entries.find((candidate) => candidate.path === "package.json" && candidate.kind === "file");
    if (!entry) {
        return null;
    }
    try {
        const raw: unknown = JSON.parse(new TextDecoder().decode(entry.bytes));
        return isObject(raw) && isObject(raw.neurobook) ? raw as AgentAssetPackageJson : null;
    } catch {
        return null;
    }
}

/** 生成便于手工阅读的 package.json 字节。 */
function encodePackageJson(packageJson: AgentAssetPackageJson): Uint8Array {
    return strToU8(`${JSON.stringify(packageJson, null, 4)}\n`);
}

/** JSON 对象守卫。 */
function isObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 返回相对路径父目录。 */
function parentPath(path: string): string {
    return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** 返回相对路径末段。 */
function baseName(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

/** 依据常见扩展名选择文件图标。 */
function fileIcon(path: string): string {
    const lower = path.toLowerCase();
    return lower.endsWith(".md") ? "i-lucide-file-text"
        : /\.(?:ts|tsx|js|jsx|json)$/.test(lower) ? "i-lucide-file-code"
            : /\.(?:png|jpe?g|gif|webp|svg)$/.test(lower) ? "i-lucide-image" : "i-lucide-file";
}
