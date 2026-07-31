import {requireCurrentUser, setAuthSession, toAuthUser} from "../../../utils/auth";
import {ChangePasswordRequestDtoSchema, validateBody} from "../../../utils/dto";
import {hashUserPassword, verifyUserPassword} from "../../../utils/password";
import {consumeRateLimit, envRateLimit} from "../../../utils/rate-limit";
import {prisma} from "../../../database/prisma";
import {apiError} from "../../../utils/api-error";

/**
 * 修改密码（spec §5.1，cookie session 专属）。
 * 已有密码必须验旧密；无密码账号（OAuth 注册）免旧密补设，由此获得密码登录能力并解锁解绑。
 * 成功后 sessionVersion+1 踢掉其他设备的在线会话，随后重写当前会话保活（顺序不能反）。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    if (!consumeRateLimit(`password:${user.id}`, envRateLimit("NB_PASSWORD_RATE_LIMIT", 5), 60 * 60 * 1000)) {
        throw apiError(429, "rate_limit_exceeded", "Password change rate limit exceeded");
    }
    const body = await validateBody(event, ChangePasswordRequestDtoSchema);

    if (user.passwordHash !== null) {
        const matched = body.currentPassword
            ? await verifyUserPassword(body.currentPassword, user.passwordHash)
            : false;
        if (!matched) {
            throw apiError(401, "current_password_invalid", "Current password is invalid", {field: "currentPassword"});
        }
    }

    const updated = await prisma.user.update({
        where: {id: user.id},
        data: {
            passwordHash: await hashUserPassword(body.newPassword),
            sessionVersion: user.sessionVersion + 1,
        },
    });
    await setAuthSession(event, toAuthUser(updated));
    return {ok: true};
});
