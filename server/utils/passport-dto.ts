import {z} from "zod";
import type {AuthorizationDto} from "../../shared/dto/passport.dto";
import type {PassportAuthorization} from "../database/prisma";

// Passport 请求校验 schema 与 DTO 映射。输出 DTO 纯类型见 shared/dto/passport.dto.ts。

/** v1 可签发 scope 全集（spec §7）；申请必须是其子集 */
export const PASSPORT_SCOPES = ["workshop:publish", "backup:read", "backup:write"] as const;

// 设备码申请（spec §6.2）
export const DeviceCodeRequestSchema = z.object({
    instanceName: z.string().trim().min(1, "实例名不能为空").max(64, "实例名最长 64 字符"),
    scopes: z
        .array(z.enum(PASSPORT_SCOPES, "scope 不在可签发集合内"))
        .min(1, "scopes 不能为空")
        .refine((scopes) => new Set(scopes).size === scopes.length, "scopes 不能重复"),
});

// token 端点（spec §6.4）：两种 grant 按 grantType 判别
export const TokenRequestSchema = z.discriminatedUnion("grantType", [
    z.object({grantType: z.literal("device_code"), deviceCode: z.string().min(1, "缺少 deviceCode")}),
    z.object({grantType: z.literal("refresh_token"), refreshToken: z.string().min(1, "缺少 refreshToken")}),
]);

// 实例注销（spec §6.5）
export const RevokeRequestSchema = z.object({
    refreshToken: z.string().min(1, "缺少 refreshToken"),
});

// /link 批准（spec §6.3）：instanceName 可覆盖实例建议名
export const ApproveDeviceRequestSchema = z.object({
    instanceName: z.string().trim().min(1, "实例名不能为空").max(64, "实例名最长 64 字符"),
});

// 面板重命名授权（spec §8）
export const RenameAuthorizationRequestSchema = z.object({
    instanceName: z.string().trim().min(1, "实例名不能为空").max(64, "实例名最长 64 字符"),
});

/**
 * 授权实体 → 面板 DTO。
 */
export function toAuthorizationDto(authorization: PassportAuthorization): AuthorizationDto {
    return {
        id: authorization.id,
        instanceName: authorization.instanceName,
        scopes: JSON.parse(authorization.scopesJson) as string[],
        createdAt: authorization.createdAt.toISOString(),
        lastUsedAt: authorization.lastUsedAt?.toISOString() ?? null,
        revokedAt: authorization.revokedAt?.toISOString() ?? null,
    };
}
