import {prisma} from "../../../../../database/prisma";
import {requireCurrentUser} from "../../../../../utils/auth";
import {validateBody} from "../../../../../utils/dto";
import {normalizeUserCode} from "../../../../../utils/passport";
import {ApproveDeviceRequestSchema} from "../../../../../utils/passport-dto";
import {apiError} from "../../../../../utils/api-error";

/**
 * /link 页批准设备码（spec §6.3，cookie session 专属）：创建实例授权并回写设备码。
 * 仅 pending 且未过期可批准；事务内条件更新守卫并发双批（输者整体回滚，不留孤儿授权）。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const user = await requireCurrentUser(event);
    const userCode = normalizeUserCode(decodeURIComponent(getRouterParam(event, "userCode") ?? ""));
    const body = await validateBody(event, ApproveDeviceRequestSchema);

    const code = await prisma.passportDeviceCode.findUnique({where: {userCode}});
    if (!code) {
        throw apiError(404, "device_code_not_found", "Device code not found");
    }
    if (code.status !== "pending" || code.expiresAt.getTime() <= Date.now()) {
        throw apiError(409, "device_code_unavailable", "Device code was handled or expired");
    }

    await prisma.$transaction(async (tx) => {
        const authorization = await tx.passportAuthorization.create({
            data: {
                userId: user.id,
                instanceName: body.instanceName,
                scopesJson: code.scopesJson,
            },
        });
        const updated = await tx.passportDeviceCode.updateMany({
            where: {id: code.id, status: "pending"},
            data: {
                status: "approved",
                approvedById: user.id,
                authorizationId: authorization.id,
                instanceName: body.instanceName,
            },
        });
        if (updated.count === 0) {
            // 并发已被处理：回滚本次创建的授权
            throw apiError(409, "device_code_unavailable", "Device code was already handled");
        }
    });

    return {ok: true};
});
