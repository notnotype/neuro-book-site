import type {FavoriteStateDto} from "../../../../../shared/dto/workshop.dto";
import {requireCurrentUser} from "../../../../utils/auth";
import {prisma} from "../../../../database/prisma";
import {requireItemBySlug, requireSlugParam} from "../../../../utils/workshop";

/**
 * 取消收藏（幂等）：不限条目 status——条目下架后用户仍可清理自己的收藏。
 */
export default defineEventHandler(async (event): Promise<FavoriteStateDto> => {
    const user = await requireCurrentUser(event);
    const slug = requireSlugParam(event);
    const item = await requireItemBySlug(slug);

    await prisma.favorite.deleteMany({where: {userId: user.id, itemId: item.id}});

    return {favorited: false};
});
