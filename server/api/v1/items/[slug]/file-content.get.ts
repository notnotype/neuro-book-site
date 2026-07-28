import type {PackageFileContentDto} from "../../../../../shared/dto/workshop.dto";
import {requirePublishedItem, requireSlugParam, resolveItemVersion} from "../../../../utils/workshop";
import {versionZipPath} from "../../../../utils/workshop-files";
import {isPreviewableFile, readPackageEntry} from "../../../../utils/workshop-package";
import {PackageFileContentQuerySchema, validateQuery} from "../../../../utils/workshop-dto";

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
        throw createError({statusCode: 404, message: "包内不存在该文件"});
    }
    if (!isPreviewableFile(query.path, data.byteLength)) {
        throw createError({statusCode: 400, message: "该文件是二进制或超过预览大小上限，不支持在线预览"});
    }

    let content: string;
    try {
        content = new TextDecoder("utf-8", {fatal: true}).decode(data);
    } catch {
        throw createError({statusCode: 400, message: "该文件不是合法 UTF-8 文本，不支持在线预览"});
    }
    if (content.includes("\0")) {
        throw createError({statusCode: 400, message: "该文件是二进制内容，不支持在线预览"});
    }
    return {path: query.path, size: data.byteLength, content};
});
