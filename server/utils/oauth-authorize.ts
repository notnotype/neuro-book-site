import {apiError} from "./api-error";
import {OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI, OAUTH_SCOPE} from "./oauth";

const AUTHORIZE_QUERY_KEYS = new Set([
    "client_id",
    "redirect_uri",
    "response_type",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
]);
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** 校验授权请求的固定 client、redirect、scope、state 与 S256 PKCE 合同。 */
export function validateAuthorizeQuery(query: Record<string, string>): void {
    for (const key of Object.keys(query)) {
        if (!AUTHORIZE_QUERY_KEYS.has(key)) {
            throw apiError(400, "invalid_request", "Unsupported OAuth authorization parameter");
        }
    }
    if (query.client_id !== OAUTH_CLIENT_ID || query.redirect_uri !== OAUTH_REDIRECT_URI) {
        throw apiError(400, "invalid_request", "OAuth client or redirect URI is invalid");
    }
    if (query.response_type !== "code" || query.scope !== OAUTH_SCOPE || !query.state) {
        throw apiError(400, "invalid_request", "OAuth authorization request is invalid");
    }
    if (!query.code_challenge || !CODE_CHALLENGE_PATTERN.test(query.code_challenge)
        || query.code_challenge_method !== "S256") {
        throw apiError(400, "invalid_request", "OAuth authorization requires S256 PKCE");
    }
}

/** 只接受授权确认页提交的 allowed 布尔字段。 */
export function readApprovalBody(body: unknown): boolean {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw apiError(400, "validation_failed", "Approval body must be an object");
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.allowed !== "boolean") {
        throw apiError(400, "validation_failed", "Approval body must contain only allowed:boolean");
    }
    return record.allowed;
}
