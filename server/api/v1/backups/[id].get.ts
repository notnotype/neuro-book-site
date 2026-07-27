import type {BackupDto} from "../../../../shared/dto/backup.dto";
import {prisma} from "../../../database/prisma";
import {toBackupDto} from "../../../utils/backup-dto";
import {requireAccess} from "../../../utils/passport-guard";
import {requireIdParam} from "../../../utils/workshop";

/**
 * 单条备份元数据（spec §9.2，backup:read）：仅本人可见，越权一律 404。
 */
export default defineEventHandler(async (event): Promise<BackupDto> => {
    const {user} = await requireAccess(event, "backup:read");
    const id = requireIdParam(event);
    const backup = await prisma.instanceBackup.findFirst({where: {id, userId: user.id}});
    if (!backup) {
        throw createError({statusCode: 404, message: "备份不存在"});
    }
    return toBackupDto(backup);
});
