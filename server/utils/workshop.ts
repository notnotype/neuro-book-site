import type {H3Event} from "h3";
import {createError, getRouterParam} from "h3";
import type {CommentDto, ItemAuthorDto, ItemVersionDto, ItemViewerStateDto, PageDto, ReportDto, WorkshopItemDto} from "../../shared/dto/workshop.dto";
import type {Comment, ItemVersion, Report, User, WorkshopItem} from "../database/prisma";
import {Prisma, prisma} from "../database/prisma";
import {requireCurrentUser} from "./auth";

// Workshop 通用查询 / 映射 / 权限 helpers，供 server/api/v1 各路由复用。

/** 条目 DTO 所需的关联加载：作者、最新版本（取一条）、可见评论数 */
export const itemDtoInclude = {
    author: true,
    versions: {orderBy: {ordinal: "desc" as const}, take: 1},
    _count: {select: {comments: {where: {deletedAt: null}}}},
} satisfies Prisma.WorkshopItemInclude;

export type ItemWithRefs = Prisma.WorkshopItemGetPayload<{include: typeof itemDtoInclude}>;

/**
 * 用户 → 作者摘要 DTO。
 */
export function toItemAuthorDto(user: Pick<User, "id" | "username" | "displayName" | "avatarUrl">): ItemAuthorDto {
    return {id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl};
}

/**
 * 解析 tagsJson；历史脏数据解析失败时按空数组处理。
 */
export function parseTags(tagsJson: string): string[] {
    try {
        const parsed: unknown = JSON.parse(tagsJson); // JSON.parse 无静态类型，下一行立即收窄
        return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
    } catch {
        return [];
    }
}

/**
 * 条目实体（带关联）→ DTO；viewer 仅登录用户请求详情时传入。
 */
export function toItemDto(item: ItemWithRefs, viewer?: ItemViewerStateDto): WorkshopItemDto {
    return {
        id: item.id,
        slug: item.slug,
        name: item.name,
        type: item.type,
        title: item.title,
        summary: item.summary,
        description: item.description,
        tags: parseTags(item.tagsJson),
        status: item.status,
        featured: item.featured,
        downloadCount: item.downloadCount,
        likeCount: item.likeCount,
        commentCount: item._count.comments,
        latestVersion: item.versions[0]?.version ?? null,
        author: toItemAuthorDto(item.author),
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        ...(viewer ? {viewer} : {}),
    };
}

/**
 * 版本实体 → DTO。
 */
export function toVersionDto(version: ItemVersion): ItemVersionDto {
    return {
        id: version.id,
        version: version.version,
        changelog: version.changelog,
        fileName: version.fileName,
        fileSize: version.fileSize,
        sha256: version.sha256,
        minAppVersion: version.minAppVersion,
        createdAt: version.createdAt.toISOString(),
    };
}

/**
 * 评论实体（带作者）→ DTO；调用方保证已过滤软删。
 */
export function toCommentDto(comment: Comment & {author: User}): CommentDto {
    return {
        id: comment.id,
        content: comment.content,
        author: toItemAuthorDto(comment.author),
        createdAt: comment.createdAt.toISOString(),
    };
}

/**
 * 举报实体（带条目与举报人）→ DTO。
 */
export function toReportDto(report: Report & {item: WorkshopItem; reporter: User}): ReportDto {
    return {
        id: report.id,
        itemId: report.itemId,
        itemSlug: report.item.slug,
        itemTitle: report.item.title,
        reporter: report.reporter.username,
        reason: report.reason,
        createdAt: report.createdAt.toISOString(),
        resolvedAt: report.resolvedAt?.toISOString() ?? null,
    };
}

/**
 * 组装分页返回（对齐 NeuroBook Page 惯例：hasMore 时才带 nextOffset）。
 */
export function buildPage<T>(items: T[], total: number, offset: number, limit: number): PageDto<T> {
    const hasMore = offset + items.length < total;
    return {items, total, offset, limit, hasMore, ...(hasMore ? {nextOffset: offset + items.length} : {})};
}

/**
 * 要求当前用户是 admin。
 */
export async function requireAdmin(event: H3Event): Promise<User> {
    const user = await requireCurrentUser(event);
    if (user.role !== "admin") {
        throw createError({statusCode: 403, message: "需要管理员权限"});
    }
    return user;
}

/**
 * 从路由参数取 slug（路由文件名保证存在，此处兜底 400）。
 */
export function requireSlugParam(event: H3Event): string {
    const slug = getRouterParam(event, "slug");
    if (!slug) {
        throw createError({statusCode: 400, message: "缺少 slug 参数"});
    }
    return slug;
}

/**
 * 从路由参数取正整数 id。
 */
export function requireIdParam(event: H3Event): number {
    const id = Number.parseInt(getRouterParam(event, "id") ?? "", 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw createError({statusCode: 400, message: "id 参数无效"});
    }
    return id;
}

/**
 * 按 slug 取公开可见条目（status=published）并附带 DTO 关联；不存在或不可见一律 404（不泄露存在性）。
 */
export async function requirePublishedItem(slug: string): Promise<ItemWithRefs> {
    const item = await prisma.workshopItem.findUnique({where: {slug}, include: itemDtoInclude});
    if (!item || item.status !== "published") {
        throw createError({statusCode: 404, message: "条目不存在"});
    }
    return item;
}

/**
 * 按 slug 取条目（不限 status）；仅供"撤销自己既有关系"类操作（取消点赞 / 取消收藏）使用，
 * 让用户能清理已下架条目上的痕迹，不要用于任何公开读取入口。
 */
export async function requireItemBySlug(slug: string): Promise<ItemWithRefs> {
    const item = await prisma.workshopItem.findUnique({where: {slug}, include: itemDtoInclude});
    if (!item) {
        throw createError({statusCode: 404, message: "条目不存在"});
    }
    return item;
}

/**
 * 按 slug 取当前用户拥有的条目；不存在 404，非作者 403。
 * user 传入时（Bearer 化端点已经过 requireAccess）跳过内部取会话。
 */
export async function requireOwnedItem(event: H3Event, slug: string, user?: User): Promise<{user: User; item: ItemWithRefs}> {
    const owner = user ?? (await requireCurrentUser(event));
    const item = await prisma.workshopItem.findUnique({where: {slug}, include: itemDtoInclude});
    if (!item) {
        throw createError({statusCode: 404, message: "条目不存在"});
    }
    if (item.authorId !== owner.id) {
        throw createError({statusCode: 403, message: "只有作者本人可以操作该条目"});
    }
    return {user: owner, item};
}

/**
 * 解析条目的目标 SemVer：version 缺省取最新版；不存在时 404。
 * 下载与包内容预览接口共用同一套版本解析语义。
 */
export async function resolveItemVersion(item: ItemWithRefs, versionNumber?: string): Promise<ItemVersion> {
    const version = versionNumber
        ? await prisma.itemVersion.findUnique({where: {itemId_version: {itemId: item.id, version: versionNumber}}})
        : (item.versions[0] ?? null);
    if (!version) {
        throw createError({statusCode: 404, message: versionNumber ? "指定版本不存在" : "该条目还没有任何版本"});
    }
    return version;
}

/**
 * 查询当前用户与条目的点赞 / 收藏状态。
 */
export async function loadViewerState(userId: number, itemId: number): Promise<ItemViewerStateDto> {
    const [like, favorite] = await Promise.all([
        prisma.like.findUnique({where: {userId_itemId: {userId, itemId}}}),
        prisma.favorite.findUnique({where: {userId_itemId: {userId, itemId}}}),
    ]);
    return {liked: like !== null, favorited: favorite !== null};
}
