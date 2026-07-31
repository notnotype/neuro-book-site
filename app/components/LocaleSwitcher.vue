<script setup lang="ts">
import {computed} from "vue";
import type {DropdownItem} from "@notnotype/nb-ui/components";

const {locale, setLocale, t} = useI18n();

const items = computed<DropdownItem[]>(() => [
    {label: t("common.chinese"), value: "zh-CN", rightIconClass: locale.value === "zh-CN" ? "i-lucide-check" : undefined},
    {label: t("common.english"), value: "en-US", rightIconClass: locale.value === "en-US" ? "i-lucide-check" : undefined},
]);

/** 切换语言并由 i18n 模块写入一年期站点 Cookie。 */
async function select(value: string): Promise<void> {
    if (value === "zh-CN" || value === "en-US") {
        await setLocale(value);
    }
}
</script>

<template>
    <Dropdown :items="items" root-class="relative" menu-class="right-0 top-full mt-2 min-w-36" @select="select">
        <button type="button" class="nb-ui-focus-ring flex h-9 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]" :title="t('common.language')" :aria-label="t('common.language')">
            <span class="i-lucide-languages h-4 w-4"></span>
            <span>{{ locale === "zh-CN" ? "中" : "EN" }}</span>
        </button>
    </Dropdown>
</template>
