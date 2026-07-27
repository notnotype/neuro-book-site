import {isAbsolute, join, resolve} from "node:path";

// 备份归档的本地磁盘存储与配额配置（spec §9.3）。归档对服务端是 opaque blob，
// 布局 <backupDir>/<userId>/<backupId>.nbbackup，上传中转在 <backupDir>/tmp/。

/**
 * 数值 env 读取：未设置或非法时用默认值。
 */
function envInt(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) {
        return fallback;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * 备份存储根目录：env NB_BACKUP_DIR，默认 ./data/backups（相对进程 CWD）。
 */
export function backupDir(): string {
    const raw = process.env.NB_BACKUP_DIR?.trim() || "./data/backups";
    return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/**
 * 上传中转目录：与最终落位同盘，保证 rename 原子。
 */
export function backupTmpDir(): string {
    return join(backupDir(), "tmp");
}

/**
 * storagePath（相对 backupDir）→ 绝对路径。
 */
export function backupFilePath(storagePath: string): string {
    return join(backupDir(), storagePath);
}

/** 单份备份体积上限（字节），默认 1 GiB。env NB_BACKUP_MAX_FILE_BYTES */
export function backupMaxFileBytes(): number {
    return envInt("NB_BACKUP_MAX_FILE_BYTES", 1024 * 1024 * 1024);
}

/** 每账号总量配额（字节），默认 2 GiB。env NB_BACKUP_QUOTA_BYTES */
export function backupQuotaBytes(): number {
    return envInt("NB_BACKUP_QUOTA_BYTES", 2 * 1024 * 1024 * 1024);
}

/** 每账号备份份数上限，默认 5。env NB_BACKUP_MAX_COUNT */
export function backupMaxCount(): number {
    return envInt("NB_BACKUP_MAX_COUNT", 5);
}
