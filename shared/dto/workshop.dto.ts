// Workshop 输出 DTO：前后端共享的响应结构定义。
// 请求校验（zod schema）在 server/utils/workshop-dto.ts，这里只放纯类型。

// 资产类型：三类资产共享根 package.json 外壳。
export type WorkshopItemType = "skill" | "workflow" | "profile";

// 条目状态：published 公开；unlisted 作者自主下架；removed admin 下架
export type WorkshopItemStatus = "published" | "unlisted" | "removed";

// 分页返回结构（对齐 NeuroBook Page 惯例，offset/limit 制）
export type PageDto<T> = {
    items: T[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset?: number; // 仅 hasMore 为 true 时存在
};

// 条目作者 / 评论作者摘要
export type ItemAuthorDto = {
    id: number;
    username: string;
    displayName: string;
    avatarUrl: string; // 空串表示未设置，前端回落首字母色块
};

// 当前登录用户与条目的关系（仅登录用户请求详情时返回）
export type ItemViewerStateDto = {
    liked: boolean;
    favorited: boolean;
};

// 工坊条目（列表与详情共用；列表场景 description 仍返回原文，第一版不做截断裁剪）
export type WorkshopItemDto = {
    id: number;
    slug: string;
    name: string; // 安装名，取自首版 manifest；尚未上传首版时为空字符串
    type: WorkshopItemType;
    title: string;
    summary: string;
    description: string; // markdown 原文
    tags: string[];
    status: WorkshopItemStatus;
    featured: boolean; // admin 打标的「编辑推荐」
    downloadCount: number;
    likeCount: number;
    commentCount: number;
    latestVersion: string | null; // 尚未上传任何版本时为 null
    author: ItemAuthorDto;
    createdAt: string; // ISO 时间
    updatedAt: string; // ISO 时间
    viewer?: ItemViewerStateDto; // 未登录请求时缺省
};

// 条目版本（一次 zip 上传）
export type ItemVersionDto = {
    id: number;
    version: string;
    changelog: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    minAppVersion: string | null; // null 表示作者未声明 NeuroBook 兼容下限
    createdAt: string;
};

// 评论（纯文本；软删除的评论不会出现在任何响应里）
export type CommentDto = {
    id: number;
    content: string;
    author: ItemAuthorDto;
    createdAt: string;
};

// 作者公开页：资料 + 其全部 published 条目
export type PublicUserDto = {
    username: string;
    displayName: string;
    avatarUrl: string; // 空串表示未设置
    bio: string; // 个性签名；空串表示未填写
    websiteUrl: string; // 个人网站；空串表示未填写
    joinedAt: string;
    items: WorkshopItemDto[];
};

// 点赞操作后的最新状态
export type LikeStateDto = {
    liked: boolean;
    likeCount: number;
};

// 收藏操作后的最新状态
export type FavoriteStateDto = {
    favorited: boolean;
};

// 平台元信息（预留客户端握手）
export type WorkshopMetaDto = {
    platform: "neuro-book-site";
    platformVersion: string; // 平台自身版本（package.json version）
    apiVersion: 1;
    packageSchemaVersion: 1;
    itemTypes: WorkshopItemType[];
};

// 举报（admin 视角）
export type ReportDto = {
    id: number;
    itemId: number;
    itemSlug: string;
    itemTitle: string;
    reporter: string; // 举报人 username
    reason: string;
    createdAt: string;
    resolvedAt: string | null; // null 表示未处理
};

// 包内单个文件（在线预览用）
export type PackageFileDto = {
    path: string; // zip 内相对路径
    size: number; // 字节数
    previewable: boolean; // false 表示二进制或超过预览大小上限
};

// 包文件列表（在线预览用）
export type PackageFileListDto = {
    version: string; // 实际解析的 SemVer（请求缺省 version 时为最新版）
    files: PackageFileDto[];
};

// 包内文本文件内容（在线预览用）
export type PackageFileContentDto = {
    path: string;
    size: number;
    content: string; // UTF-8 解码后的文本
};
