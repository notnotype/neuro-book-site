<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {AdminBackupDto, AdminBackupUsageDto} from "../../../shared/dto/admin.dto";

// admin 备份用量：按账号聚合总览；点开某账号展开其备份行，可删除异常备份。
const api = useWorkshopApi();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const {t} = useI18n();
const {formatBytes, formatDate, relativeTime, formatNumber} = useLocaleFormat();

const usage = ref<AdminBackupUsageDto[]>([]);
const loading = ref(false);
const errorMsg = ref("");

// 展开的账号与其备份行（同时只展开一个，简单直接）
const expandedUserId = ref<number | null>(null);
const rows = ref<AdminBackupDto[]>([]);
const rowsLoading = ref(false);

// 删除确认
const pendingDelete = ref<AdminBackupDto | null>(null);
const deleting = ref(false);

async function load(): Promise<void> {
    loading.value = true;
    errorMsg.value = "";
    try {
        usage.value = await api.getBackupUsage();
    } catch (error) {
        errorMsg.value = localizedError.resolve(error, "common.loadFailed");
    } finally {
        loading.value = false;
    }
}

async function toggleExpand(userId: number): Promise<void> {
    if (expandedUserId.value === userId) {
        expandedUserId.value = null;
        rows.value = [];
        return;
    }
    expandedUserId.value = userId;
    rows.value = [];
    rowsLoading.value = true;
    try {
        // 单账号份数受配额上限（默认 20）约束，一页取满即可
        const page = await api.listAdminBackups({userId, limit: 100});
        rows.value = page.items;
    } catch (error) {
        notification.error(localizedError.resolve(error, "backup.detailsLoadFailed"));
    } finally {
        rowsLoading.value = false;
    }
}

async function confirmDelete(): Promise<void> {
    const target = pendingDelete.value;
    if (!target) {
        return;
    }
    deleting.value = true;
    try {
        await api.adminDeleteBackup(target.id);
        rows.value = rows.value.filter((row) => row.id !== target.id);
        pendingDelete.value = null;
        notification.success(t("backup.deleted"));
        await load(); // 刷新聚合数字
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.deleteFailed"));
    } finally {
        deleting.value = false;
    }
}

onMounted(load);
</script>

<template>
    <div class="flex flex-col gap-4">
        <StateBlock v-if="loading && usage.length === 0" state="loading" />
        <StateBlock v-else-if="errorMsg && usage.length === 0" state="error" :message="errorMsg" :retry="load" />
        <StateBlock v-else-if="usage.length === 0" state="empty" :message="t('backup.emptyAdmin')" />
        <ul v-else class="flex flex-col gap-2">
            <li v-for="row in usage" :key="row.userId" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]">
                <!-- 聚合行：点击展开该账号的备份明细 -->
                <button type="button" class="flex w-full flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]" @click="toggleExpand(row.userId)">
                    <span class="flex min-w-0 items-center gap-2 text-sm font-medium text-[var(--text-main)]">
                        <span :class="expandedUserId === row.userId ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                        <span class="truncate">@{{ row.username }}</span>
                    </span>
                    <span class="shrink-0 text-xs text-[var(--text-muted)]">{{ t("backup.countAndSize", {count: formatNumber(row.count), size: formatBytes(row.totalBytes)}) }}<span v-if="row.latestAt"> · {{ t("backup.latest", {time: relativeTime(row.latestAt)}) }}</span></span>
                </button>
                <!-- 明细行 -->
                <div v-if="expandedUserId === row.userId" class="border-t border-[var(--border-color)] px-3 py-2">
                    <StateBlock v-if="rowsLoading" state="loading" />
                    <StateBlock v-else-if="rows.length === 0" state="empty" :message="t('backup.noDetails')" />
                    <ul v-else class="flex flex-col gap-1.5">
                        <li v-for="backup in rows" :key="backup.id" class="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border-color)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-xs">
                            <span class="min-w-0 truncate text-[var(--text-secondary)]">
                                #{{ backup.id }} · {{ backup.instanceLabel }} · {{ backup.kind === "auto" ? t("backup.automatic") : t("backup.manual") }} · {{ formatBytes(backup.fileSize) }} · {{ t("backup.key") }} {{ backup.keyId }} · v{{ backup.appVersion }} · {{ formatDate(backup.createdAt) }}{{ backup.comment ? ` · ${backup.comment}` : "" }}
                            </span>
                            <IconButton :title="t('backup.deleteTitle')" variant="danger" size="sm" @click="pendingDelete = backup"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></IconButton>
                        </li>
                    </ul>
                </div>
            </li>
        </ul>

        <!-- 删除确认 -->
        <Dialog :model-value="pendingDelete !== null" :title="t('backup.deleteTitle')" size="sm" show-cancel :cancel-label="t('common.cancel')" :confirm-label="t('backup.deleteConfirm')" :close-label="t('common.close')" :busy="deleting" @confirm="confirmDelete" @update:model-value="(open: boolean) => { if (!open) pendingDelete = null; }">
            <p v-if="pendingDelete" class="text-sm text-[var(--text-secondary)]">{{ t("backup.deleteDescription", {username: pendingDelete.username, id: pendingDelete.id, size: formatBytes(pendingDelete.fileSize)}) }}</p>
        </Dialog>
    </div>
</template>
