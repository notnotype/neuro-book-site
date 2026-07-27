import {mkdtemp, readFile, rm, utimes, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {cleanupUploadTempDirectory} from "./upload-temp-cleanup";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => await rm(root, {recursive: true, force: true})));
});

describe("cleanupUploadTempDirectory", () => {
    it("只删除过期 .part，保留新文件和未知文件", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-upload-cleanup-"));
        roots.push(root);
        const oldPart = join(root, "old.part");
        const newPart = join(root, "new.part");
        const unknown = join(root, "keep.bin");
        await Promise.all([
            writeFile(oldPart, "old"),
            writeFile(newPart, "new"),
            writeFile(unknown, "keep"),
        ]);
        const now = Date.now();
        await utimes(oldPart, new Date(now - 10_000), new Date(now - 10_000));

        expect(await cleanupUploadTempDirectory(root, now, 5_000)).toBe(1);
        await expect(readFile(oldPart)).rejects.toThrow();
        await expect(readFile(newPart, "utf8")).resolves.toBe("new");
        await expect(readFile(unknown, "utf8")).resolves.toBe("keep");
    });
});
