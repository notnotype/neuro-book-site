import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {prisma} from "../../../../database/prisma";
import {backupFilePath} from "../../../../utils/backup-files";
import {requireAccess} from "../../../../utils/passport-guard";
import {requireIdParam} from "../../../../utils/workshop";

/**
 * 下载备份字节流（spec §9.2，backup:read）：响应头带 x-nb-sha256 供客户端校验。
 * 数据库有行但磁盘文件缺失属于部署事故，按 404 报告。
 */
export default defineEventHandler(async (event) => {
    const {user} = await requireAccess(event, "backup:read");
    const id = requireIdParam(event);
    const backup = await prisma.instanceBackup.findFirst({where: {id, userId: user.id}});
    if (!backup) {
        throw createError({statusCode: 404, message: "备份不存在"});
    }

    const filePath = backupFilePath(backup.storagePath);
    let fileSize: number;
    try {
        fileSize = (await stat(filePath)).size;
    } catch {
        throw createError({statusCode: 404, message: "备份文件不存在"});
    }

    setHeaders(event, {
        "content-type": "application/vnd.neurobook.backup",
        "content-length": fileSize,
        "content-disposition": `attachment; filename="neurobook-backup-${backup.id}.nbbackup"`,
        "x-nb-sha256": backup.sha256,
    });
    return sendStream(event, createReadStream(filePath));
});
