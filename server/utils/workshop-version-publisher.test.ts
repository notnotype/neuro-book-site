import {beforeEach, describe, expect, it, vi} from "vitest";
import type {ItemVersion, WorkshopItem} from "../database/prisma";
import type {VersionPublishInput} from "./workshop-version-publisher";

const state = vi.hoisted(() => {
    class KnownRequestError extends Error {
        code = "P2002";
    }
    return {
        KnownRequestError,
        findUnique: vi.fn(),
        createVersion: vi.fn(),
        updateItem: vi.fn(),
        transaction: vi.fn(),
        archiveExists: vi.fn(),
        commitArchive: vi.fn(),
        removeArchive: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
});

vi.mock("../database/prisma", () => ({
    Prisma: {PrismaClientKnownRequestError: state.KnownRequestError},
    prisma: {
        itemVersion: {findUnique: state.findUnique},
        $transaction: state.transaction,
    },
}));

vi.mock("./workshop-files", () => ({
    versionZipExists: state.archiveExists,
    commitVersionZip: state.commitArchive,
    removeVersionZip: state.removeArchive,
}));

vi.mock("./site-logger", () => ({
    siteLogger: {warn: state.warn, error: state.error},
}));

import {publishWorkshopVersion} from "./workshop-version-publisher";

const item: WorkshopItem = {
    id: 11,
    slug: "demo-skill",
    name: "",
    type: "skill",
    title: "Draft",
    summary: "",
    description: "",
    tagsJson: "[]",
    authorId: 3,
    status: "unlisted",
    featured: false,
    downloadCount: 0,
    likeCount: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const version: ItemVersion = {
    id: 21,
    itemId: item.id,
    ordinal: 1,
    version: "1.0.0",
    packageSchemaVersion: 1,
    changelog: "",
    fileName: "demo.zip",
    fileSize: 128,
    sha256: "a".repeat(64),
    minAppVersion: null,
    containsExecutableCode: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
};

const input: VersionPublishInput = {
    item,
    ordinal: 1,
    latestVersion: null,
    packageJson: {
        name: "demo-skill",
        version: "1.0.0",
        type: "module",
        neurobook: {schemaVersion: 1, assetType: "skill"},
    },
    tmpPath: "C:/tmp/upload.part",
    fileName: "demo.zip",
    fileSize: version.fileSize,
    sha256: version.sha256,
    changelog: "first",
    metadata: {title: "Published", tags: ["demo"]},
};

beforeEach(() => {
    vi.clearAllMocks();
    state.findUnique.mockResolvedValue(null);
    state.archiveExists.mockResolvedValue(false);
    state.commitArchive.mockResolvedValue(undefined);
    state.removeArchive.mockResolvedValue(undefined);
    state.createVersion.mockResolvedValue(version);
    state.updateItem.mockResolvedValue(item);
    state.transaction.mockImplementation(async (operation: (transaction: {
        itemVersion: {create: typeof state.createVersion};
        workshopItem: {update: typeof state.updateItem};
    }) => Promise<ItemVersion>) => await operation({
        itemVersion: {create: state.createVersion},
        workshopItem: {update: state.updateItem},
    }));
});

describe("publishWorkshopVersion", () => {
    it("先原子落位归档，再在同一数据库事务提交版本、元数据和公开状态", async () => {
        await expect(publishWorkshopVersion(input)).resolves.toEqual(version);

        expect(state.commitArchive).toHaveBeenCalledWith(input.tmpPath, item.id, 1);
        expect(state.commitArchive.mock.invocationCallOrder[0]).toBeLessThan(state.createVersion.mock.invocationCallOrder[0] ?? 0);
        expect(state.createVersion).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({version: "1.0.0", containsExecutableCode: false}),
        }));
        expect(state.updateItem).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({name: "demo-skill", status: "published", title: "Published", tagsJson: '["demo"]'}),
        }));
    });

    it("数据库事务失败时删除已经落位的最终归档", async () => {
        state.transaction.mockRejectedValue(new Error("database failed"));

        await expect(publishWorkshopVersion(input)).rejects.toThrow(/database failed/);
        expect(state.commitArchive).toHaveBeenCalledOnce();
        expect(state.removeArchive).toHaveBeenCalledWith(item.id, 1);
    });

    it("只清理数据库无法对应的孤儿文件，然后提交新归档", async () => {
        state.archiveExists.mockResolvedValue(true);

        await publishWorkshopVersion(input);

        expect(state.removeArchive).toHaveBeenCalledWith(item.id, 1);
        expect(state.removeArchive.mock.invocationCallOrder[0]).toBeLessThan(state.commitArchive.mock.invocationCallOrder[0] ?? 0);
        expect(state.warn).toHaveBeenCalledOnce();
    });

    it("数据库已有 ordinal 但归档缺失时失败关闭，不写入上传文件", async () => {
        state.findUnique.mockResolvedValue({id: 99});
        state.archiveExists.mockResolvedValue(false);

        await expect(publishWorkshopVersion(input)).rejects.toMatchObject({statusCode: 500});
        expect(state.commitArchive).not.toHaveBeenCalled();
        expect(state.removeArchive).not.toHaveBeenCalled();
    });

    it("数据库与归档都已有 ordinal 时返回稳定冲突", async () => {
        state.findUnique.mockResolvedValue({id: 99});
        state.archiveExists.mockResolvedValue(true);

        await expect(publishWorkshopVersion(input)).rejects.toMatchObject({statusCode: 409});
        expect(state.commitArchive).not.toHaveBeenCalled();
    });
});
