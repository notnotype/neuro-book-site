import {rm} from "node:fs/promises";
import type {ItemVersionDto} from "../../../../../shared/dto/workshop.dto";
import type {ItemVersion} from "../../../../database/prisma";
import {Prisma, prisma} from "../../../../database/prisma";
import {requireAccess} from "../../../../utils/passport-guard";
import {requireOwnedItem, requireSlugParam, toVersionDto} from "../../../../utils/workshop";
import {parseWorkshopPackageFile, assertUploadAllowed} from "../../../../utils/workshop-package";
import {commitVersionZip, workshopFilesDir} from "../../../../utils/workshop-files";
import {parseWorkshopUpload} from "../../../../utils/workshop-upload";
import {consumeRateLimit, envRateLimit} from "../../../../utils/rate-limit";
import {useStorageCapacityService} from "../../../../utils/storage-capacity";

/**
 * 上传新版本 zip（multipart：file = zip 文件，changelog = 可选文本字段）。
 * 数据正确性校验：package.json 合法、assetType 与条目一致、
 * 非首版 name 与条目安装名一致、version 严格递增（拒绝时提示应改为 N+1）；
 * 首版把 manifest.name 落库为条目安装名。sha256 由服务端计算落库。
 * cookie session 与 Bearer（workshop:publish）等价接受。
 */
export default defineEventHandler(async (event): Promise<ItemVersionDto> => {
    const slug = requireSlugParam(event);
    const access = await requireAccess(event, "workshop:publish");
    const {item} = await requireOwnedItem(event, slug, access.user);
    if (item.status === "removed") {
        throw createError({statusCode: 403, message: "条目已被管理员下架，无法上传新版本"});
    }
    if (!consumeRateLimit(`workshop-upload:${access.user.id}`, envRateLimit("NB_WORKSHOP_UPLOAD_RATE_LIMIT", 20), 60 * 60 * 1000)) {
        throw createError({
            statusCode: 429,
            message: "Workshop 上传过于频繁，请稍后再试",
            data: {error: "rate_limit_exceeded"},
        });
    }

    const capacity = useStorageCapacityService();
    return await capacity.withUpload(async () => {
        const declaredLength = Number.parseInt(String(event.node.req.headers["content-length"] ?? ""), 10);
        await capacity.preflight(workshopFilesDir(), Number.isSafeInteger(declaredLength) && declaredLength > 0 ? declaredLength : 0);
        const upload = await parseWorkshopUpload(event);
        try {
            const {packageJson} = await parseWorkshopPackageFile(upload.tmpPath);
            // requireOwnedItem 在进入全站上传锁前执行，锁内必须重读最新版本，避免并发请求
            // 都拿到同一个旧 ordinal。ordinal 与 SemVer 递增判断共享这份数据库真相。
            const latest = await prisma.itemVersion.findFirst({
                where: {itemId: item.id},
                orderBy: {ordinal: "desc"},
            });
            assertUploadAllowed(packageJson, item, latest?.version ?? null);
            const ordinal = (latest?.ordinal ?? 0) + 1;
            await capacity.assertCanStore({
                targetRoot: workshopFilesDir(),
                incomingBytes: upload.fileSize,
                temporaryAlreadyAllocated: true,
            });

            // 先写库再落盘：并发上传同版本时只有一个能通过唯一约束。
            let version: ItemVersion;
            try {
                [version] = await prisma.$transaction([
                    prisma.itemVersion.create({
                        data: {
                            itemId: item.id,
                            ordinal,
                            version: packageJson.version,
                            packageSchemaVersion: 1,
                            changelog: upload.changelog,
                            fileName: upload.fileName || `${item.slug}-v${packageJson.version}.zip`,
                            fileSize: upload.fileSize,
                            sha256: upload.sha256,
                            minAppVersion: packageJson.neurobook.minAppVersion ?? null,
                        },
                    }),
                    // 首版落库安装名；空 data 时也会刷新 updatedAt，让"最新"排序反映版本活跃
                    prisma.workshopItem.update({where: {id: item.id}, data: latest ? {} : {name: packageJson.name}}),
                ]);
            } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                    throw createError({statusCode: 409, message: `version ${packageJson.version} 或发布序号已存在（可能有并发上传），请确认最新版本后重试`});
                }
                throw error;
            }

            try {
                await commitVersionZip(upload.tmpPath, item.id, ordinal);
            } catch (error) {
                await prisma.itemVersion.delete({where: {id: version.id}}).catch(() => undefined);
                throw error;
            }
            return toVersionDto(version);
        } catch (error) {
            await rm(upload.tmpPath, {force: true}).catch(() => undefined);
            throw error;
        }
    });
});
