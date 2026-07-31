import type {InviteCodeDto} from "../../../../../shared/dto/access-code.dto";
import {prisma} from "../../../../database/prisma";
import {toAccessCodeDto} from "../../../../utils/access-code";
import {UpdateAccessCodeRequestSchema} from "../../../../utils/access-code-dto";
import {requireCurrentUser} from "../../../../utils/auth";
import {validateBody} from "../../../../utils/dto";
import {requireIdParam} from "../../../../utils/workshop";
import {apiError} from "../../../../utils/api-error";

/** 创建者修改自己的邀请码；他人邀请码统一按不存在处理。 */
export default defineEventHandler(async (event): Promise<InviteCodeDto> => {
    const user = await requireCurrentUser(event);
    const id = requireIdParam(event);
    const body = await validateBody(event, UpdateAccessCodeRequestSchema);
    const existing = await prisma.inviteCode.findFirst({where: {id, ownerId: user.id}});
    if (!existing) {
        throw apiError(404, "invite_code_not_found", "Invite code not found");
    }
    const result = await prisma.inviteCode.updateMany({
        where: {
            id,
            ownerId: user.id,
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
    const updated = await prisma.inviteCode.findUniqueOrThrow({where: {id}});
    return toAccessCodeDto(updated);
});
