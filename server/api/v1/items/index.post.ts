import type {WorkshopItemDto} from "../../../../shared/dto/workshop.dto";
import {requireAccess} from "../../../utils/passport-guard";
import {Prisma, prisma} from "../../../database/prisma";
import {itemDtoInclude, toItemDto} from "../../../utils/workshop";
import {CreateItemRequestSchema} from "../../../utils/workshop-dto";
import {validateBody} from "../../../utils/dto";
import {apiError} from "../../../utils/api-error";

/**
 * 创建条目（仅元数据）：安装名 name 此时为空，待首版上传时从 manifest 落库。
 * cookie session 与 Bearer（workshop:publish）等价接受。
 */
export default defineEventHandler(async (event): Promise<WorkshopItemDto> => {
    const {user} = await requireAccess(event, "workshop:publish");
    const body = await validateBody(event, CreateItemRequestSchema);

    // 预检查只为常见路径友好报错；并发抢注由 slug 唯一约束兜底
    const existing = await prisma.workshopItem.findUnique({where: {slug: body.slug}, select: {id: true}});
    if (existing) {
        throw apiError(409, "slug_taken", "Slug already exists", {field: "slug"});
    }

    try {
        const item = await prisma.workshopItem.create({
            data: {
                slug: body.slug,
                name: "",
                type: body.type,
                title: body.title,
                summary: body.summary,
                description: body.description,
                tagsJson: JSON.stringify(body.tags),
                authorId: user.id,
                status: "unlisted",
            },
            include: itemDtoInclude,
        });
        return toItemDto(item);
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw apiError(409, "slug_taken", "Slug already exists", {field: "slug"});
        }
        throw error;
    }
});
