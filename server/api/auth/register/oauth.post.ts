import type {AuthSessionDto} from "../../../utils/auth";
import {getPendingOAuthSession, setAuthSession, toAuthUser} from "../../../utils/auth";
import {OAuthRegisterRequestDtoSchema, validateBody} from "../../../utils/dto";
import {consumeRateLimit, envRateLimit} from "../../../utils/rate-limit";
import type {User} from "../../../database/prisma";
import {Prisma, prisma} from "../../../database/prisma";
import {clientIp, isGitHubOAuthEnabled} from "../../../utils/site-config";
import {consumeAccessCodes} from "../../../utils/access-code";
import {apiError} from "../../../utils/api-error";

/**
 * GitHub 补全注册（spec §5.2）：身份取自 session pendingOAuth，body 补用户名、注册码与可选邀请码。
 * 事务内建免密账号（passwordHash 为空）+ PassportIdentity + 消费两类码，四者同生共死；
 * 成功写正式 session（replace 语义顺带清掉 pendingOAuth）。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    if (!isGitHubOAuthEnabled()) {
        throw apiError(404, "not_found", "Not Found");
    }
    const ip = clientIp(event);
    if (!consumeRateLimit(`register:${ip}`, envRateLimit("NB_REGISTER_RATE_LIMIT", 5), 60 * 60 * 1000)) {
        throw apiError(429, "rate_limit_exceeded", "Registration rate limit exceeded");
    }

    const pending = await getPendingOAuthSession(event);
    if (!pending) {
        throw apiError(400, "oauth_registration_missing", "No pending GitHub registration");
    }
    const body = await validateBody(event, OAuthRegisterRequestDtoSchema);

    const existingUser = await prisma.user.findUnique({
        where: {username: body.username},
        select: {id: true},
    });
    if (existingUser) {
        throw apiError(409, "username_taken", "Username already exists", {field: "username"});
    }
    const existingIdentity = await prisma.passportIdentity.findUnique({
        where: {provider_providerUserId: {provider: pending.provider, providerUserId: pending.providerUserId}},
        select: {id: true},
    });
    if (existingIdentity) {
        throw apiError(409, "oauth_identity_taken", "GitHub identity already belongs to another account");
    }

    let user: User;
    try {
        user = await prisma.$transaction(async (tx) => {
            const codeIds = await consumeAccessCodes(tx, body.registrationCode, body.inviteCode || undefined);
            const created = await tx.user.create({
                data: {
                    username: body.username,
                    displayName: body.displayName,
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
            throw apiError(409, "registration_identity_conflict", "Username or GitHub identity is already in use");
        }
        throw error;
    }

    const sessionUser = toAuthUser(user);
    await setAuthSession(event, sessionUser);
    return {authEnabled: true, user: sessionUser};
});
