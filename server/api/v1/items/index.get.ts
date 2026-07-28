import type {PageDto, WorkshopItemDto} from "../../../../shared/dto/workshop.dto";
import {Prisma, prisma} from "../../../database/prisma";
import {buildPage, itemDtoInclude, toItemDto} from "../../../utils/workshop";
import {ListItemsQuerySchema, validateQuery} from "../../../utils/workshop-dto";

/**
 * 公开条目列表：支持 q 关键词、type、tags（逗号分隔，命中任一）、sort（latest | downloads | likes）、
 * featured=1（只取精选）分页查询。
 */
export default defineEventHandler(async (event): Promise<PageDto<WorkshopItemDto>> => {
    const query = validateQuery(event, ListItemsQuerySchema);

    const where: Prisma.WorkshopItemWhereInput = {
        status: "published",
        versions: {some: {}},
        ...(query.featured ? {featured: true} : {}),
        ...(query.type ? {type: query.type} : {}),
        ...(query.q
            ? {
                  OR: [
                      {title: {contains: query.q}},
                      {summary: {contains: query.q}},
                      {slug: {contains: query.q}},
                      {name: {contains: query.q}},
                  ],
              }
            : {}),
        // tags 匹配 JSON 序列化后的带引号完整值，避免子串误命中
        ...(query.tags && query.tags.length > 0
            ? {AND: [{OR: query.tags.map((tag) => ({tagsJson: {contains: JSON.stringify(tag)}}))}]}
            : {}),
    };

    const orderBy: Prisma.WorkshopItemOrderByWithRelationInput =
        query.sort === "downloads" ? {downloadCount: "desc"} : query.sort === "likes" ? {likeCount: "desc"} : {updatedAt: "desc"};

    const [total, items] = await Promise.all([
        prisma.workshopItem.count({where}),
        prisma.workshopItem.findMany({where, orderBy, skip: query.offset, take: query.limit, include: itemDtoInclude}),
    ]);

    return buildPage(items.map((item) => toItemDto(item)), total, query.offset, query.limit);
});
