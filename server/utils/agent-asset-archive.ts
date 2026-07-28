import {stat} from "node:fs/promises";
import type {Readable} from "node:stream";
import type {Entry, ZipFile} from "yauzl";
import yauzl from "yauzl";
import {AGENT_ASSET_LIMITS, normalizeAgentAssetPath} from "../../shared/agent-asset-package";

export type AgentAssetArchiveEntry = {
    path: string;
    size: number;
    directory: boolean;
};

export type AgentAssetArchiveScan = {
    entries: AgentAssetArchiveEntry[];
    selected: Uint8Array | null;
};

export class AgentAssetArchiveError extends Error {
    /** 创建一个不包含底层库实现细节的归档错误。 */
    constructor(message: string) {
        super(message);
        this.name = "AgentAssetArchiveError";
    }
}

type ScanOptions = {
    inflateAll?: boolean;
    selectedPath?: string;
    selectedLimit?: number;
    collectAll?: boolean;
};

type ArchiveLimits = {
    compressedBytes: number;
    uncompressedBytes: number;
    entries: number;
};

/**
 * 顺序扫描 ZIP。条目只有在 readEntry 后才进入内存，实际解压量由输出字节累计，
 * 不信任中央目录声明的 uncompressedSize。
 */
export async function scanAgentAssetArchive(path: string, options: ScanOptions = {}): Promise<AgentAssetArchiveScan & {all?: Map<string, Uint8Array>}> {
    const limits = archiveLimits();
    const file = await stat(path);
    if (file.size > limits.compressedBytes) {
        throw new AgentAssetArchiveError("ZIP 超过 20 MiB 上限");
    }

    const zip = await openZip(path);
    const entries: AgentAssetArchiveEntry[] = [];
    const seen = new Set<string>();
    const selectedChunks: Buffer[] = [];
    const all = options.collectAll ? new Map<string, Uint8Array>() : undefined;
    let selectedBytes = 0;
    let selectedFound = false;
    let actualBytes = 0;
    let settled = false;
    let entryInFlight = false;
    let pendingZipError: unknown;

    return await new Promise((resolve, reject) => {
        const fail = (error: unknown): void => {
            if (settled) {
                return;
            }
            settled = true;
            zip.close();
            reject(normalizeArchiveError(error));
        };
        zip.once("error", (error) => {
            if (entryInFlight) {
                pendingZipError = error;
                return;
            }
            fail(error);
        });
        zip.on("entry", (entry) => {
            entryInFlight = true;
            void processEntry(entry).then(() => {
                entryInFlight = false;
                if (pendingZipError) {
                    fail(pendingZipError);
                }
            }).catch((error: unknown) => {
                entryInFlight = false;
                fail(error);
            });
        });
        zip.once("end", () => {
            if (settled) {
                return;
            }
            settled = true;
            resolve({
                entries,
                selected: options.selectedPath && selectedFound ? Buffer.concat(selectedChunks) : null,
                ...(all ? {all} : {}),
            });
        });

        const processEntry = async (entry: Entry): Promise<void> => {
            const pathName = normalizeAgentAssetPath(entry.fileName);
            if (!pathName) {
                throw new AgentAssetArchiveError(`ZIP 包含非法路径：${entry.fileName}`);
            }
            const folded = pathName.toLowerCase();
            if (seen.has(folded)) {
                throw new AgentAssetArchiveError(`ZIP 包含重复路径：${pathName}`);
            }
            seen.add(folded);
            assertRegularEntry(entry);
            const directory = entry.fileName.endsWith("/");
            const scannedEntry: AgentAssetArchiveEntry = {path: pathName, size: entry.uncompressedSize, directory};
            entries.push(scannedEntry);
            if (entries.length > limits.entries) {
                throw new AgentAssetArchiveError(`ZIP 条目数超过 ${limits.entries} 个上限`);
            }
            if (directory) {
                all?.set(`${pathName}/`, new Uint8Array());
                zip.readEntry();
                return;
            }

            const shouldRead = options.inflateAll || options.collectAll || entry.fileName === options.selectedPath;
            if (!shouldRead) {
                zip.readEntry();
                return;
            }
            const stream = await openEntryStream(zip, entry);
            const chunks: Buffer[] = [];
            let entryBytes = 0;
            for await (const raw of stream) {
                const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
                entryBytes += chunk.byteLength;
                actualBytes += chunk.byteLength;
                if (actualBytes > limits.uncompressedBytes) {
                    throw new AgentAssetArchiveError("ZIP 实际解压体积超过 100 MiB 上限");
                }
                if (options.collectAll || entry.fileName === options.selectedPath) {
                    chunks.push(chunk);
                }
                if (entry.fileName === options.selectedPath) {
                    selectedBytes += chunk.byteLength;
                    if (selectedBytes > (options.selectedLimit ?? AGENT_ASSET_LIMITS.sourceBytes)) {
                        throw new AgentAssetArchiveError(`${entry.fileName} 实际解压体积超过允许上限`);
                    }
                }
            }
            // 已实际读取的条目必须以输出字节为准，不能把中央目录声明用于安全校验。
            scannedEntry.size = entryBytes;
            if (entry.fileName === options.selectedPath) {
                selectedFound = true;
                selectedChunks.push(...chunks);
            }
            if (all) {
                all.set(pathName, Buffer.concat(chunks));
            }
            zip.readEntry();
        };

        zip.readEntry();
    });
}

