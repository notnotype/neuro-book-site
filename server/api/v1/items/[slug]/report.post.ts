import {requireCurrentUser} from "../../../../utils/auth";
import {prisma} from "../../../../database/prisma";
import {requirePublishedItem, requireSlugParam} from "../../../../utils/workshop";
import {CreateReportRequestSchema} from "../../../../utils/workshop-dto";
import {validateBody} from "../../../../utils/dto";

/**
 * 举报条目：登录用户提交理由，等待 admin 处理（运营兜底通道）。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);
    const body = await validateBody(event, CreateReportRequestSchema);

    await prisma.report.create({
        data: {itemId: item.id, reporterId: user.id, reason: body.reason},
    });

    return {ok: true};
});
