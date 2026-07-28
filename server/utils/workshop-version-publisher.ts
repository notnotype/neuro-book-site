import type {AgentAssetPackageJson} from "../../shared/agent-asset-package";
import {packageRunsCode} from "../../shared/agent-asset-package";
import {createError} from "h3";
import type {ItemVersion, WorkshopItem} from "../database/prisma";
import {Prisma, prisma} from "../database/prisma";
import type {UpdateItemRequest} from "./workshop-dto";
import {commitVersionZip, removeVersionZip, versionZipExists} from "./workshop-files";
import {siteLogger} from "./site-logger";

export type VersionPublishInput = {
    item: WorkshopItem;
    ordinal: number;
    latestVersion: string | null;
    packageJson: AgentAssetPackageJson;
    tmpPath: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    changelog: string;
    metadata?: UpdateItemRequest;
};

/**
 * 版本提交边界：先把已经 fsync 的归档原子落位，再用单个数据库事务提交版本和条目元数据。
 * 进程崩溃最多留下数据库无记录的确定性孤儿文件。
 */
export async function publishWorkshopVersion(input: VersionPublishInput): Promise<ItemVersion> {
    const existing = await prisma.itemVersion.findUnique({
        where: {itemId_ordinal: {itemId: input.item.id, ordinal: input.ordinal}},
        select: {id: true},
    });
    const archiveExists = await versionZipExists(input.item.id, input.ordinal);
    if (existing) {
        if (!archiveExists) {
            throw createError({statusCode: 500, message: "版本数据库记录对应的归档缺失，已停止发布"});
        }
        throw createError({statusCode: 409, message: "发布序号已存在，请刷新后重试"});
    }
    if (archiveExists) {
        await removeVersionZip(input.item.id, input.ordinal);
        siteLogger.warn({event: "workshop.version.orphan_removed", itemId: input.item.id, ordinal: input.ordinal}, "removed proven orphan archive");
    }

    await commitVersionZip(input.tmpPath, input.item.id, input.ordinal);
    try {
        return await prisma.$transaction(async (transaction) => {
            const version = await transaction.itemVersion.create({
                data: {
                    itemId: input.item.id,
                    ordinal: input.ordinal,
                    version: input.packageJson.version,
                    packageSchemaVersion: 1,
                    changelog: input.changelog,
                    fileName: input.fileName || `${input.item.slug}-v${input.packageJson.version}.zip`,
                    fileSize: input.fileSize,
                    sha256: input.sha256,
                    minAppVersion: input.packageJson.neurobook.minAppVersion ?? null,
                    containsExecutableCode: packageRunsCode(input.packageJson),
                },
            });
            const firstVersion = input.latestVersion === null;
            const metadata = input.metadata;
            await transaction.workshopItem.update({
                where: {id: input.item.id},
                data: {
                    ...(firstVersion ? {name: input.packageJson.name, status: "published" as const} : {}),
                    ...(metadata?.title !== undefined ? {title: metadata.title} : {}),
                    ...(metadata?.summary !== undefined ? {summary: metadata.summary} : {}),
                    ...(metadata?.description !== undefined ? {description: metadata.description} : {}),
                    ...(metadata?.tags !== undefined ? {tagsJson: JSON.stringify(metadata.tags)} : {}),
                    ...(!firstVersion && metadata?.status !== undefined ? {status: metadata.status} : {}),
                },
            });
            return version;
        });
    } catch (error) {
        try {
            await removeVersionZip(input.item.id, input.ordinal);
        } catch (cleanupError) {
            siteLogger.error({
                event: "workshop.version.rollback_failed",
                itemId: input.item.id,
                ordinal: input.ordinal,
                errorType: cleanupError instanceof Error ? cleanupError.name : "unknown",
            }, "failed to remove archive after database rollback");
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw createError({statusCode: 409, message: `version ${input.packageJson.version} 或发布序号已存在，请刷新后重试`});
        }
        throw error;
    }
}
