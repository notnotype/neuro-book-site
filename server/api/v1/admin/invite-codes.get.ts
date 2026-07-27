import type {InviteCodeDto, PageDto} from "../../../../shared/dto/workshop.dto";
import {prisma} from "../../../database/prisma";
import {buildPage, requireAdmin, toInviteCodeDto} from "../../../utils/workshop";
import {AdminInviteCodesQuerySchema} from "../../../utils/admin-dto";
import {validateQuery} from "../../../utils/workshop-dto";

/**
 * admin 邀请码全量列表：按使用状态过滤 + 分页，新签发的在前。
 */
export default defineEventHandler(async (event): Promise<PageDto<InviteCodeDto>> => {
    await requireAdmin(event);
    const query = validateQuery(event, AdminInviteCodesQuerySchema);

    const where = query.filter === "used"
        ? {usedById: {not: null}}
        : query.filter === "unused"
            ? {usedById: null}
            : {};
    const [total, codes] = await Promise.all([
        prisma.inviteCode.count({where}),
        prisma.inviteCode.findMany({
            where,
            orderBy: {id: "desc"},
            skip: query.offset,
            take: query.limit,
            include: {usedBy: true},
        }),
    ]);

    return buildPage(codes.map(toInviteCodeDto), total, query.offset, query.limit);
});
