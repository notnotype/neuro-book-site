import type {FavoriteStateDto} from "../../../../../shared/dto/workshop.dto";
import {requireCurrentUser} from "../../../../utils/auth";
import {Prisma, prisma} from "../../../../database/prisma";
import {requirePublishedItem, requireSlugParam} from "../../../../utils/workshop";

/**
 * 收藏（幂等）：私人书签，不参与公开计数。
 */
export default defineEventHandler(async (event): Promise<FavoriteStateDto> => {
    const user = await requireCurrentUser(event);
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);

    // SQLite 不支持 createMany skipDuplicates：用唯一约束冲突（P2002）实现幂等
    try {
        await prisma.favorite.create({data: {userId: user.id, itemId: item.id}});
    } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
            throw error;
        }
    }

    return {favorited: true};
});
