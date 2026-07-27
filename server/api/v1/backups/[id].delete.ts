import {rm} from "node:fs/promises";
import {prisma} from "../../../database/prisma";
import {backupFilePath} from "../../../utils/backup-files";
import {requireAccess} from "../../../utils/passport-guard";
import {requireIdParam} from "../../../utils/workshop";

/**
 * 删除备份（spec §9.2，backup:write）：幂等，不存在也返回 200。
 * 先删行再 best-effort 删文件（残留孤儿文件无害，行是真相源）。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const {user} = await requireAccess(event, "backup:write");
    const id = requireIdParam(event);

    const backup = await prisma.instanceBackup.findFirst({where: {id, userId: user.id}});
    if (backup) {
        await prisma.instanceBackup.delete({where: {id: backup.id}});
        if (backup.storagePath) {
            await rm(backupFilePath(backup.storagePath), {force: true}).catch(() => undefined);
        }
    }
    return {ok: true};
});
