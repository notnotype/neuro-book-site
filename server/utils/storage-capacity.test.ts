import {describe, expect, it} from "vitest";
import {StorageCapacityService, storageCapacityViolation} from "./storage-capacity";

describe("storage capacity", () => {
    it("聚合逻辑上限与物理保留空间分别拒绝", () => {
        expect(storageCapacityViolation({
            committedBytes: 80,
            incomingBytes: 21,
            maxBytes: 100,
            availableBytes: 1000,
            reservedBytes: 10,
        }, false)).toBe("global");
        expect(storageCapacityViolation({
            committedBytes: 10,
            incomingBytes: 11,
            maxBytes: 100,
            availableBytes: 20,
            reservedBytes: 10,
        }, false)).toBe("physical");
        expect(storageCapacityViolation({
            committedBytes: 10,
            incomingBytes: 11,
            maxBytes: 100,
            availableBytes: 20,
            reservedBytes: 10,
        }, true)).toBeNull();
    });

    it("容量不足返回稳定 507 storage_capacity_exceeded", async () => {
        const service = new StorageCapacityService({
            maxBytes: () => 100,
            reservedBytes: () => 10,
            committedBytes: async () => 95,
            availableBytes: async () => 1000,
        });
        await expect(service.assertCanStore({
            targetRoot: "ignored",
            incomingBytes: 6,
            temporaryAlreadyAllocated: true,
        })).rejects.toMatchObject({
            statusCode: 507,
            data: expect.objectContaining({error: "storage_capacity_exceeded", reason: "global"}),
        });
    });

    it("删除释放后的聚合值允许下一次写入", async () => {
        let committed = 95;
        const service = new StorageCapacityService({
            maxBytes: () => 100,
            reservedBytes: () => 10,
            committedBytes: async () => committed,
            availableBytes: async () => 1000,
        });
        await expect(service.assertCanStore({targetRoot: "ignored", incomingBytes: 10, temporaryAlreadyAllocated: true})).rejects.toMatchObject({statusCode: 507});
        committed = 80;
        await expect(service.assertCanStore({targetRoot: "ignored", incomingBytes: 10, temporaryAlreadyAllocated: true})).resolves.toBeUndefined();
    });

    it("Workshop 与 Backup 上传共享同一串行队列", async () => {
        const service = new StorageCapacityService();
        const order: string[] = [];
        let releaseFirst = (): void => undefined;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const first = service.withUpload(async () => {
            order.push("workshop:start");
            await firstGate;
            order.push("workshop:end");
        });
        const second = service.withUpload(async () => {
            order.push("backup:start");
            order.push("backup:end");
        });

        await Promise.resolve();
        expect(order).toEqual(["workshop:start"]);
        releaseFirst();
        await Promise.all([first, second]);
        expect(order).toEqual(["workshop:start", "workshop:end", "backup:start", "backup:end"]);
    });
});
