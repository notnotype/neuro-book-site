import {z} from "zod";
import type {BackupDto, BackupQuotaDto} from "../../shared/dto/backup.dto";
import type {InstanceBackup} from "../database/prisma";
import {backupMaxCount, backupMaxFileBytes, backupQuotaBytes} from "./backup-files";

// Backup 请求校验 schema 与 DTO 映射。输出 DTO 纯类型见 shared/dto/backup.dto.ts。

// 上传 meta（multipart 的 meta 字段，JSON 字符串）
export const BackupUploadMetaSchema = z.object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 必须是 64 位小写 hex"),
    keyId: z.string().regex(/^[0-9a-f]{16}$/, "keyId 必须是 16 位小写 hex"),
    appVersion: z.string().trim().min(1, "appVersion 不能为空").max(50),
    kind: z.enum(["manual", "auto"], "kind 必须是 manual 或 auto"),
    comment: z.string().trim().max(500).default(""),
    rotate: z.boolean().default(false),
});

export type BackupUploadMeta = z.infer<typeof BackupUploadMetaSchema>;

// 列表查询：instanceLabel 可选过滤
export const ListBackupsQuerySchema = z.object({
    instanceLabel: z.string().trim().min(1).max(64).optional(),
});

/**
 * 备份实体 → DTO。
 */
export function toBackupDto(backup: InstanceBackup): BackupDto {
    return {
        id: backup.id,
        instanceLabel: backup.instanceLabel,
        kind: backup.kind as "manual" | "auto",
        fileSize: backup.fileSize,
        sha256: backup.sha256,
        keyId: backup.keyId,
        appVersion: backup.appVersion,
        comment: backup.comment,
        createdAt: backup.createdAt.toISOString(),
    };
}

/**
 * 组装配额 DTO（usedBytes / count 由调用方聚合传入）。
 */
export function buildQuotaDto(usedBytes: number, count: number): BackupQuotaDto {
    return {
        usedBytes,
        maxBytes: backupQuotaBytes(),
        count,
        maxCount: backupMaxCount(),
        maxFileBytes: backupMaxFileBytes(),
    };
}
