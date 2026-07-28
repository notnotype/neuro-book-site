import {createReadStream} from "node:fs";
import {Unzip, UnzipInflate, unzipSync} from "fflate";
import {createError} from "h3";
import {gt} from "semver";
import {assetEntryPath, hasRuntimeDependencies} from "../../shared/agent-asset-package";
import type {AgentAssetPackage} from "./workshop-dto";
import {AgentAssetPackageSchema} from "./workshop-dto";

// Agent 资产包（zip + 根 package.json）解析与结构校验。站点从不执行包内代码。

export type ParsedWorkshopPackage = {
    packageJson: AgentAssetPackage;
    entryNames: string[]; // zip 内全部条目名（目录条目以 / 结尾）
};

const DEFAULT_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 500;
const MAX_PACKAGE_JSON_BYTES = 64 * 1024;
const MAX_WORKFLOW_BYTES = 1024 * 1024;
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WORKFLOW_IMPORT_PATTERN = /(?:^|\n)\s*(?:import\s+|export\s+[^\n;]+\s+from\s+)|\b(?:import|require)\s*\(/m;

/**
 * 服务端顺序验证 Workshop zip：不把压缩包或解压结果整体读入内存。
 */
export async function parseWorkshopPackageFile(zipPath: string): Promise<ParsedWorkshopPackage> {
    const maxUncompressedBytes = positiveEnv("NB_WORKSHOP_MAX_UNCOMPRESSED_BYTES", DEFAULT_MAX_UNCOMPRESSED_BYTES);
    const maxEntries = positiveEnv("NB_WORKSHOP_MAX_ENTRIES", DEFAULT_MAX_ENTRIES);
    const entryNames: string[] = [];
    const seenPaths = new Set<string>();
    const packageJsonChunks: Buffer[] = [];
    const workflowChunks: Buffer[] = [];
    let packageJsonBytes = 0;
    let workflowBytes = 0;
    let uncompressedBytes = 0;
    let failure: Error | null = null;

    const unzip = new Unzip((file) => {
        const safePath = sanitizeWorkshopEntryPath(file.name);
        if (!safePath) {
            failure = failure ?? createError({statusCode: 400, message: `zip 包含非法路径：${file.name}`});
            file.terminate();
            return;
        }
        const foldedPath = safePath.toLowerCase();
        if (seenPaths.has(foldedPath)) {
            failure = failure ?? createError({statusCode: 400, message: `zip 包含重复路径：${safePath}`});
            file.terminate();
            return;
        }
        seenPaths.add(foldedPath);
        entryNames.push(file.name.endsWith("/") ? `${safePath}/` : safePath);
        if (entryNames.length > maxEntries) {
            failure = failure ?? createError({statusCode: 400, message: `zip 条目数超过 ${maxEntries} 个上限`});
            file.terminate();
            return;
        }

        file.ondata = (error, data) => {
            if (error) {
                failure = failure ?? error;
                return;
            }
            if (failure) {
                return;
            }
            uncompressedBytes += data.byteLength;
            if (uncompressedBytes > maxUncompressedBytes) {
                failure = createError({statusCode: 400, message: "zip 实际解压体积超过 100 MiB 上限"});
                file.terminate();
                return;
            }
            if (safePath === "package.json") {
                packageJsonBytes += data.byteLength;
                if (packageJsonBytes > MAX_PACKAGE_JSON_BYTES) {
                    failure = createError({statusCode: 400, message: "package.json 体积异常"});
                    file.terminate();
                    return;
                }
                packageJsonChunks.push(Buffer.from(data));
            }
            if (safePath === "workflow.ts") {
                workflowBytes += data.byteLength;
                if (workflowBytes > MAX_WORKFLOW_BYTES) {
                    failure = createError({statusCode: 400, message: "workflow.ts 超过 1 MiB 上限"});
                    file.terminate();
                    return;
                }
                workflowChunks.push(Buffer.from(data));
            }
        };
        try {
            file.start();
        } catch {
            failure = failure ?? createError({statusCode: 400, message: "zip 使用了不支持的压缩格式"});
        }
    });
    unzip.register(UnzipInflate);

    try {
        const source = createReadStream(zipPath, {highWaterMark: 1 << 18});
        for await (const chunk of source) {
            unzip.push(chunk as Buffer);
            if (failure) {
                throw failure;
            }
        }
        unzip.push(new Uint8Array(0), true);
    } catch (error) {
        if (failure) {
            throw failure;
        }
        if (typeof error === "object" && error !== null && "statusCode" in error) {
            throw error;
        }
        throw createError({statusCode: 400, message: "无法解析 zip 文件"});
    }
    if (failure) {
        throw failure;
    }
    if (packageJsonChunks.length === 0) {
        throw createError({statusCode: 400, message: "包根部缺少 package.json"});
    }
    const packageJson = parsePackageJsonBytes(Buffer.concat(packageJsonChunks));
    assertPackageStructure(packageJson, seenPaths, Buffer.concat(workflowChunks));
    return {packageJson, entryNames};
}

/**
 * 验证 zip 条目路径，拒绝绝对路径、反斜杠、空段、点段、Windows 保留名及尾随空格/点。
 */
export function sanitizeWorkshopEntryPath(entryName: string): string | null {
    if (!entryName || entryName.includes("\0") || entryName.includes("\\") || entryName.startsWith("/") || /^[A-Za-z]:/.test(entryName)) {
        return null;
    }
    const withoutDirectoryMarker = entryName.endsWith("/") ? entryName.slice(0, -1) : entryName;
    const parts = withoutDirectoryMarker.split("/");
    if (parts.length === 0 || parts.some((part) => part.length === 0
        || part === "."
        || part === ".."
        || /[ .]$/.test(part)
        || WINDOWS_RESERVED_NAMES.test(part))) {
        return null;
    }
    return parts.join("/");
}

/**
 * 读取可由测试缩小的正整数限制。
 */
function positiveEnv(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name]?.trim() ?? "", 10);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * 解析内存中的资产包并执行与流式上传相同的结构校验。
 * 与条目的 type/name 一致性、version 递增需要数据库参与，在 API 层校验。
 */
