import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import type {FileHandle} from "node:fs/promises";
import {access, mkdtemp, open, readdir, rename, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, dirname, join} from "node:path";
import {createClient, type Row} from "@libsql/client";
import {packageRunsCode} from "../../shared/agent-asset-package";
import {prisma} from "../database/prisma";
import {readAllAgentAssetArchiveEntries} from "./agent-asset-archive";
import {migrateAgentAssetEntries} from "./agent-asset-migration";
import {parseWorkshopPackageFile} from "./workshop-package";
import {versionZipPath, workshopFilesDir} from "./workshop-files";

export type AgentAssetMaintenanceReport = {
    checked: number;
    migrated: number;
    recovered: number;
    cleaned: number;
    metadataUpdated: number;
    actions: string[];
};

type VersionRow = {
    id: number;
    itemId: number;
    ordinal: number;
    version: string;
    packageSchemaVersion: number;
    fileSize: number;
    sha256: string;
    containsExecutableCode: boolean;
};

/** 完整只读预检或可恢复迁移；apply=false 保证不写文件和数据库。 */
export async function maintainAgentAssetArchives(apply: boolean): Promise<AgentAssetMaintenanceReport> {
    const versions = apply ? await readCurrentVersions() : await readPreflightVersions();
    const report: AgentAssetMaintenanceReport = {checked: 0, migrated: 0, recovered: 0, cleaned: 0, metadataUpdated: 0, actions: []};
    for (const version of versions) {
        report.checked += 1;
        await maintainVersion(version, apply, report);
    }
    await handleOrphans(versions, apply, report);
    return report;
}

/** readiness 使用的轻量检查：不计算 SHA，也不解压归档。 */
export async function assertAgentAssetArchivesReady(): Promise<void> {
    const versions = await readCurrentVersions();
    for (const version of versions) {
        if (version.packageSchemaVersion !== 1) {
            throw new Error(`版本 ${version.id} 仍待归档迁移`);
        }
        const finalPath = versionZipPath(version.itemId, version.ordinal);
        const info = await stat(finalPath).catch(() => null);
        if (!info?.isFile() || info.size !== version.fileSize) {
            throw new Error(`版本 ${version.id} 的正式归档缺失或大小不匹配`);
        }
        const sidecars = sidecarPaths(version);
        if (await exists(sidecars.temporary) || await exists(sidecars.backup)) {
            throw new Error(`版本 ${version.id} 存在未收口迁移 sidecar`);
        }
    }
}

async function readCurrentVersions(): Promise<VersionRow[]> {
    return await prisma.itemVersion.findMany({
        orderBy: [{itemId: "asc"}, {ordinal: "asc"}],
        select: {
            id: true,
            itemId: true,
            ordinal: true,
            version: true,
            packageSchemaVersion: true,
            fileSize: true,
            sha256: true,
            containsExecutableCode: true,
        },
    });
}

/**
 * 停站前 preflight 必须能读取尚未执行 Task 01 Prisma migration 的生产表。
 * 这里只做 SELECT，并由升级脚本把数据卷以只读方式挂载，数据库形状不会被探针推进。
 */
async function readPreflightVersions(): Promise<VersionRow[]> {
    const client = createClient({url: process.env.DATABASE_URL?.trim() || "file:./data.db"});
    try {
        const tableInfo = await client.execute('PRAGMA table_info("ItemVersion")');
        const columns = new Set(tableInfo.rows.map((row) => readString(row, "name")));
        if (!columns.has("id") || !columns.has("itemId") || !columns.has("version")
            || !columns.has("fileSize") || !columns.has("sha256")) {
            throw new Error("ItemVersion 表结构无法识别，停止 Agent 资产 preflight");
        }
        if (!columns.has("ordinal")) {
            const result = await client.execute(
                "SELECT id, itemId, version AS legacyVersion, fileSize, sha256 FROM ItemVersion ORDER BY itemId, version",
            );
            return result.rows.map((row) => {
                const ordinal = readPositiveInteger(row, "legacyVersion");
                return {
                    id: readPositiveInteger(row, "id"),
                    itemId: readPositiveInteger(row, "itemId"),
                    ordinal,
                    version: `${ordinal}.0.0`,
                    packageSchemaVersion: 0,
                    fileSize: readNonNegativeInteger(row, "fileSize"),
                    sha256: readString(row, "sha256"),
                    containsExecutableCode: true,
                };
            });
        }
        if (!columns.has("packageSchemaVersion")) {
            throw new Error("ItemVersion 已有 ordinal 但缺少 packageSchemaVersion，结构处于未知状态");
        }
        const riskSelect = columns.has("containsExecutableCode") ? "containsExecutableCode" : "1 AS containsExecutableCode";
        const result = await client.execute(
            `SELECT id, itemId, ordinal, version, packageSchemaVersion, fileSize, sha256, ${riskSelect} FROM ItemVersion ORDER BY itemId, ordinal`,
        );
        return result.rows.map((row) => ({
            id: readPositiveInteger(row, "id"),
            itemId: readPositiveInteger(row, "itemId"),
            ordinal: readPositiveInteger(row, "ordinal"),
            version: readString(row, "version"),
            packageSchemaVersion: readNonNegativeInteger(row, "packageSchemaVersion"),
            fileSize: readNonNegativeInteger(row, "fileSize"),
            sha256: readString(row, "sha256"),
            containsExecutableCode: readNonNegativeInteger(row, "containsExecutableCode") !== 0,
        }));
    } finally {
        client.close();
    }
}

