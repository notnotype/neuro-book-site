import {prisma} from "../../../../database/prisma";
import {requirePublishedItem, requireSlugParam, resolveItemVersion} from "../../../../utils/workshop";
import {readVersionZip} from "../../../../utils/workshop-files";
import {DownloadQuerySchema, validateQuery} from "../../../../utils/workshop-dto";

/**
 * 下载版本 zip：无需账号；version 缺省取最新版；成功即递增 downloadCount（裸计数，不去重）。
 */
export default defineEventHandler(async (event): Promise<Buffer> => {
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);
    const query = validateQuery(event, DownloadQuerySchema);
    const version = await resolveItemVersion(item, query.version);

    const bytes = await readVersionZip(item.id, version.version);
    await prisma.workshopItem.update({where: {id: item.id}, data: {downloadCount: {increment: 1}}});

    setHeader(event, "Content-Type", "application/zip");
    setHeader(event, "Content-Disposition", `attachment; filename="${item.slug}-v${version.version}.zip"`);
    setHeader(event, "Content-Length", bytes.byteLength);
    return bytes;
});
