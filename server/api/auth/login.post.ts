import type {AuthSessionDto} from "../../utils/auth";
import {setAuthSession, toAuthUser} from "../../utils/auth";
import {LoginRequestDtoSchema, validateBody} from "../../utils/dto";
import {verifyUserPassword} from "../../utils/password";
import {consumeRateLimit, envRateLimit} from "../../utils/rate-limit";
import {prisma} from "../../database/prisma";
import {clientIp} from "../../utils/site-config";

/**
 * 登录并写入 session。防爆破：按 IP+用户名限频（spec §4；纯 IP 会误伤共享出口，键上用户名后
 * 单账号爆破被压死，撒网式换名爆破由注册码准入门禁兜底）。额度 env 可覆写供测试。
 * OAuth 免密账号（passwordHash 为空）与封禁账号统一走「用户名或密码错误」，不泄露账号存在性。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    const body = await validateBody(event, LoginRequestDtoSchema);
    const ip = clientIp(event);
    if (!consumeRateLimit(`login:${ip}:${body.username}`, envRateLimit("NB_LOGIN_RATE_LIMIT", 10), 5 * 60 * 1000)) {
        throw createError({statusCode: 429, message: "登录尝试过于频繁，请 5 分钟后再试"});
    }

    const user = await prisma.user.findUnique({
        where: {username: body.username},
    });
    const passwordMatched = user?.status === "active" && user.passwordHash !== null
        ? await verifyUserPassword(body.password, user.passwordHash)
        : false;

    if (!user || !passwordMatched) {
        throw createError({
            statusCode: 401,
            message: "用户名或密码错误",
        });
    }

    const updatedUser = await prisma.user.update({
        where: {id: user.id},
        data: {lastLoginAt: new Date()},
    });
    const sessionUser = toAuthUser(updatedUser);
    await setAuthSession(event, sessionUser);

    return {authEnabled: true, user: sessionUser};
});
