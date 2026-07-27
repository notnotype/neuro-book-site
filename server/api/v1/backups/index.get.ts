import type {BackupListDto} from "../../../../shared/dto/backup.dto";
import {prisma} from "../../../database/prisma";
import {buildQuotaDto, ListBackupsQuerySchema, toBackupDto} from "../../../utils/backup-dto";
import {requireAccess} from "../../../utils/passport-guard";
import {validateQuery} from "../../../utils/workshop-dto";

/**
 * 备份列表（spec §9.2，backup:read）：按 createdAt 倒序，支持 instanceLabel 过滤。
 * 响应附配额用量（全账号口径，不受过滤影响），面板用量条与实例端预检共用。
 */
export default defineEventHandler(async (event): Promise<BackupListDto> => {
    const {user} = await requireAccess(event, "backup:read");
    const query = validateQuery(event, ListBackupsQuerySchema);

    const [rows, aggregate] = await Promise.all([
        prisma.instanceBackup.findMany({
            where: {userId: user.id, ...(query.instanceLabel ? {instanceLabel: query.instanceLabel} : {})},
            orderBy: {createdAt: "desc"},
        }),
        prisma.instanceBackup.aggregate({where: {userId: user.id}, _sum: {fileSize: true}, _count: true}),
    ]);

    return {
        items: rows.map((row) => toBackupDto(row)),
        quota: buildQuotaDto(aggregate._sum.fileSize ?? 0, aggregate._count),
    };
});
