import {access, link, mkdir, open, readFile, rm, unlink} from "node:fs/promises";
import type {FileHandle} from "node:fs/promises";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {createError} from "h3";

// 版本 zip 的本地磁盘存储。根目录走 env 配置，布局 <filesDir>/<itemId>/<ordinal>.zip。

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
export function versionZipPath(itemId: number, ordinal: number): string {
    return join(workshopFilesDir(), String(itemId), `${ordinal}.zip`);
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
export async function commitVersionZip(tmpPath: string, itemId: number, ordinal: number): Promise<void> {
    const finalPath = versionZipPath(itemId, ordinal);
    await mkdir(dirname(finalPath), {recursive: true});
    // Windows 的 FlushFileBuffers 需要可写句柄；r+ 同时保留 Linux fsync 语义。
    const temporary = await open(tmpPath, "r+");
    try {
        await temporary.sync();
    } finally {
        await temporary.close();
    }
    try {
        // 同盘 hard link 是不覆盖目标的原子提交；随后删除临时目录项，不复制归档字节。
        await link(tmpPath, finalPath);
    } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
        if (code === "EEXIST") {
            throw createError({statusCode: 409, message: "版本文件目标已存在，必须先完成孤儿状态检查"});
        }
        throw error;
    }
    await unlink(tmpPath);
    await syncDirectory(dirname(finalPath));
}

/** 删除数据库事务失败后留下的最终文件。 */
export async function removeVersionZip(itemId: number, ordinal: number): Promise<void> {
    const path = versionZipPath(itemId, ordinal);
    await rm(path, {force: true});
    await syncDirectory(dirname(path));
}

/** 判断确定性版本路径是否存在。 */
export async function versionZipExists(itemId: number, ordinal: number): Promise<boolean> {
    return await pathExists(versionZipPath(itemId, ordinal));
}

async function pathExists(path: string): Promise<boolean> {
    return await access(path).then(() => true).catch(() => false);
}

/** Linux 上同步目录项；Windows/不支持目录 fsync 的开发环境只跳过已知错误。 */
async function syncDirectory(path: string): Promise<void> {
    let directory: FileHandle | undefined;
    try {
        directory = await open(path, "r");
        await directory.sync();
    } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
        if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP"].includes(code)) {
            throw error;
        }
    } finally {
        await directory?.close();
    }
}

/**
 * 读取版本 zip 字节；文件缺失时抛 404（数据库有记录但磁盘文件丢失属于部署事故）。
 */
export async function readVersionZip(itemId: number, ordinal: number): Promise<Buffer> {
    try {
        return await readFile(versionZipPath(itemId, ordinal));
    } catch {
        throw createError({statusCode: 404, message: "版本文件不存在"});
    }
}
