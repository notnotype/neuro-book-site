import {readRawBody, sendRedirect, setResponseHeader, setResponseStatus} from "h3";
import type {H3Event} from "h3";
import OAuth2Server from "@node-oauth/oauth2-server";
import {apiError} from "./api-error";

export type OAuthParameterMap = Record<string, string>;

/** 从 Node 原始 header 保留重复值，供 Basic/Bearer 唯一性门禁使用。 */
export function headerValues(event: H3Event, name: string): string[] {
    const normalized = name.toLowerCase();
    const rawHeaders = event.node.req.rawHeaders ?? [];
    const values: string[] = [];
    for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
        if (rawHeaders[index]?.toLowerCase() === normalized) {
            values.push(rawHeaders[index + 1] ?? "");
        }
    }
    if (values.length > 0) {
        return values;
    }
    const value = event.node.req.headers[normalized];
    if (Array.isArray(value)) {
        return value;
    }
    return value ? [value] : [];
}

/** 读取原始 URL query，拒绝重复参数并保留 OAuth library 所需的单值 map。 */
export function readUniqueQuery(event: H3Event): OAuthParameterMap {
    const rawUrl = event.node.req.url ?? "/";
    const queryText = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1) : "";
    return parseUniqueParameters(new URLSearchParams(queryText), "query");
}

/** 读取 application/x-www-form-urlencoded body，拒绝重复参数。 */
export async function readUniqueFormBody(event: H3Event): Promise<OAuthParameterMap> {
    const rawBody = await readRawBody(event, "utf8");
    if (rawBody === undefined || rawBody === "") {
        return {};
    }
    return parseUniqueParameters(new URLSearchParams(rawBody), "body");
}

function parseUniqueParameters(params: URLSearchParams, source: "query" | "body"): OAuthParameterMap {
    const result: OAuthParameterMap = {};
    for (const [key, value] of params.entries()) {
        if (Object.prototype.hasOwnProperty.call(result, key)) {
            throw apiError(400, "invalid_request", `Duplicate OAuth ${source} parameter`);
        }
        result[key] = value;
    }
    return result;
}

function normalizedHeaders(event: H3Event): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(event.node.req.headers)) {
        if (Array.isArray(value)) {
            result[name.toLowerCase()] = value.join(",");
        } else if (value !== undefined) {
            result[name.toLowerCase()] = value;
        }
    }
    return result;
}

/** 将 H3 请求包装成 node-oauth 要求的 Request；不把 H3 对象直接交给 library。 */
export function createOAuthRequest(
    event: H3Event,
    query: OAuthParameterMap,
    body: OAuthParameterMap = {},
): OAuth2Server.Request {
    return new OAuth2Server.Request({
        method: event.method,
        headers: normalizedHeaders(event),
        query,
        body,
    });
}

/** 将 OAuth library Response 映射为 H3 响应，保留 redirect/status/cache headers。 */
export function applyOAuthResponse(event: H3Event, response: OAuth2Server.Response): Record<string, unknown> | undefined {
    for (const [name, value] of Object.entries(response.headers ?? {})) {
        setResponseHeader(event, name, value);
    }
    const location = response.get("location");
    if (location) {
        return sendRedirect(event, location, response.status || 302) as unknown as undefined;
    }
    setResponseStatus(event, response.status || 200);
    return response.body as Record<string, unknown> | undefined;
}

/** 统一读取 OAuth library 错误响应，避免把 code/verifier/secret 写入 H3 错误。 */
export function oauthErrorPayload(response: OAuth2Server.Response): Record<string, unknown> {
    const body = response.body;
    if (!body || typeof body !== "object") {
        return {error: "server_error", error_description: "OAuth request failed"};
    }
    const error = "error" in body && typeof body.error === "string" ? body.error : "server_error";
    if (error === "server_error") {
        return {error, error_description: "OAuth request failed"};
    }
    const description = "error_description" in body && typeof body.error_description === "string"
        ? body.error_description
        : "OAuth request failed";
    return {error, error_description: description};
}
