import type {PassportIdentityDto} from "../../../../../shared/dto/passport.dto";
import {prisma} from "../../../../database/prisma";
import {requireCurrentUser} from "../../../../utils/auth";

/**
 * 列出本账号已关联的上游 OAuth 身份（spec §5.2，cookie session 专属）。
 */
export default defineEventHandler(async (event): Promise<PassportIdentityDto[]> => {
    const user = await requireCurrentUser(event);
    const identities = await prisma.passportIdentity.findMany({
        where: {userId: user.id},
        orderBy: {createdAt: "asc"},
    });
    return identities.map((identity) => ({
        id: identity.id,
        provider: identity.provider as PassportIdentityDto["provider"],
        providerUsername: identity.providerUsername,
        createdAt: identity.createdAt.toISOString(),
    }));
});
