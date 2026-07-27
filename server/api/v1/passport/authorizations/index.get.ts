import type {AuthorizationDto} from "../../../../../shared/dto/passport.dto";
import {prisma} from "../../../../database/prisma";
import {requireCurrentUser} from "../../../../utils/auth";
import {toAuthorizationDto} from "../../../../utils/passport-dto";

/**
 * 列出本账号全部实例授权（spec §8，cookie session 专属）：含已吊销，前端可过滤。
 */
export default defineEventHandler(async (event): Promise<AuthorizationDto[]> => {
    const user = await requireCurrentUser(event);
    const authorizations = await prisma.passportAuthorization.findMany({
        where: {userId: user.id},
        orderBy: {createdAt: "desc"},
    });
    return authorizations.map((authorization) => toAuthorizationDto(authorization));
});
