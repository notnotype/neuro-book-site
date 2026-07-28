import type {PublicUserDto} from "../../../../shared/dto/workshop.dto";
import {prisma} from "../../../database/prisma";
import {itemDtoInclude, toItemDto} from "../../../utils/workshop";

/**
 * 作者公开页：资料 + 其全部 published 条目（unlisted / removed 不出现）。
 */
export default defineEventHandler(async (event): Promise<PublicUserDto> => {
    const username = getRouterParam(event, "username");
    if (!username) {
        throw createError({statusCode: 400, message: "缺少 username 参数"});
    }

    const user = await prisma.user.findUnique({where: {username}});
    if (!user || user.status !== "active") {
        throw createError({statusCode: 404, message: "用户不存在"});
    }

    const items = await prisma.workshopItem.findMany({
        where: {authorId: user.id, status: "published", versions: {some: {}}},
        orderBy: {updatedAt: "desc"},
        include: itemDtoInclude,
    });

    return {
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        websiteUrl: user.websiteUrl,
        joinedAt: user.createdAt.toISOString(),
        items: items.map((item) => toItemDto(item)),
    };
});
