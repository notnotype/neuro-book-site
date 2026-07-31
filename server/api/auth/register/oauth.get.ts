import type {PendingOAuthDto} from "../../../../shared/dto/auth.dto";
import {getPendingOAuthSession} from "../../../utils/auth";
import {suggestUsername} from "../../../utils/github-oauth";
import {isGitHubOAuthEnabled} from "../../../utils/site-config";
import {apiError} from "../../../utils/api-error";

/**
 * 补全注册页读取待完成的 GitHub 身份（不含 providerUserId 内部字段）。
 * 404 表示当前会话没有 pending 注册（直接访问页面 / 会话过期），前端应引导回登录页。
 */
export default defineEventHandler(async (event): Promise<PendingOAuthDto> => {
    if (!isGitHubOAuthEnabled()) {
        throw apiError(404, "not_found", "Not Found");
    }
    const pending = await getPendingOAuthSession(event);
    if (!pending) {
        throw apiError(404, "oauth_registration_missing", "No pending GitHub registration");
    }
    return {
        provider: pending.provider,
        providerUsername: pending.providerUsername,
        suggestedUsername: suggestUsername(pending.providerUsername),
        displayName: pending.displayName,
        avatarUrl: pending.avatarUrl,
    };
});
