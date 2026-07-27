import type {H3Event} from "h3";
import {createError, getQuery} from "h3";
import {z} from "zod";

// Workshop 请求校验 schema。输出 DTO 纯类型见 shared/dto/workshop.dto.ts。

// kebab-case：小写字母/数字段用单个连字符连接（与 88 文档 manifest 约定一致）
const kebabCasePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// 资产包 manifest（zip 根部 nbook-package.json）
export const PackageManifestSchema = z.object({
    manifestVersion: z.literal(1, "manifestVersion 必须为 1"),
    type: z.enum(["skill", "profile"], "type 必须是 skill 或 profile"),
    name: z.string().regex(kebabCasePattern, "name 必须是 kebab-case（小写字母/数字/连字符）"),
    version: z.number().int("version 必须是整数").positive("version 必须是正整数"),
    minAppVersion: z.string().trim().min(1).max(50).optional(),
});

export type PackageManifest = z.infer<typeof PackageManifestSchema>;

// 创建条目（元数据；安装名 name 在首版上传时从 manifest 落库）
export const CreateItemRequestSchema = z.object({
    slug: z.string().trim().min(3, "slug 至少 3 个字符").max(64).regex(kebabCasePattern, "slug 必须是 kebab-case（小写字母/数字/连字符）"),
    type: z.enum(["skill", "profile"], "type 必须是 skill 或 profile"),
    title: z.string().trim().min(1, "标题不能为空").max(120),
    summary: z.string().trim().max(300).default(""),
    description: z.string().max(50_000).default(""),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});

export type CreateItemRequest = z.infer<typeof CreateItemRequestSchema>;

// 作者编辑条目：所有字段可选；status 只允许 published/unlisted 互切（removed 是 admin 专属态）
export const UpdateItemRequestSchema = z.object({
    title: z.string().trim().min(1, "标题不能为空").max(120).optional(),
    summary: z.string().trim().max(300).optional(),
    description: z.string().max(50_000).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
    status: z.enum(["published", "unlisted"], "作者只能在 published / unlisted 之间切换").optional(),
});

export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;

// 分页参数（对齐 NeuroBook Page 惯例）
export const PageQuerySchema = z.object({
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

// 公开条目列表查询；tags 为逗号分隔多值，匹配任意一个即命中；featured=1 只取精选
export const ListItemsQuerySchema = PageQuerySchema.extend({
    q: z.string().trim().max(100).optional(),
    type: z.enum(["skill", "profile"]).optional(),
    tags: z
        .string()
        .trim()
        .max(200)
        .transform((raw) => raw.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0))
        .optional(),
    sort: z.enum(["latest", "downloads", "likes"]).default("latest"),
    featured: z
        .string()
        .optional()
        .transform((raw) => raw === "1" || raw === "true"),
});

export type ListItemsQuery = z.infer<typeof ListItemsQuerySchema>;

// 下载查询：version 缺省表示最新版
export const DownloadQuerySchema = z.object({
    version: z.coerce.number().int().positive().optional(),
});

// 包内文件内容预览查询：path 是 zip 内相对路径（对象键查找，天然无路径穿越）
export const PackageFileContentQuerySchema = z.object({
    version: z.coerce.number().int().positive().optional(),
    path: z.string().min(1, "缺少 path 参数").max(500),
});

// 发表评论（纯文本）
export const CreateCommentRequestSchema = z.object({
    content: z.string().trim().min(1, "评论内容不能为空").max(2000),
});

// 举报
export const CreateReportRequestSchema = z.object({
    reason: z.string().trim().min(1, "举报理由不能为空").max(2000),
});

// admin 下架 / 恢复条目
export const AdminItemStatusRequestSchema = z.object({
    status: z.enum(["published", "removed"], "admin 只能设置 published 或 removed"),
});

// admin 设置 / 取消精选
export const AdminItemFeaturedRequestSchema = z.object({
    featured: z.boolean("featured 必须是布尔值"),
});

// 上传版本 multipart 的文本字段（文件字段单独处理）
export const UploadVersionFieldsSchema = z.object({
    changelog: z.string().trim().max(10_000).default(""),
});

/**
 * 统一解析并校验 query 参数（对应 body 侧的 validateBody）。
 */
export function validateQuery<T>(event: H3Event, schema: z.ZodType<T>): T {
    const result = schema.safeParse(getQuery(event));
    if (!result.success) {
        throw createError({
            statusCode: 400,
            message: result.error.issues.map((issue) => issue.message).join("；") || "查询参数无效",
        });
    }
    return result.data;
}
