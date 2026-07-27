import {prisma} from "../../../../../database/prisma";
import {requireAdmin, requireIdParam} from "../../../../../utils/workshop";
import {AdminUserStatusRequestSchema} from "../../../../../utils/admin-dto";
import {validateBody} from "../../../../../utils/dto";

/**
 * admin 封禁 / 解封用户。
 * 封禁 = status→disabled 且 sessionVersion+1：在线 cookie session 立即失效（getCurrentUser 双重校验），
 * Bearer 面由 passport-guard 的 user active 检查同步拒绝，无需额外吊销。
 * 禁止操作自己：防止唯一管理员把自己封出局。条目不自动下架（需要时用条目管理单独 removed）。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const admin = await requireAdmin(event);
    const id = requireIdParam(event);
    const body = await validateBody(event, AdminUserStatusRequestSchema);

    if (id === admin.id) {
        throw createError({statusCode: 400, message: "不能封禁或解封自己"});
    }
    const target = await prisma.user.findUnique({where: {id}, select: {id: true, sessionVersion: true}});
    if (!target) {
        throw createError({statusCode: 404, message: "用户不存在"});
    }

    await prisma.user.update({
        where: {id},
        data: {
            status: body.status,
            // 仅封禁时踢线；解封不动 sessionVersion（被封时会话早已失效，无线可踢）
            ...(body.status === "disabled" ? {sessionVersion: target.sessionVersion + 1} : {}),
        },
    });
    return {ok: true};
});
