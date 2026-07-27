import busboy from "busboy";
import {createHash, randomUUID} from "node:crypto";
import {createWriteStream} from "node:fs";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import type {H3Event} from "h3";
import {backupMaxFileBytes, backupTmpDir} from "./backup-files";
import {BackupUploadMetaSchema, type BackupUploadMeta} from "./backup-dto";

// 备份上传的流式 multipart 解析（spec §9.2）。刻意不用 readMultipartFormData：
// 那会把整个 body 缓冲进内存，1 GiB 上限意味着单请求峰值内存打爆小内存 VPS；
// 备份是 opaque blob，用 busboy 流写 tmp 文件、边写边算 sha256 即可。

export type ParsedBackupUpload = {
    meta: BackupUploadMeta;
    tmpPath: string; // 已完整落盘的中转文件；调用方负责 rename 落位或失败清理
    fileSize: number;
    sha256: string; // 服务端实测摘要（hex 小写）
};

const encryptedBackupMagic = Buffer.from("NBOOKBK1", "ascii");

/**
 * 流式解析备份上传 multipart（meta = JSON 字符串字段，file = 归档字节流）。
 * 超 NB_BACKUP_MAX_FILE_BYTES 立即中止、删 tmp、抛 413；meta 缺失或非法抛 400。
 * 注意：本函数直接消费 event.node.req 原生流，端点在此之前不得读取过 body。
 */
export async function parseBackupUpload(event: H3Event): Promise<ParsedBackupUpload> {
    const req = event.node.req;
    const maxBytes = backupMaxFileBytes();

    // 请求头预检：声明体积明显超限直接拒（省流量；流中实测仍兜底防伪造头）
    const declaredLength = Number.parseInt(String(req.headers["content-length"] ?? ""), 10);
    if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes + 64 * 1024) {
        throw createError({statusCode: 413, message: "备份体积超过单份上限", data: {error: "file_too_large"}});
    }

    await mkdir(backupTmpDir(), {recursive: true});
    const tmpPath = join(backupTmpDir(), `${randomUUID()}.part`);

    return await new Promise<ParsedBackupUpload>((resolvePromise, rejectPromise) => {
        const hash = createHash("sha256");
        const out = createWriteStream(tmpPath);
        let metaRaw: string | null = null;
        let fileSeen = false;
        let encryptedPrefixLength = 0;
        const encryptedPrefix = Buffer.alloc(encryptedBackupMagic.byteLength);
        let fileName = "";
        let mimeType = "";
        let fileSize = 0;
        let settled = false;

        const parser = busboy({headers: req.headers, limits: {files: 1, fileSize: maxBytes}});

        /** 统一失败出口：只生效一次；销毁流、删 tmp（Windows 上须等写流关闭后再删） */
        const fail = (error: unknown): void => {
            if (settled) {
                return;
            }
            settled = true;
            req.unpipe(parser);
            parser.removeAllListeners();
            out.destroy();
            out.once("close", () => {
                rm(tmpPath, {force: true}).catch(() => undefined);
            });
            rejectPromise(error);
        };

        parser.on("field", (name, value) => {
            if (name === "meta") {
                metaRaw = value;
            }
        });

        parser.on("file", (name, file, info) => {
            if (name !== "file" || fileSeen) {
                file.resume();
                return;
            }
            fileSeen = true;
            fileName = info.filename;
            mimeType = info.mimeType;
            file.on("data", (chunk: Buffer) => {
                if (settled) {
                    return;
                }
                fileSize += chunk.length;
                hash.update(chunk);
                if (encryptedPrefixLength < encryptedPrefix.byteLength) {
                    const copied = chunk.copy(
                        encryptedPrefix,
                        encryptedPrefixLength,
                        0,
                        encryptedPrefix.byteLength - encryptedPrefixLength,
                    );
                    encryptedPrefixLength += copied;
                }
                if (!out.write(chunk)) {
                    file.pause();
                    out.once("drain", () => file.resume());
                }
            });
            // busboy 的 fileSize limit 命中：流被截断，视为超限
            file.on("limit", () => {
                fail(createError({statusCode: 413, message: "备份体积超过单份上限", data: {error: "file_too_large"}}));
            });
            file.on("error", fail);
        });

        parser.on("error", fail);
        req.on("error", fail);

        parser.on("close", () => {
            if (settled) {
                return;
            }
            // 等写流把缓冲全部落盘再校验元数据
            out.end(() => {
                if (settled) {
                    return;
                }
                if (!fileSeen) {
                    fail(createError({statusCode: 400, message: "缺少归档文件字段 file"}));
                    return;
                }
                if (!fileName.toLowerCase().endsWith(".nbbackup")
                    || mimeType !== "application/vnd.neurobook.backup"
                    || encryptedPrefixLength !== encryptedBackupMagic.byteLength
                    || !encryptedPrefix.equals(encryptedBackupMagic)) {
                    fail(createError({
                        statusCode: 400,
                        message: "只接受 NeuroBook 加密备份（.nbbackup）",
                        data: {error: "invalid_backup_format"},
                    }));
                    return;
                }
                if (metaRaw === null) {
                    fail(createError({statusCode: 400, message: "缺少 meta 字段"}));
                    return;
                }
                let metaJson: unknown;
                try {
                    metaJson = JSON.parse(metaRaw);
                } catch {
                    fail(createError({statusCode: 400, message: "meta 不是合法 JSON"}));
                    return;
                }
                const meta = BackupUploadMetaSchema.safeParse(metaJson);
                if (!meta.success) {
                    fail(createError({statusCode: 400, message: meta.error.issues.map((issue) => issue.message).join("；")}));
                    return;
                }
                settled = true;
                resolvePromise({meta: meta.data, tmpPath, fileSize, sha256: hash.digest("hex")});
            });
        });

        req.pipe(parser);
    });
}
