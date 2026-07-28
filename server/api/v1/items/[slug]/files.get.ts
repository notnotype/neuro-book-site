import type {PackageFileListDto} from "../../../../../shared/dto/workshop.dto";
import {requirePublishedItem, requireSlugParam, resolveItemVersion} from "../../../../utils/workshop";
import {readVersionZip} from "../../../../utils/workshop-files";
import {isPreviewableFile, listPackageEntries} from "../../../../utils/workshop-package";
import {DownloadQuerySchema, validateQuery} from "../../../../utils/workshop-dto";

/**
 * 包内文件列表（在线预览）：无需账号；version 缺省取最新版；不递增 downloadCount。
 * 每次请求整读 zip（无缓存，第一版取舍）；清单借 fflate filter 零解压获得。
 */
export default defineEventHandler(async (event): Promise<PackageFileListDto> => {
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);
    const query = validateQuery(event, DownloadQuerySchema);
    const version = await resolveItemVersion(item, query.version);

    const bytes = await readVersionZip(item.id, version.ordinal);
    const files = listPackageEntries(new Uint8Array(bytes))
        .map((entry) => ({...entry, previewable: isPreviewableFile(entry.path, entry.size)}))
        .sort((a, b) => a.path.localeCompare(b.path));

    return {version: version.version, files};
});
