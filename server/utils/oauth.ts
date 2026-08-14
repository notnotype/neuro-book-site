import {createHash, randomBytes} from "node:crypto";
import OAuth2Server from "@node-oauth/oauth2-server";
import {prisma} from "../database/prisma";
import type {OAuthAccessToken, OAuthAuthorizationCode, OAuthClient, User} from "../database/prisma";
import {verifyUserPassword} from "./password";

export const OAUTH_CLIENT_ID = "llmlint-web";
export const OAUTH_REDIRECT_URI = "https://llmlint.notnotype.com/auth/neurobook";
export const OAUTH_SCOPE = "profile";
export const OAUTH_SCOPE_LIST = [OAUTH_SCOPE] as const;
export const OAUTH_AUTHORIZATION_CODE_LIFETIME_SECONDS = 300;
export const OAUTH_ACCESS_TOKEN_LIFETIME_SECONDS = 300;

export type OAuthProfileUser = Pick<User, "id" | "username" | "displayName" | "status">;

type StoredAuthorizationCode = OAuthAuthorizationCode & {
    client: OAuthClient;
    user: User;
};

type StoredAccessToken = OAuthAccessToken & {
    client: OAuthClient;
    user: User;
};

/** 计算 OAuth 明文凭据的不可逆摘要；明文不进入 Prisma。 */
export function hashOAuthSecret(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 生成只在当前请求内存中使用的 opaque code/token。 */
function generateOpaqueValue(prefix: string): string {
    return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function parseScopeJson(value: string): string[] | null {
    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed) || parsed.some((scope) => typeof scope !== "string")) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function userIdOf(user: OAuth2Server.User): number | null {
    const id = user.id;
    return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

function clientIdOf(client: OAuth2Server.Client): string | null {
    return typeof client.id === "string" && client.id === OAUTH_CLIENT_ID ? client.id : null;
}

const oauthModel: OAuth2Server.AuthorizationCodeModel = {
    async getClient(clientId: string, clientSecret?: string | null): Promise<OAuth2Server.Client | false> {
        if (clientId !== OAUTH_CLIENT_ID) {
            return false;
        }
        const client = await prisma.oAuthClient.findUnique({where: {clientId}});
        if (!client || client.status !== "active" || client.redirectUri !== OAUTH_REDIRECT_URI) {
            return false;
        }
        if (clientSecret !== null && clientSecret !== undefined) {
            if (!await verifyUserPassword(clientSecret, client.secretHash)) {
                return false;
            }
        }
        return {
            id: client.clientId,
            redirectUris: [client.redirectUri],
            grants: ["authorization_code"],
            accessTokenLifetime: OAUTH_ACCESS_TOKEN_LIFETIME_SECONDS,
        };
    },

    async validateRedirectUri(redirectUri: string, client: OAuth2Server.Client): Promise<boolean> {
        return clientIdOf(client) === OAUTH_CLIENT_ID && redirectUri === OAUTH_REDIRECT_URI;
    },

    async validateScope(user: OAuth2Server.User, client: OAuth2Server.Client, scope?: string[]): Promise<string[] | false> {
        if (!userIdOf(user) || !clientIdOf(client) || !scope || scope.length !== 1 || scope[0] !== OAUTH_SCOPE) {
            return false;
        }
        return [OAUTH_SCOPE];
    },

    async generateAuthorizationCode(): Promise<string> {
        return generateOpaqueValue("nb_oac_");
    },

    async saveAuthorizationCode(
        code: Pick<OAuth2Server.AuthorizationCode, "authorizationCode" | "expiresAt" | "redirectUri" | "scope" | "codeChallenge" | "codeChallengeMethod">,
        client: OAuth2Server.Client,
        user: OAuth2Server.User,
    ): Promise<OAuth2Server.AuthorizationCode | false> {
        const clientId = clientIdOf(client);
        const userId = userIdOf(user);
        const scope = code.scope ?? [];
        if (!clientId || !userId || code.redirectUri !== OAUTH_REDIRECT_URI
            || code.codeChallengeMethod !== "S256" || !code.codeChallenge
            || scope.length !== 1 || scope[0] !== OAUTH_SCOPE) {
            return false;
        }
        const created = await prisma.oAuthAuthorizationCode.create({
            data: {
                codeHash: hashOAuthSecret(code.authorizationCode),
                clientId,
                userId,
                redirectUri: code.redirectUri,
                scopeJson: JSON.stringify(scope),
                codeChallenge: code.codeChallenge,
                codeChallengeMethod: code.codeChallengeMethod,
                status: "active",
                expiresAt: code.expiresAt,
            },
            include: {client: true, user: true},
        });
        return {
            authorizationCode: code.authorizationCode,
            expiresAt: created.expiresAt,
            redirectUri: created.redirectUri,
            scope,
            codeChallenge: created.codeChallenge,
            codeChallengeMethod: created.codeChallengeMethod,
            client: {
                id: created.client.clientId,
                redirectUris: [created.client.redirectUri],
                grants: ["authorization_code"],
                accessTokenLifetime: OAUTH_ACCESS_TOKEN_LIFETIME_SECONDS,
            },
            user: created.user,
        };
    },

    async getAuthorizationCode(authorizationCode: string): Promise<OAuth2Server.AuthorizationCode | false> {
        const stored: StoredAuthorizationCode | null = await prisma.oAuthAuthorizationCode.findUnique({
            where: {codeHash: hashOAuthSecret(authorizationCode)},
            include: {client: true, user: true},
        });
        if (!stored || stored.status !== "active" || stored.expiresAt <= new Date()
            || stored.client.status !== "active" || stored.user.status !== "active") {
            return false;
        }
        const scope = parseScopeJson(stored.scopeJson);
        if (!scope) {
            return false;
        }
        return {
            authorizationCode,
            expiresAt: stored.expiresAt,
            redirectUri: stored.redirectUri,
            scope,
            codeChallenge: stored.codeChallenge,
            codeChallengeMethod: stored.codeChallengeMethod,
            client: {
                id: stored.client.clientId,
                redirectUris: [stored.client.redirectUri],
                grants: ["authorization_code"],
                accessTokenLifetime: OAUTH_ACCESS_TOKEN_LIFETIME_SECONDS,
            },
            user: stored.user,
        };
    },

    async revokeAuthorizationCode(code: OAuth2Server.AuthorizationCode): Promise<boolean> {
        const result = await prisma.oAuthAuthorizationCode.updateMany({
            where: {codeHash: hashOAuthSecret(code.authorizationCode), status: "active"},
            data: {status: "consumed", consumedAt: new Date()},
        });
        return result.count === 1;
    },

    async generateAccessToken(): Promise<string> {
        return generateOpaqueValue("nb_oat_");
    },

    async generateRefreshToken(): Promise<string> {
        // TokenHandler 5.3.0 要求正 refreshTokenLifetime，但空 sentinel 使响应和数据库都没有 refresh token。
        return "";
    },

    async saveToken(
        token: OAuth2Server.Token,
        client: OAuth2Server.Client,
        user: OAuth2Server.User,
    ): Promise<OAuth2Server.Token | false> {
        const clientId = clientIdOf(client);
        const userId = userIdOf(user);
        const accessTokenExpiresAt = token.accessTokenExpiresAt;
        const scope = token.scope ?? [];
        if (!clientId || !userId || !token.accessToken || !(accessTokenExpiresAt instanceof Date)
            || scope.length !== 1 || scope[0] !== OAUTH_SCOPE) {
            return false;
        }
        await prisma.oAuthAccessToken.create({
            data: {
                tokenHash: hashOAuthSecret(token.accessToken),
                clientId,
                userId,
                scopeJson: JSON.stringify(scope),
                status: "active",
                expiresAt: accessTokenExpiresAt,
            },
        });
        return {
            ...token,
            refreshToken: "",
            client,
            user,
        };
    },

    async getAccessToken(accessToken: string): Promise<OAuth2Server.Token | false> {
        const stored: StoredAccessToken | null = await prisma.oAuthAccessToken.findUnique({
            where: {tokenHash: hashOAuthSecret(accessToken)},
            include: {client: true, user: true},
        });
        if (!stored || stored.status !== "active" || stored.expiresAt <= new Date()
            || stored.client.status !== "active" || stored.user.status !== "active") {
            return false;
        }
        const scope = parseScopeJson(stored.scopeJson);
        if (!scope) {
            return false;
        }
        return {
            accessToken,
            accessTokenExpiresAt: stored.expiresAt,
            scope,
            client: {
                id: stored.client.clientId,
                redirectUris: [stored.client.redirectUri],
                grants: ["authorization_code"],
                accessTokenLifetime: OAUTH_ACCESS_TOKEN_LIFETIME_SECONDS,
            },
            user: stored.user,
        };
    },

    async verifyScope(token: OAuth2Server.Token, scope: string[]): Promise<boolean> {
        const authorized = token.scope ?? [];
        return scope.every((requested) => authorized.includes(requested));
    },
};

const oauthOptions = {
    model: oauthModel,
    authorizationCodeLifetime: OAUTH_AUTHORIZATION_CODE_LIFETIME_SECONDS,
    accessTokenLifetime: OAUTH_ACCESS_TOKEN_LIFETIME_SECONDS,
    refreshTokenLifetime: OAUTH_ACCESS_TOKEN_LIFETIME_SECONDS,
    enablePlainPKCE: false,
    requireClientAuthentication: {authorization_code: true},
    allowEmptyState: false,
    allowExtendedTokenAttributes: false,
    allowBearerTokensInQueryString: false,
} as OAuth2Server.ServerOptions & {enablePlainPKCE: boolean};

export const oauthServer = new OAuth2Server(oauthOptions);

/** 将当前官方用户转成 OAuth library 只读 user 对象。 */
export function toOAuthUser(user: OAuthProfileUser): OAuth2Server.User {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        status: user.status,
    };
}
