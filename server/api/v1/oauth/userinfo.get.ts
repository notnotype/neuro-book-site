import {setResponseHeader, setResponseStatus} from "h3";
import type {H3Event} from "h3";
import OAuth2Server from "@node-oauth/oauth2-server";
import {oauthServer} from "../../../utils/oauth";
import {createOAuthRequest, headerValues, readUniqueQuery} from "../../../utils/oauth-transport";
import {clientIp} from "../../../utils/site-config";
import {consumeRateLimit, envRateLimit} from "../../../utils/rate-limit";

function invalidAccessToken(event: H3Event, status = 401): {error: "invalid_access_token"} {
    setResponseStatus(event, status);
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    setResponseHeader(event, "WWW-Authenticate", 'Bearer realm="oauth", error="invalid_token"');
    return {error: "invalid_access_token"};
}

/** 只使用 opaque Bearer access token 读取最小官方账号资料。 */
export default defineEventHandler(async (event) => {
    const ip = clientIp(event);
    if (!consumeRateLimit(`oauth-userinfo:${ip}`, envRateLimit("NB_OAUTH_TOKEN_RATE_LIMIT", 20), 5 * 60 * 1000)) {
        return invalidAccessToken(event, 429);
    }

    const authorizationValues = headerValues(event, "authorization");
    if (authorizationValues.length !== 1 || !/^Bearer\s+[0-9A-Za-z._~+\/=:-]+$/u.test(authorizationValues[0] ?? "")) {
        return invalidAccessToken(event);
    }
    let query: Record<string, string>;
    try {
        query = readUniqueQuery(event);
    } catch {
        return invalidAccessToken(event);
    }
    if (Object.keys(query).length > 0) {
        return invalidAccessToken(event);
    }

    const request = createOAuthRequest(event, query);
    const response = new OAuth2Server.Response();
    try {
        const token = await oauthServer.authenticate(request, response, {
            scope: ["profile"],
            addAcceptedScopesHeader: false,
            addAuthorizedScopesHeader: false,
            allowBearerTokensInQueryString: false,
        });
        const user = token.user;
        if (!user || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0
            || typeof user.username !== "string" || typeof user.displayName !== "string" || user.status !== "active") {
            return invalidAccessToken(event);
        }
        return {
            sub: String(user.id),
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            status: "active" as const,
        };
    } catch {
        return invalidAccessToken(event);
    }
});
