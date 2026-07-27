import type {InviteCodeDto} from "../../../../shared/dto/access-code.dto";
import {prisma} from "../../../database/prisma";
import {toAccessCodeDto} from "../../../utils/access-code";
import {requireCurrentUser} from "../../../utils/auth";

/** 当前用户创建的全部邀请码，新创建优先。 */
export default defineEventHandler(async (event): Promise<InviteCodeDto[]> => {
    const user = await requireCurrentUser(event);
    const codes = await prisma.inviteCode.findMany({where: {ownerId: user.id}, orderBy: {id: "desc"}});
    return codes.map(toAccessCodeDto);
});