async function maintainVersion(version: VersionRow, apply: boolean, report: AgentAssetMaintenanceReport): Promise<void> {
    if (version.packageSchemaVersion !== 0 && version.packageSchemaVersion !== 1) {
        throw new Error(`版本 ${version.id} 使用未知 packageSchemaVersion=${version.packageSchemaVersion}`);
    }
    const finalPath = versionZipPath(version.itemId, version.ordinal);
    const sidecars = sidecarPaths(version);
    if (version.packageSchemaVersion === 0) {
        await recoverSchemaZero(version, finalPath, sidecars, apply, report);
        const sourcePath = await exists(sidecars.backup) ? sidecars.backup : finalPath;
        await assertFileMatches(sourcePath, version);
        const entries = await readAllAgentAssetArchiveEntries(sourcePath);
        const migrated = migrateAgentAssetEntries(entries, version.version);
        if (!migrated.changed) {
            const parsed = await parseWorkshopPackageFile(sourcePath);
            report.actions.push(`mark-schema item=${version.itemId} version=${version.version}`);
            if (apply) {
                await prisma.itemVersion.update({
                    where: {id: version.id},
                    data: {packageSchemaVersion: 1, containsExecutableCode: packageRunsCode(parsed.packageJson)},
                });
                report.metadataUpdated += 1;
            }
            return;
        }
        report.actions.push(`migrate item=${version.itemId} version=${version.version}`);
        if (!apply) {
            await validateCandidatePreflight(migrated.bytes);
            return;
        }
        await replaceArchive(version, finalPath, sidecars, migrated.bytes);
        report.migrated += 1;
        return;
    }

    await assertFileMatches(finalPath, version);
    const parsed = await parseWorkshopPackageFile(finalPath);
    const expectedRisk = packageRunsCode(parsed.packageJson);
    if (expectedRisk !== version.containsExecutableCode) {
        report.actions.push(`update-risk item=${version.itemId} version=${version.version}`);
        if (apply) {
            await prisma.itemVersion.update({where: {id: version.id}, data: {containsExecutableCode: expectedRisk}});
            report.metadataUpdated += 1;
        }
    }
    for (const path of [sidecars.temporary, sidecars.backup]) {
        if (await exists(path)) {
            report.actions.push(`remove-sidecar ${basename(path)}`);
            if (apply) {
                await rm(path, {force: true});
                await syncDirectory(dirname(path));
                report.cleaned += 1;
            }
        }
    }
}

async function recoverSchemaZero(
    version: VersionRow,
    finalPath: string,
    sidecars: ReturnType<typeof sidecarPaths>,
    apply: boolean,
    report: AgentAssetMaintenanceReport,
): Promise<void> {
    if (await exists(sidecars.backup)) {
        await assertFileMatches(sidecars.backup, version);
        report.actions.push(`restore-backup item=${version.itemId} version=${version.version}`);
        if (apply) {
            await rm(finalPath, {force: true});
            await rename(sidecars.backup, finalPath);
            await rm(sidecars.temporary, {force: true});
            await syncDirectory(dirname(finalPath));
            report.recovered += 1;
        }
        return;
    }
    await assertFileMatches(finalPath, version);
    if (await exists(sidecars.temporary)) {
        report.actions.push(`remove-stale-tmp item=${version.itemId} version=${version.version}`);
        if (apply) {
            await rm(sidecars.temporary, {force: true});
            await syncDirectory(dirname(sidecars.temporary));
            report.cleaned += 1;
        }
    }
}

