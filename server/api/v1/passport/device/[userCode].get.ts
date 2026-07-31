import type {DeviceCodeStatus, PendingDeviceDto} from "../../../../../shared/dto/passport.dto";
import {prisma} from "../../../../database/prisma";
import {requireCurrentUser} from "../../../../utils/auth";
import {normalizeUserCode} from "../../../../utils/passport";
import {apiError} from "../../../../utils/api-error";

/**
 * /link 页查待批设备码（spec §6.3，cookie session 专属）。
 * userCode 先归一化（大写、补横线、混淆字符映射）再查；pending 且已过期时顺手标记 expired。
 */
export default defineEventHandler(async (event): Promise<PendingDeviceDto> => {
    await requireCurrentUser(event);
    const userCode = normalizeUserCode(decodeURIComponent(getRouterParam(event, "userCode") ?? ""));
    const code = await prisma.passportDeviceCode.findUnique({where: {userCode}});
    if (!code) {
        throw apiError(404, "device_code_not_found", "Device code not found");
    }
    let status = code.status as DeviceCodeStatus;
    if (status === "pending" && code.expiresAt.getTime() <= Date.now()) {
        await prisma.passportDeviceCode.update({where: {id: code.id}, data: {status: "expired"}}).catch(() => undefined);
        status = "expired";
    }
    return {
        userCode: code.userCode,
        instanceName: code.instanceName,
        scopes: JSON.parse(code.scopesJson) as string[],
        status,
        expiresAt: code.expiresAt.toISOString(),
    };
});
