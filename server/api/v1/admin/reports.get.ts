import type {PageDto, ReportDto} from "../../../../shared/dto/workshop.dto";
import {prisma} from "../../../database/prisma";
import {buildPage, requireAdmin, toReportDto} from "../../../utils/workshop";
import {PageQuerySchema, validateQuery} from "../../../utils/workshop-dto";

/**
 * admin 举报列表：未处理的在前，其余按时间倒序分页。
 */
export default defineEventHandler(async (event): Promise<PageDto<ReportDto>> => {
    await requireAdmin(event);
    const query = validateQuery(event, PageQuerySchema);

    const [total, reports] = await Promise.all([
        prisma.report.count(),
        prisma.report.findMany({
            // SQLite ASC 排序时 NULL 最小排最前，天然实现"未处理在前"
            orderBy: [{resolvedAt: "asc"}, {createdAt: "desc"}],
            skip: query.offset,
            take: query.limit,
            include: {item: true, reporter: true},
        }),
    ]);

    return buildPage(reports.map(toReportDto), total, query.offset, query.limit);
});
