import type {MeProfileDto} from "../../../../shared/dto/auth.dto";
import {requireCurrentUser, setAuthSession, toAuthUser, toMeProfileDto} from "../../../utils/auth";
import {UpdateProfileRequestDtoSchema, validateBody} from "../../../utils/dto";
import {prisma} from "../../../database/prisma";

/**
 * 更新本人资料（spec §5.1，cookie session 专属）。
 * 成功后重写 session，让顶栏昵称/头像立即生效。
 */
export default defineEventHandler(async (event): Promise<MeProfileDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, UpdateProfileRequestDtoSchema);

    const updated = await prisma.user.update({
        where: {id: user.id},
        data: {
            displayName: body.displayName,
            bio: body.bio,
            websiteUrl: body.websiteUrl,
            avatarUrl: body.avatarUrl,
        },
    });
    await setAuthSession(event, toAuthUser(updated));
    return toMeProfileDto(updated);
});
