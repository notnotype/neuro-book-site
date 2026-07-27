import {mkdir, open} from "node:fs/promises";
import {dirname} from "node:path";
import {isMemoryDatabase, resolveSqliteFilePath} from "../server/utils/sqlite-file";

const databaseUrl = process.env.DATABASE_URL?.trim() || "file:./data.db";

/**
 * 确保 Prisma migrate deploy 使用的本地 SQLite 文件已经存在。
 */
async function main(): Promise<void> {
    if (isMemoryDatabase(databaseUrl)) {
        console.log("Skip SQLite file creation for in-memory database.");
        return;
    }

    const databasePath = resolveSqliteFilePath(databaseUrl);
    await mkdir(dirname(databasePath), {recursive: true});

    const file = await open(databasePath, "a");
    await file.close();
    console.log(`SQLite database file is ready: ${databasePath}`);
}

await main();
