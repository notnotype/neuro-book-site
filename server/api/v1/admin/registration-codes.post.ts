import {randomBytes} from "node:crypto";
import type {RegistrationCodeDto} from "../../../../shared/dto/access-code.dto";
import {prisma} from "../../../database/prisma";
import {toAccessCodeDto} from "../../../utils/access-code";
import {CreateRegistrationCodesRequestSchema} from "../../../utils/access-code-dto";
import {validateBody} from "../../../utils/dto";
import {requireAdmin} from "../../../utils/workshop";

/** 批量签发注册码；maxUses=null 表示不限次数，expiresAt=null 表示永不过期。 */
export default defineEventHandler(async (event): Promise<RegistrationCodeDto[]> => {
    const admin = await requireAdmin(event);
    const body = await validateBody(event, CreateRegistrationCodesRequestSchema);
    const codes = Array.from({length: body.count}, () => `nbr-${randomBytes(9).toString("base64url")}`);
    await prisma.registrationCode.createMany({
        data: codes.map((code) => ({
            code,
            note: body.note,
            maxUses: body.maxUses,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            createdById: admin.id,
        })),
    });
    const created = await prisma.registrationCode.findMany({where: {code: {in: codes}}, orderBy: {id: "asc"}});
    return created.map(toAccessCodeDto);
});
