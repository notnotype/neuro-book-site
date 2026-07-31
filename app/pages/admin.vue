<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {ReportDto, WorkshopItemDto} from "../../shared/dto/workshop.dto";

// admin 控制台六分区：概览 / 注册码 / 举报 / 条目 / 用户 / 备份。
// 注册码、用户、备份、概览抽在 app/components/admin/ 下；举报与条目管理逻辑留在本页。
definePageMeta({middleware: "auth"});
const api = useWorkshopApi();
const {session} = useAuthState();
const notification = useNotification();
const {t} = useI18n();
const {resolve} = useLocalizedApiError();
const {relativeTime, formatNumber} = useLocaleFormat();
useHead({title: computed(() => t("admin.title"))});

const isAdmin = computed(() => session.value.user?.role === "admin");

type AdminTab = "overview" | "registrationCodes" | "reports" | "items" | "users" | "backups";
const tab = ref<AdminTab>("overview");
const tabOptions = computed<SegmentedControlOption[]>(() => [
    {label: t("admin.tabs.overview"), value: "overview"},
    {label: t("admin.tabs.registrationCodes"), value: "registrationCodes"},
    {label: t("admin.tabs.reports"), value: "reports"},
    {label: t("admin.tabs.items"), value: "items"},
    {label: t("admin.tabs.users"), value: "users"},
    {label: t("admin.tabs.backups"), value: "backups"},
]);

// ---- 举报 ----
const PAGE_SIZE = 20;
const reports = ref<ReportDto[]>([]);
const reportsTotal = ref(0);
const reportsNext = ref<number | null>(null);
const reportsLoading = ref(false);
const reportsLoadingMore = ref(false);
const reportsError = ref("");
const reportsLoaded = ref(false);

async function loadReports(reset: boolean): Promise<void> {
    if (reset) {
        reportsLoading.value = true;
        reportsError.value = "";
    } else {
        reportsLoadingMore.value = true;
    }
    try {
        const offset = reset ? 0 : reportsNext.value ?? 0;
        const page = await api.listReports({offset, limit: PAGE_SIZE});
        reports.value = reset ? page.items : [...reports.value, ...page.items];
        reportsTotal.value = page.total;
        reportsNext.value = page.hasMore ? page.nextOffset ?? null : null;
        reportsLoaded.value = true;
    } catch (error) {
        if (reset) {
            reportsError.value = resolve(error, "common.loadFailed");
        } else {
            notification.error(resolve(error, "common.loadMoreFailed"));
        }
    } finally {
        reportsLoading.value = false;
        reportsLoadingMore.value = false;
    }
}

async function resolveReport(id: number): Promise<void> {
    try {
        const updated = await api.resolveReport(id);
        reports.value = reports.value.map((report) => report.id === id ? updated : report);
        notification.success(t("admin.reports.resolvedSuccess"));
    } catch (error) {
        notification.error(resolve(error, "common.actionFailed"));
    }
}

// ---- 条目管理（按 id 下架 / 恢复） ----
const manageId = ref<number | null>(null);
const manageBusy = ref(false);
const manageError = ref("");
const manageResult = ref<WorkshopItemDto | null>(null);
const showRemove = ref(false);

// 换目标条目时清掉上一次操作的结果与错误，避免旧条目信息误导。
// 注意：操作按钮一律显式声明目标状态（恢复/下架/设为精选/取消精选），不从 manageResult 派生意图。
watch(manageId, () => {
    manageResult.value = null;
    manageError.value = "";
});

async function setStatus(status: "published" | "removed"): Promise<void> {
    if (manageId.value === null) {
        manageError.value = t("admin.items.idRequired");
        return;
    }
    manageBusy.value = true;
    manageError.value = "";
    try {
        manageResult.value = await api.setItemStatus(manageId.value, status);
        notification.success(status === "removed" ? t("admin.items.removedSuccess") : t("admin.items.restoredSuccess"));
    } catch (error) {
        manageError.value = resolve(error, "common.actionFailed");
    } finally {
        manageBusy.value = false;
    }
}

function askRemove(): void {
    if (manageId.value === null) {
        manageError.value = t("admin.items.idRequired");
        return;
    }
    showRemove.value = true;
}

async function confirmRemove(): Promise<void> {
    await setStatus("removed");
    showRemove.value = false;
}

/** 设置 / 取消精选：精选条目进首页「编辑推荐」分区。 */
async function setFeatured(featured: boolean): Promise<void> {
    if (manageId.value === null) {
        manageError.value = t("admin.items.idRequired");
        return;
    }
    manageBusy.value = true;
    manageError.value = "";
    try {
        manageResult.value = await api.setItemFeatured(manageId.value, featured);
        notification.success(featured ? t("admin.items.featuredSuccess") : t("admin.items.unfeaturedSuccess"));
    } catch (error) {
        manageError.value = resolve(error, "common.actionFailed");
    } finally {
        manageBusy.value = false;
    }
}

onMounted(() => {
    if (tab.value === "reports") {
        void loadReports(true);
    }
});
watch(tab, (current) => {
    if (current === "reports" && !reportsLoaded.value) {
        void loadReports(true);
    }
});
</script>

