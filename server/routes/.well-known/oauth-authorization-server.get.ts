import {getRequestURL} from "h3";
import {siteOrigin} from "../../utils/site-config";

/** OAuth Authorization Server Metadata（RFC 8414）；所有 endpoint URL 使用 canonical origin。 */
export default defineEventHandler((event) => {
    const origin = siteOrigin(getRequestURL(event).origin);
    return {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/api/v1/oauth/token`,
        userinfo_endpoint: `${origin}/api/v1/oauth/userinfo`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        scopes_supported: ["profile"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
    };
});
