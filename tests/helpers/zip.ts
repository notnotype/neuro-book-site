import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {strToU8, zipSync} from "fflate";
import type {AgentAssetPackageJson, AgentAssetType} from "../../shared/agent-asset-package";

// 测试专用：构造 Workshop 资产包 zip 的小工具。

/**
 * 递归读取目录为 zip 条目集合（键为 / 分隔的相对路径，与包内布局一致）。
 */
export function readDirAsZipEntries(dir: string, prefix = ""): Record<string, Uint8Array> {
    const entries: Record<string, Uint8Array> = {};
    for (const name of readdirSync(dir)) {
        const fullPath = join(dir, name);
        const key = prefix ? `${prefix}/${name}` : name;
        if (statSync(fullPath).isDirectory()) {
            Object.assign(entries, readDirAsZipEntries(fullPath, key));
        } else {
            entries[key] = readFileSync(fullPath);
        }
    }
    return entries;
}

/**
 * 构造资产包 zip。
 * @param packageJson 写入根部 package.json 的对象；传 null 表示刻意不带 package.json（拒绝用例）。
 */
export function buildPackageZip(packageJson: object | null, entries: Record<string, Uint8Array>): Uint8Array {
    const all: Record<string, Uint8Array> = {...entries};
    if (packageJson !== null) {
        all["package.json"] = strToU8(JSON.stringify(packageJson, null, 4));
    }
    return zipSync(all);
}

/** 构造 HTTP 集成测试使用的最小统一包清单。 */
export function agentPackage(
    assetType: AgentAssetType,
    name: string,
    version: string,
    minAppVersion?: string,
): AgentAssetPackageJson {
    return {
        name,
        version,
        type: "module",
        neurobook: {
            schemaVersion: 1,
            assetType,
            ...(minAppVersion ? {minAppVersion} : {}),
        },
    };
}
