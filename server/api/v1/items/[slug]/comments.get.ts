import type {CommentDto, PageDto} from "../../../../../shared/dto/workshop.dto";
import {prisma} from "../../../../database/prisma";
import {buildPage, requirePublishedItem, requireSlugParam, toCommentDto} from "../../../../utils/workshop";
import {PageQuerySchema, validateQuery} from "../../../../utils/workshop-dto";

/**
 * 评论列表：公开可见，过滤软删，按发表时间正序（楼层序）分页。
 */
export default defineEventHandler(async (event): Promise<PageDto<CommentDto>> => {
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);
    const query = validateQuery(event, PageQuerySchema);

    const where = {itemId: item.id, deletedAt: null};
    const [total, comments] = await Promise.all([
        prisma.comment.count({where}),
        prisma.comment.findMany({where, orderBy: {createdAt: "asc"}, skip: query.offset, take: query.limit, include: {author: true}}),
    ]);

    return buildPage(comments.map(toCommentDto), total, query.offset, query.limit);
});
