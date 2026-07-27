import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {strToU8, Zip, ZipDeflate, zipSync} from "fflate";
import {afterEach, describe, expect, it, vi} from "vitest";
import {parseWorkshopPackageFile} from "./workshop-package";

const cleanupRoots: string[] = [];
const manifest = {manifestVersion: 1, type: "skill", name: "stream-skill", version: 1};

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
            "nbook-package.json": strToU8(JSON.stringify(manifest)),
            "SKILL.md": strToU8("# skill"),
        }));
        const parsed = await parseWorkshopPackageFile(path);
        expect(parsed.manifest).toEqual(manifest);
        expect(parsed.entryNames).toContain("SKILL.md");
    });

    it("拒绝路径逃逸与归一化后的重复路径", async () => {
        const escaped = await writeZip(zipSync({
            "nbook-package.json": strToU8(JSON.stringify(manifest)),
            "SKILL.md": strToU8("# skill"),
            "../escape.txt": strToU8("bad"),
        }));
        await expect(parseWorkshopPackageFile(escaped)).rejects.toThrow(/非法路径/);

        const duplicate = await writeZip(duplicateZip([
            ["nbook-package.json", strToU8(JSON.stringify(manifest))],
            ["SKILL.md", strToU8("# skill")],
            ["docs//a.md", strToU8("one")],
            ["docs/a.md", strToU8("two")],
        ]));
        await expect(parseWorkshopPackageFile(duplicate)).rejects.toThrow(/重复路径/);
    });

    it("按实际输出限制解压总量，中央目录伪造不能绕过", async () => {
        vi.stubEnv("NB_WORKSHOP_MAX_UNCOMPRESSED_BYTES", "80");
        const zip = Buffer.from(zipSync({
            "nbook-package.json": strToU8(JSON.stringify(manifest)),
            "SKILL.md": strToU8("A".repeat(200)),
        }));
        const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        expect(central).toBeGreaterThan(0);
        zip.writeUInt32LE(1, central + 24); // forged central-directory originalSize
        await expect(parseWorkshopPackageFile(await writeZip(zip))).rejects.toThrow(/实际解压体积/);
    });

    it("限制最多条目数", async () => {
        vi.stubEnv("NB_WORKSHOP_MAX_ENTRIES", "2");
        const path = await writeZip(zipSync({
            "nbook-package.json": strToU8(JSON.stringify(manifest)),
            "SKILL.md": strToU8("# skill"),
            "README.md": strToU8("extra"),
        }));
        await expect(parseWorkshopPackageFile(path)).rejects.toThrow(/条目数超过 2/);
    });
});
