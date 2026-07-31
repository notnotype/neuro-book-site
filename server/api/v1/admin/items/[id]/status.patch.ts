import type {WorkshopItemDto} from "../../../../../../shared/dto/workshop.dto";
import {prisma} from "../../../../../database/prisma";
import {itemDtoInclude, requireAdmin, requireIdParam, toItemDto} from "../../../../../utils/workshop";
import {AdminItemStatusRequestSchema} from "../../../../../utils/workshop-dto";
import {validateBody} from "../../../../../utils/dto";
import {apiError} from "../../../../../utils/api-error";

/**
 * admin 下架（removed）/ 恢复（published）条目：不受作者 status 限制。
 */
export default defineEventHandler(async (event): Promise<WorkshopItemDto> => {
    await requireAdmin(event);
    const id = requireIdParam(event);
    const body = await validateBody(event, AdminItemStatusRequestSchema);

    const item = await prisma.workshopItem.findUnique({where: {id}, select: {id: true, _count: {select: {versions: true}}}});
    if (!item) {
        throw apiError(404, "item_not_found", "Item not found");
    }
    if (body.status === "published" && item._count.versions === 0) {
        throw apiError(409, "first_version_required", "First version is required before publishing");
    }

    const updated = await prisma.workshopItem.update({
        where: {id},
        data: {status: body.status},
        include: itemDtoInclude,
    });

    return toItemDto(updated);
});
