import type {
    CommentDto,
    FavoriteStateDto,
    ItemVersionDto,
    LikeStateDto,
    PackageFileContentDto,
    PackageFileListDto,
    PageDto,
    PublicUserDto,
    ReportDto,
    WorkshopItemDto,
    WorkshopItemType,
    WorkshopMetaDto,
} from "../../shared/dto/workshop.dto";
import type {AccessCodeSettingsInput, InviteCodeDto, RegistrationCodeDto} from "../../shared/dto/access-code.dto";
import type {AuthorizationDto, PassportIdentityDto, PendingDeviceDto} from "../../shared/dto/passport.dto";
import type {BackupListDto} from "../../shared/dto/backup.dto";
import type {AuthSessionDto, MeProfileDto, PendingOAuthDto} from "../../shared/dto/auth.dto";
import type {AdminBackupDto, AdminBackupUsageDto, AdminStatsDto, AdminUserDto} from "../../shared/dto/admin.dto";

/**
 * 列表查询参数（对齐后端 ListItemsQuerySchema）。
 * tags 前端以数组表达，发请求时序列化为逗号分隔字符串（命中任一即匹配）。
 */
export type ListItemsQuery = {
    q?: string;
    type?: WorkshopItemType;
    tags?: string[];
    sort?: "latest" | "downloads" | "likes";
    featured?: boolean; // true = 只取 admin 精选
    offset?: number;
    limit?: number;
};

/** 分页游标入参（offset/limit 制，缺省走后端默认）。 */
export type PageParams = {
    offset?: number;
    limit?: number;
};

/** 创建条目入参（对齐 CreateItemRequestSchema；summary/description/tags 后端有默认值故可选）。 */
export type CreateItemInput = {
    slug: string;
    type: WorkshopItemType;
    title: string;
    summary?: string;
    description?: string;
    tags?: string[];
};

/** 编辑条目入参（对齐 UpdateItemRequestSchema；字段全可选，仅传改动项）。 */
export type UpdateItemInput = {
    title?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    status?: "published" | "unlisted";
};

/** 资料更新入参（对齐 UpdateProfileRequestDtoSchema，整体提交）。 */
export type UpdateProfileInput = {
    displayName: string;
    bio: string;
    websiteUrl: string;
    avatarUrl: string;
};

/**
 * Workshop API 的类型化访问层：全站唯一的 $fetch 出口。
 * 入参出参均以 shared/dto/workshop.dto.ts 为准，业务组件不直接拼 URL / 解析响应结构。
 */
