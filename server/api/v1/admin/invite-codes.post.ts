import {randomBytes} from "node:crypto";
import type {InviteCodeDto} from "../../../../shared/dto/workshop.dto";
import {prisma} from "../../../database/prisma";
import {requireAdmin, toInviteCodeDto} from "../../../utils/workshop";
import {CreateInviteCodesRequestSchema} from "../../../utils/workshop-dto";
import {validateBody} from "../../../utils/dto";

/**
 * admin 批量签发邀请码：响应即码明文（一码一人，注册消费后作废）。
 */
export default defineEventHandler(async (event): Promise<InviteCodeDto[]> => {
    const admin = await requireAdmin(event);
    const body = await validateBody(event, CreateInviteCodesRequestSchema);

    const codes = Array.from({length: body.count}, () => `nbw-${randomBytes(6).toString("hex")}`);
    await prisma.inviteCode.createMany({
        data: codes.map((code) => ({code, note: body.note, createdById: admin.id})),
    });

    const created = await prisma.inviteCode.findMany({
        where: {code: {in: codes}},
        include: {usedBy: true},
        orderBy: {id: "asc"},
    });
    return created.map(toInviteCodeDto);
});