export function parseWorkshopPackage(zipBytes: Uint8Array): ParsedWorkshopPackage {
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(zipBytes);
    } catch {
        throw createError({statusCode: 400, message: "无法解析 zip 文件"});
    }

    const normalizedEntries = new Map<string, {path: string; bytes: Uint8Array}>();
    for (const [rawPath, bytes] of Object.entries(entries)) {
        const safePath = sanitizeWorkshopEntryPath(rawPath);
        if (!safePath) {
            throw createError({statusCode: 400, message: `zip 包含非法路径：${rawPath}`});
        }
        const foldedPath = safePath.toLowerCase();
        if (normalizedEntries.has(foldedPath)) {
            throw createError({statusCode: 400, message: `zip 包含重复路径：${safePath}`});
        }
        normalizedEntries.set(foldedPath, {path: safePath, bytes});
    }
    const packageEntry = normalizedEntries.get("package.json");
    if (!packageEntry) {
        throw createError({statusCode: 400, message: "包根部缺少 package.json"});
    }
    const packageJson = parsePackageJsonBytes(packageEntry.bytes);
    const workflowBytes = normalizedEntries.get("workflow.ts")?.bytes ?? new Uint8Array();
    assertPackageStructure(packageJson, new Set(normalizedEntries.keys()), workflowBytes);
    return {packageJson, entryNames: [...normalizedEntries.values()].map((entry) => entry.path)};
}

/** 解析并校验根 package.json；外部 JSON 数据仅在此处以 unknown 进入 zod。 */
function parsePackageJsonBytes(bytes: Uint8Array): AgentAssetPackage {
    if (bytes.byteLength > MAX_PACKAGE_JSON_BYTES) {
        throw createError({statusCode: 400, message: "package.json 体积异常"});
    }
    let raw: unknown;
    try {
        raw = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    } catch {
        throw createError({statusCode: 400, message: "package.json 不是合法 JSON"});
    }
    const parsed = AgentAssetPackageSchema.safeParse(raw);
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: `package.json 字段无效：${parsed.error.issues.map((issue) => issue.path.length > 0 ? `${issue.path.join(".")} ${issue.message}` : issue.message).join("；")}`,
        });
    }
    return parsed.data;
}

/** 校验固定入口以及 Workflow 的无依赖、无 import 合同。 */
function assertPackageStructure(packageJson: AgentAssetPackage, seenPaths: Set<string>, workflowBytes: Uint8Array): void {
    const entryPath = assetEntryPath(packageJson.neurobook.assetType, packageJson.name);
    if (!seenPaths.has(entryPath.toLowerCase())) {
        throw createError({statusCode: 400, message: `${packageJson.neurobook.assetType} 包根部必须包含 ${entryPath}`});
    }
    if (packageJson.neurobook.assetType !== "workflow") {
        return;
    }
    if (hasRuntimeDependencies(packageJson)) {
        throw createError({statusCode: 400, message: "Workflow 包不能声明运行时或开发依赖"});
    }
    if (workflowBytes.byteLength > MAX_WORKFLOW_BYTES) {
        throw createError({statusCode: 400, message: "workflow.ts 超过 1 MiB 上限"});
    }
    let source: string;
    try {
        source = new TextDecoder("utf-8", {fatal: true}).decode(workflowBytes);
    } catch {
        throw createError({statusCode: 400, message: "workflow.ts 不是合法 UTF-8 文本"});
    }
    if (WORKFLOW_IMPORT_PATTERN.test(source)) {
        throw createError({statusCode: 400, message: "Workflow 不允许使用 import、export from 或 require"});
    }
}

