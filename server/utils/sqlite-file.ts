import {isAbsolute, resolve} from "node:path";
import {fileURLToPath} from "node:url";

/** 判断 SQLite URL 是否指向内存数据库。 */
export function isMemoryDatabase(url: string): boolean {
    return url === "file::memory:" || url.includes("mode=memory");
}

/** 把本站支持的 file: SQLite URL 解析成本地文件路径。 */
export function resolveSqliteFilePath(url: string): string {
    if (!url.startsWith("file:")) {
        throw new Error(`只支持 file: SQLite URL，当前为：${url}`);
    }
    if (isMemoryDatabase(url)) {
        throw new Error("内存数据库没有持久文件路径");
    }
    if (url.startsWith("file://")) {
        return fileURLToPath(url);
    }
    const pathPart = url.slice("file:".length).split(/[?#]/, 1)[0];
    if (!pathPart) {
        throw new Error("DATABASE_URL 缺少 SQLite 文件路径");
    }
    return isAbsolute(pathPart) ? pathPart : resolve(process.cwd(), pathPart);
}

/** 解析当前环境的 SQLite 持久文件路径。 */
export function databaseFilePath(): string {
    return resolveSqliteFilePath(process.env.DATABASE_URL?.trim() || "file:./data.db");
}
