import type {AuthSessionDto} from "../../utils/auth";
import {setAuthSession, toAuthUser} from "../../utils/auth";
import {RegisterRequestDtoSchema, validateBody} from "../../utils/dto";
import {hashUserPassword} from "../../utils/password";
import {consumeRateLimit, envRateLimit} from "../../utils/rate-limit";
import type {User} from "../../database/prisma";
import {Prisma, prisma} from "../../database/prisma";
import {clientIp, isRegistrationEnabled} from "../../utils/site-config";

/**
 * 邀请码注册：校验邀请码有效且未被使用，创建用户后消费该码，并立即写入 session。
 * 码的消费用条件更新（usedById 仍为空才写入）挡并发双花；用户名冲突靠唯一约束兜底并发注册。
 * 防爆破：按 IP 限频（与 OAuth 补全注册共享额度，spec §4）。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    if (!isRegistrationEnabled()) {
        throw createError({
            statusCode: 403,
            message: "当前站点未开放注册",
            data: {error: "registration_disabled"},
        });
    }
    const ip = clientIp(event);
    if (!consumeRateLimit(`register:${ip}`, envRateLimit("NB_REGISTER_RATE_LIMIT", 5), 60 * 60 * 1000)) {
        throw createError({statusCode: 429, message: "注册尝试过于频繁，请一小时后再试"});
    }

    const body = await validateBody(event, RegisterRequestDtoSchema);

    // 预检查只为友好报错；真正的一码一用与用户名唯一由下方事务内条件更新 + 唯一约束保证
    const inviteCode = await prisma.inviteCode.findUnique({where: {code: body.inviteCode}});
    if (!inviteCode) {
        throw createError({
            statusCode: 400,
            message: "邀请码无效",
        });
    }
    if (inviteCode.usedById !== null) {
        throw createError({
            statusCode: 400,
            message: "邀请码已被使用",
        });
    }

    const existing = await prisma.user.findUnique({
        where: {username: body.username},
        select: {id: true},
    });
    if (existing) {
        throw createError({
            statusCode: 409,
            message: "用户名已存在",
        });
    }

    const passwordHash = await hashUserPassword(body.password);
    // 事务保证创建用户与消费邀请码同生共死
    let user: User;
    try {
        user = await prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    username: body.username,
                    displayName: body.username,
                    passwordHash,
                },
            });
            // 条件更新：并发双请求用同一码时，后提交者匹配不到 usedById=null，count=0 → 回滚
            const consumed = await tx.inviteCode.updateMany({
                where: {id: inviteCode.id, usedById: null},
                data: {usedById: created.id, usedAt: new Date()},
            });
            if (consumed.count === 0) {
                throw createError({statusCode: 400, message: "邀请码已被使用"});
            }
            return created;
        });
    } catch (error) {
        // 并发同名注册穿过预检查时撞 username 唯一约束
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw createError({statusCode: 409, message: "用户名已存在"});
        }
        throw error;
    }
    const sessionUser = toAuthUser(user);
    await setAuthSession(event, sessionUser);

    return {authEnabled: true, user: sessionUser};
});
