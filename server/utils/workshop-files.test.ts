import {access, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {commitVersionZip, versionZipPath} from "./workshop-files";

const cleanupRoots: string[] = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    for (const root of cleanupRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

describe("commitVersionZip", () => {
    it("同步临时归档后原子落位，并保留原始字节", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-workshop-files-"));
        cleanupRoots.push(root);
        vi.stubEnv("WORKSHOP_FILES_DIR", root);
        const tmpPath = join(root, "tmp", "upload.part");
        await mkdir(join(root, "tmp"));
        await writeFile(tmpPath, Buffer.from("archive-bytes"));

        await commitVersionZip(tmpPath, 17, 3);

        await expect(access(tmpPath)).rejects.toMatchObject({code: "ENOENT"});
        await expect(readFile(versionZipPath(17, 3), "utf8")).resolves.toBe("archive-bytes");
    });

    it("目标已存在时原子拒绝覆盖并保留双方字节", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-workshop-files-"));
        cleanupRoots.push(root);
        vi.stubEnv("WORKSHOP_FILES_DIR", root);
        const tmpPath = join(root, "tmp", "upload.part");
        const finalPath = versionZipPath(17, 3);
        await mkdir(join(root, "tmp"));
        await mkdir(join(root, "17"));
        await writeFile(tmpPath, Buffer.from("incoming"));
        await writeFile(finalPath, Buffer.from("committed"));

        await expect(commitVersionZip(tmpPath, 17, 3)).rejects.toMatchObject({statusCode: 409});

        await expect(readFile(tmpPath, "utf8")).resolves.toBe("incoming");
        await expect(readFile(finalPath, "utf8")).resolves.toBe("committed");
    });
});
