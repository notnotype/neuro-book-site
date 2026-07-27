import {prisma} from "../../../../database/prisma";
import {requireCurrentUser} from "../../../../utils/auth";
import {revokeAuthorizationChain} from "../../../../utils/passport";
import {requireIdParam} from "../../../../utils/workshop";

/**
 * 吊销实例授权（spec §8，cookie session 专属）：整条 token 链立即失效。
 * 公网实例失守时用户唯一的自救手段；对已吊销授权重复调用幂等返回 200。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    const id = requireIdParam(event);

    const authorization = await prisma.passportAuthorization.findFirst({where: {id, userId: user.id}});
    if (!authorization) {
        throw createError({statusCode: 404, message: "授权不存在"});
    }
    await revokeAuthorizationChain(authorization.id);
    return {ok: true};
});
