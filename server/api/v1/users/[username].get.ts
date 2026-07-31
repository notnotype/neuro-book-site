import type {PublicUserDto} from "../../../../shared/dto/workshop.dto";
import {prisma} from "../../../database/prisma";
import {itemDtoInclude, toItemDto} from "../../../utils/workshop";
import {apiError} from "../../../utils/api-error";

/**
 * 作者公开页：资料 + 其全部 published 条目（unlisted / removed 不出现）。
 */
export default defineEventHandler(async (event): Promise<PublicUserDto> => {
    const username = getRouterParam(event, "username");
    if (!username) {
        throw apiError(400, "validation_failed", "Missing username parameter");
    }

    const user = await prisma.user.findUnique({where: {username}});
    if (!user || user.status !== "active") {
        throw apiError(404, "user_not_found", "User not found");
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
