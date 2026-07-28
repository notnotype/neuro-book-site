import type {FileTreeMove, FileTreeNode} from "@notnotype/nb-ui/components";
import {strToU8, unzipSync, zipSync} from "fflate";
import {inc, valid} from "semver";
import type {AgentAssetPackageJson, AgentAssetType} from "../../shared/agent-asset-package";
import {assetEntryPath, hasRuntimeDependencies} from "../../shared/agent-asset-package";

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

const MAX_ENTRIES = 500;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WORKFLOW_IMPORT = /(?:^|\n)\s*(?:import\s+|export\s+[^\n;]+\s+from\s+)|\b(?:import|require)\s*\(/m;
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
            ? "export default defineWorkflow({\n    name: \"draft-workflow\",\n    steps: [],\n});\n"
            : "export const profileManifest = {\n    name: \"Writer\",\n};\n";
    return {
        entries: [
            {path: "package.json", kind: "file", bytes: encodePackageJson(packageJson)},
            {path: entry, kind: "file", bytes: strToU8(template)},
        ],
    };
}

/** 从完整 ZIP 建立草稿，并执行路径、条目数与解压量门禁。 */
export function draftFromZip(zipBytes: Uint8Array, stripSingleRoot = false): {ok: true; draft: PackageDraft} | {ok: false; error: string} {
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(zipBytes);
    } catch {
        return {ok: false, error: "无法解析 ZIP 文件"};
    }
    return normalizeDraftEntries(Object.entries(entries).map(([path, bytes]) => ({
        path: path.endsWith("/") ? path.slice(0, -1) : path,
        kind: path.endsWith("/") ? "directory" : "file",
        bytes,
    })), stripSingleRoot);
}

/** 从浏览器多文件选择建立目录草稿片段。 */
export async function draftEntriesFromFiles(files: File[]): Promise<{ok: true; entries: DraftEntry[]} | {ok: false; error: string}> {
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

/** 解析 package.json 并校验三类入口及 Workflow 静态合同。 */
export function parseDraftPackage(draft: PackageDraft): DraftPackageResult {
    const packageEntry = draft.entries.find((entry) => entry.kind === "file" && entry.path === "package.json");
    if (!packageEntry) {
        return {ok: false, error: "根目录缺少 package.json"};
    }
    let raw: unknown; // 外部包 JSON 在这里进入 unknown，随后逐字段收窄。
    try {
        raw = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(packageEntry.bytes));
    } catch {
        return {ok: false, error: "package.json 不是合法 UTF-8 JSON"};
    }
    if (!isObject(raw) || typeof raw.name !== "string" || !KEBAB_CASE.test(raw.name)) {
        return {ok: false, error: "package.json name 必须是 kebab-case"};
    }
    if (typeof raw.version !== "string" || valid(raw.version) !== raw.version) {
        return {ok: false, error: "package.json version 必须是合法 SemVer"};
    }
    if (raw.type !== "module" || !isObject(raw.neurobook) || raw.neurobook.schemaVersion !== 1
        || (raw.neurobook.assetType !== "skill" && raw.neurobook.assetType !== "workflow" && raw.neurobook.assetType !== "profile")) {
        return {ok: false, error: "package.json 必须声明 type=module、neurobook.schemaVersion=1 和合法 assetType"};
    }
    if (raw.neurobook.minAppVersion !== undefined
        && (typeof raw.neurobook.minAppVersion !== "string" || valid(raw.neurobook.minAppVersion) !== raw.neurobook.minAppVersion)) {
        return {ok: false, error: "neurobook.minAppVersion 必须是合法 SemVer"};
    }
    const packageJson = raw as AgentAssetPackageJson;
    const entryPath = assetEntryPath(packageJson.neurobook.assetType, packageJson.name);
    if (!draft.entries.some((entry) => entry.kind === "file" && entry.path === entryPath)) {
        return {ok: false, error: `${packageJson.neurobook.assetType} 包根目录必须包含 ${entryPath}`};
    }
    if (packageJson.neurobook.assetType === "workflow") {
        if (hasRuntimeDependencies(packageJson)) {
            return {ok: false, error: "Workflow 不能声明依赖"};
        }
        const workflow = draft.entries.find((entry) => entry.path === "workflow.ts" && entry.kind === "file");
        let source: string;
        try {
            source = new TextDecoder("utf-8", {fatal: true}).decode(workflow?.bytes);
        } catch {
            return {ok: false, error: "workflow.ts 不是合法 UTF-8 文本"};
        }
        if (WORKFLOW_IMPORT.test(source)) {
            return {ok: false, error: "Workflow 不允许使用 import、export from 或 require"};
        }
    }
    return {ok: true, packageJson};
}

/** 构建最终 ZIP；最终压缩字节与解压总量使用与服务端相同的上限。 */
export function buildDraftZip(draft: PackageDraft, slug: string): DraftBuildResult {
    const normalized = normalizeDraftEntries(draft.entries);
    if (!normalized.ok) {
        return normalized;
    }
    const parsed = parseDraftPackage(normalized.draft);
    if (!parsed.ok) {
        return parsed;
    }
    const zipEntries: Record<string, Uint8Array> = {};
    for (const entry of normalized.draft.entries) {
        zipEntries[entry.kind === "directory" ? `${entry.path}/` : entry.path] = entry.bytes;
    }
    const bytes = zipSync(zipEntries);
    if (bytes.byteLength > MAX_ZIP_BYTES) {
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
    if (working.length > MAX_ENTRIES) {
        return {ok: false, error: `文件数超过 ${MAX_ENTRIES} 个上限`};
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
        if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
            return {ok: false, error: "文件实际总量超过 100 MiB 上限"};
        }
        seen.set(folded, entry);
    }
    return {ok: true, draft: {entries: [...seen.values()].sort((left, right) => left.path.localeCompare(right.path))}};
}

/** 返回单个相对路径的用户可读错误；空串表示合法。 */
function validateDraftPath(path: string): string {
    if (!path || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
        return "必须是使用 / 的相对路径";
    }
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || /[ .]$/.test(part) || WINDOWS_RESERVED.test(part))) {
        return "包含空段、点段、保留名或尾随空格/点";
    }
    return "";
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
