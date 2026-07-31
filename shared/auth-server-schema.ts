import {z} from "zod";
import {DisplayNameSchema} from "./auth-schema";

export {
    LoginRequestDtoSchema,
    OAuthRegisterRequestDtoSchema,
    RegisterRequestDtoSchema,
} from "./auth-schema";

/** 站外链接：空串表示未填写，非空只允许 http(s)。 */
const HttpUrlSchema = z.string().trim().max(500).refine((value) => value === "" || /^https?:\/\//i.test(value));

export const UpdateProfileRequestDtoSchema = z.object({
    displayName: DisplayNameSchema,
    bio: z.string().trim().max(200),
    websiteUrl: HttpUrlSchema,
    avatarUrl: HttpUrlSchema,
});

/** 修改密码：currentPassword 缺省仅允许无密码账号补设。 */
export const ChangePasswordRequestDtoSchema = z.object({
    currentPassword: z.string().min(1).max(200).optional(),
    newPassword: z.string().min(8).max(200),
});
