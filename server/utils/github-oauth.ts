// GitHub OAuth 回调的分支决策与 pending 身份类型（spec §5.2）。
// 决策逻辑抽成纯函数：回调路由只做查库与执行，三分支矩阵在这里单测覆盖。

// 未注册用户在补全页期间暂存于 sealed session cookie 的上游身份快照（不落库）
export type PendingOAuthSession = {
    provider: "github";
    providerUserId: string; // 上游用户唯一 id（GitHub 数字 id 字符串化）
    providerUsername: string; // GitHub login，补全页展示与用户名预填
    displayName: string; // GitHub name；为空回落 login
    avatarUrl: string; // GitHub 头像 URL；可为空串
};

// 回调三分支 + 封禁拦截的决策结果
export type GitHubSignInDecision =
    | {kind: "login"; userId: number} // GitHub 身份已绑定且账号可用 → 直接登录（当前已登录他人也切换）
    | {kind: "disabled"} // 已绑定但账号被封禁 → 拒绝登录
    | {kind: "bind"; userId: number} // 未绑定且当前已登录 → 绑定到当前账号
    | {kind: "signup"}; // 未绑定且未登录 → 进邀请码补全注册

/**
 * GitHub 回调决策（纯函数）。
 * @param identityUserId 该 GitHub 身份已绑定的账号 id；null 表示未绑定
 * @param identityUserStatus 绑定账号的 status；identityUserId 为 null 时忽略
 * @param currentUserId 当前 cookie session 账号 id；null 表示未登录
 */
export function resolveGitHubSignIn(input: {
    identityUserId: number | null;
    identityUserStatus: "active" | "disabled" | null;
    currentUserId: number | null;
}): GitHubSignInDecision {
    if (input.identityUserId !== null) {
        if (input.identityUserStatus !== "active") {
            return {kind: "disabled"};
        }
        return {kind: "login", userId: input.identityUserId};
    }
    if (input.currentUserId !== null) {
        return {kind: "bind", userId: input.currentUserId};
    }
    return {kind: "signup"};
}

/**
 * 把 GitHub login 归一为合法用户名建议值（非法字符转 "-"，长度压进 3–32）。
 */
export function suggestUsername(login: string): string {
    const cleaned = login.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
    return cleaned.length >= 3 ? cleaned : `${cleaned}-user`.slice(0, 32);
}
