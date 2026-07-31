<script setup lang="ts">
import type {NuxtError} from "#app";

const props = defineProps<{error: NuxtError}>();
const {t} = useI18n();

useHead(() => ({title: t("errorPage.title")}));

/** 清除 Nuxt 错误边界并回到首页。 */
async function goHome(): Promise<void> {
    await clearError({redirect: "/"});
}
</script>

<template>
    <main class="relative flex min-h-screen items-center justify-center bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <div class="absolute right-4 top-4"><LocaleSwitcher /></div>
        <Panel class="w-full max-w-md space-y-4 text-center">
            <span class="i-lucide-circle-alert mx-auto block h-9 w-9 text-[var(--status-danger)]"></span>
            <h1 class="text-lg font-semibold">{{ t("errorPage.title") }}</h1>
            <p class="text-sm text-[var(--text-muted)]">{{ props.error.statusCode === 404 ? t("errorPage.notFound") : t("errorPage.generic") }}</p>
            <Button @click="goHome">{{ t("errorPage.home") }}</Button>
        </Panel>
    </main>
</template>
