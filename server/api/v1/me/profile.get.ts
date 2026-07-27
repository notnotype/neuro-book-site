import type {MeProfileDto} from "../../../../shared/dto/auth.dto";
import {requireCurrentUser, toMeProfileDto} from "../../../utils/auth";

/**
 * 读取本人完整资料（账号设置页预填，cookie session 专属）。
 */
export default defineEventHandler(async (event): Promise<MeProfileDto> => {
    const user = await requireCurrentUser(event);
    return toMeProfileDto(user);
});
