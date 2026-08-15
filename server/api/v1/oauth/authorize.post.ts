import {getRequestHeader, getRequestURL, readBody} from "h3";
import OAuth2Server from "@node-oauth/oauth2-server";
import {requireCurrentUser} from "../../../utils/auth";
import {oauthServer, toOAuthUser} from "../../../utils/oauth";
import {
    applyOAuthResponse,
    createOAuthRequest,
    headerValues,
    readUniqueFormBody,
    readUniqueQuery,
} from "../../../utils/oauth-transport";
import {readApprovalBody, readApprovalFormBody, validateAuthorizeQuery} from "../../../utils/oauth-authorize";
import {clientIp, siteOrigin} from "../../../utils/site-config";
import {consumeRateLimit, envRateLimit} from "../../../utils/rate-limit";
import {apiError} from "../../../utils/api-error";

/**
 * 授权批准端点。Origin 必须精确匹配官方 origin，OAuth 参数继续留在 query，避免客户端重组 redirect/state。
 */
export default defineEventHandler(async (event) => {
    if (event.method !== "POST") {
        throw apiError(405, "method_not_allowed", "OAuth authorization approval requires POST");
    }
    const ip = clientIp(event);
    if (!consumeRateLimit(`oauth-authorize:${ip}`, envRateLimit("NB_OAUTH_AUTHORIZE_RATE_LIMIT", 30), 15 * 60 * 1000)) {
        throw apiError(429, "rate_limit_exceeded", "OAuth authorization rate limit exceeded");
    }
    const originValues = headerValues(event, "origin");
    const expectedOrigin = siteOrigin(getRequestURL(event).origin);
    if (originValues.length !== 1 || originValues[0] !== expectedOrigin) {
        throw apiError(403, "origin_mismatch", "OAuth authorization origin is not allowed");
    }

    const user = await requireCurrentUser(event);
    const query = readUniqueQuery(event);
    validateAuthorizeQuery(query);
    const contentType = getRequestHeader(event, "content-type") ?? "";
    let allowed: boolean;
    if (/^application\/json(?:\s*;|$)/iu.test(contentType)) {
        allowed = readApprovalBody(await readBody(event));
    } else if (/^application\/x-www-form-urlencoded(?:\s*;|$)/iu.test(contentType)) {
        allowed = readApprovalFormBody(await readUniqueFormBody(event));
    } else {
        throw apiError(415, "unsupported_media_type", "OAuth authorization approval requires JSON or form encoding");
    }
    const request = createOAuthRequest(event, query, {allowed: allowed ? "true" : "false"});
    const response = new OAuth2Server.Response();
    const authenticateHandler = {
        handle: async () => toOAuthUser(user),
    };

    try {
        await oauthServer.authorize(request, response, {
            authenticateHandler,
        } as OAuth2Server.AuthorizeOptions);
    } catch {
        // 合法 redirect 的 OAuth 业务错误由 library 写入固定 callback；其余错误不向客户端暴露内部信息。
        if (!response.get("location")) {
            throw apiError(503, "oauth_provider_error", "OAuth authorization service unavailable");
        }
    }

    return applyOAuthResponse(event, response);
});
