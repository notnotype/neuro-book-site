import type {RegistrationCodeDto} from "../../../../../shared/dto/access-code.dto";
import {prisma} from "../../../../database/prisma";
import {toAccessCodeDto} from "../../../../utils/access-code";
import {UpdateAccessCodeRequestSchema} from "../../../../utils/access-code-dto";
import {validateBody} from "../../../../utils/dto";
import {requireAdmin, requireIdParam} from "../../../../utils/workshop";
import {apiError} from "../../../../utils/api-error";

/** 修改注册码限制或停用状态；已使用次数不能被新的有限上限截断。 */
export default defineEventHandler(async (event): Promise<RegistrationCodeDto> => {
    await requireAdmin(event);
    const id = requireIdParam(event);
    const body = await validateBody(event, UpdateAccessCodeRequestSchema);
    const existing = await prisma.registrationCode.findUnique({where: {id}});
    if (!existing) {
        throw apiError(404, "registration_code_not_found", "Registration code not found");
    }
    const result = await prisma.registrationCode.updateMany({
        where: {
            id,
            ...(body.maxUses !== undefined && body.maxUses !== null ? {usedCount: {lte: body.maxUses}} : {}),
        },
        data: {
            ...(body.note !== undefined ? {note: body.note} : {}),
            ...(body.maxUses !== undefined ? {maxUses: body.maxUses} : {}),
            ...(body.expiresAt !== undefined ? {expiresAt: body.expiresAt ? new Date(body.expiresAt) : null} : {}),
            ...(body.disabled !== undefined ? {disabledAt: body.disabled ? new Date() : null} : {}),
        },
    });
    if (result.count !== 1) {
        throw apiError(400, "max_uses_below_used", "Maximum uses cannot be below current uses", {field: "maxUses"});
    }
    const updated = await prisma.registrationCode.findUniqueOrThrow({where: {id}});
    return toAccessCodeDto(updated);
});
