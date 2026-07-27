// Passport 模块公开 DTO（reference/passport/api-v1.md）。请求校验 zod schema 见 server/utils/passport-dto.ts。

/** v1 可签发的 scope 集合（保留字 workshop:read / contribution:submit / memory:* 不在此列） */
export type PassportScope = "workshop:publish" | "backup:read" | "backup:write";

/** 设备码状态机（spec §6.4） */
export type DeviceCodeStatus = "pending" | "approved" | "denied" | "expired" | "consumed";

/** 设备码申请响应（spec §6.2） */
export type DeviceCodeDto = {
    deviceCode: string; // 实例侧凭据，勿展示给用户
    userCode: string; // XXXX-XXXX，展示给用户
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number; // 秒
    interval: number; // 轮询最小间隔秒
};

/** token 端点成功响应（spec §6.4，device_code 与 refresh_token 两种 grant 相同） */
export type TokenGrantDto = {
    accessToken: string;
    expiresIn: number;
    refreshToken: string;
    scopes: string[];
    account: {id: number; username: string; displayName: string};
};

/** /link 页待批设备码详情（spec §6.3） */
export type PendingDeviceDto = {
    userCode: string;
    instanceName: string;
    scopes: string[];
    status: DeviceCodeStatus;
    expiresAt: string;
};

/** 实例授权：面板管理单位（spec §8） */
export type AuthorizationDto = {
    id: number;
    instanceName: string;
    scopes: string[];
    createdAt: string;
    lastUsedAt: string | null; // 为空表示批准后从未使用
    revokedAt: string | null; // 为空表示有效
};

/** 已关联的上游 OAuth 身份（spec §5.2，面板展示用） */
export type PassportIdentityDto = {
    id: number;
    provider: "github";
    providerUsername: string; // 上游展示名快照（GitHub login）
    createdAt: string;
};
