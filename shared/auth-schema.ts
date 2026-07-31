import {z} from "zod";

/** 登录账号名：承担登录、个人主页路径和作者引用，只允许稳定的 ASCII 标识符。 */
export const UsernameSchema = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/);

/** 公开显示名称：允许中文等 Unicode 内容，资料编辑与注册共用同一合同。 */
export const DisplayNameSchema = z.string().trim().min(1).max(50);

/** 管理员注册码：注册准入必填。 */
export const RegistrationCodeSchema = z.string().trim().min(1).max(100);

/** 用户邀请码：可选，只记录邀请归属。 */
export const OptionalInviteCodeSchema = z.string().trim().max(100).optional();

export const LoginRequestDtoSchema = z.object({
    username: UsernameSchema,
    password: z.string().min(1).max(200),
});

export const RegisterRequestDtoSchema = z.object({
    username: UsernameSchema,
    displayName: DisplayNameSchema,
    password: z.string().min(8).max(200),
    registrationCode: RegistrationCodeSchema,
    inviteCode: OptionalInviteCodeSchema,
});

/** GitHub 身份来自 sealed session；body 只补齐站内账号信息与准入凭据。 */
export const OAuthRegisterRequestDtoSchema = z.object({
    username: UsernameSchema,
    displayName: DisplayNameSchema,
    registrationCode: RegistrationCodeSchema,
    inviteCode: OptionalInviteCodeSchema,
});

/** 普通注册浏览器表单；confirmPassword 只在本地验证，不进入 HTTP DTO。 */
export const RegisterFormSchema = RegisterRequestDtoSchema.extend({
    confirmPassword: z.string().min(1).max(200),
}).superRefine((value, context) => {
    if (value.password !== value.confirmPassword) {
        context.addIssue({code: "custom", path: ["confirmPassword"], message: "password_mismatch"});
    }
});

export type LoginRequestDto = z.infer<typeof LoginRequestDtoSchema>;
export type RegisterRequestDto = z.infer<typeof RegisterRequestDtoSchema>;
export type OAuthRegisterRequestDto = z.infer<typeof OAuthRegisterRequestDtoSchema>;
export type RegisterForm = z.infer<typeof RegisterFormSchema>;
