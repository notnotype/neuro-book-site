import * as typescript from "typescript";
import {createError} from "h3";
import {gt} from "semver";
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
import type {AgentAssetPackageJson} from "../../shared/agent-asset-package";
import {
    AgentAssetArchiveError,
    readAgentAssetArchiveEntry,
    scanAgentAssetArchive,
} from "./agent-asset-archive";
import {apiError} from "./api-error";

export type ParsedWorkshopPackage = {
    packageJson: AgentAssetPackageJson;
    entryNames: string[];
};

/**
 * 完整验证上传归档：顺序解压确认真实总量，再读取固定入口做协议级源码检查。
 */
export async function parseWorkshopPackageFile(zipPath: string): Promise<ParsedWorkshopPackage> {
    try {
        const scan = await scanAgentAssetArchive(zipPath, {
            inflateAll: true,
            selectedPath: "package.json",
            selectedLimit: AGENT_ASSET_LIMITS.packageJsonBytes,
        });
        if (!scan.selected) {
            throw invalidPackage("包根目录缺少 package.json");
        }
        const parsed = parseAgentAssetPackage(scan.selected);
        if (!parsed.ok) {
            throw invalidPackage(formatAgentAssetIssues(parsed.issues), parsed.issues);
        }
        const files = new Map(scan.entries.filter((entry) => !entry.directory).map((entry) => [entry.path, {size: entry.size}]));
        const layoutIssues = validateAgentAssetLayout(parsed.packageJson, files);
        if (layoutIssues.length > 0) {
            throw invalidPackage(formatAgentAssetIssues(layoutIssues), layoutIssues);
        }
        const entryPath = assetEntryPath(parsed.packageJson.neurobook.assetType, parsed.packageJson.name);
        const source = await readAgentAssetArchiveEntry(zipPath, entryPath, AGENT_ASSET_LIMITS.sourceBytes);
        if (!source) {
            throw invalidPackage(`包根目录缺少 ${entryPath}`);
        }
        const sourceIssues = validateAgentAssetSource(parsed.packageJson, source, typescript);
        if (sourceIssues.length > 0) {
            throw invalidPackage(formatAgentAssetIssues(sourceIssues), sourceIssues);
        }
        return {packageJson: parsed.packageJson, entryNames: scan.entries.map((entry) => entry.path)};
    } catch (error) {
        if (typeof error === "object" && error !== null && "statusCode" in error) {
            throw error;
        }
        if (error instanceof AgentAssetArchiveError) {
            throw invalidPackage(error.message);
        }
        throw invalidPackage("无法解析 ZIP 文件");
    }
}

/**
 * 上传落库前校验条目身份和 SemVer。首版允许 name 从包落库，后续版本保持身份不变。
 */
export function assertUploadAllowed(
    packageJson: AgentAssetPackageJson,
    item: {type: "skill" | "workflow" | "profile"; name: string},
    latestVersion: string | null,
): void {
    const identityIssues = validateAgentAssetIdentity(packageJson, {
        type: item.type,
        ...(latestVersion !== null ? {name: item.name} : {}),
    });
    if (identityIssues.length > 0) {
        throw invalidPackage(formatAgentAssetIssues(identityIssues), identityIssues);
    }
    if (latestVersion !== null && !gt(packageJson.version, latestVersion)) {
        throw createError({
            statusCode: 400,
            message: `version（${packageJson.version}）必须按 SemVer precedence 严格大于当前最新版本 ${latestVersion}`,
            data: {error: "invalid_agent_asset_version"},
        });
    }
}

export type PackageEntryMeta = {path: string; size: number};

/** 列出已发布归档文件；只读取中央目录，但仍校验路径和特殊文件。 */
export async function listPackageEntries(zipPath: string): Promise<PackageEntryMeta[]> {
    try {
        const scan = await scanAgentAssetArchive(zipPath);
        return scan.entries.filter((entry) => !entry.directory).map((entry) => ({path: entry.path, size: entry.size}));
    } catch {
        throw apiError(500, "archive_corrupt", "Package archive is corrupt");
    }
}

/** 读取一个预览条目，按实际输出限制 200 KiB。 */
export async function readPackageEntry(zipPath: string, path: string): Promise<Uint8Array | null> {
    const normalized = normalizeAgentAssetPath(path);
    if (!normalized || normalized !== path) {
        return null;
    }
    try {
        return await readAgentAssetArchiveEntry(zipPath, path, AGENT_ASSET_LIMITS.previewBytes);
    } catch (error) {
        if (error instanceof AgentAssetArchiveError && error.message.includes("超过允许上限")) {
            throw apiError(400, "file_preview_too_large", "File exceeds the preview limit");
        }
        throw apiError(500, "archive_corrupt", "Package archive is corrupt");
    }
}

const previewableExtensions = new Set([
    "md", "markdown", "txt", "json", "ts", "tsx", "js", "jsx", "mjs", "cjs",
    "yaml", "yml", "toml", "css", "html", "htm", "vue", "csv", "xml", "sh", "ps1", "py",
]);
const previewableBareNames = new Set(["license", "readme", "changelog", "notice"]);

/** 中央目录大小只用于提前隐藏明显超限项，读取接口仍按实际输出二次限制。 */
export function isPreviewableFile(path: string, size: number): boolean {
    if (size > AGENT_ASSET_LIMITS.previewBytes) {
        return false;
    }
    const base = path.split("/").pop() ?? "";
    const dot = base.lastIndexOf(".");
    return dot === -1
        ? previewableBareNames.has(base.toLowerCase())
        : previewableExtensions.has(base.slice(dot + 1).toLowerCase());
}

function invalidPackage(message: string, issues?: readonly {code: string; path: string; message: string}[]): ReturnType<typeof createError> {
    return createError({
        statusCode: 400,
        message,
        data: {error: "invalid_agent_asset_package", ...(issues ? {issues} : {})},
    });
}

export const sanitizeWorkshopEntryPath = normalizeAgentAssetPath;
