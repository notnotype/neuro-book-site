import {readonly, ref} from "vue";
import {applyNbTheme} from "@notnotype/nb-ui/theme";
import {DEFAULT_THEME_ID, themeIds, themeMeta, themes, type TemplateThemeId} from "~/theme/themes";

const STORAGE_KEY = "neuro-book-site-theme";

// 全局单例：当前主题 id。SPA 环境下模块级 ref 即可跨组件共享。
const current = ref<TemplateThemeId>(DEFAULT_THEME_ID);

/** 判断字符串是否为合法主题 id。 */
function isThemeId(value: string | null): value is TemplateThemeId {
    return value !== null && (themeIds as string[]).includes(value);
}

/**
 * 把主题变量写入 <html> 与 <body>，并同步 color-scheme。
 * color-scheme 影响浏览器原生 UI（滚动条、原生下拉、表单控件）的明暗表现。
 */
function applyTheme(id: TemplateThemeId): void {
    const vars = themes[id];
    applyNbTheme(document.documentElement, vars);
    applyNbTheme(document.body, vars);
    document.documentElement.style.colorScheme = themeMeta[id].appearance;
}

/**
 * 主题系统入口。
 * - initTheme：在 app 根组件挂载时调用一次，从 localStorage 恢复上次选择。
 * - setTheme：切换并持久化。
 */
export function useTheme() {
    function setTheme(id: TemplateThemeId): void {
        current.value = id;
        if (typeof document === "undefined") {
            return;
        }
        applyTheme(id);
        try {
            localStorage.setItem(STORAGE_KEY, id);
        } catch {
            // 隐私模式等场景 localStorage 不可用时静默忽略
        }
    }

    function initTheme(): void {
        if (typeof document === "undefined") {
            return;
        }
        let stored: string | null = null;
        try {
            stored = localStorage.getItem(STORAGE_KEY);
        } catch {
            stored = null;
        }
        current.value = isThemeId(stored) ? stored : DEFAULT_THEME_ID;
        applyTheme(current.value);
    }

    return {
        current: readonly(current),
        themeMeta,
        themeIds,
        setTheme,
        initTheme,
    };
}
