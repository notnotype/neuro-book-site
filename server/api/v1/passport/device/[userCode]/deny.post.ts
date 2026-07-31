import {prisma} from "../../../../../database/prisma";
import {requireCurrentUser} from "../../../../../utils/auth";
import {normalizeUserCode} from "../../../../../utils/passport";
import {apiError} from "../../../../../utils/api-error";

/**
 * /link 页拒绝设备码（spec §6.3，cookie session 专属）：仅 pending 可拒绝。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    const userCode = normalizeUserCode(decodeURIComponent(getRouterParam(event, "userCode") ?? ""));

    const code = await prisma.passportDeviceCode.findUnique({where: {userCode}});
    if (!code) {
        throw apiError(404, "device_code_not_found", "Device code not found");
    }
    const updated = await prisma.passportDeviceCode.updateMany({
        where: {id: code.id, status: "pending"},
        data: {status: "denied", approvedById: user.id},
    });
    if (updated.count === 0) {
        throw apiError(409, "device_code_unavailable", "Device code was handled or expired");
    }
    return {ok: true};
});
