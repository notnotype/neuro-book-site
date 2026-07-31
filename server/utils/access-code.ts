import type {InviteCode, Prisma, RegistrationCode} from "../generated/prisma/client";
import type {AccessCodeDto} from "../../shared/dto/access-code.dto";
import {apiError} from "./api-error";

/** 将数据库中的注册码/邀请码转为公开 DTO。 */
export function toAccessCodeDto(code: RegistrationCode | InviteCode): AccessCodeDto {
    return {
        id: code.id,
        code: code.code,
        note: code.note,
        maxUses: code.maxUses,
        usedCount: code.usedCount,
        lastUsedAt: code.lastUsedAt?.toISOString() ?? null,
        expiresAt: code.expiresAt?.toISOString() ?? null,
        disabledAt: code.disabledAt?.toISOString() ?? null,
        createdAt: code.createdAt.toISOString(),
    };
}

/** 把码当前不可用的原因转换成稳定、可读的注册错误。 */
function assertUsable(code: RegistrationCode | InviteCode | null, kind: "registration_code" | "invite_code", now: Date): asserts code is RegistrationCode | InviteCode {
    const field = kind === "registration_code" ? "registrationCode" : "inviteCode";
    if (!code) {
        throw apiError(400, `${kind}_invalid`, `${kind} is invalid`, {field});
    }
    if (code.disabledAt !== null) {
        throw apiError(400, `${kind}_disabled`, `${kind} is disabled`, {field});
    }
    if (code.expiresAt !== null && code.expiresAt.getTime() <= now.getTime()) {
        throw apiError(400, `${kind}_expired`, `${kind} is expired`, {field});
    }
    if (code.maxUses !== null && code.usedCount >= code.maxUses) {
        throw apiError(400, `${kind}_exhausted`, `${kind} has reached its usage limit`, {field});
    }
}

/**
 * 原子消费注册码。usedCount + maxUses 组成 CAS，允许不限次数并避免并发穿透有限次数。
 */
async function consumeRegistrationCode(tx: Prisma.TransactionClient, value: string, now: Date): Promise<number> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = await tx.registrationCode.findUnique({where: {code: value}});
        assertUsable(code, "registration_code", now);
        const consumed = await tx.registrationCode.updateMany({
            where: {
                id: code.id,
                usedCount: code.usedCount,
                maxUses: code.maxUses,
                disabledAt: null,
                OR: [{expiresAt: null}, {expiresAt: {gt: now}}],
            },
            data: {usedCount: {increment: 1}, lastUsedAt: now},
        });
        if (consumed.count === 1) {
            return code.id;
        }
    }
    throw apiError(409, "registration_code_conflict", "Registration code state changed", {field: "registrationCode"});
}

/** 原子消费可选邀请码；邀请码只记录归属，不替代注册码。 */
async function consumeInviteCode(tx: Prisma.TransactionClient, value: string, now: Date): Promise<number> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = await tx.inviteCode.findUnique({where: {code: value}});
        assertUsable(code, "invite_code", now);
        const consumed = await tx.inviteCode.updateMany({
            where: {
                id: code.id,
                usedCount: code.usedCount,
                maxUses: code.maxUses,
                disabledAt: null,
                OR: [{expiresAt: null}, {expiresAt: {gt: now}}],
            },
            data: {usedCount: {increment: 1}, lastUsedAt: now},
        });
        if (consumed.count === 1) {
            return code.id;
        }
    }
    throw apiError(409, "invite_code_conflict", "Invite code state changed", {field: "inviteCode"});
}

/** 在注册事务内同时消费必填注册码和可选邀请码，返回新用户的归属外键。 */
export async function consumeAccessCodes(
    tx: Prisma.TransactionClient,
    registrationCode: string,
    inviteCode: string | undefined,
): Promise<{registrationCodeId: number; inviteCodeId: number | null}> {
    const now = new Date();
    const registrationCodeId = await consumeRegistrationCode(tx, registrationCode, now);
    const inviteCodeId = inviteCode ? await consumeInviteCode(tx, inviteCode, now) : null;
    return {registrationCodeId, inviteCodeId};
}