/**
 * 上传落库前的条目一致性校验（依赖条目现状，独立成纯函数便于单测）：
 * 1. package.json assetType 必须与条目类型一致（首版与后续版本都校验）；
 * 2. 非首版（latestVersion 非 null）时 package.json name 必须与条目安装名一致；
 * 3. version 必须大于当前最新版本，拒绝时直接提示应改为 N+1。
 * @param latestVersion 条目当前最新版本号；null 表示尚无任何版本（首版上传）
 */
export function assertUploadAllowed(packageJson: AgentAssetPackage, item: {type: "skill" | "workflow" | "profile"; name: string}, latestVersion: string | null): void {
    if (packageJson.neurobook.assetType !== item.type) {
        throw createError({statusCode: 400, message: `包 assetType（${packageJson.neurobook.assetType}）与条目类型（${item.type}）不一致`});
    }
    if (latestVersion === null) {
        return;
    }
    if (packageJson.name !== item.name) {
        throw createError({statusCode: 400, message: `包 name（${packageJson.name}）与条目安装名（${item.name}）不一致`});
    }
    if (!gt(packageJson.version, latestVersion)) {
        throw createError({
            statusCode: 400,
            message: `version（${packageJson.version}）必须按 SemVer precedence 严格大于当前最新版本 ${latestVersion}`,
        });
    }
}

/** 包内文件条目元信息；size 为 zip 中央目录头部声明的解压后大小。 */
export type PackageEntryMeta = {path: string; size: number};

/**
 * 列出包内文件条目（在线预览用）：借 fflate filter 只读中央目录头部并返回 false，
 * 全程零解压。目录占位条目剔除，条目名分隔符归一为 /。zip 损坏 → 500。
 * 将来 zip bomb 守卫（安全债）在此与 readPackageEntry 统一落点。
 */
export function listPackageEntries(zipBytes: Uint8Array): PackageEntryMeta[] {
    const entries: PackageEntryMeta[] = [];
    try {
        unzipSync(zipBytes, {
            filter: (file) => {
                const path = sanitizeWorkshopEntryPath(file.name);
                if (!path) {
                    throw createError({statusCode: 500, message: "包文件含非法路径"});
                }
                if (!file.name.endsWith("/")) {
                    entries.push({path, size: file.originalSize});
                }
                return false; // 不解压任何条目，仅收集元信息
            },
        });
    } catch {
        throw createError({statusCode: 500, message: "包文件损坏，无法解析"});
    }
    return entries;
}

/**
 * 读取包内单个条目字节（在线预览用）：filter 精确匹配、只解压目标条目；
 * path 按归一化条目名匹配，目录条目不可读。不存在返回 null。zip 损坏 → 500。
 */
export function readPackageEntry(zipBytes: Uint8Array, path: string): Uint8Array | null {
    let unzipped: Record<string, Uint8Array>;
    try {
        unzipped = unzipSync(zipBytes, {
            filter: (file) => {
                const name = sanitizeWorkshopEntryPath(file.name);
                return name !== null && !file.name.endsWith("/") && name === path;
            },
        });
    } catch {
        throw createError({statusCode: 500, message: "包文件损坏，无法解析"});
    }
    return Object.values(unzipped)[0] ?? null;
}

// 在线预览的文本大小上限：超过则视为不可预览，防止超大文本拖垮响应
const PREVIEW_MAX_BYTES = 200 * 1024;

// 可在线预览的文本扩展名白名单（小写）
const previewableExtensions = new Set([
    "md", "markdown", "txt", "json", "ts", "tsx", "js", "jsx", "mjs", "cjs",
    "yaml", "yml", "toml", "css", "html", "htm", "vue", "csv", "xml", "sh", "ps1", "py",
]);

// 无扩展名但通常是文本的常见裸文件名（小写）
const previewableBareNames = new Set(["license", "readme", "changelog", "notice"]);

/**
 * 判断包内文件是否可在线预览：扩展名 / 常见裸文件名白名单 + 大小上限。
 * 纯函数，包文件列表与内容预览接口共用同一判定。
 */
export function isPreviewableFile(path: string, size: number): boolean {
    if (size > PREVIEW_MAX_BYTES) {
        return false;
    }
    const base = path.split("/").pop() ?? "";
    const dot = base.lastIndexOf(".");
    if (dot === -1) {
        return previewableBareNames.has(base.toLowerCase());
    }
    return previewableExtensions.has(base.slice(dot + 1).toLowerCase());
}
