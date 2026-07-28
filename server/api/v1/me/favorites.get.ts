import type {PageDto, WorkshopItemDto} from "../../../../shared/dto/workshop.dto";
import {requireCurrentUser} from "../../../utils/auth";
import {prisma} from "../../../database/prisma";
import {buildPage, itemDtoInclude, toItemDto} from "../../../utils/workshop";
import {PageQuerySchema, validateQuery} from "../../../utils/workshop-dto";

/**
 * 我的收藏列表：按收藏时间倒序分页；被下架（unlisted / removed）的条目不返回，与公开面不可达口径一致。
 */
export default defineEventHandler(async (event): Promise<PageDto<WorkshopItemDto>> => {
    const user = await requireCurrentUser(event);
    const query = validateQuery(event, PageQuerySchema);

    const where = {userId: user.id, item: {status: "published" as const, versions: {some: {}}}};
    const [total, favorites] = await Promise.all([
        prisma.favorite.count({where}),
        prisma.favorite.findMany({
            where,
            orderBy: {createdAt: "desc"},
            skip: query.offset,
            take: query.limit,
            include: {item: {include: itemDtoInclude}},
        }),
    ]);

    return buildPage(favorites.map((favorite) => toItemDto(favorite.item)), total, query.offset, query.limit);
});
