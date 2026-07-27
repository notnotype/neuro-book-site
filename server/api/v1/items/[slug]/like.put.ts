import type {LikeStateDto} from "../../../../../shared/dto/workshop.dto";
import {requireCurrentUser} from "../../../../utils/auth";
import {Prisma, prisma} from "../../../../database/prisma";
import {requirePublishedItem, requireSlugParam} from "../../../../utils/workshop";

/**
 * 点赞（幂等）：重复点赞不报错也不重复计数。
 */
export default defineEventHandler(async (event): Promise<LikeStateDto> => {
    const user = await requireCurrentUser(event);
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);

    // SQLite 不支持 createMany skipDuplicates：用唯一约束冲突（P2002）识别"已点过赞"
    let createdNew = false;
    try {
        await prisma.like.create({data: {userId: user.id, itemId: item.id}});
        createdNew = true;
    } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
            throw error;
        }
    }

    const updated = createdNew
        ? await prisma.workshopItem.update({where: {id: item.id}, data: {likeCount: {increment: 1}}, select: {likeCount: true}})
        : {likeCount: item.likeCount};

    return {liked: true, likeCount: updated.likeCount};
});
