import type {H3Event} from "h3";
import {getRequestProtocol} from "h3";
import type {AuthSessionDto, AuthUserDto, MeProfileDto} from "../../shared/dto/auth.dto";
import type {PendingOAuthSession} from "./github-oauth";
import type {User} from "../database/prisma";
import {prisma} from "../database/prisma";
import {siteOrigin} from "./site-config";

export type {AuthSessionDto, AuthUserDto};

/**
 * 根据当前请求协议生成 session 配置。HTTP dev 站点不能使用 Secure cookie。
 */
function authSessionConfig(event: H3Event) {
    return {
        cookie: {
            secure: siteOrigin().startsWith("https://") || getRequestProtocol(event) === "https",
            sameSite: "lax" as const,
        },
    };
}

/**
 * 写入当前用户 session。
 * 用 replace 而非 merge：登录/注册成功即整体重建会话，顺带清掉可能残留的 pendingOAuth
 * （用户从 GitHub 补全页中途放弃、转用密码登录的场景）。
 */
export async function setAuthSession(event: H3Event, user: AuthUserDto): Promise<void> {
    await replaceUserSession(event, {user}, authSessionConfig(event));
}

/**
 * 清理当前用户 session。
 */
export async function clearAuthSession(event: H3Event): Promise<void> {
    await clearUserSession(event, authSessionConfig(event));
}

/**
 * 暂存 GitHub 补全注册的 pending 身份（sealed cookie，不落库）。整体 replace：此时必然未登录。
 */
export async function setPendingOAuthSession(event: H3Event, pending: PendingOAuthSession): Promise<void> {
    await replaceUserSession(event, {pendingOAuth: pending}, authSessionConfig(event));
}

/**
 * 读取 pending 身份；null 表示当前会话没有待完成的 OAuth 注册。
 */
export async function getPendingOAuthSession(event: H3Event): Promise<PendingOAuthSession | null> {
    const session = await getUserSession(event);
    const pending = (session as {pendingOAuth?: PendingOAuthSession}).pendingOAuth;
    if (!pending || pending.provider !== "github" || !pending.providerUserId) {
        return null;
    }
    return pending;
}

/**
 * 将用户实体映射为可写入 session 的轻量身份。
 */
export function toAuthUser(user: Pick<User, "id" | "username" | "displayName" | "avatarUrl" | "role" | "sessionVersion">): AuthUserDto {
    return {
        id: String(user.id),
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        sessionVersion: user.sessionVersion,
    };
}

/**
 * 用户实体 → 本人完整资料 DTO（profile.get / profile.patch 共用）。
 */
export function toMeProfileDto(user: User): MeProfileDto {
    return {
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        websiteUrl: user.websiteUrl,
        hasPassword: user.passwordHash !== null,
        joinedAt: user.createdAt.toISOString(),
    };
}

/**
 * 获取当前请求的有效用户。
 */
export async function getCurrentUser(event: H3Event): Promise<User | null> {
    const session = await getUserSession(event);
    const sessionUser = session.user as Partial<AuthUserDto> | undefined;
    const sessionUserId = sessionUser?.id;
    if (!sessionUserId) {
        return null;
    }

    const userId = Number.parseInt(sessionUserId, 10);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        await clearAuthSession(event);
        return null;
    }

    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user || user.status !== "active" || user.sessionVersion !== sessionUser?.sessionVersion) {
        await clearAuthSession(event);
        return null;
    }

    return user;
}

/**
 * 要求当前请求来自已登录用户。
 */
export async function requireCurrentUser(event: H3Event): Promise<User> {
    const user = await getCurrentUser(event);
    if (!user) {
        throw createError({
            statusCode: 401,
            message: "请先登录",
        });
    }
    return user;
}
