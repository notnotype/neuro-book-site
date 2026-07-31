<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import type {BackupListDto} from "../../shared/dto/backup.dto";

// 云备份面板（spec §9）：列表 / 下载 / 删除 / 配额用量。上传由实例侧发起，面板只做管理。

const api = useWorkshopApi();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const {t} = useI18n();
const {formatBytes, formatDateTime, formatNumber} = useLocaleFormat();

const data = ref<BackupListDto | null>(null); // 为空表示尚未加载完成
const loading = ref(false);
const errorMsg = ref("");
// 两步确认删除：第一次点击进入确认态，再次点击执行
const confirmDeleteId = ref<number | null>(null);
const acting = ref(false);

const usagePercent = computed(() => {
    if (!data.value || data.value.quota.maxBytes <= 0) {
        return 0;
    }
    return Math.min(100, Math.round((data.value.quota.usedBytes / data.value.quota.maxBytes) * 100));
});

async function load(): Promise<void> {
    loading.value = true;
    errorMsg.value = "";
    try {
        data.value = await api.listBackups();
    } catch (error) {
        errorMsg.value = localizedError.resolve(error, "common.loadFailed");
    } finally {
        loading.value = false;
    }
}

async function remove(id: number): Promise<void> {
    if (confirmDeleteId.value !== id) {
        confirmDeleteId.value = id;
        return;
    }
    acting.value = true;
    try {
        await api.deleteBackup(id);
        notification.success(t("backup.deleted"));
        confirmDeleteId.value = null;
        await load();
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.deleteFailed"));
    } finally {
        acting.value = false;
    }
}

onMounted(() => void load());
</script>

<template>
    <!-- 云备份管理 -->
    <div class="flex flex-col gap-4">
        <p class="text-sm text-[var(--text-muted)]">{{ t("backup.description") }}</p>

        <StateBlock v-if="loading && !data" state="loading" />
        <StateBlock v-else-if="errorMsg && !data" state="error" :message="errorMsg" :retry="load" />

        <template v-else-if="data">
            <!-- 配额用量条 -->
            <div class="flex flex-col gap-1.5 rounded-xl border border-[var(--border-color)] p-4">
                <div class="flex items-center justify-between text-sm">
                    <span class="text-[var(--text-main)]">{{ t("backup.storageUsage") }}</span>
                    <span class="text-[var(--text-muted)]">{{ formatBytes(data.quota.usedBytes) }} / {{ formatBytes(data.quota.maxBytes) }} · {{ t("backup.quotaCount", {count: formatNumber(data.quota.count), maximum: formatNumber(data.quota.maxCount)}) }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[var(--bg-input)]">
                    <div class="h-full rounded-full bg-[var(--accent-main)] transition-all" :style="{width: `${usagePercent}%`}"></div>
                </div>
            </div>

            <StateBlock v-if="data.items.length === 0" state="empty" :message="t('backup.empty')" />

            <ul v-else class="flex flex-col gap-3">
                <li v-for="backup in data.items" :key="backup.id" class="flex flex-col gap-2 rounded-xl border border-[var(--border-color)] p-4">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="i-lucide-archive h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
                        <span class="font-medium text-[var(--text-main)]">{{ backup.instanceLabel }}</span>
                        <span class="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-xs text-[var(--text-muted)]">{{ backup.kind === "manual" ? t("backup.manual") : t("backup.automatic") }}</span>
                        <span class="ml-auto text-xs text-[var(--text-muted)]">{{ formatDateTime(backup.createdAt) }}</span>
                    </div>
                    <p v-if="backup.comment" class="text-sm text-[var(--text-muted)]">{{ backup.comment }}</p>
                    <div class="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                        <span>{{ formatBytes(backup.fileSize) }}</span>
                        <span>NeuroBook {{ backup.appVersion }}</span>
                        <span class="hidden font-mono sm:inline" :title="backup.sha256">sha256 {{ backup.sha256.slice(0, 12) }}…</span>
                        <span class="flex-1"></span>
                        <Button size="sm" variant="subtle" as="a" :href="api.backupDownloadHref(backup.id)"><span class="i-lucide-download h-3.5 w-3.5"></span>{{ t("backup.download") }}</Button>
                        <Button size="sm" :variant="confirmDeleteId === backup.id ? 'danger' : 'subtle'" :loading="acting && confirmDeleteId === backup.id" @click="remove(backup.id)">
                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>{{ confirmDeleteId === backup.id ? t("backup.confirmDelete") : t("backup.delete") }}
                        </Button>
                    </div>
                </li>
            </ul>
        </template>
    </div>
</template>
