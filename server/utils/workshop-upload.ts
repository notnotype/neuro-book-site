import busboy from "busboy";
import {createHash, randomUUID} from "node:crypto";
import {createWriteStream} from "node:fs";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import type {H3Event} from "h3";
import {normalizeValidationIssues} from "../../shared/validation-issues";
import {apiError} from "./api-error";
import type {UpdateItemRequest} from "./workshop-dto";
import {UpdateItemRequestSchema, UploadVersionFieldsSchema} from "./workshop-dto";
import {workshopTmpDir} from "./workshop-files";

const WORKSHOP_MAX_FILE_BYTES = 20 * 1024 * 1024;

export type ParsedWorkshopUpload = {
    tmpPath: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    changelog: string;
    metadata?: UpdateItemRequest;
};

/**
 * Workshop 压缩包上限。测试可通过 NB_WORKSHOP_MAX_FILE_BYTES 缩小阈值。
 */
export function workshopMaxFileBytes(): number {
    const configured = Number.parseInt(process.env.NB_WORKSHOP_MAX_FILE_BYTES?.trim() ?? "", 10);
    return Number.isSafeInteger(configured) && configured > 0 ? configured : WORKSHOP_MAX_FILE_BYTES;
}

/**
 * 用 busboy 把 Workshop multipart 顺序落到同盘 tmp，并边写边计算摘要。
 */
export async function parseWorkshopUpload(event: H3Event): Promise<ParsedWorkshopUpload> {
    const request = event.node.req;
    const maxBytes = workshopMaxFileBytes();
    const declaredLength = Number.parseInt(String(request.headers["content-length"] ?? ""), 10);
    if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes + 64 * 1024) {
        throw apiError(413, "file_too_large", "Workshop archive exceeds the file limit");
    }

    await mkdir(workshopTmpDir(), {recursive: true});
    const tmpPath = join(workshopTmpDir(), `${randomUUID()}.part`);
    return await new Promise<ParsedWorkshopUpload>((resolvePromise, rejectPromise) => {
        const parser = busboy({
            headers: request.headers,
            limits: {files: 1, fields: 3, fileSize: maxBytes, fieldSize: 60 * 1024},
        });
        const output = createWriteStream(tmpPath);
        const hash = createHash("sha256");
        let fileSeen = false;
        let fileName = "";
        let fileSize = 0;
        let changelog = "";
        let metadata = "";
        let settled = false;

        /** 统一失败出口：终止解析，写流关闭后清理 tmp。 */
        const fail = (error: unknown): void => {
            if (settled) {
                return;
            }
            settled = true;
            request.unpipe(parser);
            parser.removeAllListeners();
            output.destroy();
            output.once("close", () => {
                rm(tmpPath, {force: true}).catch(() => undefined);
            });
            rejectPromise(error);
        };

        parser.on("field", (name, value) => {
            if (name === "changelog") {
                changelog = value;
            }
            if (name === "metadata") {
                metadata = value;
            }
        });
        parser.on("file", (name, file, info) => {
            if (name !== "file" || fileSeen) {
                file.resume();
                return;
            }
            fileSeen = true;
            fileName = info.filename;
            file.on("data", (chunk: Buffer) => {
                if (settled) {
                    return;
                }
                fileSize += chunk.byteLength;
                hash.update(chunk);
                if (!output.write(chunk)) {
                    file.pause();
                    output.once("drain", () => file.resume());
                }
            });
            file.on("limit", () => {
                fail(apiError(413, "file_too_large", "Workshop archive exceeds the file limit"));
            });
            file.on("error", fail);
        });
        parser.on("filesLimit", () => fail(apiError(400, "multipart_file_limit", "Only one archive can be uploaded")));
        parser.on("fieldsLimit", () => fail(apiError(400, "multipart_field_limit", "Too many multipart fields")));
        parser.on("error", fail);
        request.on("error", fail);
        parser.on("close", () => {
            if (settled) {
                return;
            }
            output.end(() => {
                if (settled) {
                    return;
                }
                if (!fileSeen) {
                    fail(apiError(400, "multipart_file_required", "Missing multipart file field"));
                    return;
                }
                if (!fileName.toLowerCase().endsWith(".zip")) {
                    fail(apiError(400, "invalid_archive_format", "Workshop archive must be a ZIP file"));
                    return;
                }
                const fields = UploadVersionFieldsSchema.safeParse({changelog, ...(metadata ? {metadata} : {})});
                if (!fields.success) {
                    fail(apiError(400, "validation_failed", "Multipart fields validation failed", {
                        issues: normalizeValidationIssues(fields.error.issues),
                    }));
                    return;
                }
                let parsedMetadata: UpdateItemRequest | undefined;
                if (fields.data.metadata) {
                    try {
                        const raw: unknown = JSON.parse(fields.data.metadata);
                        const result = UpdateItemRequestSchema.safeParse(raw);
                        if (!result.success) {
                            fail(apiError(400, "validation_failed", "Item metadata validation failed", {
                                issues: normalizeValidationIssues(result.error.issues),
                            }));
                            return;
                        }
                        parsedMetadata = result.data;
                    } catch {
                        fail(apiError(400, "invalid_metadata_json", "Metadata is not valid JSON"));
                        return;
                    }
                }
                settled = true;
                resolvePromise({
                    tmpPath,
                    fileName,
                    fileSize,
                    sha256: hash.digest("hex"),
                    changelog: fields.data.changelog,
                    ...(parsedMetadata ? {metadata: parsedMetadata} : {}),
                });
            });
        });
        request.pipe(parser);
    });
}
