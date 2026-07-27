export type AuthUserDto = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string; // 空串表示未设置，前端回落首字母色块
    role: "admin" | "user";
    sessionVersion: number;
};

export type AuthSessionDto = {
    authEnabled: true;
    user: AuthUserDto | null;
};

// GitHub 补全注册页可见的 pending 身份（不含 providerUserId 等内部字段）
export type PendingOAuthDto = {
    provider: "github";
    providerUsername: string; // GitHub login
    suggestedUsername: string; // 用户名输入框预填值（login 归一为合法用户名字符）
    displayName: string;
    avatarUrl: string;
};

// 本人完整资料（账号设置页消费；比 AuthUserDto 多 profile 字段与密码状态）
export type MeProfileDto = {
    username: string;
    displayName: string;
    avatarUrl: string; // 空串表示未设置
    bio: string; // 个性签名；空串表示未填写
    websiteUrl: string; // 个人网站；空串表示未填写
    hasPassword: boolean; // false = OAuth 免密账号：改密走免旧密补设，解绑上游身份被禁止
    joinedAt: string;
};
