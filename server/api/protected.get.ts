import {requireCurrentUser} from "../utils/auth";

/**
 * 受保护 API 示例：只有有效登录用户可以访问。
 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    return {
        ok: true as const,
        username: user.username,
    };
});
