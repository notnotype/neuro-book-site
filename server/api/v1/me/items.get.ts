import type {PageDto, WorkshopItemDto} from "../../../../shared/dto/workshop.dto";
import {requireAccess} from "../../../utils/passport-guard";
import {prisma} from "../../../database/prisma";
import {buildPage, itemDtoInclude, toItemDto} from "../../../utils/workshop";
import {PageQuerySchema, validateQuery} from "../../../utils/workshop-dto";

/**
 * 我的发布列表：本人全部条目（含 unlisted / removed），按更新时间倒序分页。
 * 与公开面（仅 published 可见）不同，作者需要在个人页管理自己所有状态的条目。
 * cookie session 与 Bearer（workshop:publish）等价接受。
 */
export default defineEventHandler(async (event): Promise<PageDto<WorkshopItemDto>> => {
    const {user} = await requireAccess(event, "workshop:publish");
    const query = validateQuery(event, PageQuerySchema);

    const where = {authorId: user.id};
    const [total, items] = await Promise.all([
        prisma.workshopItem.count({where}),
        prisma.workshopItem.findMany({
            where,
            orderBy: {updatedAt: "desc"},
            skip: query.offset,
            take: query.limit,
            include: itemDtoInclude,
        }),
    ]);

    return buildPage(items.map((item) => toItemDto(item)), total, query.offset, query.limit);
});
