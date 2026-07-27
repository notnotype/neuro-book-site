import type {ItemVersionDto} from "../../../../../shared/dto/workshop.dto";
import {prisma} from "../../../../database/prisma";
import {requirePublishedItem, requireSlugParam, toVersionDto} from "../../../../utils/workshop";

/**
 * 版本历史：公开可见，按 version 倒序返回全部版本。
 */
export default defineEventHandler(async (event): Promise<ItemVersionDto[]> => {
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);

    const versions = await prisma.itemVersion.findMany({
        where: {itemId: item.id},
        orderBy: {version: "desc"},
    });

    return versions.map(toVersionDto);
});
