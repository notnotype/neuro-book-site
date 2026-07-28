import {requireAccess} from "../../../../../utils/passport-guard";
import {requireOwnedItem, requireSlugParam, resolveItemVersion} from "../../../../../utils/workshop";
import {readVersionZip} from "../../../../../utils/workshop-files";
import {DownloadQuerySchema, validateQuery} from "../../../../../utils/workshop-dto";

/**
 * 作者读取自己的完整源包，用于在发布工作台基于既有版本创建草稿。
 * 接口不增加下载计数，并允许作者读取自己的 unlisted / removed 条目。
 */
export default defineEventHandler(async (event): Promise<Buffer> => {
    const slug = requireSlugParam(event);
    const {user} = await requireAccess(event, "workshop:publish");
    const {item} = await requireOwnedItem(event, slug, user);
    const query = validateQuery(event, DownloadQuerySchema);
    const version = await resolveItemVersion(item, query.version);
    const bytes = await readVersionZip(item.id, version.ordinal);

    setHeader(event, "Content-Type", "application/zip");
    setHeader(event, "Content-Disposition", `attachment; filename="${item.slug}-v${version.version}.zip"`);
    setHeader(event, "Content-Length", bytes.byteLength);
    return bytes;
});
