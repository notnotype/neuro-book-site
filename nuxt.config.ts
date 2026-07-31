import {defineNuxtConfig} from "nuxt/config";

export default defineNuxtConfig({
    ssr: false,
    modules: [
        "@unocss/nuxt",
        "@pinia/nuxt",
        "nuxt-auth-utils",
        "@nuxtjs/color-mode",
        "@nuxtjs/i18n",
        "@notnotype/nb-ui/nuxt",
    ],
    compatibilityDate: "2026-07-03",
    // UnoCSS 配置移到根 uno.config.ts（presetWind3 + presetIcons + nb-ui safelist），此处不再重复配置。
    // reset 先于 global.css 加载，保证 body margin 归零与主题字体/滚动条生效。
    css: ["@unocss/reset/tailwind.css", "~/styles/global.css"],
    devtools: {
        enabled: process.env.NUXT_DEVTOOLS === "1",
    },
    runtimeConfig: {
        public: {
            // 生产默认关闭；部署时由同名 NUXT_PUBLIC_ 环境变量在运行时显式开启。
            registrationEnabled: process.env.NODE_ENV !== "production",
            githubOAuthEnabled: process.env.NB_PRIVATE_MODE !== "1"
                && process.env.NUXT_PUBLIC_GITHUB_OAUTH_ENABLED !== "0"
                && process.env.NODE_ENV !== "production",
        },
    },
    nitro: {
        rollupConfig: {
            // 服务端 AST 校验从生产 node_modules 加载 TypeScript。不要把约 9 MiB
            // 编译器内联进 Nitro 单文件，否则 Rollup 会占用数 GiB 内存。
            external: ["typescript"],
            plugins: [
                {
                    // Prisma 生成 client 顶层的 __dirname polyfill 在 bundle 后拿到的是
                    // nitro 虚拟入口 URL（file:///_entry.js），Windows 上 fileURLToPath 直接抛
                    // ERR_INVALID_FILE_URL_PATH 导致 server 启动即崩。driver adapter（libsql）
                    // 模式下该 __dirname 不用于定位引擎文件，这里在构建期给它包一层兜底。
                    // Prisma 升级后若此行生成代码形态变化，集成测试会在 Windows 启动阶段直接暴露。
                    name: "patch-prisma-generated-dirname",
                    transform(code: string, id: string) {
                        if (!id.replaceAll("\\", "/").includes("/server/generated/prisma/client")) {
                            return null;
                        }
                        const pattern = /globalThis\[["']__dirname["']\]\s*=\s*path\.dirname\(fileURLToPath\([^)]*\)\)/;
                        if (!pattern.test(code)) {
                            return null;
                        }
                        return code.replace(pattern, (line) => `try { ${line} } catch { globalThis["__dirname"] = process.cwd() }`);
                    },
                },
            ],
        },
    },
    colorMode: {
        classSuffix: "",
        preference: "dark",
        fallback: "dark",
    },
    i18n: {
        strategy: "no_prefix",
        defaultLocale: "zh-CN",
        langDir: "locales",
        locales: [
            {code: "zh-CN", language: "zh-CN", name: "简体中文", file: "zh-CN.ts"},
            {code: "en-US", language: "en-US", name: "English", file: "en-US.ts"},
        ],
        detectBrowserLanguage: {
            useCookie: true,
            cookieKey: "neuro-book-site-locale",
            cookieSecure: process.env.NODE_ENV === "production",
            cookieCrossOrigin: false,
            alwaysRedirect: false,
            // no_prefix 下所有页面都没有语言段；在任意首次入口执行检测，分享链接才能遵循浏览器语言。
            redirectOn: "all",
            fallbackLocale: "zh-CN",
        },
    },
    app: {
        head: {
            // title 不在此设置：app.vue 的 titleTemplate 是唯一后缀出口，这里设了会被二次拼接
            meta: [
                {name: "viewport", content: "width=device-width, initial-scale=1"},
            ],
        },
    },
});
