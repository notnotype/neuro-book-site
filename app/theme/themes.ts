import {type NbThemeVars} from "@notnotype/nb-ui/theme";

/**
 * Workshop 内置主题（与 nb-fullstack-template 对齐）。
 *
 * 全部基于 nb-ui 的变量契约（NbThemeVars）定义，因此切换后所有 nb-ui 组件自动换肤。
 * 色值取自 NeuroBook 的主题体系，映射到 nb-ui 契约键。
 * 说明：dracula / tokyo-night 的 `--text-secondary` 在 NeuroBook 里是高饱和强调色（紫/绿），
 * 这里中和为中性色，保证表单说明等次要文本在高文本密度页面里可读。
 */
export type TemplateThemeId = "dark" | "light" | "catppuccin" | "dracula" | "tokyo-night";
export type ThemeAppearance = "light" | "dark";

/** 主题元信息：展示名与明暗归属。 */
export const themeMeta: Record<TemplateThemeId, {label: string; appearance: ThemeAppearance}> = {
    dark: {label: "Default Dark", appearance: "dark"},
    light: {label: "Light Editorial", appearance: "light"},
    catppuccin: {label: "Catppuccin", appearance: "dark"},
    dracula: {label: "Dracula", appearance: "dark"},
    "tokyo-night": {label: "Tokyo Night", appearance: "dark"},
};

/** 可选主题 id 列表（用于切换器遍历）。 */
export const themeIds = Object.keys(themeMeta) as TemplateThemeId[];

/** 默认主题。 */
export const DEFAULT_THEME_ID: TemplateThemeId = "dark";

// 面板浮层阴影：按明暗分档，深色更重、浅色更柔
const DARK_SHADOW = "0 1px 2px rgba(0, 0, 0, 0.45), 0 20px 48px rgba(0, 0, 0, 0.55)";
const LIGHT_SHADOW = "0 1px 2px rgba(15, 23, 42, 0.10), 0 18px 44px rgba(15, 23, 42, 0.14)";

/** 主题变量表：唯一色值来源。 */
export const themes: Record<TemplateThemeId, NbThemeVars> = {
    dark: {
        "--color-scheme": "dark",
        "--bg-main": "#18181b",
        "--bg-panel": "#252529",
        "--bg-subtle": "color-mix(in srgb, #1e1e22 78%, #252529)",
        "--bg-hover": "#313137",
        "--bg-input": "#121214",
        "--text-main": "#fafafa",
        "--text-secondary": "#d4d4d8",
        "--text-muted": "#a1a1aa",
        "--text-inverse": "#0b0b0d",
        "--border-color": "#3f3f46",
        "--border-strong": "#4e4e54",
        "--accent-main": "#f59e0b",
        "--accent-bg": "rgba(245, 158, 11, 0.15)",
        "--accent-text": "#fbbd23",
        "--status-success": "#22c55e",
        "--status-warning": "#f59e0b",
        "--status-danger": "#fb7185",
        "--shadow-panel": DARK_SHADOW,
        "--selection-bg": "rgba(245, 158, 11, 0.34)",
    },
    light: {
        "--color-scheme": "light",
        "--bg-main": "#f6f8fa",
        "--bg-panel": "#ffffff",
        "--bg-subtle": "color-mix(in srgb, #f0f2f5 78%, #ffffff)",
        "--bg-hover": "#e6e8ec",
        "--bg-input": "#f3f4f6",
        "--text-main": "#111827",
        "--text-secondary": "#4b5563",
        "--text-muted": "#9ca3af",
        "--text-inverse": "#ffffff",
        "--border-color": "#e5e7eb",
        "--border-strong": "#d1d5db",
        "--accent-main": "#3b82f6",
        "--accent-bg": "rgba(59, 130, 246, 0.12)",
        "--accent-text": "#2563eb",
        "--status-success": "#16a34a",
        "--status-warning": "#b45309",
        "--status-danger": "#dc2626",
        "--shadow-panel": LIGHT_SHADOW,
        "--selection-bg": "rgba(59, 130, 246, 0.24)",
    },
    catppuccin: {
        "--color-scheme": "dark",
        "--bg-main": "#11111b",
        "--bg-panel": "#1e1e2e",
        "--bg-subtle": "color-mix(in srgb, #181825 78%, #1e1e2e)",
        "--bg-hover": "#313244",
        "--bg-input": "#11111b",
        "--text-main": "#cdd6f4",
        "--text-secondary": "#a6adc8",
        "--text-muted": "#6c7086",
        "--text-inverse": "#11111b",
        "--border-color": "#3e3f56",
        "--border-strong": "#45475a",
        "--accent-main": "#b4befe",
        "--accent-bg": "rgba(180, 190, 254, 0.15)",
        "--accent-text": "#cba6f7",
        "--status-success": "#a6e3a1",
        "--status-warning": "#f9e2af",
        "--status-danger": "#f38ba8",
        "--shadow-panel": DARK_SHADOW,
        "--selection-bg": "rgba(180, 190, 254, 0.34)",
    },
    dracula: {
        "--color-scheme": "dark",
        "--bg-main": "#1e1f29",
        "--bg-panel": "#282a36",
        "--bg-subtle": "color-mix(in srgb, #21222c 78%, #282a36)",
        "--bg-hover": "#343746",
        "--bg-input": "#191a21",
        "--text-main": "#f8f8f2",
        "--text-secondary": "#b9bcd6",
        "--text-muted": "#6272a4",
        "--text-inverse": "#282a36",
        "--border-color": "#50536c",
        "--border-strong": "#6272a4",
        "--accent-main": "#ff79c6",
        "--accent-bg": "rgba(255, 121, 198, 0.15)",
        "--accent-text": "#50fa7b",
        "--status-success": "#50fa7b",
        "--status-warning": "#f1fa8c",
        "--status-danger": "#ff5555",
        "--shadow-panel": DARK_SHADOW,
        "--selection-bg": "rgba(255, 121, 198, 0.34)",
    },
    "tokyo-night": {
        "--color-scheme": "dark",
        "--bg-main": "#16161e",
        "--bg-panel": "#1a1b26",
        "--bg-subtle": "color-mix(in srgb, #16161e 78%, #1a1b26)",
        "--bg-hover": "#24283b",
        "--bg-input": "#13131a",
        "--text-main": "#a9b1d6",
        "--text-secondary": "#8891b4",
        "--text-muted": "#565f89",
        "--text-inverse": "#1a1b26",
        "--border-color": "#454c6f",
        "--border-strong": "#565f89",
        "--accent-main": "#7aa2f7",
        "--accent-bg": "rgba(122, 162, 247, 0.15)",
        "--accent-text": "#bb9af7",
        "--status-success": "#9ece6a",
        "--status-warning": "#e0af68",
        "--status-danger": "#f7768e",
        "--shadow-panel": DARK_SHADOW,
        "--selection-bg": "rgba(122, 162, 247, 0.34)",
    },
};
