import type {DeviceCodeDto} from "../../../../../shared/dto/passport.dto";
import {Prisma, prisma} from "../../../../database/prisma";
import {validateBody} from "../../../../utils/dto";
import {deviceCodeTtlSeconds, devicePollIntervalSeconds, generateToken, generateUserCode, hashToken} from "../../../../utils/passport";
import {DeviceCodeRequestSchema} from "../../../../utils/passport-dto";
import {consumeRateLimit} from "../../../../utils/rate-limit";
import {clientIp, siteOrigin} from "../../../../utils/site-config";
import {apiError} from "../../../../utils/api-error";

/**
 * 设备码申请（spec §6.2，匿名，实例发起）：生成 deviceCode + userCode，落库 pending 态。
 * 按 IP 限频 10 次/小时；userCode 唯一冲突（约 1/2^40）重试一次即可覆盖。
 */
export default defineEventHandler(async (event): Promise<DeviceCodeDto> => {
    const body = await validateBody(event, DeviceCodeRequestSchema);

    const ip = clientIp(event);
    if (!consumeRateLimit(`passport-device-code:${ip}`, 10, 60 * 60 * 1000)) {
        throw apiError(429, "rate_limit_exceeded", "Device code rate limit exceeded");
    }

    const deviceCode = generateToken("nbp_dc_");
    const expiresIn = deviceCodeTtlSeconds();
    const data = {
        deviceCodeHash: hashToken(deviceCode),
        instanceName: body.instanceName,
        scopesJson: JSON.stringify(body.scopes),
        status: "pending",
        expiresAt: new Date(Date.now() + expiresIn * 1000),
    };

    let userCode = generateUserCode();
    try {
        await prisma.passportDeviceCode.create({data: {...data, userCode}});
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            userCode = generateUserCode();
            await prisma.passportDeviceCode.create({data: {...data, userCode}});
        } else {
            throw error;
        }
    }

    const origin = siteOrigin(getRequestURL(event).origin);
    return {
        deviceCode,
        userCode,
        verificationUri: `${origin}/link`,
        verificationUriComplete: `${origin}/link?code=${userCode}`,
        expiresIn,
        interval: devicePollIntervalSeconds(),
    };
});
