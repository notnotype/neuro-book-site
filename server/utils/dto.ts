import type {H3Event} from "h3";
import {readBody} from "h3";
import {z} from "zod";

const UsernameSchema = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/);
const InviteCodeSchema = z.string().trim().min(1, "注册需要邀请码");

export const LoginRequestDtoSchema = z.object({
    username: UsernameSchema,
    password: z.string().min(1).max(200),
});

export const RegisterRequestDtoSchema = z.object({
    username: UsernameSchema,
    password: z.string().min(8).max(200),
    inviteCode: InviteCodeSchema,
});

// GitHub 补全注册（spec §5.2）：身份来自 session pendingOAuth，body 只补用户名与邀请码
export const OAuthRegisterRequestDtoSchema = z.object({
    username: UsernameSchema,
    inviteCode: InviteCodeSchema,
});

// 站外链接字段：空串 = 未填写；非空必须 http(s)（avatarUrl 进 <img src>，拦掉 javascript: 等危险 scheme）
const HttpUrlSchema = z.string().trim().max(500, "链接过长").refine(
    (value) => value === "" || /^https?:\/\//i.test(value),
    "链接必须以 http:// 或 https:// 开头",
);

// 资料更新（spec §5.1）
export const UpdateProfileRequestDtoSchema = z.object({
    displayName: z.string().trim().min(1, "昵称不能为空").max(50, "昵称过长"),
    bio: z.string().trim().max(200, "签名最长 200 字"),
    websiteUrl: HttpUrlSchema,
    avatarUrl: HttpUrlSchema,
});

// 修改密码（spec §5.1）：currentPassword 缺省仅允许无密码账号补设
export const ChangePasswordRequestDtoSchema = z.object({
    currentPassword: z.string().min(1).max(200).optional(),
    newPassword: z.string().min(8, "新密码至少 8 位").max(200),
});

export type LoginRequestDto = z.infer<typeof LoginRequestDtoSchema>;
export type RegisterRequestDto = z.infer<typeof RegisterRequestDtoSchema>;
export type OAuthRegisterRequestDto = z.infer<typeof OAuthRegisterRequestDtoSchema>;
export type UpdateProfileRequestDto = z.infer<typeof UpdateProfileRequestDtoSchema>;
export type ChangePasswordRequestDto = z.infer<typeof ChangePasswordRequestDtoSchema>;

/**
 * 统一解析并校验 JSON body。
 */
export async function validateBody<T>(event: H3Event, schema: z.ZodType<T>): Promise<T> {
    const result = schema.safeParse(await readBody(event));
    if (!result.success) {
        throw createError({
            statusCode: 400,
            message: result.error.issues.map((issue) => issue.message).join("；") || "请求参数无效",
        });
    }
    return result.data;
}
