import {afterEach, describe, expect, it, vi} from "vitest";
import {
    clientIp,
    isGitHubOAuthEnabled,
    isPrivateSite,
    isRegistrationEnabled,
    productionConfigErrors,
} from "./site-config";

/** 构造 clientIp 实际消费的最小请求形状。 */
function addressEvent(remoteAddress: string, realIp?: string): Parameters<typeof clientIp>[0] {
    return {
        node: {
            req: {
                socket: {remoteAddress},
                headers: realIp ? {"x-real-ip": realIp} : {},
            },
        },
    };
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("site feature gates", () => {
    it("生产环境默认启用私有模式并关闭注册与 GitHub OAuth", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("NB_PRIVATE_MODE", "");
        vi.stubEnv("NB_GITHUB_OAUTH_ENABLED", "1");

        expect(isPrivateSite()).toBe(true);
        expect(isRegistrationEnabled()).toBe(false);
        expect(isGitHubOAuthEnabled()).toBe(false);
    });

    it("开发环境可显式开启私有模式", () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("NB_PRIVATE_MODE", "1");

        expect(isPrivateSite()).toBe(true);
        expect(isRegistrationEnabled()).toBe(false);
        expect(isGitHubOAuthEnabled()).toBe(false);
    });
});

describe("clientIp", () => {
    it("非可信来源伪造 X-Real-IP 时仍使用直连地址", () => {
        vi.stubEnv("NB_TRUSTED_PROXY_ADDRESSES", "172.30.0.1");

        expect(clientIp(addressEvent("203.0.113.10", "198.51.100.8"))).toBe("203.0.113.10");
    });

    it("可信 Compose 网关可传递合法 X-Real-IP，并归一 IPv4-mapped 地址", () => {
        vi.stubEnv("NB_TRUSTED_PROXY_ADDRESSES", "172.30.0.1");

        expect(clientIp(addressEvent("::ffff:172.30.0.1", "198.51.100.8"))).toBe("198.51.100.8");
    });

    it("可信代理传入非法地址时退回直连地址", () => {
        vi.stubEnv("NB_TRUSTED_PROXY_ADDRESSES", "172.30.0.1");

        expect(clientIp(addressEvent("172.30.0.1", "spoofed"))).toBe("172.30.0.1");
    });
});

describe("productionConfigErrors", () => {
    /** 填充一组可通过生产门禁的最小环境。 */
    function validProductionEnv(): void {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("NUXT_SESSION_PASSWORD", "cW8qP9TVeJ1Kzv5aM2hR7sX4nB6uD3fG0yL8kQ5pN9tV2xZa");
        vi.stubEnv("NB_SITE_ORIGIN", "https://nbook.notnotype.com");
        vi.stubEnv("DATABASE_URL", "file:/data/site.db");
        vi.stubEnv("WORKSHOP_FILES_DIR", "/data/workshop");
        vi.stubEnv("NB_BACKUP_DIR", "/data/backups");
        vi.stubEnv("NB_STORAGE_MAX_BYTES", String(6 * 1024 * 1024 * 1024));
        vi.stubEnv("NB_STORAGE_RESERVED_BYTES", String(4 * 1024 * 1024 * 1024));
        vi.stubEnv("NB_BACKUP_MAX_FILE_BYTES", String(1024 * 1024 * 1024));
        vi.stubEnv("NB_BACKUP_QUOTA_BYTES", String(2 * 1024 * 1024 * 1024));
        vi.stubEnv("NB_BACKUP_MAX_COUNT", "5");
        vi.stubEnv("NB_WORKSHOP_MAX_FILE_BYTES", String(20 * 1024 * 1024));
        vi.stubEnv("NB_WORKSHOP_MAX_UNCOMPRESSED_BYTES", String(100 * 1024 * 1024));
        vi.stubEnv("NB_WORKSHOP_MAX_ENTRIES", "500");
        vi.stubEnv("NB_LOG_LEVEL", "info");
        vi.stubEnv("NB_LOG_FILE", "C:/logs/site.jsonl");
        vi.stubEnv("NB_TRUSTED_PROXY_ADDRESSES", "172.30.0.1");
        vi.stubEnv("NB_PRIVATE_MODE", "1");
        vi.stubEnv("ADMIN_PASSWORD", "");
        delete process.env.ADMIN_PASSWORD;
    }

    it("完整私有生产配置通过", () => {
        validProductionEnv();
        expect(productionConfigErrors()).toEqual([]);
    });

    it("拒绝示例 secret、缺失容量参数和 ADMIN_PASSWORD", () => {
        validProductionEnv();
        vi.stubEnv("NUXT_SESSION_PASSWORD", "replace-with-at-least-48-characters-example-value");
        vi.stubEnv("NB_STORAGE_MAX_BYTES", "");
        vi.stubEnv("ADMIN_PASSWORD", "admin123456");

        const errors = productionConfigErrors();
        expect(errors).toContain("NUXT_SESSION_PASSWORD 必须是至少 48 字符且不含示例值的随机 secret");
        expect(errors).toContain("NB_STORAGE_MAX_BYTES 必须是正整数字节数");
        expect(errors).toContain("生产环境禁止 ADMIN_PASSWORD；管理员密码只能经 stdin 初始化");
    });

    it("拒绝非法日志级别与相对日志路径", () => {
        validProductionEnv();
        vi.stubEnv("NB_LOG_LEVEL", "silent");
        vi.stubEnv("NB_LOG_FILE", "logs/site.jsonl");

        expect(productionConfigErrors()).toEqual(expect.arrayContaining([
            "NB_LOG_LEVEL 必须是 debug/info/warn/error",
            "NB_LOG_FILE 必须是绝对路径",
        ]));
    });
});
