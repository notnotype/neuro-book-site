import {createHash, randomBytes} from "node:crypto";
import {prisma} from "../database/prisma";

// Passport token / 设备码的生成、摘要与撤链工具（reference/passport/api-v1.md §6.6）。
// 时序常量支持 env 覆写：集成测试需要缩短 TTL、放大轮询间隔来稳定断言。

/**
 * 数值 env 读取：未设置或非法时用默认值。
 */
function envInt(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) {
        return fallback;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** access token 有效期（秒），默认 30 分钟。env NB_PASSPORT_ACCESS_TTL_SECONDS */
export function accessTokenTtlSeconds(): number {
    return envInt("NB_PASSPORT_ACCESS_TTL_SECONDS", 1800);
}

/** 设备码有效期（秒），默认 15 分钟。env NB_PASSPORT_DEVICE_TTL_SECONDS */
export function deviceCodeTtlSeconds(): number {
    return envInt("NB_PASSPORT_DEVICE_TTL_SECONDS", 900);
}

/** 设备码轮询最小间隔（秒），默认 5。env NB_PASSPORT_POLL_INTERVAL_SECONDS */
export function devicePollIntervalSeconds(): number {
    return envInt("NB_PASSPORT_POLL_INTERVAL_SECONDS", 5);
}

/** refresh token 闲置作废天数，默认 90。env NB_PASSPORT_REFRESH_IDLE_DAYS */
export function refreshIdleDays(): number {
    return envInt("NB_PASSPORT_REFRESH_IDLE_DAYS", 90);
}

/** token 前缀：泄露识别用（access / refresh / device code） */
export type TokenPrefix = "nbp_at_" | "nbp_rt_" | "nbp_dc_";

/**
 * 生成不透明 token：前缀 + 256-bit 随机数的 base64url。
 */
export function generateToken(prefix: TokenPrefix): string {
    return prefix + randomBytes(32).toString("base64url");
}

/**
 * token / 设备码统一 sha256 hex 摘要：落库与查表的唯一入口，明文不落库。
 */
export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

// Crockford base32 去掉易混淆字母（I L O U），用于人工输入的 userCode。
// 字母表长度 32 整除 256，randomBytes 取模无偏。
const USER_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 生成 8 位用户码，格式 XXXX-XXXX（约 40 bit 熵，15 分钟窗口内足够）。
 */
export function generateUserCode(): string {
    const bytes = randomBytes(8);
    let code = "";
    for (let i = 0; i < 8; i++) {
        code += USER_CODE_ALPHABET[(bytes[i] as number) % USER_CODE_ALPHABET.length];
        if (i === 3) {
            code += "-";
        }
    }
    return code;
}

/**
 * 归一化用户输入的 userCode：大写、去空白与横线、混淆字符映射（I/L→1、O→0、U→V）、补横线。
 * 长度不是 8 时原样返回清洗结果，交由查库 miss 报错。
 */
export function normalizeUserCode(input: string): string {
    const cleaned = input
        .toUpperCase()
        .replaceAll(/[\s-]/g, "")
        .replaceAll("I", "1")
        .replaceAll("L", "1")
        .replaceAll("O", "0")
        .replaceAll("U", "V");
    if (cleaned.length !== 8) {
        return cleaned;
    }
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/**
 * 撤销整条授权链：授权标记 revokedAt + 名下全部 token 置 revoked。幂等。
 * 触发点：refresh 重放 / 实例 revoke / 面板吊销。
 */
export async function revokeAuthorizationChain(authorizationId: number): Promise<void> {
    await prisma.$transaction([
        prisma.passportAuthorization.updateMany({
            where: {id: authorizationId, revokedAt: null},
            data: {revokedAt: new Date()},
        }),
        prisma.passportToken.updateMany({
            where: {authorizationId},
            data: {status: "revoked"},
        }),
    ]);
}
