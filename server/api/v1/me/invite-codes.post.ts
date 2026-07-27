import {randomBytes} from "node:crypto";
import type {InviteCodeDto} from "../../../../shared/dto/access-code.dto";
import {prisma} from "../../../database/prisma";
import {toAccessCodeDto} from "../../../utils/access-code";
import {CreateInviteCodeRequestSchema} from "../../../utils/access-code-dto";
import {requireCurrentUser} from "../../../utils/auth";
import {validateBody} from "../../../utils/dto";

/** 当前用户创建一个邀请码；邀请码只记录邀请归属，不授予注册资格。 */
export default defineEventHandler(async (event): Promise<InviteCodeDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CreateInviteCodeRequestSchema);
    const code = await prisma.inviteCode.create({
        data: {
            code: `nbi-${randomBytes(9).toString("base64url")}`,
            note: body.note,
            maxUses: body.maxUses,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            ownerId: user.id,
        },
    });
    return toAccessCodeDto(code);
});
