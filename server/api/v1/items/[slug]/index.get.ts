import type {WorkshopItemDto} from "../../../../../shared/dto/workshop.dto";
import {getCurrentUser} from "../../../../utils/auth";
import {loadViewerState, requirePublishedItem, requireSlugParam, toItemDto} from "../../../../utils/workshop";

/**
 * 条目详情：公开可见；已登录用户附带 viewer（点赞 / 收藏状态）。
 */
export default defineEventHandler(async (event): Promise<WorkshopItemDto> => {
    const slug = requireSlugParam(event);
    const item = await requirePublishedItem(slug);

    const user = await getCurrentUser(event);
    const viewer = user ? await loadViewerState(user.id, item.id) : undefined;

    return toItemDto(item, viewer);
});
