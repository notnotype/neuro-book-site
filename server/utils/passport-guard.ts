import type {H3Event} from "h3";
import type {PassportScope} from "../../shared/dto/passport.dto";
import type {PassportAuthorization, User} from "../database/prisma";
import {prisma} from "../database/prisma";
import {getCurrentUser} from "./auth";
import {hashToken} from "./passport";

// 统一访问守卫（spec §3/§7）：cookie session 与 Bearer access token 等价接受；
// Bearer 额外受 scope 限制。admin 端点不得使用本守卫（继续走 requireAdmin，永不接受 Bearer）。

export type AccessContext = {
    user: User;
    via: "session" | "bearer";
    /** bearer 时必有：access token 所属的实例授权；session 时为 null */
    authorization: PassportAuthorization | null;
};

// lastUsedAt 懒更新最小间隔：面板展示精确到分钟足够，避免每请求写库
const LAST_USED_UPDATE_INTERVAL_MS = 60 * 1000;

/**
 * Bearer 分支：校验 access token 有效性（active + 未过期 + 授权未吊销 + 用户 active）与 scope。
 */
async function requireBearerAccess(scope: PassportScope, bearerToken: string): Promise<AccessContext> {
    const token = await prisma.passportToken.findUnique({
        where: {tokenHash: hashToken(bearerToken)},
        include: {authorization: {include: {user: true}}},
    });
    const valid = token !== null
        && token.kind === "access"
        && token.status === "active"
        && token.expiresAt !== null
        && token.expiresAt.getTime() > Date.now()
        && token.authorization.revokedAt === null
        && token.authorization.user.status === "active";
    if (!token || !valid) {
        throw createError({statusCode: 401, message: "access token 无效或已过期"});
    }
    const scopes = JSON.parse(token.authorization.scopesJson) as string[];
    if (!scopes.includes(scope)) {
        throw createError({statusCode: 403, message: `当前授权缺少 ${scope} 权限`, data: {error: "insufficient_scope"}});
    }
    const authorization = token.authorization;
    if (!authorization.lastUsedAt || Date.now() - authorization.lastUsedAt.getTime() > LAST_USED_UPDATE_INTERVAL_MS) {
        // fire-and-forget 懒更新：失败不影响请求
        prisma.passportAuthorization.update({where: {id: authorization.id}, data: {lastUsedAt: new Date()}}).catch(() => undefined);
    }
    return {user: authorization.user, via: "bearer", authorization};
}

/**
 * 要求请求具备访问权：带 Bearer 头走 token + scope 校验，否则回落 cookie session
 * （session 拥有该账号全部非 admin 权限，不检查 scope）。二者皆无 → 401。
 */
export async function requireAccess(event: H3Event, scope: PassportScope): Promise<AccessContext> {
    const header = getHeader(event, "authorization");
    if (header?.startsWith("Bearer ")) {
        return await requireBearerAccess(scope, header.slice("Bearer ".length).trim());
    }
    const user = await getCurrentUser(event);
    if (!user) {
        throw createError({statusCode: 401, message: "请先登录"});
    }
    return {user, via: "session", authorization: null};
}
