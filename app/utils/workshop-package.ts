import {zipSync, unzipSync, strToU8} from "fflate";
import type {WorkshopItemType} from "../../shared/dto/workshop.dto";

// 前端资产打包工具：把「友好输入」（在线编辑 / 单文件 / 目录 zip）就地打成 canonical zip
// （根部 nbook-package.json + 入口文件）。canonical 格式是后端唯一契约（存储 / 下载 / Phase 2 安装），
// 这里只在浏览器生成，生成后仍走后端 parseWorkshopPackage 校验——后端始终是校验真相源。

// kebab-case：与后端 slug / manifest name 同口径
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// 平台按发布表单生成 manifest 的输入
export type ManifestInput = {
    type: WorkshopItemType;
    name: string; // kebab-case 安装名；profile 入口文件名 = <name>.profile.tsx
    version: number; // 平台决定：新建 = 1，新版本 = latest + 1
    minAppVersion?: string; // 空 / 缺省表示不声明 NeuroBook 兼容下限
};

// 前端就地解析出的 canonical manifest（结构与后端 PackageManifestSchema 对齐）
export type ParsedManifest = {
    manifestVersion: 1;
    type: WorkshopItemType;
    name: string;
    version: number;
    minAppVersion?: string;
};

// PackageContentInput 产出的内容来源，交给 buildUploadFile 打包
export type ContentSource =
    | {kind: "profile"; bytes: Uint8Array} // profile：编辑器全文或单文件读出的字节
    | {kind: "skill"; bytes: Uint8Array; isDirZip: boolean} // skill：isDirZip=false 时 bytes 是 SKILL.md，true 时是目录 zip
    | {kind: "advanced"; file: File; parsed: ParsedManifest}; // 高级模式：已是 canonical zip，manifest 已解析

// 打包 / 解析结果
export type BuildFileResult = {ok: true; file: File} | {ok: false; error: string};
export type ParseResult = {ok: true; manifest: ParsedManifest; entryNames: string[]} | {ok: false; error: string};

/** 生成 nbook-package.json 字节（缩进 2，便于用户下载后阅读）。 */
function manifestBytes(input: ManifestInput): Uint8Array {
    const manifest: Record<string, unknown> = {
        manifestVersion: 1,
        type: input.type,
        name: input.name,
        version: input.version,
    };
    if (input.minAppVersion && input.minAppVersion.trim().length > 0) {
        manifest.minAppVersion = input.minAppVersion.trim();
    }
    return strToU8(JSON.stringify(manifest, null, 2));
}

/**
 * 剥离单层顶层文件夹：Windows 右键压缩「文件夹」会得到 my-skill/SKILL.md 前缀。
 * 若全部文件条目都在同一个顶层目录下，去掉该前缀让 SKILL.md 回到根部；否则原样返回。
 */
function stripSingleRootFolder(entries: Record<string, Uint8Array>): Record<string, Uint8Array> {
    const fileNames = Object.keys(entries).filter((name) => !name.endsWith("/")); // 忽略纯目录占位条目
    const first = fileNames[0];
    if (!first) {
        return entries;
    }
    const rootSeg = first.split("/")[0] ?? "";
    const shareRoot = rootSeg.length > 0 && fileNames.every((name) => name.startsWith(`${rootSeg}/`));
    if (!shareRoot) {
        return entries;
    }
    const stripped: Record<string, Uint8Array> = {};
    for (const [name, bytes] of Object.entries(entries)) {
        if (name.endsWith("/")) {
            continue; // 丢弃目录占位条目，zipSync 会按剩余路径重建目录
        }
        stripped[name.slice(rootSeg.length + 1)] = bytes;
    }
    return stripped;
}

/** 丢弃纯目录占位条目，避免 zipSync 报错。 */
function dropDirEntries(entries: Record<string, Uint8Array>): Record<string, Uint8Array> {
    const clean: Record<string, Uint8Array> = {};
    for (const [name, bytes] of Object.entries(entries)) {
        if (!name.endsWith("/")) {
            clean[name] = bytes;
        }
    }
    return clean;
}

/** Uint8Array → 上传用 File（uploadVersion 需要带 filename 的 File）。 */
function zipToFile(bytes: Uint8Array, slug: string, version: number): File {
    // DOM lib 的 BlobPart 期望 ArrayBufferView<ArrayBuffer>，fflate 返回 Uint8Array<ArrayBufferLike>，
    // 运行时完全兼容，仅需类型断言收窄
    return new File([bytes as BlobPart], `${slug}-v${version}.zip`, {type: "application/zip"});
}

/**
 * 解析上传的 canonical zip（高级模式就地校验），口径与后端 parseWorkshopPackage 对齐。
 * 真相源仍是后端；这里只为尽早暴露错误。
 */
