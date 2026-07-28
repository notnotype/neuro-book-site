import type {WorkshopItemDto} from "../../../../../../shared/dto/workshop.dto";
import {requireAccess} from "../../../../../utils/passport-guard";
import {requireOwnedItem, requireSlugParam, toItemDto} from "../../../../../utils/workshop";

/** 作者读取自己的条目详情，包含 unlisted / removed，供发布工作台加载既有资产。 */
export default defineEventHandler(async (event): Promise<WorkshopItemDto> => {
    const slug = requireSlugParam(event);
    const {user} = await requireAccess(event, "workshop:publish");
    const {item} = await requireOwnedItem(event, slug, user);
    return toItemDto(item);
});
