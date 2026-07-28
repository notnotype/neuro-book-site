import {strToU8, unzipSync, zipSync} from "fflate";
import {valid} from "semver";
import {parseWorkshopPackage} from "./workshop-package";

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

/** 把旧 nbook-package.json 合并进根 package.json，并删除旧清单。 */
export function migrateAgentAssetArchive(zipBytes: Uint8Array, databaseVersion: string): MigratedArchive {
    const entries = unzipSync(zipBytes);
    const legacyBytes = entries["nbook-package.json"];
    if (!legacyBytes) {
        parseWorkshopPackage(zipBytes);
        return {bytes: zipBytes, changed: false};
    }

    const legacy = parseLegacyManifest(legacyBytes);
    if (databaseVersion !== `${legacy.version}.0.0`) {
        throw new Error(`数据库版本 ${databaseVersion} 与旧包版本 ${legacy.version} 不一致`);
    }
    const existingPackage = parseExistingPackage(entries["package.json"]);
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
    delete entries["nbook-package.json"];
    entries["package.json"] = strToU8(`${JSON.stringify(packageJson, null, 4)}\n`);
    const migrated = zipSync(entries);
    parseWorkshopPackage(migrated);
    return {bytes: migrated, changed: true};
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

/** 解析已有 package.json；旧 Skill 可借此保留 dependencies、scripts 与 bin。 */
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

/** 判断 JSON 值是否为普通对象。 */
function isObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
