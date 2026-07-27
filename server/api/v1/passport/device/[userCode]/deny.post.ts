import {prisma} from "../../../../../database/prisma";
import {requireCurrentUser} from "../../../../../utils/auth";
import {normalizeUserCode} from "../../../../../utils/passport";

/**
 * /link 页拒绝设备码（spec §6.3，cookie session 专属）：仅 pending 可拒绝。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    const userCode = normalizeUserCode(decodeURIComponent(getRouterParam(event, "userCode") ?? ""));

    const code = await prisma.passportDeviceCode.findUnique({where: {userCode}});
    if (!code) {
        throw createError({statusCode: 404, message: "设备码不存在，请核对输入"});
    }
    const updated = await prisma.passportDeviceCode.updateMany({
        where: {id: code.id, status: "pending"},
        data: {status: "denied", approvedById: user.id},
    });
    if (updated.count === 0) {
        throw createError({statusCode: 409, message: "设备码已被处理或已过期"});
    }
    return {ok: true};
});
