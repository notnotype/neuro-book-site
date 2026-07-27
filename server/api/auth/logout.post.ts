import type {AuthSessionDto} from "../../utils/auth";
import {clearAuthSession} from "../../utils/auth";

/**
 * 清理当前登录 session。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    await clearAuthSession(event);
    return {authEnabled: true, user: null};
});
