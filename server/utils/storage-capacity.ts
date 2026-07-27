import {mkdir, statfs} from "node:fs/promises";
import {createError} from "h3";
import type {Prisma, PrismaClient} from "../generated/prisma/client";
import {prisma} from "../database/prisma";

type CapacityPrisma = PrismaClient | Prisma.TransactionClient;

type StorageCapacityOptions = {
    maxBytes?: () => number;
    reservedBytes?: () => number;
    committedBytes?: (executor: CapacityPrisma) => Promise<number>;
    availableBytes?: (targetRoot: string) => Promise<number>;
};

export type StorageCapacitySnapshot = {
    committedBytes: number;
    incomingBytes: number;
    maxBytes: number;
    availableBytes: number;
    reservedBytes: number;
};

/**
 * 读取正整数容量环境变量；开发环境缺省时使用已审定默认值。
 */
function envBytes(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name]?.trim() ?? "", 10);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** 全站 Workshop + Backup 已提交文件容量上限，默认 6 GiB。 */
export function storageMaxBytes(): number {
    return envBytes("NB_STORAGE_MAX_BYTES", 6 * 1024 * 1024 * 1024);
}

/** 持久卷必须保留的物理可用空间，默认 4 GiB。 */
export function storageReservedBytes(): number {
    return envBytes("NB_STORAGE_RESERVED_BYTES", 4 * 1024 * 1024 * 1024);
}

/**
 * 判断容量快照是否允许提交。tmp 已占用磁盘时不再重复扣减 incomingBytes。
 */
export function storageCapacityViolation(
    snapshot: StorageCapacitySnapshot,
    temporaryAlreadyAllocated: boolean,
): "global" | "physical" | null {
    if (snapshot.committedBytes + snapshot.incomingBytes > snapshot.maxBytes) {
        return "global";
    }
    const availableAfterWrite = snapshot.availableBytes - (temporaryAlreadyAllocated ? 0 : snapshot.incomingBytes);
    return availableAfterWrite < snapshot.reservedBytes ? "physical" : null;
}

/**
 * 串行化两类大文件上传，并统一执行逻辑容量与物理余量门禁。
 */
export class StorageCapacityService {
    private uploadTail: Promise<void> = Promise.resolve();
    private readonly maxBytes: () => number;
    private readonly reservedBytes: () => number;
    private readonly committedBytes: (executor: CapacityPrisma) => Promise<number>;
    private readonly availableBytes: (targetRoot: string) => Promise<number>;

    constructor(options: StorageCapacityOptions = {}) {
        this.maxBytes = options.maxBytes ?? storageMaxBytes;
        this.reservedBytes = options.reservedBytes ?? storageReservedBytes;
        this.committedBytes = options.committedBytes ?? readCommittedBytes;
        this.availableBytes = options.availableBytes ?? readAvailableBytes;
    }

    /**
     * 在进程级互斥区执行一次 Workshop 或 Backup 上传。
     */
    async withUpload<Result>(operation: () => Promise<Result>): Promise<Result> {
        const previous = this.uploadTail;
        let release = (): void => undefined;
        this.uploadTail = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }

    /**
     * 上传落 tmp 前按声明大小预检；声明未知时 incomingBytes 传 0。
     */
    async preflight(targetRoot: string, incomingBytes: number): Promise<void> {
        await this.assertCanStore({targetRoot, incomingBytes, temporaryAlreadyAllocated: false});
    }

    /**
     * tmp 完整落盘后按实测大小复检，可传事务 executor 看到同事务内 rotate 删除结果。
     */
    async assertCanStore(input: {
        targetRoot: string;
        incomingBytes: number;
        temporaryAlreadyAllocated: boolean;
        executor?: CapacityPrisma;
    }): Promise<void> {
        const snapshot = await this.snapshot(input.targetRoot, input.incomingBytes, input.executor);
        const violation = storageCapacityViolation(snapshot, input.temporaryAlreadyAllocated);
        if (!violation) {
            return;
        }
        throw createError({
            statusCode: 507,
            message: violation === "global" ? "站点文件容量已达上限" : "持久卷剩余空间不足",
            data: {
                error: "storage_capacity_exceeded",
                reason: violation,
                committedBytes: snapshot.committedBytes,
                maxBytes: snapshot.maxBytes,
                reservedBytes: snapshot.reservedBytes,
            },
        });
    }

    /** 返回 readiness 与上传门禁共用的容量快照。 */
    async snapshot(targetRoot: string, incomingBytes = 0, executor: CapacityPrisma = prisma): Promise<StorageCapacitySnapshot> {
        return {
            committedBytes: await this.committedBytes(executor),
            incomingBytes,
            maxBytes: this.maxBytes(),
            availableBytes: await this.availableBytes(targetRoot),
            reservedBytes: this.reservedBytes(),
        };
    }
}

/**
 * 聚合 Workshop 与 Backup 两张表的已提交文件字节。
 */
async function readCommittedBytes(executor: CapacityPrisma): Promise<number> {
    const [workshop, backups] = await Promise.all([
        executor.itemVersion.aggregate({_sum: {fileSize: true}}),
        executor.instanceBackup.aggregate({_sum: {fileSize: true}}),
    ]);
    return (workshop._sum.fileSize ?? 0) + (backups._sum.fileSize ?? 0);
}

/**
 * 读取目标持久目录所在文件系统的可用字节。
 */
async function readAvailableBytes(targetRoot: string): Promise<number> {
    await mkdir(targetRoot, {recursive: true});
    const fileSystem = await statfs(targetRoot);
    return fileSystem.bavail * fileSystem.bsize;
}

type GlobalStorageCapacity = {
    storageCapacityService?: StorageCapacityService;
};

const globalForStorageCapacity = globalThis as typeof globalThis & GlobalStorageCapacity;

/**
 * 返回单实例共享服务，保证两类上传进入同一互斥队列。
 */
export function useStorageCapacityService(): StorageCapacityService {
    if (!globalForStorageCapacity.storageCapacityService) {
        globalForStorageCapacity.storageCapacityService = new StorageCapacityService();
    }
    return globalForStorageCapacity.storageCapacityService;
}
