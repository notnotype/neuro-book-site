import {defineConfig, presetIcons, presetWind3} from "unocss";
import {NB_UI_ICON_SAFELIST} from "@notnotype/nb-ui/uno";

/**
 * Workshop UnoCSS 配置（与 nb-fullstack-template 对齐）。
 *
 * 关键点：
 * - presetWind3 提供 Tailwind3 兼容的原子类，项目现有类（rounded-md、bg-[var(--*)] 等）全部依赖它。
 * - presetIcons 接入 @iconify-json/lucide，让页面与 nb-ui 里的 `i-lucide-*` 渲染为真实图标。
 * - safelist 兜底 nb-ui 组件内部写死、可能不出现在页面模板里的图标类，保证按需提取失效时仍能生成。
 */
export default defineConfig({
    presets: [
        presetWind3(),
        presetIcons({
            scale: 1.1,
            // 图标默认按文字基线对齐，避免与相邻文本行内错位
            extraProperties: {
                display: "inline-block",
                "vertical-align": "middle",
            },
        }),
    ],
    // nb-ui 组件内部固定使用的图标：清单由 nb-ui 导出，随库版本自动同步
    safelist: [...NB_UI_ICON_SAFELIST],
});
