import {PrismaLibSql} from "@prisma/adapter-libsql";
import "@libsql/isomorphic-ws";
import {Prisma, PrismaClient} from "../generated/prisma/client";

export type {PrismaClient};
export {Prisma};
export type {User, UserRole, UserStatus, InviteCode, WorkshopItem, ItemVersion, Like, Favorite, Comment, Report, PassportDeviceCode, PassportAuthorization, PassportToken, InstanceBackup, OAuthClient, OAuthAuthorizationCode, OAuthAccessToken} from "../generated/prisma/client";

type GlobalPrisma = {
    prismaClient?: PrismaClient;
};

const globalForPrisma = globalThis as typeof globalThis & GlobalPrisma;

/**
 * 解析模板的本地 SQLite URL。
 */
function resolveDatabaseUrl(): string {
    const url = process.env.DATABASE_URL?.trim() || "file:./data.db";
    if (!url.startsWith("file:")) {
        throw new Error(`模板默认只支持 file: SQLite URL，当前为：${url}`);
    }
    return url;
}

/**
 * 创建 libSQL 适配器 PrismaClient。
 */
function createPrismaClient(): PrismaClient {
    const adapter = new PrismaLibSql({url: resolveDatabaseUrl()});
    return new PrismaClient({adapter});
}

/**
 * 获取进程级 PrismaClient 单例。
 */
export function usePrismaClient(): PrismaClient {
    if (!globalForPrisma.prismaClient) {
        globalForPrisma.prismaClient = createPrismaClient();
    }
    return globalForPrisma.prismaClient;
}

export const prisma = usePrismaClient();
