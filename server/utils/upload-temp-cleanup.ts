import {mkdir, readdir, rm, stat} from "node:fs/promises";
import {join} from "node:path";
import {backupTmpDir} from "./backup-files";
import {workshopTmpDir} from "./workshop-files";

/** 上传中转文件最长保留时间，默认 24 小时。 */
function uploadTempMaxAgeMs(): number {
    const value = Number.parseInt(process.env.NB_UPLOAD_TMP_MAX_AGE_MS?.trim() ?? "", 10);
    return Number.isSafeInteger(value) && value > 0 ? value : 24 * 60 * 60 * 1000;
}

/** 清理单个 tmp 目录中过期的 .part 文件；未知文件和目录保持不动。 */
export async function cleanupUploadTempDirectory(
    directory: string,
    now = Date.now(),
    maxAgeMs = uploadTempMaxAgeMs(),
): Promise<number> {
    await mkdir(directory, {recursive: true});
    const entries = await readdir(directory, {withFileTypes: true});
    let removed = 0;
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".part")) {
            continue;
        }
        const path = join(directory, entry.name);
        const file = await stat(path);
        if (now - file.mtimeMs < maxAgeMs) {
            continue;
        }
        await rm(path, {force: true});
        removed += 1;
    }
    return removed;
}

/** 启动时清理 Workshop 与 Backup 的过期中转文件。 */
export async function cleanupUploadTempFiles(): Promise<number> {
    const removed = await Promise.all([
        cleanupUploadTempDirectory(workshopTmpDir()),
        cleanupUploadTempDirectory(backupTmpDir()),
    ]);
    return removed[0] + removed[1];
}
