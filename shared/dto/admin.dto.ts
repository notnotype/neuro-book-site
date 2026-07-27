// Admin 后台输出 DTO（站内模块，不进 passport spec）。请求校验 schema 见 server/utils/admin-dto.ts。

// 用户管理行
export type AdminUserDto = {
    id: number;
    username: string;
    displayName: string;
    avatarUrl: string; // 空串表示未设置
    role: "admin" | "user";
    status: "active" | "disabled";
    itemCount: number; // 全部状态条目数（含 unlisted/removed）
    hasGithub: boolean; // 是否已绑定 GitHub 身份
    hasPassword: boolean; // false = OAuth 免密账号
    lastLoginAt: string | null; // null 表示从未登录
    createdAt: string;
};

// 站点统计概览（数字卡片）
export type AdminStatsDto = {
    userTotal: number;
    userRecent30d: number; // 近 30 天新注册
    itemPublished: number;
    itemUnlisted: number;
    itemRemoved: number;
    downloadTotal: number; // 全站下载量合计
    backupCount: number;
    backupBytes: number; // 云备份总占用
    reportPending: number; // 未处理举报
    inviteUnused: number; // 未使用邀请码
};

// 各账号云备份用量聚合行
export type AdminBackupUsageDto = {
    userId: number;
    username: string;
    count: number;
    totalBytes: number;
    latestAt: string | null; // 最近一次备份时间；null 理论不会出现（有行才有聚合）
};

// admin 视角的备份行（比用户侧多归属人）
export type AdminBackupDto = {
    id: number;
    userId: number;
    username: string;
    instanceLabel: string;
    kind: "manual" | "auto";
    fileSize: number;
    keyId: string;
    appVersion: string;
    comment: string;
    createdAt: string;
};