export function useWorkshopApi() {
    // ---- 读接口（公开，无需登录） ----

    /** 条目列表：分页 + 关键词 / 类型 / 标签 / 排序过滤。 */
    async function listItems(query: ListItemsQuery = {}): Promise<PageDto<WorkshopItemDto>> {
        return await $fetch<PageDto<WorkshopItemDto>>("/api/v1/items", {
            query: {
                ...(query.q ? {q: query.q} : {}),
                ...(query.type ? {type: query.type} : {}),
                ...(query.tags && query.tags.length > 0 ? {tags: query.tags.join(",")} : {}),
                ...(query.sort ? {sort: query.sort} : {}),
                ...(query.featured ? {featured: "1"} : {}),
                ...(query.offset !== undefined ? {offset: query.offset} : {}),
                ...(query.limit !== undefined ? {limit: query.limit} : {}),
            },
        });
    }

    /** 条目详情：登录时后端附带 viewer（点赞 / 收藏态）。 */
    async function getItem(slug: string): Promise<WorkshopItemDto> {
        return await $fetch<WorkshopItemDto>(`/api/v1/items/${slug}`);
    }

    /** 版本历史：按内部发布序号倒序全量返回。 */
    async function getVersions(slug: string): Promise<ItemVersionDto[]> {
        return await $fetch<ItemVersionDto[]>(`/api/v1/items/${slug}/versions`);
    }

    /** 评论列表：楼层正序分页。 */
    async function getComments(slug: string, page: PageParams = {}): Promise<PageDto<CommentDto>> {
        return await $fetch<PageDto<CommentDto>>(`/api/v1/items/${slug}/comments`, {query: page});
    }

    /** 下载直链：version 缺省下载最新版。浏览器直接跳转此地址触发下载。 */
    function downloadHref(slug: string, version?: string): string {
        return `/api/v1/items/${slug}/download${version ? `?version=${encodeURIComponent(version)}` : ""}`;
    }

    /** 包内文件列表（在线预览）：version 缺省取最新版；不计入下载数。 */
    async function getPackageFiles(slug: string, version?: string): Promise<PackageFileListDto> {
        return await $fetch<PackageFileListDto>(`/api/v1/items/${slug}/files`, {query: version ? {version} : {}});
    }

    /** 包内文本文件内容（在线预览）：二进制 / 超大文件后端拒绝（400）。 */
    async function getPackageFileContent(slug: string, path: string, version?: string): Promise<PackageFileContentDto> {
        return await $fetch<PackageFileContentDto>(`/api/v1/items/${slug}/file-content`, {query: {path, ...(version ? {version} : {})}});
    }

    /** 作者公开页：资料 + 其全部 published 条目（后端不分页）。 */
    async function getUser(username: string): Promise<PublicUserDto> {
        return await $fetch<PublicUserDto>(`/api/v1/users/${username}`);
    }

    /** 平台元信息（类型清单 / 版本，预留客户端握手）。 */
    async function getMeta(): Promise<WorkshopMetaDto> {
        return await $fetch<WorkshopMetaDto>("/api/v1/meta");
    }

    // ---- 写接口（需登录） ----

    /** 创建条目（仅元数据，安装名待首版上传落库）。 */
    async function createItem(body: CreateItemInput): Promise<WorkshopItemDto> {
        return await $fetch<WorkshopItemDto>("/api/v1/items", {method: "POST", body});
    }

    /** 上传新版本，并把本次条目元数据放进同一个提交边界。 */
    async function uploadVersion(slug: string, input: {file: File; changelog?: string; metadata?: UpdateItemInput}): Promise<ItemVersionDto> {
        const form = new FormData();
        form.append("file", input.file, input.file.name);
        if (input.changelog) {
            form.append("changelog", input.changelog);
        }
        if (input.metadata) {
            form.append("metadata", JSON.stringify(input.metadata));
        }
        return await $fetch<ItemVersionDto>(`/api/v1/items/${slug}/versions`, {method: "POST", body: form});
    }

    /** 放弃无版本草稿并释放 slug。 */
    async function discardItemDraft(slug: string): Promise<void> {
        await $fetch(`/api/v1/me/items/${slug}/draft`, {method: "DELETE"});
    }

    /** 编辑条目元数据 / 上下架（published ↔ unlisted）。 */
    async function updateItem(slug: string, patch: UpdateItemInput): Promise<WorkshopItemDto> {
        return await $fetch<WorkshopItemDto>(`/api/v1/items/${slug}`, {method: "PATCH", body: patch});
    }

    /** 点赞（幂等）。 */
    async function like(slug: string): Promise<LikeStateDto> {
        return await $fetch<LikeStateDto>(`/api/v1/items/${slug}/like`, {method: "PUT"});
    }

    /** 取消点赞（幂等）。 */
    async function unlike(slug: string): Promise<LikeStateDto> {
        return await $fetch<LikeStateDto>(`/api/v1/items/${slug}/like`, {method: "DELETE"});
    }

    /** 收藏（幂等）。 */
    async function favorite(slug: string): Promise<FavoriteStateDto> {
        return await $fetch<FavoriteStateDto>(`/api/v1/items/${slug}/favorite`, {method: "PUT"});
    }

    /** 取消收藏（幂等）。 */
    async function unfavorite(slug: string): Promise<FavoriteStateDto> {
        return await $fetch<FavoriteStateDto>(`/api/v1/items/${slug}/favorite`, {method: "DELETE"});
    }

    /** 发表评论（纯文本）。 */
    async function addComment(slug: string, content: string): Promise<CommentDto> {
        return await $fetch<CommentDto>(`/api/v1/items/${slug}/comments`, {method: "POST", body: {content}});
    }

    /** 删除评论（本人或 admin，软删）。 */
    async function deleteComment(id: number): Promise<void> {
        await $fetch(`/api/v1/comments/${id}`, {method: "DELETE"});
    }

    /** 举报条目（提交理由，等 admin 处理）。 */
    async function report(slug: string, reason: string): Promise<void> {
        await $fetch(`/api/v1/items/${slug}/report`, {method: "POST", body: {reason}});
    }

    /** 我的收藏（分页，仅 published）。 */
    async function myFavorites(page: PageParams = {}): Promise<PageDto<WorkshopItemDto>> {
        return await $fetch<PageDto<WorkshopItemDto>>("/api/v1/me/favorites", {query: page});
    }

    /** 我的发布：本人全部状态条目（含 unlisted）。后端 GET /me/items 于 Web 阶段补齐。 */
    async function myItems(page: PageParams = {}): Promise<PageDto<WorkshopItemDto>> {
        return await $fetch<PageDto<WorkshopItemDto>>("/api/v1/me/items", {query: page});
    }

    /** 作者读取自己任意状态条目的详情，用于 /publish/:slug。 */
    async function getMyItem(slug: string): Promise<WorkshopItemDto> {
        return await $fetch<WorkshopItemDto>(`/api/v1/me/items/${slug}`);
    }

    /** 作者读取自己的完整源包，不计公开下载数。 */
    async function getMyPackage(slug: string, version?: string): Promise<Uint8Array> {
        const bytes = await $fetch<ArrayBuffer>(`/api/v1/me/items/${slug}/package`, {
            query: version ? {version} : {},
            responseType: "arrayBuffer",
        });
        return new Uint8Array(bytes);
    }

    // ---- 账号自管理（cookie session 专属） ----

    /** 本人完整资料（账号设置页预填；hasPassword=false 即 OAuth 免密账号）。 */
    async function getMyProfile(): Promise<MeProfileDto> {
        return await $fetch<MeProfileDto>("/api/v1/me/profile");
    }

    /** 更新资料；成功后服务端已刷新 session，调用方应刷新本地会话态。 */
    async function updateMyProfile(input: UpdateProfileInput): Promise<MeProfileDto> {
        return await $fetch<MeProfileDto>("/api/v1/me/profile", {method: "PATCH", body: input});
    }

    /** 修改密码；无密码账号补设时 currentPassword 缺省。成功后其他设备会话失效。 */
    async function changePassword(input: {currentPassword?: string; newPassword: string}): Promise<void> {
        await $fetch("/api/v1/me/password", {method: "POST", body: input});
    }

    /** 已关联的上游 OAuth 身份列表。 */
    async function listIdentities(): Promise<PassportIdentityDto[]> {
        return await $fetch<PassportIdentityDto[]>("/api/v1/passport/identities");
    }

    /** 解绑上游身份（未设密码时后端 400）。 */
    async function unlinkIdentity(id: number): Promise<void> {
        await $fetch(`/api/v1/passport/identities/${id}`, {method: "DELETE"});
    }

    /** 补全注册页读取 pending GitHub 身份（无则 404）。 */
    async function getPendingOAuth(): Promise<PendingOAuthDto> {
        return await $fetch<PendingOAuthDto>("/api/auth/register/oauth");
    }

    /** GitHub 补全注册（用户名 + 注册码 + 可选邀请码），成功即登录。 */
    async function completeOAuthRegister(input: {username: string; registrationCode: string; inviteCode?: string}): Promise<AuthSessionDto> {
        return await $fetch<AuthSessionDto>("/api/auth/register/oauth", {method: "POST", body: input});
    }

    // ---- 邀请码自管理 ----

    /** 当前用户创建的邀请码列表。 */
    async function listMyInviteCodes(): Promise<InviteCodeDto[]> {
        return await $fetch<InviteCodeDto[]>("/api/v1/me/invite-codes");
    }

    /** 当前用户创建一个邀请码。 */
    async function createMyInviteCode(input: AccessCodeSettingsInput): Promise<InviteCodeDto> {
        return await $fetch<InviteCodeDto>("/api/v1/me/invite-codes", {method: "POST", body: input});
    }

    /** 当前用户修改自己的邀请码。 */
    async function updateMyInviteCode(id: number, input: Partial<AccessCodeSettingsInput> & {disabled?: boolean}): Promise<InviteCodeDto> {
        return await $fetch<InviteCodeDto>(`/api/v1/me/invite-codes/${id}`, {method: "PATCH", body: input});
    }

    // ---- admin ----

    /** 批量签发注册码，返回完整设置与码值。 */
    async function createRegistrationCodes(count: number, input: AccessCodeSettingsInput): Promise<RegistrationCodeDto[]> {
        return await $fetch<RegistrationCodeDto[]>("/api/v1/admin/registration-codes", {method: "POST", body: {count, ...input}});
    }

    /** 管理员注册码全量分页列表。 */
    async function listRegistrationCodes(query: PageParams = {}): Promise<PageDto<RegistrationCodeDto>> {
        return await $fetch<PageDto<RegistrationCodeDto>>("/api/v1/admin/registration-codes", {query});
    }

    /** 修改注册码设置或停用状态。 */
    async function updateRegistrationCode(id: number, input: Partial<AccessCodeSettingsInput> & {disabled?: boolean}): Promise<RegistrationCodeDto> {
        return await $fetch<RegistrationCodeDto>(`/api/v1/admin/registration-codes/${id}`, {method: "PATCH", body: input});
    }

    /** 用户列表（用户名/昵称搜索 + 分页）。 */
    async function listAdminUsers(query: PageParams & {search?: string} = {}): Promise<PageDto<AdminUserDto>> {
        return await $fetch<PageDto<AdminUserDto>>("/api/v1/admin/users", {query});
    }

    /** 封禁 / 解封用户（封禁即踢线）。 */
    async function setUserStatus(id: number, status: "active" | "disabled"): Promise<void> {
        await $fetch(`/api/v1/admin/users/${id}/status`, {method: "PATCH", body: {status}});
    }

    /** 授予 / 收回管理员角色（对方被踢线需重登）。 */
    async function setUserRole(id: number, role: "admin" | "user"): Promise<void> {
        await $fetch(`/api/v1/admin/users/${id}/role`, {method: "PATCH", body: {role}});
    }

    /** 站点统计概览。 */
    async function getAdminStats(): Promise<AdminStatsDto> {
        return await $fetch<AdminStatsDto>("/api/v1/admin/stats");
    }

    /** 各账号云备份用量聚合（按占用倒序）。 */
    async function getBackupUsage(): Promise<AdminBackupUsageDto[]> {
        return await $fetch<AdminBackupUsageDto[]>("/api/v1/admin/backup-usage");
    }

    /** admin 备份行列表（可按归属用户过滤）。 */
    async function listAdminBackups(query: PageParams & {userId?: number} = {}): Promise<PageDto<AdminBackupDto>> {
        return await $fetch<PageDto<AdminBackupDto>>("/api/v1/admin/backups", {query});
    }

    /** admin 删除任意账号备份（幂等）。 */
    async function adminDeleteBackup(id: number): Promise<void> {
        await $fetch(`/api/v1/admin/backups/${id}`, {method: "DELETE"});
    }

    /** 举报列表（未处理在前，分页）。 */
    async function listReports(page: PageParams = {}): Promise<PageDto<ReportDto>> {
        return await $fetch<PageDto<ReportDto>>("/api/v1/admin/reports", {query: page});
    }

    /** 处理举报（幂等，保留首次处理时间）。 */
    async function resolveReport(id: number): Promise<ReportDto> {
        return await $fetch<ReportDto>(`/api/v1/admin/reports/${id}/resolve`, {method: "POST"});
    }

    /** 下架 / 恢复条目（admin，不受作者 status 限制）。 */
    async function setItemStatus(id: number, status: "published" | "removed"): Promise<WorkshopItemDto> {
        return await $fetch<WorkshopItemDto>(`/api/v1/admin/items/${id}/status`, {method: "PATCH", body: {status}});
    }

    /** 设置 / 取消精选（admin），精选条目进首页「编辑推荐」。 */
    async function setItemFeatured(id: number, featured: boolean): Promise<WorkshopItemDto> {
        return await $fetch<WorkshopItemDto>(`/api/v1/admin/items/${id}/featured`, {method: "PATCH", body: {featured}});
    }

    // ---- Passport：设备码批准与实例授权管理（cookie session 专属） ----

    /** /link 页查待批设备码。 */
    async function getPendingDevice(userCode: string): Promise<PendingDeviceDto> {
        return await $fetch<PendingDeviceDto>(`/api/v1/passport/device/${encodeURIComponent(userCode)}`);
    }

    /** 批准设备码（instanceName 可覆盖实例建议名）。 */
    async function approveDevice(userCode: string, instanceName: string): Promise<void> {
        await $fetch(`/api/v1/passport/device/${encodeURIComponent(userCode)}/approve`, {method: "POST", body: {instanceName}});
    }

    /** 拒绝设备码。 */
    async function denyDevice(userCode: string): Promise<void> {
        await $fetch(`/api/v1/passport/device/${encodeURIComponent(userCode)}/deny`, {method: "POST"});
    }

    /** 本账号全部实例授权（含已吊销）。 */
    async function listAuthorizations(): Promise<AuthorizationDto[]> {
        return await $fetch<AuthorizationDto[]>("/api/v1/passport/authorizations");
    }

    /** 重命名实例授权。 */
    async function renameAuthorization(id: number, instanceName: string): Promise<AuthorizationDto> {
        return await $fetch<AuthorizationDto>(`/api/v1/passport/authorizations/${id}`, {method: "PATCH", body: {instanceName}});
    }

    /** 吊销实例授权：整条 token 链立即失效。 */
    async function revokeAuthorization(id: number): Promise<void> {
        await $fetch(`/api/v1/passport/authorizations/${id}`, {method: "DELETE"});
    }

    // ---- Backup：云备份管理（面板走 cookie session） ----

    /** 备份列表 + 配额用量。 */
    async function listBackups(instanceLabel?: string): Promise<BackupListDto> {
        return await $fetch<BackupListDto>("/api/v1/backups", {query: instanceLabel ? {instanceLabel} : {}});
    }

    /** 备份下载地址（<a> 直下，浏览器自动带 cookie）。 */
    function backupDownloadHref(id: number): string {
        return `/api/v1/backups/${id}/download`;
    }

    /** 删除备份（幂等）。 */
    async function deleteBackup(id: number): Promise<void> {
        await $fetch(`/api/v1/backups/${id}`, {method: "DELETE"});
    }

    return {
        listItems, getItem, getVersions, getComments, downloadHref, getUser, getMeta,
        getPackageFiles, getPackageFileContent,
        createItem, uploadVersion, discardItemDraft, updateItem, like, unlike, favorite, unfavorite,
        addComment, deleteComment, report, myFavorites, myItems, getMyItem, getMyPackage,
        getMyProfile, updateMyProfile, changePassword, listIdentities, unlinkIdentity,
        getPendingOAuth, completeOAuthRegister,
        listMyInviteCodes, createMyInviteCode, updateMyInviteCode,
        createRegistrationCodes, listRegistrationCodes, updateRegistrationCode,
        listReports, resolveReport, setItemStatus, setItemFeatured,
        listAdminUsers, setUserStatus, setUserRole, getAdminStats, getBackupUsage, listAdminBackups, adminDeleteBackup,
        getPendingDevice, approveDevice, denyDevice,
        listAuthorizations, renameAuthorization, revokeAuthorization,
        listBackups, backupDownloadHref, deleteBackup,
    };
}
