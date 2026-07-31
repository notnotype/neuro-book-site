<script setup lang="ts">
// 列表 / 详情统一的三态占位：加载 / 空 / 错误。错误态可选 retry 回调渲染"重试"按钮。
defineProps<{
    state: "loading" | "empty" | "error";
    message?: string;
    retry?: () => void;
}>();
const {t} = useI18n();
</script>

<template>
    <div class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--border-color)] px-6 py-14 text-center text-[var(--text-secondary)]">
        <template v-if="state === 'loading'">
            <span class="i-lucide-loader-2 h-6 w-6 animate-spin text-[var(--text-muted)]"></span>
            <p class="text-sm">{{ message || t("state.loading") }}</p>
        </template>
        <template v-else-if="state === 'empty'">
            <span class="i-lucide-inbox h-7 w-7 text-[var(--text-muted)]"></span>
            <p class="text-sm">{{ message || t("state.empty") }}</p>
        </template>
        <template v-else>
            <span class="i-lucide-circle-alert h-7 w-7 text-[var(--status-danger)]"></span>
            <p class="text-sm">{{ message || t("state.failed") }}</p>
            <Button v-if="retry" size="sm" variant="secondary" @click="retry">{{ t("state.retry") }}</Button>
        </template>
    </div>
</template>
