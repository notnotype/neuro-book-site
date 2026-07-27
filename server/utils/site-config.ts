import {isIP} from "node:net";
import type {IncomingHttpHeaders} from "node:http";

type ClientAddressEvent = {
    node: {
        req: {
            socket: {remoteAddress?: string};
            headers: IncomingHttpHeaders;
        };
    };
};

/**
 * 解析布尔环境变量；未设置时返回 fallback。
 */
function envBoolean(name: string, fallback: boolean): boolean {
    const value = process.env[name]?.trim().toLowerCase();
    if (value === "1" || value === "true") {
        return true;
    }
    if (value === "0" || value === "false") {
        return false;
    }
    return fallback;
}

/** 使用动态键读取运行时 NODE_ENV，避免 Nitro 构建阶段将它常量折叠。 */
function runtimeNodeEnv(): string {
    const name = "NODE_ENV";
    return process.env[name]?.trim() ?? "";
}

/** owner-only 私有模式；生产默认开启。 */
export function isPrivateSite(): boolean {
    return envBoolean("NB_PRIVATE_MODE", runtimeNodeEnv() === "production");
}

/** 私有模式下注册服务端强制关闭。 */
export function isRegistrationEnabled(): boolean {
    return !isPrivateSite();
}

/** 私有模式下 GitHub OAuth 强制关闭；开发环境可显式或默认开启。 */
export function isGitHubOAuthEnabled(): boolean {
    return !isPrivateSite() && envBoolean("NB_GITHUB_OAUTH_ENABLED", runtimeNodeEnv() !== "production");
}

/**
 * 返回站点 canonical origin。生产由 NB_SITE_ORIGIN 唯一决定，开发可回退当前请求。
 */
export function siteOrigin(requestOrigin = ""): string {
    return process.env.NB_SITE_ORIGIN?.trim().replace(/\/$/, "") || requestOrigin.replace(/\/$/, "");
}

/**
 * 解析可信代理地址集合。只接受精确 IP，不接受网段或通配符。
 */
export function trustedProxyAddresses(): Set<string> {
    return new Set((process.env.NB_TRUSTED_PROXY_ADDRESSES ?? "")
        .split(",")
        .map((value) => normalizeIp(value.trim()))
        .filter((value) => isIP(value) !== 0));
}

/**
 * 获取限流使用的客户端 IP。只有直连 socket 命中可信代理时才读取 X-Real-IP。
 */
export function clientIp(event: ClientAddressEvent): string {
    const remoteAddress = normalizeIp(event.node.req.socket.remoteAddress ?? "");
    if (!trustedProxyAddresses().has(remoteAddress)) {
        return remoteAddress || "unknown";
    }
    const realIpHeader = event.node.req.headers["x-real-ip"];
    const realIp = normalizeIp(Array.isArray(realIpHeader) ? realIpHeader[0] ?? "" : realIpHeader ?? "");
    return isIP(realIp) !== 0 ? realIp : remoteAddress || "unknown";
}

/**
 * 归一 IPv4-mapped IPv6，确保 Compose bridge 地址能精确匹配。
 */
function normalizeIp(value: string): string {
    return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

/**
 * 校验生产环境所有不可缺省配置；返回全部问题便于一次修完。
 */
export function productionConfigErrors(): string[] {
    if (runtimeNodeEnv() !== "production") {
        return [];
    }
    const errors: string[] = [];
    const sessionPassword = process.env.NUXT_SESSION_PASSWORD?.trim() ?? "";
    if (sessionPassword.length < 48 || /replace|change|example|password/i.test(sessionPassword)) {
        errors.push("NUXT_SESSION_PASSWORD 必须是至少 48 字符且不含示例值的随机 secret");
    }
    const origin = process.env.NB_SITE_ORIGIN?.trim() ?? "";
    try {
        const parsed = new URL(origin);
        if (parsed.protocol !== "https:" || parsed.origin !== origin.replace(/\/$/, "") || parsed.pathname !== "/") {
            errors.push("NB_SITE_ORIGIN 必须是无路径的 HTTPS origin");
        }
    } catch {
        errors.push("NB_SITE_ORIGIN 必须是合法 HTTPS origin");
    }
    requireEnv(errors, "DATABASE_URL");
    requireEnv(errors, "WORKSHOP_FILES_DIR");
    requireEnv(errors, "NB_BACKUP_DIR");
    requirePositiveInteger(errors, "NB_STORAGE_MAX_BYTES");
    requirePositiveInteger(errors, "NB_STORAGE_RESERVED_BYTES");
    requirePositiveInteger(errors, "NB_BACKUP_MAX_FILE_BYTES");
    requirePositiveInteger(errors, "NB_BACKUP_QUOTA_BYTES");
    requirePositiveInteger(errors, "NB_BACKUP_MAX_COUNT");
    requirePositiveInteger(errors, "NB_WORKSHOP_MAX_FILE_BYTES");
    requirePositiveInteger(errors, "NB_WORKSHOP_MAX_UNCOMPRESSED_BYTES");
    requirePositiveInteger(errors, "NB_WORKSHOP_MAX_ENTRIES");
    if (trustedProxyAddresses().size === 0) {
        errors.push("NB_TRUSTED_PROXY_ADDRESSES 必须至少包含一个可信直连代理 IP");
    }
    if (!isPrivateSite()) {
        errors.push("私有内测要求 NB_PRIVATE_MODE=1");
    }
    if (process.env.ADMIN_PASSWORD !== undefined) {
        errors.push("生产环境禁止 ADMIN_PASSWORD；管理员密码只能经 stdin 初始化");
    }
    return errors;
}

/** 将缺失环境变量追加为生产配置错误。 */
function requireEnv(errors: string[], name: string): void {
    const value = process.env[name]?.trim() ?? "";
    if (!value || /replace|change|example/i.test(value)) {
        errors.push(`${name} 缺失或仍是示例值`);
    }
}

/** 将非法正整数环境变量追加为生产配置错误。 */
function requirePositiveInteger(errors: string[], name: string): void {
    const value = Number.parseInt(process.env[name]?.trim() ?? "", 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
        errors.push(`${name} 必须是正整数字节数`);
    }
}