/** 只读取一个条目；不存在返回 null，输出超过限制立即停止。 */
export async function readAgentAssetArchiveEntry(path: string, entryPath: string, maxBytes: number): Promise<Uint8Array | null> {
    const scan = await scanAgentAssetArchive(path, {selectedPath: entryPath, selectedLimit: maxBytes});
    return scan.selected;
}

/** 维护迁移专用：在 100 MiB 总上限内读取全部普通文件。 */
export async function readAllAgentAssetArchiveEntries(path: string): Promise<Map<string, Uint8Array>> {
    const scan = await scanAgentAssetArchive(path, {collectAll: true});
    return scan.all ?? new Map();
}

function openZip(path: string): Promise<ZipFile> {
    return new Promise((resolve, reject) => {
        yauzl.open(path, {
            lazyEntries: true,
            autoClose: true,
            decodeStrings: true,
            strictFileNames: true,
            validateEntrySizes: false,
        }, (error, zip) => {
            if (error || !zip) {
                reject(new AgentAssetArchiveError("ZIP 文件损坏，无法解析"));
                return;
            }
            resolve(zip);
        });
    });
}

/** 把 yauzl 在 entry 事件前完成的路径拒绝映射为稳定的协议错误。 */
function normalizeArchiveError(error: unknown): AgentAssetArchiveError {
    if (error instanceof AgentAssetArchiveError) {
        return error;
    }
    if (error instanceof Error && error.message.startsWith("invalid relative path:")) {
        return new AgentAssetArchiveError("ZIP 包含非法路径");
    }
    return new AgentAssetArchiveError("ZIP 文件损坏，无法解析");
}

/** 生产使用固定合同，测试可通过同一组已受启动门禁保护的环境变量缩小阈值。 */
function archiveLimits(): ArchiveLimits {
    return {
        compressedBytes: positiveIntegerEnv("NB_WORKSHOP_MAX_FILE_BYTES", AGENT_ASSET_LIMITS.compressedBytes),
        uncompressedBytes: positiveIntegerEnv("NB_WORKSHOP_MAX_UNCOMPRESSED_BYTES", AGENT_ASSET_LIMITS.uncompressedBytes),
        entries: positiveIntegerEnv("NB_WORKSHOP_MAX_ENTRIES", AGENT_ASSET_LIMITS.entries),
    };
}

/** 非法或缺失配置回退共享合同；生产启动检查会在提供流量前拒绝非法值。 */
function positiveIntegerEnv(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name]?.trim() ?? "", 10);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<Readable> {
    return new Promise((resolve, reject) => {
        zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
                reject(new AgentAssetArchiveError(`无法读取 ZIP 条目：${entry.fileName}`));
                return;
            }
            resolve(stream);
        });
    });
}

/** Unix ZIP 的 mode 高位可识别 symlink、socket、设备文件等特殊条目。 */
function assertRegularEntry(entry: Entry): void {
    const platform = entry.versionMadeBy >>> 8;
    if (platform !== 3 && platform !== 19) {
        return;
    }
    const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
    const type = mode & 0o170000;
    if (type !== 0 && type !== 0o100000 && type !== 0o040000) {
        throw new AgentAssetArchiveError(`ZIP 包含符号链接或特殊文件：${entry.fileName}`);
    }
}
