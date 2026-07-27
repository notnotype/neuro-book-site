import type {AuthSessionDto} from "../../../utils/auth";
import {getPendingOAuthSession, setAuthSession, toAuthUser} from "../../../utils/auth";
import {OAuthRegisterRequestDtoSchema, validateBody} from "../../../utils/dto";
import {consumeRateLimit, envRateLimit} from "../../../utils/rate-limit";
import type {User} from "../../../database/prisma";
import {Prisma, prisma} from "../../../database/prisma";
import {clientIp, isGitHubOAuthEnabled} from "../../../utils/site-config";
import {consumeAccessCodes} from "../../../utils/access-code";

/**
 * GitHub 补全注册（spec §5.2）：身份取自 session pendingOAuth，body 补用户名、注册码与可选邀请码。
 * 事务内建免密账号（passwordHash 为空）+ PassportIdentity + 消费两类码，四者同生共死；
 * 成功写正式 session（replace 语义顺带清掉 pendingOAuth）。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    if (!isGitHubOAuthEnabled()) {
        throw createError({statusCode: 404, message: "Not Found"});
    }
    const ip = clientIp(event);
    if (!consumeRateLimit(`register:${ip}`, envRateLimit("NB_REGISTER_RATE_LIMIT", 5), 60 * 60 * 1000)) {
        throw createError({statusCode: 429, message: "注册尝试过于频繁，请一小时后再试"});
    }

    const pending = await getPendingOAuthSession(event);
    if (!pending) {
        throw createError({statusCode: 400, message: "没有待完成的 GitHub 注册，请从登录页重新发起"});
    }
    const body = await validateBody(event, OAuthRegisterRequestDtoSchema);

    const existingUser = await prisma.user.findUnique({
        where: {username: body.username},
        select: {id: true},
    });
    if (existingUser) {
        throw createError({statusCode: 409, message: "用户名已存在"});
    }
    const existingIdentity = await prisma.passportIdentity.findUnique({
        where: {provider_providerUserId: {provider: pending.provider, providerUserId: pending.providerUserId}},
        select: {id: true},
    });
    if (existingIdentity) {
        throw createError({statusCode: 409, message: "该 GitHub 账号已绑定其他用户，请直接用 GitHub 登录"});
    }

    let user: User;
    try {
        user = await prisma.$transaction(async (tx) => {
            const codeIds = await consumeAccessCodes(tx, body.registrationCode, body.inviteCode || undefined);
            const created = await tx.user.create({
                data: {
                    username: body.username,
                    displayName: pending.displayName || body.username,
                    passwordHash: null,
                    avatarUrl: pending.avatarUrl,
                    registrationCodeId: codeIds.registrationCodeId,
                    inviteCodeId: codeIds.inviteCodeId,
                },
            });
            await tx.passportIdentity.create({
                data: {
                    provider: pending.provider,
                    providerUserId: pending.providerUserId,
                    providerUsername: pending.providerUsername,
                    userId: created.id,
                },
            });
            return created;
        });
    } catch (error) {
        // 并发穿过预检查时撞唯一约束：username 或 (provider, providerUserId)
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw createError({statusCode: 409, message: "用户名或 GitHub 账号已被占用"});
        }
        throw error;
    }

    const sessionUser = toAuthUser(user);
    await setAuthSession(event, sessionUser);
    return {authEnabled: true, user: sessionUser};
});
