import type {AdminBackupUsageDto} from "../../../../shared/dto/admin.dto";
import {prisma} from "../../../database/prisma";
import {requireAdmin} from "../../../utils/workshop";

/**
 * admin 云备份用量：按账号聚合（份数 / 总字节 / 最近备份时间），按占用倒序。
 * 站点规模下账号数有限，不分页；行内点开的具体备份走 GET /admin/backups?userId=。
 */
export default defineEventHandler(async (event): Promise<AdminBackupUsageDto[]> => {
    await requireAdmin(event);

    const grouped = await prisma.instanceBackup.groupBy({
        by: ["userId"],
        _count: {_all: true},
        _sum: {fileSize: true},
        _max: {createdAt: true},
        orderBy: {_sum: {fileSize: "desc"}},
    });
    if (grouped.length === 0) {
        return [];
    }

    const users = await prisma.user.findMany({
        where: {id: {in: grouped.map((row) => row.userId)}},
        select: {id: true, username: true},
    });
    const usernameById = new Map(users.map((user) => [user.id, user.username]));

    return grouped.map((row): AdminBackupUsageDto => ({
        userId: row.userId,
        username: usernameById.get(row.userId) ?? `#${row.userId}`,
        count: row._count._all,
        totalBytes: row._sum.fileSize ?? 0,
        latestAt: row._max.createdAt?.toISOString() ?? null,
    }));
});
