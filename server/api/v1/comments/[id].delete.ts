import {requireCurrentUser} from "../../../utils/auth";
import {prisma} from "../../../database/prisma";
import {requireIdParam} from "../../../utils/workshop";
import {apiError} from "../../../utils/api-error";

/**
 * 删除评论（软删）：本人或 admin；已删除的评论视同不存在。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    const id = requireIdParam(event);

    const comment = await prisma.comment.findUnique({where: {id}});
    if (!comment || comment.deletedAt !== null) {
        throw apiError(404, "comment_not_found", "Comment not found");
    }
    if (comment.authorId !== user.id && user.role !== "admin") {
        throw apiError(403, "comment_owner_required", "Only the comment author or an administrator can delete it");
    }

    await prisma.comment.update({where: {id}, data: {deletedAt: new Date()}});
    return {ok: true};
});
