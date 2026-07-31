import type {AuthSessionDto} from "../../utils/auth";
import {setAuthSession, toAuthUser} from "../../utils/auth";
import {RegisterRequestDtoSchema, validateBody} from "../../utils/dto";
import {hashUserPassword} from "../../utils/password";
import {consumeRateLimit, envRateLimit} from "../../utils/rate-limit";
import type {User} from "../../database/prisma";
import {Prisma, prisma} from "../../database/prisma";
import {clientIp, isRegistrationEnabled} from "../../utils/site-config";
import {consumeAccessCodes} from "../../utils/access-code";
import {apiError} from "../../utils/api-error";

/**
 * 注册码注册：必填注册码负责准入，可选邀请码只记录邀请归属。
 * 两类码与用户在同一事务内消费/创建；共享 CAS 服务负责次数、过期、停用与并发限制。
 * 防爆破：按 IP 限频（与 OAuth 补全注册共享额度，spec §4）。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    if (!isRegistrationEnabled()) {
        throw apiError(403, "registration_disabled", "Registration is disabled");
    }
    const ip = clientIp(event);
    if (!consumeRateLimit(`register:${ip}`, envRateLimit("NB_REGISTER_RATE_LIMIT", 5), 60 * 60 * 1000)) {
        throw apiError(429, "rate_limit_exceeded", "Registration rate limit exceeded");
    }

    const body = await validateBody(event, RegisterRequestDtoSchema);

    const existing = await prisma.user.findUnique({
        where: {username: body.username},
        select: {id: true},
    });
    if (existing) {
        throw apiError(409, "username_taken", "Username already exists", {field: "username"});
    }

    const passwordHash = await hashUserPassword(body.password);
    // 事务保证创建用户与消费邀请码同生共死
    let user: User;
    try {
        user = await prisma.$transaction(async (tx) => {
            const codeIds = await consumeAccessCodes(tx, body.registrationCode, body.inviteCode || undefined);
            const created = await tx.user.create({
                data: {
                    username: body.username,
                    displayName: body.displayName,
                    passwordHash,
                    registrationCodeId: codeIds.registrationCodeId,
                    inviteCodeId: codeIds.inviteCodeId,
                },
            });
            return created;
        });
    } catch (error) {
        // 并发同名注册穿过预检查时撞 username 唯一约束
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw apiError(409, "username_taken", "Username already exists", {field: "username"});
        }
        throw error;
    }
    const sessionUser = toAuthUser(user);
    await setAuthSession(event, sessionUser);

    return {authEnabled: true, user: sessionUser};
});
