import type {ReportDto} from "../../../../../../shared/dto/workshop.dto";
import {prisma} from "../../../../../database/prisma";
import {requireAdmin, requireIdParam, toReportDto} from "../../../../../utils/workshop";

/**
 * admin 处理举报：标记 resolvedAt；重复处理幂等（保留首次处理时间）。
 */
export default defineEventHandler(async (event): Promise<ReportDto> => {
    await requireAdmin(event);
    const id = requireIdParam(event);

    const report = await prisma.report.findUnique({where: {id}});
    if (!report) {
        throw createError({statusCode: 404, message: "举报不存在"});
    }

    const updated = await prisma.report.update({
        where: {id},
        data: report.resolvedAt === null ? {resolvedAt: new Date()} : {},
        include: {item: true, reporter: true},
    });

    return toReportDto(updated);
});
