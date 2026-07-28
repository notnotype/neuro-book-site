import type {PackageFileListDto} from "../../../../../shared/dto/workshop.dto";
import {requirePublishedItem, requireSlugParam, resolveItemVersion} from "../../../../utils/workshop";
import {versionZipPath} from "../../../../utils/workshop-files";
import {isPreviewableFile, listPackageEntries} from "../../../../utils/workshop-package";
import {DownloadQuerySchema, validateQuery} from "../../../../utils/workshop-dto";

/**
 * 包内文件列表（在线预览）：无需账号；version 缺省取最新版；不递增 downloadCount。
 * 清单只遍历中央目录；归档在上传与启动门禁中已经完成真实解压校验。
 */
export default defineEventHandler(async (event): Promise<PackageFileListDto> => {
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);
    const query = validateQuery(event, DownloadQuerySchema);
    const version = await resolveItemVersion(item, query.version);

    const files = (await listPackageEntries(versionZipPath(item.id, version.ordinal)))
        .map((entry) => ({...entry, previewable: isPreviewableFile(entry.path, entry.size)}))
        .sort((a, b) => a.path.localeCompare(b.path));

    return {version: version.version, files};
});
