import type {CommentDto} from "../../../../../shared/dto/workshop.dto";
import {requireCurrentUser} from "../../../../utils/auth";
import {prisma} from "../../../../database/prisma";
import {requirePublishedItem, requireSlugParam, toCommentDto} from "../../../../utils/workshop";
import {CreateCommentRequestSchema} from "../../../../utils/workshop-dto";
import {validateBody} from "../../../../utils/dto";
import {consumeRateLimit, envRateLimit} from "../../../../utils/rate-limit";
import {apiError} from "../../../../utils/api-error";

/**
 * 发表评论：纯文本、扁平一级，登录即可（与完全信任口径一致，无审核）。
 */
export default defineEventHandler(async (event): Promise<CommentDto> => {
    const user = await requireCurrentUser(event);
    if (!consumeRateLimit(`comment:${user.id}`, envRateLimit("NB_COMMENT_RATE_LIMIT", 30), 10 * 60 * 1000)) {
        throw apiError(429, "rate_limit_exceeded", "Comment rate limit exceeded");
    }
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);
    const body = await validateBody(event, CreateCommentRequestSchema);

    const comment = await prisma.comment.create({
        data: {itemId: item.id, authorId: user.id, content: body.content},
        include: {author: true},
    });

    return toCommentDto(comment);
});
