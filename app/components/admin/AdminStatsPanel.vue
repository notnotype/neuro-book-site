<script setup lang="ts">
import {onMounted, ref} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {AdminStatsDto} from "../../../shared/dto/admin.dto";

// admin 概览：站点核心数字卡片（无图表）。
const api = useWorkshopApi();

const stats = ref<AdminStatsDto | null>(null);
const loading = ref(false);
const errorMsg = ref("");

async function load(): Promise<void> {
    loading.value = true;
    errorMsg.value = "";
    try {
        stats.value = await api.getAdminStats();
    } catch (error) {
        errorMsg.value = resolveApiErrorMessage(error, "加载失败");
    } finally {
        loading.value = false;
    }
}

onMounted(load);

// 卡片定义：label + 取值 + 图标；紧凑网格渲染
const cards = [
    {key: "userTotal", label: "用户总数", icon: "i-lucide-users", value: (s: AdminStatsDto) => String(s.userTotal)},
    {key: "userRecent30d", label: "近 30 天注册", icon: "i-lucide-user-plus", value: (s: AdminStatsDto) => String(s.userRecent30d)},
    {key: "itemPublished", label: "公开条目", icon: "i-lucide-package", value: (s: AdminStatsDto) => String(s.itemPublished)},
    {key: "itemHidden", label: "下架/自藏条目", icon: "i-lucide-package-x", value: (s: AdminStatsDto) => `${s.itemRemoved} / ${s.itemUnlisted}`},
    {key: "downloadTotal", label: "总下载量", icon: "i-lucide-download", value: (s: AdminStatsDto) => String(s.downloadTotal)},
    {key: "backup", label: "云备份", icon: "i-lucide-cloud-upload", value: (s: AdminStatsDto) => `${s.backupCount} 份 · ${formatBytes(s.backupBytes)}`},
    {key: "reportPending", label: "待处理举报", icon: "i-lucide-flag", value: (s: AdminStatsDto) => String(s.reportPending)},
    {key: "inviteUnused", label: "未用邀请码", icon: "i-lucide-ticket", value: (s: AdminStatsDto) => String(s.inviteUnused)},
];
</script>

<template>
    <StateBlock v-if="loading && !stats" state="loading" />
    <StateBlock v-else-if="errorMsg && !stats" state="error" :message="errorMsg" :retry="load" />
    <div v-else-if="stats" class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Panel v-for="card in cards" :key="card.key" class="flex flex-col gap-1.5">
            <span class="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><span :class="card.icon" class="h-3.5 w-3.5"></span>{{ card.label }}</span>
            <span class="text-lg font-semibold text-[var(--text-main)]">{{ card.value(stats) }}</span>
        </Panel>
    </div>
</template>
