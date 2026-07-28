import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {strToU8, Zip, ZipDeflate, zipSync} from "fflate";
import {afterEach, describe, expect, it, vi} from "vitest";
import {parseWorkshopPackageFile, readPackageEntry} from "./workshop-package";

const cleanupRoots: string[] = [];
const packageJson = {
    name: "stream-skill",
    version: "1.0.0",
    type: "module",
    neurobook: {schemaVersion: 1, assetType: "skill"},
};
const skillSource = strToU8("---\nname: stream-skill\ndescription: stream test\n---\n\n# stream-skill\n");

afterEach(async () => {
    vi.unstubAllEnvs();
    for (const root of cleanupRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

/** 将测试 zip 写到隔离文件。 */
async function writeZip(bytes: Uint8Array): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-workshop-zip-"));
    cleanupRoots.push(root);
    const path = join(root, "package.zip");
    await writeFile(path, bytes);
    return path;
}

/** 构造允许重复条目名的 zip。 */
function duplicateZip(entries: Array<[string, Uint8Array]>): Uint8Array {
    const chunks: Uint8Array[] = [];
    let failure: Error | null = null;
    const zip = new Zip((error, data) => {
        if (error) {
            failure = error;
            return;
        }
        chunks.push(data);
    });
    for (const [name, bytes] of entries) {
        const entry = new ZipDeflate(name);
        zip.add(entry);
        entry.push(bytes, true);
    }
    zip.end();
    if (failure) {
        throw failure;
    }
    return Buffer.concat(chunks);
}

describe("parseWorkshopPackageFile", () => {
    it("顺序解析合法包，不依赖整包解压", async () => {
        const path = await writeZip(zipSync({
            "package.json": strToU8(JSON.stringify(packageJson)),
            "SKILL.md": skillSource,
        }));
        const parsed = await parseWorkshopPackageFile(path);
        expect(parsed.packageJson).toEqual(packageJson);
        expect(parsed.entryNames).toContain("SKILL.md");
    });

    it("拒绝路径逃逸与归一化后的重复路径", async () => {
        const escaped = await writeZip(zipSync({
            "package.json": strToU8(JSON.stringify(packageJson)),
            "SKILL.md": strToU8("# skill"),
            "../escape.txt": strToU8("bad"),
        }));
        await expect(parseWorkshopPackageFile(escaped)).rejects.toThrow(/非法路径/);

        const duplicate = await writeZip(duplicateZip([
            ["package.json", strToU8(JSON.stringify(packageJson))],
            ["SKILL.md", strToU8("# skill")],
            ["docs/a.md", strToU8("one")],
            ["DOCS/A.md", strToU8("two")],
        ]));
        await expect(parseWorkshopPackageFile(duplicate)).rejects.toThrow(/重复路径/);
    });

    it("按实际输出限制解压总量，中央目录伪造不能绕过", async () => {
        vi.stubEnv("NB_WORKSHOP_MAX_UNCOMPRESSED_BYTES", "240");
        const zip = Buffer.from(zipSync({
            "package.json": strToU8(JSON.stringify(packageJson)),
            "SKILL.md": strToU8("A".repeat(200)),
        }));
        const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        expect(central).toBeGreaterThan(0);
        zip.writeUInt32LE(1, central + 24); // forged central-directory originalSize
        await expect(parseWorkshopPackageFile(await writeZip(zip))).rejects.toThrow(/实际解压体积/);
    });

    it("bun.lock 的非空判断使用实际输出而不是中央目录声明", async () => {
        const zip = Buffer.from(zipSync({
            "package.json": strToU8(JSON.stringify({...packageJson, dependencies: {yaml: "^2.0.0"}})),
            "SKILL.md": skillSource,
            "bun.lock": new Uint8Array(),
        }));
        patchCentralEntry(zip, "bun.lock", {uncompressedSize: 1});
        await expect(parseWorkshopPackageFile(await writeZip(zip))).rejects.toThrow(/非空 bun\.lock/);
    });

    it("限制最多条目数", async () => {
        vi.stubEnv("NB_WORKSHOP_MAX_ENTRIES", "2");
        const path = await writeZip(zipSync({
            "package.json": strToU8(JSON.stringify(packageJson)),
            "SKILL.md": strToU8("# skill"),
            "README.md": strToU8("extra"),
        }));
        await expect(parseWorkshopPackageFile(path)).rejects.toThrow(/条目数超过 2/);
    });

    it("拒绝 Unix symlink 与特殊文件", async () => {
        for (const mode of [0o120777, 0o140777]) {
            const bytes = Buffer.from(zipSync({"unsafe": strToU8("target")}));
            patchCentralEntry(bytes, "unsafe", {unixMode: mode});
            await expect(parseWorkshopPackageFile(await writeZip(bytes))).rejects.toThrow(/符号链接或特殊文件/);
        }
    });

    it("预览按实际输出执行 200 KiB 上限", async () => {
        const bytes = Buffer.from(zipSync({"docs/large.txt": strToU8("A".repeat(210 * 1024))}));
        patchCentralEntry(bytes, "docs/large.txt", {uncompressedSize: 1});
        const path = await writeZip(bytes);
        await expect(readPackageEntry(path, "docs/large.txt")).rejects.toMatchObject({statusCode: 400});
    });
});

/** 定点伪造中央目录字段，验证服务端不信任声明的大小和文件类型。 */
function patchCentralEntry(
    zip: Buffer,
    entryName: string,
    patch: {uncompressedSize?: number; unixMode?: number},
): void {
    let offset = 0;
    while ((offset = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) >= 0) {
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
        if (name === entryName) {
            if (patch.uncompressedSize !== undefined) {
                zip.writeUInt32LE(patch.uncompressedSize, offset + 24);
            }
            if (patch.unixMode !== undefined) {
                zip[offset + 5] = 3;
                zip.writeUInt32LE((patch.unixMode << 16) >>> 0, offset + 38);
            }
            return;
        }
        offset += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error(`未找到中央目录条目：${entryName}`);
}
