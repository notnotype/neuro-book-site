/** 注册码与邀请码共享的使用限制和状态字段。 */
export type AccessCodeDto = {
    id: number;
    code: string;
    note: string;
    maxUses: number | null; // null 表示不限次数
    usedCount: number;
    lastUsedAt: string | null; // null 表示尚未使用
    expiresAt: string | null; // null 表示永不过期
    disabledAt: string | null; // null 表示未停用
    createdAt: string;
};

/** 管理员创建的注册准入码。 */
export type RegistrationCodeDto = AccessCodeDto;

/** 当前用户创建的可选邀请归属码。 */
export type InviteCodeDto = AccessCodeDto;

/** 创建或批量签发码时的公共设置。 */
export type AccessCodeSettingsInput = {
    note: string;
    maxUses: number | null;
    expiresAt: string | null;
};
