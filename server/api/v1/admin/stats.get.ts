import type {AdminStatsDto} from "../../../../shared/dto/admin.dto";
import {prisma} from "../../../database/prisma";
import {requireAdmin} from "../../../utils/workshop";

/**
 * admin 站点统计概览：一把 aggregate 出全部数字卡片，无图表。
 */
export default defineEventHandler(async (event): Promise<AdminStatsDto> => {
    await requireAdmin(event);
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [userTotal, userRecent30d, itemsByStatus, downloadAgg, backupAgg, reportPending, inviteUnused] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({where: {createdAt: {gte: since30d}}}),
        prisma.workshopItem.groupBy({by: ["status"], _count: {_all: true}}),
        prisma.workshopItem.aggregate({_sum: {downloadCount: true}}),
        prisma.instanceBackup.aggregate({_count: {_all: true}, _sum: {fileSize: true}}),
        prisma.report.count({where: {resolvedAt: null}}),
        prisma.inviteCode.count({where: {usedById: null}}),
    ]);

    const statusCount = (status: "published" | "unlisted" | "removed"): number =>
        itemsByStatus.find((row) => row.status === status)?._count._all ?? 0;

    return {
        userTotal,
        userRecent30d,
        itemPublished: statusCount("published"),
        itemUnlisted: statusCount("unlisted"),
        itemRemoved: statusCount("removed"),
        downloadTotal: downloadAgg._sum.downloadCount ?? 0,
        backupCount: backupAgg._count._all,
        backupBytes: backupAgg._sum.fileSize ?? 0,
        reportPending,
        inviteUnused,
    };
});
