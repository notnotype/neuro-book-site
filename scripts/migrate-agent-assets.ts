import {createHash, randomUUID} from "node:crypto";
import {access, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {prisma} from "../server/database/prisma";
import {migrateAgentAssetArchive} from "../server/utils/agent-asset-migration";
import {versionZipPath} from "../server/utils/workshop-files";

const apply = process.argv.includes("--apply");

/** 逐版本迁移旧 ZIP；默认 dry-run，只有显式 --apply 才落盘和更新摘要。 */
async function main(): Promise<void> {
    const versions = await prisma.itemVersion.findMany({orderBy: [{itemId: "asc"}, {ordinal: "asc"}]});
    let candidates = 0;
    for (const version of versions) {
        if (version.packageSchemaVersion >= 1) {
            console.log(`unchanged item=${version.itemId} version=${version.version} schema=${version.packageSchemaVersion}`);
            continue;
        }
        const path = versionZipPath(version.itemId, version.ordinal);
        const bytes = new Uint8Array(await readFile(path));
        const migrated = migrateAgentAssetArchive(bytes, version.version);
        candidates += 1;
        if (!migrated.changed) {
            console.log(`${apply ? "mark-migrated" : "would-mark-migrated"} item=${version.itemId} version=${version.version}`);
            if (apply) {
                await prisma.itemVersion.update({where: {id: version.id}, data: {packageSchemaVersion: 1}});
            }
            continue;
        }
        const sha256 = createHash("sha256").update(migrated.bytes).digest("hex");
        console.log(`${apply ? "migrate" : "would-migrate"} item=${version.itemId} version=${version.version} bytes=${migrated.bytes.byteLength} sha256=${sha256}`);
        if (apply) {
            await replaceArchive(path, migrated.bytes, async () => {
                await prisma.itemVersion.update({
                    where: {id: version.id},
                    data: {fileSize: migrated.bytes.byteLength, sha256, packageSchemaVersion: 1},
                });
            });
        }
    }
    console.log(`${apply ? "Migrated" : "Dry run found"} ${candidates} version(s).`);
}

/** 用同目录临时文件替换 ZIP；数据库更新失败时恢复原文件。 */
export async function replaceArchive(path: string, bytes: Uint8Array, updateDatabase: () => Promise<void>): Promise<void> {
    const suffix = randomUUID();
    const temporaryPath = join(dirname(path), `.agent-asset-${suffix}.tmp`);
    const backupPath = join(dirname(path), `.agent-asset-${suffix}.backup`);
    await access(path);
    await writeFile(temporaryPath, bytes, {mode: 0o600, flag: "wx"});
    try {
        await rename(path, backupPath);
        await rename(temporaryPath, path);
        try {
            await updateDatabase();
        } catch (error) {
            await rm(path, {force: true});
            await rename(backupPath, path);
            throw error;
        }
        await rm(backupPath, {force: true});
    } catch (error) {
        await rm(temporaryPath, {force: true}).catch(() => undefined);
        const backupExists = await access(backupPath).then(() => true).catch(() => false);
        const destinationExists = await access(path).then(() => true).catch(() => false);
        if (backupExists && !destinationExists) {
            await rename(backupPath, path);
        }
        throw error;
    }
}

if (import.meta.main) {
    await main();
}
