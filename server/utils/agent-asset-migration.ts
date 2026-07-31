import {strToU8, zipSync} from "fflate";
import {valid} from "semver";
import {stringify} from "yaml";

type LegacyManifest = {
    manifestVersion: 1;
    type: "skill" | "profile";
    name: string;
    version: number;
    minAppVersion?: string;
};

export type MigratedArchive = {
    bytes: Uint8Array;
    changed: boolean;
};

/** 把已经有界读取的旧条目合并为统一根 package.json，并删除旧清单。 */
export function migrateAgentAssetEntries(entries: ReadonlyMap<string, Uint8Array>, databaseVersion: string): MigratedArchive {
    const legacyBytes = entries.get("nbook-package.json");
    if (!legacyBytes) {
        return {bytes: zipEntries(entries), changed: false};
    }

    const legacy = parseLegacyManifest(legacyBytes);
    if (databaseVersion !== `${legacy.version}.0.0`) {
        throw new Error(`数据库版本 ${databaseVersion} 与旧包版本 ${legacy.version} 不一致`);
    }
    const existingPackage = parseExistingPackage(entries.get("package.json"));
    const existingNeurobook = isObject(existingPackage.neurobook) ? existingPackage.neurobook : {};
    const packageJson = {
        ...existingPackage,
        name: legacy.name,
        version: databaseVersion,
        type: "module",
        neurobook: {
            ...existingNeurobook,
            schemaVersion: 1,
            assetType: legacy.type,
            ...(legacy.minAppVersion ? {minAppVersion: legacy.minAppVersion} : {}),
        },
    };
    const migrated = new Map(entries);
    migrated.delete("nbook-package.json");
    migrated.set("package.json", strToU8(`${JSON.stringify(packageJson, null, 4)}\n`));
    if (legacy.type === "skill") {
        const skillSource = migrated.get("SKILL.md");
        if (skillSource) {
            migrated.set("SKILL.md", migrateLegacySkillSource(skillSource, legacy.name));
        }
    }
    return {bytes: zipEntries(migrated), changed: true};
}

/**
 * schema 0 的 Skill 不要求 frontmatter。仅在完全缺失时补齐新协议最小字段；
 * 已有 frontmatter 继续交给统一解析器校验，避免静默改写作者声明。
 */
function migrateLegacySkillSource(bytes: Uint8Array, name: string): Uint8Array {
    let source: string;
    try {
        source = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
        throw new Error("旧 SKILL.md 不是合法 UTF-8 文本");
    }
    if (/^---\r?\n/.test(source)) {
        return bytes;
    }

    const firstContentLine = source.split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    const description = firstContentLine
        ?.replace(/^#{1,6}\s*/, "")
        .trim()
        .slice(0, 200) || `Workshop Skill ${name}`;
    const frontmatter = stringify({name, description}, {lineWidth: 0}).trimEnd();
    return strToU8(`---\n${frontmatter}\n---\n${source}`);
}

function zipEntries(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
    const files: {[path: string]: Uint8Array} = {};
    for (const [path, bytes] of entries) {
        files[path] = bytes;
    }
    return zipSync(files);
}

/** 外部 JSON 只在迁移边界进入 unknown，并立即收窄成旧清单。 */
function parseLegacyManifest(bytes: Uint8Array): LegacyManifest {
    let raw: unknown;
    try {
        raw = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    } catch {
        throw new Error("nbook-package.json 不是合法 JSON");
    }
    if (!isObject(raw)
        || raw.manifestVersion !== 1
        || (raw.type !== "skill" && raw.type !== "profile")
        || typeof raw.name !== "string"
        || typeof raw.version !== "number"
        || !Number.isSafeInteger(raw.version)
        || raw.version <= 0
        || (raw.minAppVersion !== undefined && (typeof raw.minAppVersion !== "string" || valid(raw.minAppVersion) !== raw.minAppVersion))) {
        throw new Error("nbook-package.json 字段无效");
    }
    return {
        manifestVersion: 1,
        type: raw.type,
        name: raw.name,
        version: raw.version,
        ...(typeof raw.minAppVersion === "string" ? {minAppVersion: raw.minAppVersion} : {}),
    };
}

/** 解析已有 package.json；旧 Skill 借此保留依赖、脚本和命令声明。 */
function parseExistingPackage(bytes?: Uint8Array): {[key: string]: unknown} {
    if (!bytes) {
        return {};
    }
    let raw: unknown;
    try {
        raw = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    } catch {
        throw new Error("已有 package.json 不是合法 JSON");
    }
    if (!isObject(raw)) {
        throw new Error("已有 package.json 必须是对象");
    }
    return raw;
}

function isObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
