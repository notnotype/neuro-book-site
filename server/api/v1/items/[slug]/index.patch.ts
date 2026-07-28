import type {WorkshopItemDto} from "../../../../../shared/dto/workshop.dto";
import {prisma} from "../../../../database/prisma";
import {requireAccess} from "../../../../utils/passport-guard";
import {itemDtoInclude, requireOwnedItem, requireSlugParam, toItemDto} from "../../../../utils/workshop";
import {UpdateItemRequestSchema} from "../../../../utils/workshop-dto";
import {validateBody} from "../../../../utils/dto";

/**
 * 作者编辑条目元数据 / 自主下架与重新上架（published ↔ unlisted）。
 * removed（admin 下架）条目作者不可操作，也不可借此恢复。
 * cookie session 与 Bearer（workshop:publish）等价接受。
 */
export default defineEventHandler(async (event): Promise<WorkshopItemDto> => {
    const slug = requireSlugParam(event);
    const access = await requireAccess(event, "workshop:publish");
    const {item} = await requireOwnedItem(event, slug, access.user);
    const body = await validateBody(event, UpdateItemRequestSchema);

    if (item.status === "removed") {
        throw createError({statusCode: 403, message: "条目已被管理员下架，无法操作"});
    }
    if (body.status === "published" && item.versions.length === 0) {
        throw createError({statusCode: 409, message: "首版上传成功前不能公开条目"});
    }

    const updated = await prisma.workshopItem.update({
        where: {id: item.id},
        data: {
            ...(body.title !== undefined ? {title: body.title} : {}),
            ...(body.summary !== undefined ? {summary: body.summary} : {}),
            ...(body.description !== undefined ? {description: body.description} : {}),
            ...(body.tags !== undefined ? {tagsJson: JSON.stringify(body.tags)} : {}),
            ...(body.status !== undefined ? {status: body.status} : {}),
        },
        include: itemDtoInclude,
    });

    return toItemDto(updated);
});
