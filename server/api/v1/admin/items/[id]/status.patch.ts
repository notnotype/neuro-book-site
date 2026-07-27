import type {WorkshopItemDto} from "../../../../../../shared/dto/workshop.dto";
import {prisma} from "../../../../../database/prisma";
import {itemDtoInclude, requireAdmin, requireIdParam, toItemDto} from "../../../../../utils/workshop";
import {AdminItemStatusRequestSchema} from "../../../../../utils/workshop-dto";
import {validateBody} from "../../../../../utils/dto";

/**
 * admin 下架（removed）/ 恢复（published）条目：不受作者 status 限制。
 */
export default defineEventHandler(async (event): Promise<WorkshopItemDto> => {
    await requireAdmin(event);
    const id = requireIdParam(event);
    const body = await validateBody(event, AdminItemStatusRequestSchema);

    const item = await prisma.workshopItem.findUnique({where: {id}, select: {id: true}});
    if (!item) {
        throw createError({statusCode: 404, message: "条目不存在"});
    }

    const updated = await prisma.workshopItem.update({
        where: {id},
        data: {status: body.status},
        include: itemDtoInclude,
    });

    return toItemDto(updated);
});
