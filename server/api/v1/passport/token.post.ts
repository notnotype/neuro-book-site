import type {TokenGrantDto} from "../../../../shared/dto/passport.dto";
import type {PassportAuthorization, User} from "../../../database/prisma";
import {Prisma, prisma} from "../../../database/prisma";
import {validateBody} from "../../../utils/dto";
import {accessTokenTtlSeconds, devicePollIntervalSeconds, generateToken, hashToken, refreshIdleDays, revokeAuthorizationChain} from "../../../utils/passport";
import {TokenRequestSchema} from "../../../utils/passport-dto";

// token 端点（spec §6.4，匿名）：device_code 兑换与 refresh_token 轮换两种 grant。
// 业务失败统一 HTTP 400 + data.error 携带 OAuth 风格错误码，供客户端状态机分支。

/**
 * OAuth 风格业务失败。
 */
function grantError(code: string, message: string): never {
    throw createError({statusCode: 400, message, data: {error: code}});
}

/**
 * 在事务内为授权签发一对新 token（access + refresh）并组装响应。
 */
async function issueTokens(tx: Prisma.TransactionClient, authorization: PassportAuthorization, user: User): Promise<TokenGrantDto> {
    const accessToken = generateToken("nbp_at_");
    const refreshToken = generateToken("nbp_rt_");
    const expiresIn = accessTokenTtlSeconds();
    await tx.passportToken.createMany({
        data: [
            {
                authorizationId: authorization.id,
                kind: "access",
                tokenHash: hashToken(accessToken),
                status: "active",
                expiresAt: new Date(Date.now() + expiresIn * 1000),
            },
            {
                authorizationId: authorization.id,
                kind: "refresh",
                tokenHash: hashToken(refreshToken),
                status: "active",
                expiresAt: null,
            },
        ],
    });
    return {
        accessToken,
        expiresIn,
        refreshToken,
        scopes: JSON.parse(authorization.scopesJson) as string[],
        account: {id: user.id, username: user.username, displayName: user.displayName},
    };
}

/**
 * device_code grant：pending 轮询 / slow_down / 过期 / 拒绝 / approved 原子消费兑换。
 */
async function grantByDeviceCode(deviceCode: string): Promise<TokenGrantDto> {
    const code = await prisma.passportDeviceCode.findUnique({where: {deviceCodeHash: hashToken(deviceCode)}});
    if (!code || code.status === "consumed" || code.status === "expired") {
        grantError("invalid_grant", "设备码无效");
    }
    if (code.expiresAt.getTime() <= Date.now()) {
        // 顺手标记过期，让 /link 页也能看到过期态
        await prisma.passportDeviceCode.update({where: {id: code.id}, data: {status: "expired"}}).catch(() => undefined);
        grantError("expired_token", "设备码已过期，请重新发起关联");
    }
    if (code.status === "denied") {
        grantError("access_denied", "用户已拒绝本次关联");
    }
    if (code.status === "pending") {
        const interval = devicePollIntervalSeconds();
        const tooFast = code.lastPolledAt !== null && Date.now() - code.lastPolledAt.getTime() < interval * 1000;
        await prisma.passportDeviceCode.update({where: {id: code.id}, data: {lastPolledAt: new Date()}}).catch(() => undefined);
        grantError(tooFast ? "slow_down" : "authorization_pending", tooFast ? "轮询过快，请增大间隔后重试" : "等待用户批准");
    }

    // status === approved：原子消费（updateMany 条件守卫，并发双兑只有一个赢）
    const result = await prisma.$transaction(async (tx) => {
        const consumed = await tx.passportDeviceCode.updateMany({
            where: {id: code.id, status: "approved"},
            data: {status: "consumed"},
        });
        if (consumed.count === 0) {
            return null;
        }
        const authorization = code.authorizationId
            ? await tx.passportAuthorization.findUnique({where: {id: code.authorizationId}, include: {user: true}})
            : null;
        // 批准后授权又被吊销 / 用户被禁用：兑换失败
        if (!authorization || authorization.revokedAt !== null || authorization.user.status !== "active") {
            return null;
        }
        return await issueTokens(tx, authorization, authorization.user);
    });
    if (!result) {
        grantError("invalid_grant", "设备码无效");
    }
    return result;
}

/**
 * refresh_token grant：轮换出新对；旧 token 重放视为泄露，撤销整条授权链。
 */
async function grantByRefreshToken(refreshToken: string): Promise<TokenGrantDto> {
    const token = await prisma.passportToken.findUnique({
        where: {tokenHash: hashToken(refreshToken)},
        include: {authorization: {include: {user: true}}},
    });
    if (!token || token.kind !== "refresh") {
        grantError("invalid_grant", "refresh token 无效");
    }
    const authorization = token.authorization;
    if (authorization.revokedAt !== null || authorization.user.status !== "active") {
        grantError("invalid_grant", "授权已失效，请重新关联");
    }
    if (token.status !== "active") {
        // 已轮换/已吊销的旧 token 被重放：视为泄露，整链撤销
        await revokeAuthorizationChain(authorization.id);
        grantError("invalid_grant", "refresh token 已失效，请重新关联");
    }
    if (Date.now() - token.createdAt.getTime() > refreshIdleDays() * 24 * 60 * 60 * 1000) {
        await revokeAuthorizationChain(authorization.id);
        grantError("invalid_grant", "授权闲置过久已失效，请重新关联");
    }

    const result = await prisma.$transaction(async (tx) => {
        // 条件轮换：并发双花只有一个赢，输者走撤链
        const rotated = await tx.passportToken.updateMany({
            where: {id: token.id, status: "active"},
            data: {status: "rotated"},
        });
        if (rotated.count === 0) {
            return null;
        }
        // 惰性清扫：顺手删除该授权名下已过期的 access token，免定时任务
        await tx.passportToken.deleteMany({
            where: {authorizationId: authorization.id, kind: "access", expiresAt: {lt: new Date()}},
        });
        return await issueTokens(tx, authorization, authorization.user);
    });
    if (!result) {
        await revokeAuthorizationChain(authorization.id);
        grantError("invalid_grant", "refresh token 已失效，请重新关联");
    }
    return result;
}

export default defineEventHandler(async (event): Promise<TokenGrantDto> => {
    const body = await validateBody(event, TokenRequestSchema);
    if (body.grantType === "device_code") {
        return await grantByDeviceCode(body.deviceCode);
    }
    return await grantByRefreshToken(body.refreshToken);
});
