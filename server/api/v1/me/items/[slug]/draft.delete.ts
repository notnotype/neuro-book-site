import {prisma} from "../../../../../database/prisma";
import {requireAccess} from "../../../../../utils/passport-guard";
import {requireOwnedItem, requireSlugParam} from "../../../../../utils/workshop";

/** 删除作者自己的无版本草稿；已发布过任何版本的条目不能通过此接口删除。 */
export default defineEventHandler(async (event): Promise<void> => {
    const slug = requireSlugParam(event);
    const {user} = await requireAccess(event, "workshop:publish");
    const {item} = await requireOwnedItem(event, slug, user);
    const result = await prisma.workshopItem.deleteMany({
        where: {id: item.id, authorId: user.id, versions: {none: {}}},
    });
    if (result.count === 0) {
        throw createError({statusCode: 409, message: "只有尚未上传首版的草稿可以删除"});
    }
    setResponseStatus(event, 204);
});
