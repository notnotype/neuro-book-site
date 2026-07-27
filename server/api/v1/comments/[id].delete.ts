import {requireCurrentUser} from "../../../utils/auth";
import {prisma} from "../../../database/prisma";
import {requireIdParam} from "../../../utils/workshop";

/**
 * 删除评论（软删）：本人或 admin；已删除的评论视同不存在。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    const id = requireIdParam(event);

    const comment = await prisma.comment.findUnique({where: {id}});
    if (!comment || comment.deletedAt !== null) {
        throw createError({statusCode: 404, message: "评论不存在"});
    }
    if (comment.authorId !== user.id && user.role !== "admin") {
        throw createError({statusCode: 403, message: "只有评论作者或管理员可以删除评论"});
    }

    await prisma.comment.update({where: {id}, data: {deletedAt: new Date()}});
    return {ok: true};
});
