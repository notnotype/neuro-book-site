import type {PageDto} from "../../../../shared/dto/workshop.dto";
import type {RegistrationCodeDto} from "../../../../shared/dto/access-code.dto";
import {prisma} from "../../../database/prisma";
import {toAccessCodeDto} from "../../../utils/access-code";
import {PageQuerySchema, validateQuery} from "../../../utils/workshop-dto";
import {buildPage, requireAdmin} from "../../../utils/workshop";

/** 管理员注册码列表：新签发优先，分页返回全部状态。 */
export default defineEventHandler(async (event): Promise<PageDto<RegistrationCodeDto>> => {
    await requireAdmin(event);
    const query = validateQuery(event, PageQuerySchema);
    const [total, codes] = await Promise.all([
        prisma.registrationCode.count(),
        prisma.registrationCode.findMany({orderBy: {id: "desc"}, skip: query.offset, take: query.limit}),
    ]);
    return buildPage(codes.map(toAccessCodeDto), total, query.offset, query.limit);
});