<template>
    <!-- 非 admin 拦截 -->
    <StateBlock v-if="!isAdmin" state="error" :message="t('admin.permissionRequired')" />

    <section v-else class="flex flex-col gap-5">
        <h1 class="text-xl font-semibold text-[var(--text-main)]">{{ t("admin.title") }}</h1>
        <SegmentedControl :model-value="tab" :options="tabOptions" :aria-label="t('admin.sectionLabel')" @update:model-value="(value: SegmentedControlValue) => tab = value as AdminTab" />

        <!-- 概览（站点统计） -->
        <AdminStatsPanel v-if="tab === 'overview'" />

        <!-- 注册码（签发 + 设置 + 分享） -->
        <AdminRegistrationCodesPanel v-else-if="tab === 'registrationCodes'" />

        <!-- 用户管理 -->
        <AdminUsersPanel v-else-if="tab === 'users'" />

        <!-- 备份用量 -->
        <AdminBackupsPanel v-else-if="tab === 'backups'" />

        <!-- 举报 -->
        <div v-else-if="tab === 'reports'" class="flex flex-col gap-4">
            <StateBlock v-if="reportsLoading && reports.length === 0" state="loading" />
            <StateBlock v-else-if="reportsError && reports.length === 0" state="error" :message="reportsError" :retry="() => loadReports(true)" />
            <StateBlock v-else-if="reports.length === 0" state="empty" :message="t('admin.reports.empty')" />
            <template v-else>
                <ul class="flex flex-col gap-3">
                    <li v-for="report in reports" :key="report.id" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="flex items-center gap-2">
                                <span v-if="report.resolvedAt" class="inline-flex items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">{{ t("admin.reports.resolved") }}</span>
                                <span v-else class="inline-flex items-center rounded-full border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] px-2 py-0.5 text-[11px] text-[var(--status-warning)]">{{ t("admin.reports.pending") }}</span>
                                <NuxtLink :to="`/items/${report.itemSlug}`" class="text-sm font-medium text-[var(--text-main)] hover:text-[var(--accent-text)]">{{ report.itemTitle }}</NuxtLink>
                            </div>
                            <Button v-if="!report.resolvedAt" variant="secondary" size="sm" @click="resolveReport(report.id)">{{ t("admin.reports.resolve") }}</Button>
                        </div>
                        <p class="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{{ report.reason }}</p>
                        <p class="mt-1 text-xs text-[var(--text-muted)]">{{ t("admin.reports.meta", {reporter: report.reporter, time: relativeTime(report.createdAt), id: report.itemId}) }}</p>
                    </li>
                </ul>
                <div class="flex flex-col items-center gap-2">
                    <Button v-if="reportsNext !== null" variant="secondary" :loading="reportsLoadingMore" @click="loadReports(false)">{{ t("common.loadMore") }}</Button>
                    <p class="text-xs text-[var(--text-muted)]">{{ t("common.totalItems", {count: formatNumber(reportsTotal)}) }}</p>
                </div>
            </template>
        </div>

        <!-- 条目管理 -->
        <div v-else class="flex flex-col gap-4">
            <Panel class="flex flex-col gap-3">
                <h2 class="text-sm font-medium text-[var(--text-main)]">{{ t("admin.items.title") }}</h2>
                <p class="text-xs text-[var(--text-muted)]">{{ t("admin.items.description") }}</p>
                <div class="flex flex-wrap items-end gap-3">
                    <FormField :label="t('admin.items.id')" class="w-40"><FormNumberInput v-model="manageId" :min="1" :placeholder="t('admin.items.idPlaceholder')" /></FormField>
                    <Button variant="secondary" :loading="manageBusy" @click="setStatus('published')"><span class="i-lucide-eye h-4 w-4"></span>{{ t("admin.items.restore") }}</Button>
                    <Button variant="danger" :loading="manageBusy" @click="askRemove"><span class="i-lucide-ban h-4 w-4"></span>{{ t("admin.items.remove") }}</Button>
                    <Button variant="secondary" :loading="manageBusy" @click="setFeatured(true)"><span class="i-lucide-star h-4 w-4"></span>{{ t("admin.items.feature") }}</Button>
                    <Button variant="secondary" :loading="manageBusy" @click="setFeatured(false)"><span class="i-lucide-star-off h-4 w-4"></span>{{ t("admin.items.unfeature") }}</Button>
                </div>
                <p v-if="manageError" class="text-sm text-[var(--status-danger)]">{{ manageError }}</p>
            </Panel>

            <Panel v-if="manageResult" class="flex items-center gap-3">
                <ItemTypeBadge :type="manageResult.type" size="sm" />
                <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-[var(--text-main)]">{{ manageResult.title }}</p>
                    <p class="font-mono text-xs text-[var(--text-muted)]">#{{ manageResult.id }} · {{ manageResult.slug }} · {{ t("admin.items.currentStatus", {status: manageResult.status}) }}{{ manageResult.featured ? ` · ★ ${t("asset.featured")}` : "" }}</p>
                </div>
            </Panel>
        </div>

        <!-- 下架确认 -->
        <Dialog v-model="showRemove" :title="t('admin.items.removeTitle')" size="sm" show-cancel :confirm-label="t('admin.items.confirmRemove')" :busy="manageBusy" @confirm="confirmRemove">
            <p class="text-sm text-[var(--text-secondary)]">{{ t("admin.items.removeDescription", {id: manageId}) }}</p>
        </Dialog>
    </section>
</template>
