import {requireCurrentUser} from "../../../utils/auth";
import {OAUTH_CLIENT_ID, OAUTH_SCOPE} from "../../../utils/oauth";
import {readUniqueQuery} from "../../../utils/oauth-transport";
import {validateAuthorizeQuery} from "../../../utils/oauth-authorize";
import {clientIp} from "../../../utils/site-config";
import {consumeRateLimit, envRateLimit} from "../../../utils/rate-limit";
import {apiError} from "../../../utils/api-error";

/** 授权页读取端：校验固定 client/redirect/scope/PKCE 后只返回最小确认信息。 */
export default defineEventHandler(async (event) => {
    const ip = clientIp(event);
    if (!consumeRateLimit(`oauth-authorize:${ip}`, envRateLimit("NB_OAUTH_AUTHORIZE_RATE_LIMIT", 30), 15 * 60 * 1000)) {
        throw apiError(429, "rate_limit_exceeded", "OAuth authorization rate limit exceeded");
    }
    const user = await requireCurrentUser(event);
    const query = readUniqueQuery(event);
    validateAuthorizeQuery(query);
    return {
        clientId: OAUTH_CLIENT_ID,
        scope: OAUTH_SCOPE,
        user: {username: user.username, displayName: user.displayName},
    };
});
