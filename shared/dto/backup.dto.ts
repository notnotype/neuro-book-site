// Backup 模块公开 DTO（reference/passport/api-v1.md §9）。请求校验 zod schema 见 server/utils/backup-dto.ts。

/** 备份条目 */
export type BackupDto = {
    id: number;
    instanceLabel: string; // 上传时授权的实例名快照
    kind: "manual" | "auto";
    fileSize: number;
    sha256: string; // 完整密文 envelope 的摘要
    keyId: string; // 16 位小写 hex，只用于客户端选择解密密钥
    appVersion: string;
    comment: string;
    createdAt: string;
};

/** 配额与用量（列表响应附带，面板用量条与实例端预检共用） */
export type BackupQuotaDto = {
    usedBytes: number;
    maxBytes: number;
    count: number;
    maxCount: number;
    maxFileBytes: number;
};

/** 备份列表响应 */
export type BackupListDto = {
    items: BackupDto[];
    quota: BackupQuotaDto;
};

/** 上传 meta 字段（multipart 的 meta JSON） */
export type BackupUploadMetaDto = {
    sha256: string; // 64 位小写 hex，客户端对完整密文 envelope 预计算
    keyId: string; // 16 位小写 hex，不包含密钥材料
    appVersion: string;
    kind: "manual" | "auto";
    comment?: string; // 为空表示无备注
    rotate?: boolean; // true 时配额不足自动淘汰同 instanceLabel 最旧的 auto 备份
};
