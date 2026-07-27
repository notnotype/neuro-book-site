import {sendRedirect} from "h3";
import {resolveGitHubSignIn} from "../../utils/github-oauth";
import {getCurrentUser, setAuthSession, setPendingOAuthSession, toAuthUser} from "../../utils/auth";
import {Prisma, prisma} from "../../database/prisma";
import {isGitHubOAuthEnabled} from "../../utils/site-config";

/**
 * GitHub OAuth 回调（spec §5.2 行为矩阵）：
 * 已绑定 → 登录（封禁则拒）；未绑定+已登录 → 绑定当前账号；未绑定+未登录 → 进补全注册。
 * env：NUXT_OAUTH_GITHUB_CLIENT_ID / NUXT_OAUTH_GITHUB_CLIENT_SECRET，回调地址 /auth/github。
 */
const githubOAuthHandler = isGitHubOAuthEnabled() ? defineOAuthGitHubEventHandler({
    async onSuccess(event, {user: ghUser}) {
        const providerUserId = String(ghUser.id);
        const identity = await prisma.passportIdentity.findUnique({
            where: {provider_providerUserId: {provider: "github", providerUserId}},
            include: {user: true},
        });
        const currentUser = await getCurrentUser(event);
        const decision = resolveGitHubSignIn({
            identityUserId: identity?.userId ?? null,
            identityUserStatus: identity?.user.status ?? null,
            currentUserId: currentUser?.id ?? null,
        });

        switch (decision.kind) {
            case "disabled": {
                return sendRedirect(event, "/login?error=disabled");
            }
            case "login": {
                const user = await prisma.user.update({
                    where: {id: decision.userId},
                    data: {lastLoginAt: new Date()},
                });
                await setAuthSession(event, toAuthUser(user));
                return sendRedirect(event, "/");
            }
            case "bind": {
                // 一个账号每个 provider 只绑一个上游身份，避免面板语义混乱
                const existing = await prisma.passportIdentity.findFirst({
                    where: {userId: decision.userId, provider: "github"},
                    select: {id: true},
                });
                if (existing) {
                    return sendRedirect(event, "/me?tab=account&github=already");
                }
                try {
                    await prisma.passportIdentity.create({
                        data: {
                            provider: "github",
                            providerUserId,
                            providerUsername: ghUser.login,
                            userId: decision.userId,
                        },
                    });
                } catch (error) {
                    // 并发窗口内同一 GitHub 身份被他人绑走 → 唯一约束兜底
                    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                        return sendRedirect(event, "/me?tab=account&github=conflict");
                    }
                    throw error;
                }
                // 账号还没头像时顺手带入 GitHub 头像，并刷新会话让顶栏立即生效
                if (currentUser && !currentUser.avatarUrl && ghUser.avatar_url) {
                    const updated = await prisma.user.update({
                        where: {id: decision.userId},
                        data: {avatarUrl: ghUser.avatar_url},
                    });
                    await setAuthSession(event, toAuthUser(updated));
                }
                return sendRedirect(event, "/me?tab=account&github=linked");
            }
            case "signup": {
                await setPendingOAuthSession(event, {
                    provider: "github",
                    providerUserId,
                    providerUsername: ghUser.login,
                    displayName: ghUser.name ?? "",
                    avatarUrl: ghUser.avatar_url ?? "",
                });
                return sendRedirect(event, "/register/github");
            }
        }
    },
    onError(event) {
        return sendRedirect(event, "/login?error=oauth");
    },
}) : defineEventHandler(() => {
    throw createError({statusCode: 404, message: "Not Found"});
});

export default githubOAuthHandler;
