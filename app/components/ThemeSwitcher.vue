<script setup lang="ts">
import {themeIds, themeMeta, themes} from "~/theme/themes";

// 主题切换器：以调色板预览 swatch 展示全部内置主题，点击即切换并持久化。
// 每个 swatch 用对应主题自身的色值渲染预览，因此无论当前主题是什么都能看清各主题风格。
const {current, setTheme} = useTheme();
const {t} = useI18n();

const themeLabel = {
    dark: "theme.dark",
    light: "theme.light",
    catppuccin: "theme.catppuccin",
    dracula: "theme.dracula",
    "tokyo-night": "theme.tokyoNight",
} as const;
</script>

<template>
    <div class="flex flex-wrap gap-2">
        <button
            v-for="id in themeIds"
            :key="id"
            type="button"
            class="nb-ui-focus-ring flex items-center gap-2.5 rounded-lg border p-2 pr-3 text-left transition-colors"
            :class="current === id ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:border-[var(--border-strong)]'"
            :aria-pressed="current === id"
            @click="setTheme(id)"
        >
            <!-- 主题调色板缩略预览：底色 + 强调色点 + 文本色条 -->
            <span class="relative h-8 w-8 shrink-0 overflow-hidden rounded-md border" :style="{background: themes[id]['--bg-main'], borderColor: themes[id]['--border-color']}">
                <span class="absolute left-1 top-1 h-3 w-4 rounded-sm" :style="{background: themes[id]['--bg-panel']}"></span>
                <span class="absolute bottom-1 left-1 h-2.5 w-2.5 rounded-full" :style="{background: themes[id]['--accent-main']}"></span>
                <span class="absolute bottom-1.5 right-1 h-1 w-3 rounded-full" :style="{background: themes[id]['--text-main']}"></span>
            </span>
            <span class="min-w-0">
                <span class="block text-sm font-medium text-[var(--text-main)]">{{ t(themeLabel[id]) }}</span>
                <span class="block text-[11px] text-[var(--text-muted)]">{{ t(themeMeta[id].appearance === "dark" ? "theme.darkAppearance" : "theme.lightAppearance") }}</span>
            </span>
            <span v-if="current === id" class="i-lucide-check ml-1 h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
        </button>
    </div>
</template>
