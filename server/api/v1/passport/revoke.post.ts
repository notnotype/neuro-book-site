import {prisma} from "../../../database/prisma";
import {validateBody} from "../../../utils/dto";
import {hashToken, revokeAuthorizationChain} from "../../../utils/passport";
import {RevokeRequestSchema} from "../../../utils/passport-dto";

/**
 * 实例主动注销（spec §6.5，匿名）：吊销 refresh token 所属整条授权链。
 * 幂等：无论 token 是否有效都返回 200，不泄露 token 存在性。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const body = await validateBody(event, RevokeRequestSchema);
    const token = await prisma.passportToken.findUnique({where: {tokenHash: hashToken(body.refreshToken)}});
    if (token && token.kind === "refresh") {
        await revokeAuthorizationChain(token.authorizationId);
    }
    return {ok: true};
});
