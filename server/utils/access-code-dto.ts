import {z} from "zod";

const MaxUsesSchema = z.number().int().min(1).max(100_000).nullable().default(null);
const ExpiresAtSchema = z.iso.datetime({offset: true}).nullable().default(null).refine(
    (value) => value === null || new Date(value).getTime() > Date.now(),
    "过期时间必须晚于当前时间",
);

/** 注册码/邀请码创建设置；maxUses 与 expiresAt 为空分别表示不限次数、永不过期。 */
export const AccessCodeSettingsSchema = z.object({
    note: z.string().trim().max(120).default(""),
    maxUses: MaxUsesSchema,
    expiresAt: ExpiresAtSchema,
});

/** 管理员批量签发注册码。 */
export const CreateRegistrationCodesRequestSchema = AccessCodeSettingsSchema.extend({
    count: z.number().int().min(1).max(100),
});

/** 用户一次创建一个邀请码。 */
export const CreateInviteCodeRequestSchema = AccessCodeSettingsSchema;

/** 修改码设置或停用状态；至少提供一个字段。 */
export const UpdateAccessCodeRequestSchema = z.object({
    note: z.string().trim().max(120).optional(),
    maxUses: z.number().int().min(1).max(100_000).nullable().optional(),
    expiresAt: z.iso.datetime({offset: true}).nullable().optional().refine(
        (value) => value === undefined || value === null || new Date(value).getTime() > Date.now(),
        "过期时间必须晚于当前时间",
    ),
    disabled: z.boolean().optional(),
}).refine(
    (value) => Object.keys(value).length > 0,
    "至少需要修改一个字段",
);
