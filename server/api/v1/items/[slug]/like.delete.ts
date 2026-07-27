import type {LikeStateDto} from "../../../../../shared/dto/workshop.dto";
import {requireCurrentUser} from "../../../../utils/auth";
import {prisma} from "../../../../database/prisma";
import {requireItemBySlug, requireSlugParam} from "../../../../utils/workshop";

/**
 * 取消点赞（幂等）：未点过赞时不报错也不扣计数。
 * 不限条目 status——条目下架后用户仍可撤回自己的点赞，likeCount 同步维护。
 */
export default defineEventHandler(async (event): Promise<LikeStateDto> => {
    const user = await requireCurrentUser(event);
    const slug = requireSlugParam(event);
    const item = await requireItemBySlug(slug);

    const deleted = await prisma.like.deleteMany({where: {userId: user.id, itemId: item.id}});
    const updated =
        deleted.count > 0
            ? await prisma.workshopItem.update({where: {id: item.id}, data: {likeCount: {decrement: 1}}, select: {likeCount: true}})
            : {likeCount: item.likeCount};

    return {liked: false, likeCount: updated.likeCount};
});
