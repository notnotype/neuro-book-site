import {mkdir, rename, rm} from "node:fs/promises";
import {dirname} from "node:path";
import type {BackupDto} from "../../../../shared/dto/backup.dto";
import type {InstanceBackup} from "../../../database/prisma";
import {prisma} from "../../../database/prisma";
import {backupDir, backupFilePath, backupMaxCount, backupQuotaBytes} from "../../../utils/backup-files";
import {parseBackupUpload} from "../../../utils/backup-upload";
import {buildQuotaDto, toBackupDto} from "../../../utils/backup-dto";
import {requireAccess} from "../../../utils/passport-guard";
import {useStorageCapacityService} from "../../../utils/storage-capacity";
import {consumeRateLimit, envRateLimit} from "../../../utils/rate-limit";

/**
 * 上传备份（spec §9.2，backup:write）。流程：流式收文件到 tmp（边算 sha256）
 * → 与 meta.sha256 比对 → 交互式事务内查配额（不足且 rotate 则淘汰同 instanceLabel
 * 最旧的 auto 备份腾位，manual 永不自动删）→ 落行 → 提交后 rename 落位（失败补偿删行）。
 * SQLite 单写者 + 交互事务保证并发上传不会双越配额。
 */
export default defineEventHandler(async (event): Promise<BackupDto> => {
    const access = await requireAccess(event, "backup:write");
    if (!consumeRateLimit(`backup-upload:${access.user.id}`, envRateLimit("NB_BACKUP_UPLOAD_RATE_LIMIT", 6), 60 * 60 * 1000)) {
        throw createError({
            statusCode: 429,
            message: "云备份上传过于频繁，请稍后再试",
            data: {error: "rate_limit_exceeded"},
        });
    }
    const capacity = useStorageCapacityService();
    return await capacity.withUpload(async () => {
        const declaredLength = Number.parseInt(String(event.node.req.headers["content-length"] ?? ""), 10);
        await capacity.preflight(backupDir(), Number.isSafeInteger(declaredLength) && declaredLength > 0 ? declaredLength : 0);
        const upload = await parseBackupUpload(event);

        // rotate 淘汰的行（事务提交后再 best-effort 删文件）
        const rotatedOut: InstanceBackup[] = [];
        try {
            if (upload.sha256 !== upload.meta.sha256) {
                throw createError({statusCode: 400, message: "sha256 校验不一致，归档可能在传输中损坏，请重试"});
            }
            // instanceLabel 取授权的实例名快照；面板（session）上传标记为 web
            const instanceLabel = access.authorization?.instanceName ?? "web";
            const userId = access.user.id;
            const maxBytes = backupQuotaBytes();
            const maxCount = backupMaxCount();

            const row = await prisma.$transaction(async (tx) => {
                const aggregate = await tx.instanceBackup.aggregate({
                    where: {userId},
                    _sum: {fileSize: true},
                    _count: true,
                });
                let usedBytes = aggregate._sum.fileSize ?? 0;
                let usedCount = aggregate._count;
                const over = (): boolean => usedBytes + upload.fileSize > maxBytes || usedCount + 1 > maxCount;

                if (over() && upload.meta.rotate) {
                    const candidates = await tx.instanceBackup.findMany({
                        where: {userId, instanceLabel, kind: "auto"},
                        orderBy: {createdAt: "asc"},
                    });
                    for (const candidate of candidates) {
                        if (!over()) {
                            break;
                        }
                        await tx.instanceBackup.delete({where: {id: candidate.id}});
                        usedBytes -= candidate.fileSize;
                        usedCount -= 1;
                        rotatedOut.push(candidate);
                    }
                }
                if (over()) {
                    throw createError({
                        statusCode: 413,
                        message: "云端备份配额不足，请删除旧备份后重试",
                        data: {error: "quota_exceeded", quota: buildQuotaDto(usedBytes, usedCount)},
                    });
                }
                await capacity.assertCanStore({
                    targetRoot: backupDir(),
                    incomingBytes: upload.fileSize,
                    temporaryAlreadyAllocated: true,
                    executor: tx,
                });

                const created = await tx.instanceBackup.create({
                    data: {
                        userId,
                        instanceLabel,
                        kind: upload.meta.kind,
                        fileSize: upload.fileSize,
                        sha256: upload.sha256,
                        keyId: upload.meta.keyId,
                        appVersion: upload.meta.appVersion,
                        comment: upload.meta.comment,
                        storagePath: "",
                    },
                });
                // storagePath 依赖自增 id，同事务内回写。
                return await tx.instanceBackup.update({
                    where: {id: created.id},
                    data: {storagePath: `${userId}/${created.id}.nbbackup`},
                });
            });

            // 先库后盘：rename 失败补偿删行，避免"库里有备份但文件 404"的半成品
            const finalPath = backupFilePath(row.storagePath);
            await mkdir(dirname(finalPath), {recursive: true});
            try {
                await rename(upload.tmpPath, finalPath);
            } catch (error) {
                await prisma.instanceBackup.delete({where: {id: row.id}}).catch(() => undefined);
                throw error;
            }

            // rotate 淘汰的孤儿文件 best-effort 清理（行已删，残留文件无害）
            for (const candidate of rotatedOut) {
                if (candidate.storagePath) {
                    await rm(backupFilePath(candidate.storagePath), {force: true}).catch(() => undefined);
                }
            }
            return toBackupDto(row);
        } catch (error) {
            await rm(upload.tmpPath, {force: true}).catch(() => undefined);
            throw error;
        }
    });
});
