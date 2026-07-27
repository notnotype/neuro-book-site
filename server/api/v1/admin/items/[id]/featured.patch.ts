import type {WorkshopItemDto} from "../../../../../../shared/dto/workshop.dto";
import {prisma} from "../../../../../database/prisma";
import {itemDtoInclude, requireAdmin, requireIdParam, toItemDto} from "../../../../../utils/workshop";
import {AdminItemFeaturedRequestSchema} from "../../../../../utils/workshop-dto";
import {validateBody} from "../../../../../utils/dto";

/**
 * admin 设置 / 取消条目精选：featured 条目进入首页「编辑推荐」分区。
 */
export default defineEventHandler(async (event): Promise<WorkshopItemDto> => {
    await requireAdmin(event);
    const id = requireIdParam(event);
    const body = await validateBody(event, AdminItemFeaturedRequestSchema);

    const item = await prisma.workshopItem.findUnique({where: {id}, select: {id: true}});
    if (!item) {
        throw createError({statusCode: 404, message: "条目不存在"});
    }

    const updated = await prisma.workshopItem.update({
        where: {id},
        data: {featured: body.featured},
        include: itemDtoInclude,
    });

    return toItemDto(updated);
});
