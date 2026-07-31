<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {AdminStatsDto} from "../../../shared/dto/admin.dto";

// admin 概览：站点核心数字卡片（无图表）。
const api = useWorkshopApi();
const localizedError = useLocalizedApiError();
const {t} = useI18n();
const {formatBytes, formatNumber} = useLocaleFormat();

const stats = ref<AdminStatsDto | null>(null);
const loading = ref(false);
const errorMsg = ref("");

async function load(): Promise<void> {
    loading.value = true;
    errorMsg.value = "";
    try {
        stats.value = await api.getAdminStats();
    } catch (error) {
        errorMsg.value = localizedError.resolve(error, "common.loadFailed");
    } finally {
        loading.value = false;
    }
}

onMounted(load);

// 卡片定义：label + 取值 + 图标；紧凑网格渲染
const cards = [
    {key: "userTotal", icon: "i-lucide-users", value: (s: AdminStatsDto) => formatNumber(s.userTotal)},
    {key: "userRecent30d", icon: "i-lucide-user-plus", value: (s: AdminStatsDto) => formatNumber(s.userRecent30d)},
    {key: "itemPublished", icon: "i-lucide-package", value: (s: AdminStatsDto) => formatNumber(s.itemPublished)},
    {key: "itemHidden", icon: "i-lucide-package-x", value: (s: AdminStatsDto) => `${formatNumber(s.itemRemoved)} / ${formatNumber(s.itemUnlisted)}`},
    {key: "downloadTotal", icon: "i-lucide-download", value: (s: AdminStatsDto) => formatNumber(s.downloadTotal)},
    {key: "backup", icon: "i-lucide-cloud-upload", value: (s: AdminStatsDto) => t("admin.stats.backupValue", {count: formatNumber(s.backupCount), size: formatBytes(s.backupBytes)})},
    {key: "reportPending", icon: "i-lucide-flag", value: (s: AdminStatsDto) => formatNumber(s.reportPending)},
    {key: "registrationCodeTotal", icon: "i-lucide-ticket", value: (s: AdminStatsDto) => formatNumber(s.registrationCodeTotal)},
];
</script>

<template>
    <StateBlock v-if="loading && !stats" state="loading" />
    <StateBlock v-else-if="errorMsg && !stats" state="error" :message="errorMsg" :retry="load" />
    <div v-else-if="stats" class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Panel v-for="card in cards" :key="card.key" class="flex flex-col gap-1.5">
            <span class="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><span :class="card.icon" class="h-3.5 w-3.5"></span>{{ t(`admin.stats.${card.key}`) }}</span>
            <span class="text-lg font-semibold text-[var(--text-main)]">{{ card.value(stats) }}</span>
        </Panel>
    </div>
</template>
