import {rm} from "node:fs/promises";
import {prisma} from "../../../../database/prisma";
import {backupFilePath} from "../../../../utils/backup-files";
import {requireAdmin, requireIdParam} from "../../../../utils/workshop";

/**
 * admin 删除任意账号的备份（清理磁盘异常占用）：幂等，先删行再 best-effort 删文件。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    await requireAdmin(event);
    const id = requireIdParam(event);

    const backup = await prisma.instanceBackup.findUnique({where: {id}});
    if (backup) {
        await prisma.instanceBackup.delete({where: {id: backup.id}});
        if (backup.storagePath) {
            await rm(backupFilePath(backup.storagePath), {force: true}).catch(() => undefined);
        }
    }
    return {ok: true};
});
