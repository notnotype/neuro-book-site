import type {BackupDto} from "../../../../shared/dto/backup.dto";
import {prisma} from "../../../database/prisma";
import {toBackupDto} from "../../../utils/backup-dto";
import {requireAccess} from "../../../utils/passport-guard";
import {requireIdParam} from "../../../utils/workshop";
import {apiError} from "../../../utils/api-error";

/**
 * 单条备份元数据（spec §9.2，backup:read）：仅本人可见，越权一律 404。
 */
export default defineEventHandler(async (event): Promise<BackupDto> => {
    const {user} = await requireAccess(event, "backup:read");
    const id = requireIdParam(event);
    const backup = await prisma.instanceBackup.findFirst({where: {id, userId: user.id}});
    if (!backup) {
        throw apiError(404, "backup_not_found", "Backup not found");
    }
    return toBackupDto(backup);
});
