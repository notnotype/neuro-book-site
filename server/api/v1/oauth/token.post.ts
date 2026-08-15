import {getRequestHeader, setResponseHeader, setResponseStatus} from "h3";
import type {H3Event} from "h3";
import OAuth2Server from "@node-oauth/oauth2-server";
import {oauthServer} from "../../../utils/oauth";
import {
    applyOAuthResponse,
    createOAuthRequest,
    headerValues,
    normalizeClientSecretBasicAuthorization,
    oauthErrorPayload,
    readUniqueFormBody,
    readUniqueQuery,
} from "../../../utils/oauth-transport";
import {clientIp} from "../../../utils/site-config";
import {consumeRateLimit, envRateLimit} from "../../../utils/rate-limit";
function tokenError(event: H3Event, status: number, error: string, description: string, authenticate = false): Record<string, string> {
    setResponseStatus(event, status);
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    if (authenticate) {
        setResponseHeader(event, "WWW-Authenticate", 'Basic realm="oauth"');
    }
    return {error, error_description: description};
}

function allowedTokenParameters(body: Record<string, string>): boolean {
    return Object.keys(body).every((key) => ["grant_type", "code", "redirect_uri", "code_verifier"].includes(key));
}

/** OAuth token endpoint；只接受唯一 Basic client authentication 与 authorization_code grant。 */
export default defineEventHandler(async (event) => {
    const ip = clientIp(event);
    if (!consumeRateLimit(`oauth-token:${ip}`, envRateLimit("NB_OAUTH_TOKEN_RATE_LIMIT", 20), 5 * 60 * 1000)) {
        return tokenError(event, 429, "rate_limit_exceeded", "OAuth token rate limit exceeded");
    }

    const authorizationValues = headerValues(event, "authorization");
    const normalizedAuthorization = authorizationValues.length === 1
        ? normalizeClientSecretBasicAuthorization(authorizationValues[0] ?? "")
        : null;
    if (!normalizedAuthorization) {
        return tokenError(event, 401, "invalid_client", "Client authentication is required", true);
    }
    const contentType = getRequestHeader(event, "content-type") ?? "";
    if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/iu.test(contentType)) {
        return tokenError(event, 400, "invalid_request", "Token request must use form encoding");
    }

    let query: Record<string, string>;
    let body: Record<string, string>;
    try {
        query = readUniqueQuery(event);
        body = await readUniqueFormBody(event);
    } catch {
        return tokenError(event, 400, "invalid_request", "Token request parameters are invalid");
    }
    if (Object.keys(query).length > 0) {
        return tokenError(event, 400, "invalid_request", "Token request parameters are invalid");
    }
    if (body.grant_type && body.grant_type !== "authorization_code") {
        return tokenError(event, 400, "unsupported_grant_type", "Only authorization_code is supported");
    }
    if (!allowedTokenParameters(body) || body.grant_type !== "authorization_code") {
        return tokenError(event, 400, "invalid_request", "Token request parameters are invalid");
    }
    if (Object.prototype.hasOwnProperty.call(body, "client_secret")
        || Object.prototype.hasOwnProperty.call(body, "client_id")) {
        return tokenError(event, 400, "invalid_client", "Use only client_secret_basic authentication");
    }

    const request = createOAuthRequest(event, query, body, {authorization: normalizedAuthorization});
    const response = new OAuth2Server.Response();
    try {
        await oauthServer.token(request, response);
    } catch {
        const payload = oauthErrorPayload(response);
        if (payload.error === "invalid_client") {
            setResponseHeader(event, "WWW-Authenticate", 'Basic realm="oauth"');
        }
        setResponseStatus(event, response.status || 400);
        setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
        return payload;
    }

    if (response.body && typeof response.body === "object" && "refresh_token" in response.body) {
        delete response.body.refresh_token;
    }
    return applyOAuthResponse(event, response);
});
