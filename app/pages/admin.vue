<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {ReportDto, WorkshopItemDto} from "../../shared/dto/workshop.dto";

// admin 控制台六分区：概览 / 邀请码 / 举报 / 条目 / 用户 / 备份。
// 邀请码、用户、备份、概览抽在 app/components/admin/ 下；举报与条目管理逻辑留在本页。
definePageMeta({middleware: "auth"});
useHead({title: "管理控制台"});

const api = useWorkshopApi();
const {session} = useAuthState();
const notification = useNotification();

const isAdmin = computed(() => session.value.user?.role === "admin");

type AdminTab = "overview" | "invites" | "reports" | "items" | "users" | "backups";
const tab = ref<AdminTab>("overview");
const tabOptions: SegmentedControlOption[] = [
    {label: "概览", value: "overview"},
    {label: "邀请码", value: "invites"},
    {label: "举报", value: "reports"},
    {label: "条目管理", value: "items"},
    {label: "用户", value: "users"},
    {label: "备份", value: "backups"},
];

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
            reportsError.value = resolveApiErrorMessage(error, "加载失败");
        } else {
            notification.error(resolveApiErrorMessage(error, "加载更多失败"));
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
        notification.success("已标记处理");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "操作失败"));
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
        manageError.value = "请输入条目 id";
        return;
    }
    manageBusy.value = true;
    manageError.value = "";
    try {
        manageResult.value = await api.setItemStatus(manageId.value, status);
        notification.success(status === "removed" ? "已下架" : "已恢复为 published");
    } catch (error) {
        manageError.value = resolveApiErrorMessage(error, "操作失败");
    } finally {
        manageBusy.value = false;
    }
}

function askRemove(): void {
    if (manageId.value === null) {
        manageError.value = "请输入条目 id";
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
        manageError.value = "请输入条目 id";
        return;
    }
    manageBusy.value = true;
    manageError.value = "";
    try {
        manageResult.value = await api.setItemFeatured(manageId.value, featured);
        notification.success(featured ? "已设为精选" : "已取消精选");
    } catch (error) {
        manageError.value = resolveApiErrorMessage(error, "操作失败");
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
    <StateBlock v-if="!isAdmin" state="error" message="需要管理员权限" />

    <section v-else class="flex flex-col gap-5">
        <h1 class="text-xl font-semibold text-[var(--text-main)]">管理控制台</h1>
        <SegmentedControl :model-value="tab" :options="tabOptions" aria-label="管理分区" @update:model-value="(value: SegmentedControlValue) => tab = value as AdminTab" />

        <!-- 概览（站点统计） -->
        <AdminStatsPanel v-if="tab === 'overview'" />

        <!-- 邀请码（签发 + 全量列表） -->
        <AdminInvitesPanel v-else-if="tab === 'invites'" />

        <!-- 用户管理 -->
        <AdminUsersPanel v-else-if="tab === 'users'" />

        <!-- 备份用量 -->
        <AdminBackupsPanel v-else-if="tab === 'backups'" />

        <!-- 举报 -->
        <div v-else-if="tab === 'reports'" class="flex flex-col gap-4">
            <StateBlock v-if="reportsLoading && reports.length === 0" state="loading" />
            <StateBlock v-else-if="reportsError && reports.length === 0" state="error" :message="reportsError" :retry="() => loadReports(true)" />
            <StateBlock v-else-if="reports.length === 0" state="empty" message="暂无举报" />
            <template v-else>
                <ul class="flex flex-col gap-3">
                    <li v-for="report in reports" :key="report.id" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="flex items-center gap-2">
                                <span v-if="report.resolvedAt" class="inline-flex items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">已处理</span>
                                <span v-else class="inline-flex items-center rounded-full border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] px-2 py-0.5 text-[11px] text-[var(--status-warning)]">待处理</span>
                                <NuxtLink :to="`/items/${report.itemSlug}`" class="text-sm font-medium text-[var(--text-main)] hover:text-[var(--accent-text)]">{{ report.itemTitle }}</NuxtLink>
                            </div>
                            <Button v-if="!report.resolvedAt" variant="secondary" size="sm" @click="resolveReport(report.id)">标记处理</Button>
                        </div>
                        <p class="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{{ report.reason }}</p>
                        <p class="mt-1 text-xs text-[var(--text-muted)]">举报人 @{{ report.reporter }} · {{ relativeTime(report.createdAt) }} · 条目 #{{ report.itemId }}</p>
                    </li>
                </ul>
                <div class="flex flex-col items-center gap-2">
                    <Button v-if="reportsNext !== null" variant="secondary" :loading="reportsLoadingMore" @click="loadReports(false)">加载更多</Button>
                    <p class="text-xs text-[var(--text-muted)]">共 {{ reportsTotal }} 条</p>
                </div>
            </template>
        </div>

        <!-- 条目管理 -->
        <div v-else class="flex flex-col gap-4">
            <Panel class="flex flex-col gap-3">
                <h2 class="text-sm font-medium text-[var(--text-main)]">按条目 id 下架 / 恢复 / 精选</h2>
                <p class="text-xs text-[var(--text-muted)]">下架（removed）后条目对公开面不可见，作者也无法自行恢复；恢复会强制回到 published。精选条目进入首页「编辑推荐」分区。</p>
                <div class="flex flex-wrap items-end gap-3">
                    <FormField label="条目 id" class="w-40"><FormNumberInput v-model="manageId" :min="1" placeholder="例如 12" /></FormField>
                    <Button variant="secondary" :loading="manageBusy" @click="setStatus('published')"><span class="i-lucide-eye h-4 w-4"></span>恢复</Button>
                    <Button variant="danger" :loading="manageBusy" @click="askRemove"><span class="i-lucide-ban h-4 w-4"></span>下架</Button>
                    <Button variant="secondary" :loading="manageBusy" @click="setFeatured(true)"><span class="i-lucide-star h-4 w-4"></span>设为精选</Button>
                    <Button variant="secondary" :loading="manageBusy" @click="setFeatured(false)"><span class="i-lucide-star-off h-4 w-4"></span>取消精选</Button>
                </div>
                <p v-if="manageError" class="text-sm text-[var(--status-danger)]">{{ manageError }}</p>
            </Panel>

            <Panel v-if="manageResult" class="flex items-center gap-3">
                <ItemTypeBadge :type="manageResult.type" size="sm" />
                <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-[var(--text-main)]">{{ manageResult.title }}</p>
                    <p class="font-mono text-xs text-[var(--text-muted)]">#{{ manageResult.id }} · {{ manageResult.slug }} · 当前状态：{{ manageResult.status }}{{ manageResult.featured ? " · ★ 精选" : "" }}</p>
                </div>
            </Panel>
        </div>

        <!-- 下架确认 -->
        <Dialog v-model="showRemove" title="下架条目" size="sm" show-cancel confirm-label="确认下架" :busy="manageBusy" @confirm="confirmRemove">
            <p class="text-sm text-[var(--text-secondary)]">确定下架条目 #{{ manageId }} 吗？下架后对公开面不可见，作者无法自行恢复。</p>
        </Dialog>
    </section>
</template>
