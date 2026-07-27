import type {PageDto} from "../../../../shared/dto/workshop.dto";
import type {AdminBackupDto} from "../../../../shared/dto/admin.dto";
import {prisma} from "../../../database/prisma";
import {buildPage, requireAdmin} from "../../../utils/workshop";
import {AdminBackupsQuerySchema} from "../../../utils/admin-dto";
import {validateQuery} from "../../../utils/workshop-dto";

/**
 * admin 备份行列表：可按归属用户过滤，按创建时间倒序分页。配合 DELETE /admin/backups/:id 清理异常备份。
 */
export default defineEventHandler(async (event): Promise<PageDto<AdminBackupDto>> => {
    await requireAdmin(event);
    const query = validateQuery(event, AdminBackupsQuerySchema);

    const where = query.userId ? {userId: query.userId} : {};
    const [total, backups] = await Promise.all([
        prisma.instanceBackup.count({where}),
        prisma.instanceBackup.findMany({
            where,
            orderBy: {createdAt: "desc"},
            skip: query.offset,
            take: query.limit,
            include: {user: {select: {username: true}}},
        }),
    ]);

    const items = backups.map((backup): AdminBackupDto => ({
        id: backup.id,
        userId: backup.userId,
        username: backup.user.username,
        instanceLabel: backup.instanceLabel,
        kind: backup.kind as AdminBackupDto["kind"],
        fileSize: backup.fileSize,
        keyId: backup.keyId,
        appVersion: backup.appVersion,
        comment: backup.comment,
        createdAt: backup.createdAt.toISOString(),
    }));
    return buildPage(items, total, query.offset, query.limit);
});
