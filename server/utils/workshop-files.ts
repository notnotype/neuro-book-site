import {mkdir, readFile, rename} from "node:fs/promises";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {createError} from "h3";

// 版本 zip 的本地磁盘存储。根目录走 env 配置，布局 <filesDir>/<itemId>/<version>.zip。

/**
 * zip 文件存储根目录：env WORKSHOP_FILES_DIR，默认 ./data/files（相对进程 CWD）。
 */
export function workshopFilesDir(): string {
    const raw = process.env.WORKSHOP_FILES_DIR?.trim() || "./data/files";
    return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/**
 * 版本 zip 的落盘路径。
 */
export function versionZipPath(itemId: number, version: number): string {
    return join(workshopFilesDir(), String(itemId), `${version}.zip`);
}

/**
 * Workshop 上传中转目录；与最终文件同盘，保证 rename 原子。
 */
export function workshopTmpDir(): string {
    return join(workshopFilesDir(), "tmp");
}

/**
 * 将已验证的同盘临时 zip 原子提交到版本路径。
 */
export async function commitVersionZip(tmpPath: string, itemId: number, version: number): Promise<void> {
    const finalPath = versionZipPath(itemId, version);
    await mkdir(dirname(finalPath), {recursive: true});
    await rename(tmpPath, finalPath);
}

/**
 * 读取版本 zip 字节；文件缺失时抛 404（数据库有记录但磁盘文件丢失属于部署事故）。
 */
export async function readVersionZip(itemId: number, version: number): Promise<Buffer> {
    try {
        return await readFile(versionZipPath(itemId, version));
    } catch {
        throw createError({statusCode: 404, message: "版本文件不存在"});
    }
}
