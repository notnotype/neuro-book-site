import type {PendingOAuthDto} from "../../../../shared/dto/auth.dto";
import {getPendingOAuthSession} from "../../../utils/auth";
import {suggestUsername} from "../../../utils/github-oauth";
import {isGitHubOAuthEnabled} from "../../../utils/site-config";

/**
 * 补全注册页读取待完成的 GitHub 身份（不含 providerUserId 内部字段）。
 * 404 表示当前会话没有 pending 注册（直接访问页面 / 会话过期），前端应引导回登录页。
 */
export default defineEventHandler(async (event): Promise<PendingOAuthDto> => {
    if (!isGitHubOAuthEnabled()) {
        throw createError({statusCode: 404, message: "Not Found"});
    }
    const pending = await getPendingOAuthSession(event);
    if (!pending) {
        throw createError({statusCode: 404, message: "没有待完成的 GitHub 注册，请从登录页重新发起"});
    }
    return {
        provider: pending.provider,
        providerUsername: pending.providerUsername,
        suggestedUsername: suggestUsername(pending.providerUsername),
        displayName: pending.displayName,
        avatarUrl: pending.avatarUrl,
    };
});
