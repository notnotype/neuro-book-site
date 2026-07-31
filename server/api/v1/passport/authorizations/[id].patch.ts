import type {AuthorizationDto} from "../../../../../shared/dto/passport.dto";
import {prisma} from "../../../../database/prisma";
import {requireCurrentUser} from "../../../../utils/auth";
import {validateBody} from "../../../../utils/dto";
import {RenameAuthorizationRequestSchema, toAuthorizationDto} from "../../../../utils/passport-dto";
import {requireIdParam} from "../../../../utils/workshop";
import {apiError} from "../../../../utils/api-error";

/**
 * 重命名实例授权（spec §8，cookie session 专属）：仅本人授权可改。
 */
export default defineEventHandler(async (event): Promise<AuthorizationDto> => {
    const user = await requireCurrentUser(event);
    const id = requireIdParam(event);
    const body = await validateBody(event, RenameAuthorizationRequestSchema);

    const authorization = await prisma.passportAuthorization.findFirst({where: {id, userId: user.id}});
    if (!authorization) {
        throw apiError(404, "authorization_not_found", "Authorization not found");
    }
    const updated = await prisma.passportAuthorization.update({
        where: {id: authorization.id},
        data: {instanceName: body.instanceName},
    });
    return toAuthorizationDto(updated);
});