export function parseCanonicalZip(bytes: Uint8Array): ParseResult {
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(bytes);
    } catch {
        return {ok: false, error: "无法解析 zip 文件"};
    }
    const manifestBytesRaw = entries["nbook-package.json"];
    if (!manifestBytesRaw) {
        return {ok: false, error: "包根部缺少 nbook-package.json"};
    }
    // JSON.parse 输出无静态类型，逐字段收窄后再使用
    let raw: unknown;
    try {
        raw = JSON.parse(new TextDecoder().decode(manifestBytesRaw));
    } catch {
        return {ok: false, error: "nbook-package.json 不是合法 JSON"};
    }
    if (typeof raw !== "object" || raw === null) {
        return {ok: false, error: "nbook-package.json 必须是 JSON 对象"};
    }
    const obj = raw as Record<string, unknown>;
    if (obj.manifestVersion !== 1) {
        return {ok: false, error: "manifestVersion 必须为 1"};
    }
    if (obj.type !== "skill" && obj.type !== "profile") {
        return {ok: false, error: "type 必须是 skill 或 profile"};
    }
    if (typeof obj.name !== "string" || !KEBAB.test(obj.name)) {
        return {ok: false, error: "name 必须是 kebab-case（小写字母/数字/连字符）"};
    }
    if (typeof obj.version !== "number" || !Number.isInteger(obj.version) || obj.version <= 0) {
        return {ok: false, error: "version 必须是正整数"};
    }
    let minAppVersion: string | undefined;
    if (obj.minAppVersion !== undefined) {
        if (typeof obj.minAppVersion !== "string" || obj.minAppVersion.trim().length === 0) {
            return {ok: false, error: "minAppVersion 必须是非空字符串"};
        }
        minAppVersion = obj.minAppVersion.trim();
    }
    const manifest: ParsedManifest = {manifestVersion: 1, type: obj.type, name: obj.name, version: obj.version, minAppVersion};
    if (manifest.type === "skill" && !entries["SKILL.md"]) {
        return {ok: false, error: "skill 包根部必须包含 SKILL.md"};
    }
    if (manifest.type === "profile" && !entries[`${manifest.name}.profile.tsx`]) {
        return {ok: false, error: `profile 包根部必须包含 ${manifest.name}.profile.tsx`};
    }
    return {ok: true, manifest, entryNames: Object.keys(entries)};
}

/**
 * 结构性校验内容来源，供输入组件即时反馈（不需要 name/version 等落库参数）。
 * advanced 已由 parseCanonicalZip 校验，这里直接放行。
 */
export function validateSource(source: ContentSource): {ok: true} | {ok: false; error: string} {
    if (source.kind === "advanced") {
        return {ok: true};
    }
    if (source.kind === "profile") {
        return source.bytes.byteLength > 0 ? {ok: true} : {ok: false, error: "profile 内容为空"};
    }
    if (!source.isDirZip) {
        return source.bytes.byteLength > 0 ? {ok: true} : {ok: false, error: "SKILL.md 内容为空"};
    }
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(source.bytes);
    } catch {
        return {ok: false, error: "无法解析 zip 文件"};
    }
    entries = stripSingleRootFolder(entries);
    if (!entries["SKILL.md"]) {
        return {ok: false, error: "目录压缩包根部必须包含 SKILL.md（已自动尝试剥离外层文件夹）"};
    }
    return {ok: true};
}

/**
 * 把内容来源打包成上传用 File。
 * - advanced：内容已是 canonical zip，直接上传（version/name 以其内嵌 manifest 为准，不重打包）；
 * - profile / skill 简单模式：按平台生成的 manifest（type/name/version）就地打包。
 * @param meta 平台决定的落库参数；简单模式 name 通常 = slug，version 平台自增
 */
export function buildUploadFile(source: ContentSource, meta: {slug: string; name: string; version: number; minAppVersion?: string}): BuildFileResult {
    if (source.kind === "advanced") {
        return {ok: true, file: source.file};
    }

    const manifestInput: ManifestInput = {
        type: source.kind === "profile" ? "profile" : "skill",
        name: meta.name,
        version: meta.version,
        minAppVersion: meta.minAppVersion,
    };

    // profile：入口文件名由平台按 name 生成，绕开用户原文件名 / builtin key 带点的问题
    if (source.kind === "profile") {
        if (source.bytes.byteLength === 0) {
            return {ok: false, error: "profile 内容为空"};
        }
        const bytes = zipSync({
            "nbook-package.json": manifestBytes(manifestInput),
            [`${meta.name}.profile.tsx`]: source.bytes,
        });
        return {ok: true, file: zipToFile(bytes, meta.slug, meta.version)};
    }

    // skill 编辑器：单文件 SKILL.md + 生成的 manifest
    if (!source.isDirZip) {
        if (source.bytes.byteLength === 0) {
            return {ok: false, error: "SKILL.md 内容为空"};
        }
        const bytes = zipSync({
            "nbook-package.json": manifestBytes(manifestInput),
            "SKILL.md": source.bytes,
        });
        return {ok: true, file: zipToFile(bytes, meta.slug, meta.version)};
    }

    // skill 目录 zip：解压 → 剥离单层顶层文件夹 → 校验 SKILL.md → 注入生成的 manifest → 重打包
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(source.bytes);
    } catch {
        return {ok: false, error: "无法解析 zip 文件"};
    }
    entries = stripSingleRootFolder(entries);
    if (!entries["SKILL.md"]) {
        return {ok: false, error: "目录压缩包根部必须包含 SKILL.md（若压缩了外层文件夹，已自动尝试剥离仍未找到）"};
    }
    entries["nbook-package.json"] = manifestBytes(manifestInput); // 覆盖 / 注入平台生成的 manifest（简单模式表单为真相源）
    const bytes = zipSync(dropDirEntries(entries));
    return {ok: true, file: zipToFile(bytes, meta.slug, meta.version)};
}
