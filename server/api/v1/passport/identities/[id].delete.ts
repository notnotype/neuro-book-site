import {prisma} from "../../../../database/prisma";
import {requireCurrentUser} from "../../../../utils/auth";
import {apiError} from "../../../../utils/api-error";

/**
 * 解绑上游 OAuth 身份（spec §5.2）。
 * 守卫：账号未设密码（OAuth 免密账号）时拒绝——解绑会移除唯一登录方式导致账号失联，
 * 须先经 POST /api/v1/me/password 补设密码。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    const id = Number.parseInt(getRouterParam(event, "id") ?? "", 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw apiError(400, "validation_failed", "Invalid identity id");
    }

    const identity = await prisma.passportIdentity.findUnique({where: {id}});
    if (!identity || identity.userId !== user.id) {
        throw apiError(404, "identity_not_found", "Identity not found");
    }
    if (user.passwordHash === null) {
        throw apiError(400, "password_required_before_unlink", "A password is required before unlinking the only sign-in method");
    }

    await prisma.passportIdentity.delete({where: {id}});
    return {ok: true};
});