async function replaceArchive(
    version: VersionRow,
    finalPath: string,
    sidecars: ReturnType<typeof sidecarPaths>,
    bytes: Uint8Array,
): Promise<void> {
    await validateCandidate(sidecars.temporary, bytes, false);
    const parsed = await parseWorkshopPackageFile(sidecars.temporary);
    const digest = createHash("sha256").update(bytes).digest("hex");
    await rename(finalPath, sidecars.backup);
    await rename(sidecars.temporary, finalPath);
    await syncDirectory(dirname(finalPath));
    try {
        await prisma.itemVersion.update({
            where: {id: version.id},
            data: {
                packageSchemaVersion: 1,
                fileSize: bytes.byteLength,
                sha256: digest,
                containsExecutableCode: packageRunsCode(parsed.packageJson),
            },
        });
    } catch (error) {
        await rm(finalPath, {force: true});
        await rename(sidecars.backup, finalPath);
        await syncDirectory(dirname(finalPath));
        throw error;
    }
    await rm(sidecars.backup, {force: true});
    await syncDirectory(dirname(finalPath));
}

async function validateCandidate(path: string, bytes: Uint8Array, removeAfter: boolean): Promise<void> {
    await rm(path, {force: true});
    const file = await open(path, "wx", 0o600);
    try {
        await file.writeFile(bytes);
        await file.sync();
    } finally {
        await file.close();
    }
    try {
        await parseWorkshopPackageFile(path);
    } catch (error) {
        await rm(path, {force: true});
        throw error;
    }
    if (removeAfter) {
        await rm(path, {force: true});
    }
}

/** preflight 只在系统临时目录验证候选，不触碰持久归档目录。 */
async function validateCandidatePreflight(bytes: Uint8Array): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "nbook-agent-asset-"));
    const path = join(directory, "candidate.zip");
    try {
        await validateCandidate(path, bytes, false);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
}

async function handleOrphans(versions: VersionRow[], apply: boolean, report: AgentAssetMaintenanceReport): Promise<void> {
    const knownArchives = new Set(versions.map((version) => `${version.itemId}/${version.ordinal}.zip`));
    const knownVersionIds = new Set(versions.map((version) => version.id));
    const root = workshopFilesDir();
    const directories = await readdir(root, {withFileTypes: true}).catch(() => []);
    for (const directory of directories) {
        if (!directory.isDirectory() || !/^\d+$/.test(directory.name)) {
            continue;
        }
        const files = await readdir(join(root, directory.name), {withFileTypes: true});
        for (const file of files) {
            if (!file.isFile()) {
                continue;
            }
            const archiveKey = `${directory.name}/${file.name}`;
            if (/^\d+\.zip$/.test(file.name) && !knownArchives.has(archiveKey)) {
                report.actions.push(`remove-orphan ${archiveKey}`);
                if (apply) {
                    await rm(join(root, archiveKey), {force: true});
                    report.cleaned += 1;
                }
                continue;
            }
            const sidecar = /^\.agent-asset-(\d+)\.(?:tmp|backup)$/.exec(file.name);
            if (sidecar && !knownVersionIds.has(Number(sidecar[1]))) {
                throw new Error(`发现无法归属数据库版本的迁移 sidecar：${archiveKey}`);
            }
        }
    }
}

function sidecarPaths(version: Pick<VersionRow, "id" | "itemId" | "ordinal">) {
    const finalPath = versionZipPath(version.itemId, version.ordinal);
    return {
        temporary: join(dirname(finalPath), `.agent-asset-${version.id}.tmp`),
        backup: join(dirname(finalPath), `.agent-asset-${version.id}.backup`),
    };
}

async function assertFileMatches(path: string, version: Pick<VersionRow, "id" | "fileSize" | "sha256">): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size !== version.fileSize) {
        throw new Error(`版本 ${version.id} 的归档缺失或大小与数据库不一致：${path}`);
    }
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(path)) {
        digest.update(chunk);
    }
    if (digest.digest("hex") !== version.sha256) {
        throw new Error(`版本 ${version.id} 的归档 SHA-256 与数据库不一致：${path}`);
    }
}

async function exists(path: string): Promise<boolean> {
    return await access(path).then(() => true).catch(() => false);
}

async function syncDirectory(path: string): Promise<void> {
    let directory: FileHandle | undefined;
    try {
        directory = await open(path, "r");
        await directory.sync();
    } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
        if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP"].includes(code)) {
            throw error;
        }
    } finally {
        await directory?.close();
    }
}

/** 外部 SQLite 行只在此边界收窄为非空字符串。 */
function readString(row: Row, field: string): string {
    const value = row[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`ItemVersion.${field} 不是非空字符串`);
    }
    return value;
}

/** 外部 SQLite 行只在此边界收窄为非负安全整数。 */
function readNonNegativeInteger(row: Row, field: string): number {
    const value = row[field];
    const number = typeof value === "bigint" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
        throw new Error(`ItemVersion.${field} 不是非负安全整数`);
    }
    return number;
}

/** 数据库主键、ordinal 与旧整数版本必须为正整数。 */
function readPositiveInteger(row: Row, field: string): number {
    const value = readNonNegativeInteger(row, field);
    if (value === 0) {
        throw new Error(`ItemVersion.${field} 必须大于 0`);
    }
    return value;
}
