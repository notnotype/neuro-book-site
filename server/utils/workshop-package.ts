import {createReadStream} from "node:fs";
import {Unzip, UnzipInflate, unzipSync} from "fflate";
import {createError} from "h3";
import type {PackageManifest} from "./workshop-dto";
import {PackageManifestSchema} from "./workshop-dto";

// 资产包（zip + nbook-package.json）解析与数据正确性校验。
// 注意：第一版按设计完全信任用户，这里不做 zip bomb / zip slip / symlink 等安全防护，
// 安全债清单见 neuro-book 仓 docs/tasks/88-workshop-platform/README.md。

export type ParsedWorkshopPackage = {
    manifest: PackageManifest;
    entryNames: string[]; // zip 内全部条目名（目录条目以 / 结尾）
};

const DEFAULT_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 500;
const MAX_MANIFEST_BYTES = 64 * 1024;

/**
 * 服务端顺序验证 Workshop zip：不把压缩包或解压结果整体读入内存。
 */
export async function parseWorkshopPackageFile(zipPath: string): Promise<ParsedWorkshopPackage> {
    const maxUncompressedBytes = positiveEnv("NB_WORKSHOP_MAX_UNCOMPRESSED_BYTES", DEFAULT_MAX_UNCOMPRESSED_BYTES);
    const maxEntries = positiveEnv("NB_WORKSHOP_MAX_ENTRIES", DEFAULT_MAX_ENTRIES);
    const entryNames: string[] = [];
    const seenPaths = new Set<string>();
    const manifestChunks: Buffer[] = [];
    let manifestBytes = 0;
    let uncompressedBytes = 0;
    let failure: Error | null = null;

    const unzip = new Unzip((file) => {
        const safePath = sanitizeWorkshopEntryPath(file.name);
        if (!safePath) {
            failure = failure ?? createError({statusCode: 400, message: `zip 包含非法路径：${file.name}`});
            file.terminate();
            return;
        }
        if (seenPaths.has(safePath)) {
            failure = failure ?? createError({statusCode: 400, message: `zip 包含重复路径：${safePath}`});
            file.terminate();
            return;
        }
        seenPaths.add(safePath);
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
            if (safePath === "nbook-package.json") {
                manifestBytes += data.byteLength;
                if (manifestBytes > MAX_MANIFEST_BYTES) {
                    failure = createError({statusCode: 400, message: "nbook-package.json 体积异常"});
                    file.terminate();
                    return;
                }
                manifestChunks.push(Buffer.from(data));
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
    if (manifestChunks.length === 0) {
        throw createError({statusCode: 400, message: "包根部缺少 nbook-package.json"});
    }

    let manifestRaw: unknown;
    try {
        manifestRaw = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(manifestChunks)));
    } catch {
        throw createError({statusCode: 400, message: "nbook-package.json 不是合法 JSON"});
    }
    const parsed = PackageManifestSchema.safeParse(manifestRaw);
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: `nbook-package.json 字段无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
        });
    }
    const manifest = parsed.data;
    if (manifest.type === "skill" && !seenPaths.has("SKILL.md")) {
        throw createError({statusCode: 400, message: "skill 包根部必须包含 SKILL.md"});
    }
    if (manifest.type === "profile" && !seenPaths.has(`${manifest.name}.profile.tsx`)) {
        throw createError({statusCode: 400, message: `profile 包根部必须包含 ${manifest.name}.profile.tsx`});
    }
    return {manifest, entryNames};
}

/**
 * 规范化并验证 zip 条目路径，拒绝绝对路径、盘符、NUL 与 `..` 逃逸。
 */
export function sanitizeWorkshopEntryPath(entryName: string): string | null {
    const normalized = entryName.replaceAll("\\", "/");
    if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
        return null;
    }
    const parts = normalized.split("/").filter((part) => part.length > 0 && part !== ".");
    if (parts.length === 0 || parts.some((part) => part === "..")) {
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
 * 解析上传的资产包 zip 并做数据正确性校验：
 * 1. zip 可解压且根部存在合法 nbook-package.json（字段由 zod 校验）；
 * 2. 按 type 校验入口存在：skill 根部必须有 SKILL.md，profile 根部必须有 <name>.profile.tsx。
 * 与条目的 type/name 一致性、version 递增需要数据库参与，在 API 层校验。
 */
export function parseWorkshopPackage(zipBytes: Uint8Array): ParsedWorkshopPackage {
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(zipBytes);
    } catch {
        throw createError({statusCode: 400, message: "无法解析 zip 文件"});
    }

    const manifestBytes = entries["nbook-package.json"];
    if (!manifestBytes) {
        throw createError({statusCode: 400, message: "包根部缺少 nbook-package.json"});
    }

    // JSON.parse 输出无静态类型，立即交给 zod 校验收窄，不在别处使用
    let manifestRaw: unknown;
    try {
        manifestRaw = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch {
        throw createError({statusCode: 400, message: "nbook-package.json 不是合法 JSON"});
    }

    const parsed = PackageManifestSchema.safeParse(manifestRaw);
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: `nbook-package.json 字段无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
        });
    }
    const manifest = parsed.data;

    if (manifest.type === "skill" && !entries["SKILL.md"]) {
        throw createError({statusCode: 400, message: "skill 包根部必须包含 SKILL.md"});
    }
    if (manifest.type === "profile" && !entries[`${manifest.name}.profile.tsx`]) {
        throw createError({statusCode: 400, message: `profile 包根部必须包含 ${manifest.name}.profile.tsx`});
    }

    return {manifest, entryNames: Object.keys(entries)};
}

/**
 * 上传落库前的条目一致性校验（依赖条目现状，独立成纯函数便于单测）：
 * 1. manifest.type 必须与条目类型一致（首版与后续版本都校验）；
 * 2. 非首版（latestVersion 非 null）时 manifest.name 必须与条目安装名一致；
 * 3. version 必须大于当前最新版本，拒绝时直接提示应改为 N+1。
 * @param latestVersion 条目当前最新版本号；null 表示尚无任何版本（首版上传）
 */
export function assertUploadAllowed(manifest: PackageManifest, item: {type: "skill" | "profile"; name: string}, latestVersion: number | null): void {
    if (manifest.type !== item.type) {
        throw createError({statusCode: 400, message: `包 type（${manifest.type}）与条目类型（${item.type}）不一致`});
    }
    if (latestVersion === null) {
        return;
    }
    if (manifest.name !== item.name) {
        throw createError({statusCode: 400, message: `包 name（${manifest.name}）与条目安装名（${item.name}）不一致`});
    }
    if (manifest.version <= latestVersion) {
        throw createError({
            statusCode: 400,
            message: `version（${manifest.version}）必须大于当前最新版本 ${latestVersion}，请把 manifest version 改为 ${latestVersion + 1}`,
        });
    }
}

/** zip 条目名分隔符归一：个别 Windows 归档器违规用反斜杠写条目名（完整包模式可能流入）。 */
function normalizeZipPath(path: string): string {
    return path.replaceAll("\\", "/");
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
                const path = normalizeZipPath(file.name);
                if (!path.endsWith("/")) {
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
                const name = normalizeZipPath(file.name);
                return !name.endsWith("/") && name === path;
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
