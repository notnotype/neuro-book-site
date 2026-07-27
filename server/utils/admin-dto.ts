import {z} from "zod";
import {PageQuerySchema} from "./workshop-dto";

// Admin 后台请求校验 schema（用户管理 / 备份用量 / 邀请码列表）。输出 DTO 见 shared/dto/admin.dto.ts。

// 用户列表：可按用户名模糊搜索
export const AdminUsersQuerySchema = PageQuerySchema.extend({
    search: z.string().trim().max(32).optional(),
});

// 封禁 / 解封
export const AdminUserStatusRequestSchema = z.object({
    status: z.enum(["active", "disabled"], "status 必须是 active 或 disabled"),
});

// 授予 / 收回 admin
export const AdminUserRoleRequestSchema = z.object({
    role: z.enum(["admin", "user"], "role 必须是 admin 或 user"),
});

// 邀请码列表：按使用状态过滤
export const AdminInviteCodesQuerySchema = PageQuerySchema.extend({
    filter: z.enum(["all", "used", "unused"]).default("all"),
});

// 备份行列表：可按归属用户过滤
export const AdminBackupsQuerySchema = PageQuerySchema.extend({
    userId: z.coerce.number().int().positive().optional(),
});
