import type {PackageFileContentDto} from "../../../../../shared/dto/workshop.dto";
import {requirePublishedItem, requireSlugParam, resolveItemVersion} from "../../../../utils/workshop";
import {versionZipPath} from "../../../../utils/workshop-files";
import {isPreviewableFile, readPackageEntry} from "../../../../utils/workshop-package";
import {PackageFileContentQuerySchema, validateQuery} from "../../../../utils/workshop-dto";
import {apiError} from "../../../../utils/api-error";

/**
 * 包内文本文件内容（在线预览）：path 按归一化条目名精确匹配（无路径穿越），只解压目标条目；
 * 二进制 / 超大文件拒绝预览（400）。不递增 downloadCount。
 */
export default defineEventHandler(async (event): Promise<PackageFileContentDto> => {
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);
    const query = validateQuery(event, PackageFileContentQuerySchema);
    const version = await resolveItemVersion(item, query.version);

    const data = await readPackageEntry(versionZipPath(item.id, version.ordinal), query.path);
    if (!data) {
        throw apiError(404, "package_file_not_found", "Package file not found");
    }
    if (!isPreviewableFile(query.path, data.byteLength)) {
        throw apiError(400, "file_preview_unsupported", "File cannot be previewed");
    }

    let content: string;
    try {
        content = new TextDecoder("utf-8", {fatal: true}).decode(data);
    } catch {
        throw apiError(400, "file_preview_unsupported", "File is not valid UTF-8");
    }
    if (content.includes("\0")) {
        throw apiError(400, "file_preview_unsupported", "Binary file cannot be previewed");
    }
    return {path: query.path, size: data.byteLength, content};
});
