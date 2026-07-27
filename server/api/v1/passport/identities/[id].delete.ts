import {prisma} from "../../../../database/prisma";
import {requireCurrentUser} from "../../../../utils/auth";

/**
 * 解绑上游 OAuth 身份（spec §5.2）。
 * 守卫：账号未设密码（OAuth 免密账号）时拒绝——解绑会移除唯一登录方式导致账号失联，
 * 须先经 POST /api/v1/me/password 补设密码。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    const id = Number.parseInt(getRouterParam(event, "id") ?? "", 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw createError({statusCode: 400, message: "无效的身份 id"});
    }

    const identity = await prisma.passportIdentity.findUnique({where: {id}});
    if (!identity || identity.userId !== user.id) {
        throw createError({statusCode: 404, message: "身份不存在"});
    }
    if (user.passwordHash === null) {
        throw createError({statusCode: 400, message: "当前账号未设置密码，解绑后将无法登录。请先在账号设置中设置密码"});
    }

    await prisma.passportIdentity.delete({where: {id}});
    return {ok: true};
});
