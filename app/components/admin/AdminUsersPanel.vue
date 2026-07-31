<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {AdminUserDto} from "../../../shared/dto/admin.dto";

// admin 用户管理：搜索 + 分页列表，行内封禁/解封、授予/收回 admin（两步确认走 Dialog）。
const api = useWorkshopApi();
const notification = useNotification();
const {session} = useAuthState();
const localizedError = useLocalizedApiError();
const {t} = useI18n();
const {formatDate, relativeTime, formatNumber} = useLocaleFormat();

const PAGE_SIZE = 20;
const users = ref<AdminUserDto[]>([]);
const total = ref(0);
const next = ref<number | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const errorMsg = ref("");
const search = ref("");

// 危险操作确认：封禁与角色变更共用一个 Dialog，pending 描述当前意图
const pending = ref<{user: AdminUserDto; action: "disable" | "enable" | "promote" | "demote"} | null>(null);
const acting = ref(false);

type AdminAction = "disable" | "enable" | "promote" | "demote";

/** 当前语言的危险操作标题、动词和说明。 */
function actionText(action: AdminAction): {title: string; verb: string; description: string} {
    return {
        title: t(`admin.users.actions.${action}.title`),
        verb: t(`admin.users.actions.${action}.verb`),
        description: t(`admin.users.actions.${action}.description`),
    };
}

async function load(reset: boolean): Promise<void> {
    if (reset) {
        loading.value = true;
        errorMsg.value = "";
    } else {
        loadingMore.value = true;
    }
    try {
        const offset = reset ? 0 : next.value ?? 0;
        const page = await api.listAdminUsers({offset, limit: PAGE_SIZE, ...(search.value.trim() ? {search: search.value.trim()} : {})});
        users.value = reset ? page.items : [...users.value, ...page.items];
        total.value = page.total;
        next.value = page.hasMore ? page.nextOffset ?? null : null;
    } catch (error) {
        if (reset) {
            errorMsg.value = localizedError.resolve(error, "common.loadFailed");
        } else {
            notification.error(localizedError.resolve(error, "common.loadMoreFailed"));
        }
    } finally {
        loading.value = false;
        loadingMore.value = false;
    }
}

async function confirmAction(): Promise<void> {
    if (!pending.value) {
        return;
    }
    const {user, action} = pending.value;
    acting.value = true;
    try {
        if (action === "disable" || action === "enable") {
            await api.setUserStatus(user.id, action === "disable" ? "disabled" : "active");
        } else {
            await api.setUserRole(user.id, action === "promote" ? "admin" : "user");
        }
        notification.success(t("admin.users.actionSuccess", {action: actionText(action).verb, username: user.username}));
        pending.value = null;
        await load(true);
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.actionFailed"));
    } finally {
        acting.value = false;
    }
}

/** 是否本人行：后端禁止操作自己，前端直接不给按钮。 */
function isSelf(user: AdminUserDto): boolean {
    return String(user.id) === session.value.user?.id;
}

onMounted(() => load(true));
</script>

<template>
    <div class="flex flex-col gap-4">
        <!-- 搜索栏 -->
        <form class="flex items-center gap-2" @submit.prevent="load(true)">
            <div class="relative w-full max-w-xs">
                <span class="i-lucide-search pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"></span>
                <input v-model="search" type="search" :placeholder="t('admin.users.searchPlaceholder')" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]" />
            </div>
            <Button type="submit" variant="secondary" size="sm">{{ t("admin.users.search") }}</Button>
        </form>

        <StateBlock v-if="loading && users.length === 0" state="loading" />
        <StateBlock v-else-if="errorMsg && users.length === 0" state="error" :message="errorMsg" :retry="() => load(true)" />
        <StateBlock v-else-if="users.length === 0" state="empty" :message="t('admin.users.empty')" />
        <template v-else>
            <ul class="flex flex-col gap-2">
                <li v-for="user in users" :key="user.id" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2.5">
                    <!-- 左：身份信息 -->
                    <div class="flex min-w-0 items-center gap-3">
                        <UserAvatar :username="user.username" :avatar-url="user.avatarUrl" :size="32" />
                        <div class="min-w-0">
                            <p class="flex items-center gap-1.5 text-sm font-medium text-[var(--text-main)]">
                                <span class="truncate">{{ user.displayName }}</span>
                                <span class="shrink-0 text-xs text-[var(--text-muted)]">@{{ user.username }}</span>
                                <span v-if="user.role === 'admin'" class="inline-flex shrink-0 items-center rounded-full border border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.12)] px-1.5 py-0.5 text-[10px] text-[#38bdf8]">admin</span>
                                <span v-if="user.status === 'disabled'" class="inline-flex shrink-0 items-center rounded-full border border-[rgba(244,63,94,0.35)] bg-[rgba(244,63,94,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--status-danger)]">{{ t("admin.users.disabled") }}</span>
                                <span v-if="user.hasGithub" class="i-lucide-github h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" :title="t('admin.users.githubBound')"></span>
                                <span v-if="!user.hasPassword" class="inline-flex shrink-0 items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]" :title="t('admin.users.passwordlessTitle')">{{ t("admin.users.passwordless") }}</span>
                            </p>
                            <p class="text-xs text-[var(--text-muted)]">{{ t("admin.users.summary", {items: formatNumber(user.itemCount), created: formatDate(user.createdAt), login: user.lastLoginAt ? t("admin.users.recentLogin", {time: relativeTime(user.lastLoginAt)}) : t("admin.users.neverLoggedIn")}) }}</p>
                        </div>
                    </div>
                    <!-- 右：操作（不对自己展示） -->
                    <div v-if="!isSelf(user)" class="flex shrink-0 items-center gap-2">
                        <Button v-if="user.status === 'active'" size="sm" variant="danger" @click="pending = {user, action: 'disable'}">{{ t("admin.users.disable") }}</Button>
                        <Button v-else size="sm" variant="secondary" @click="pending = {user, action: 'enable'}">{{ t("admin.users.enable") }}</Button>
                        <Button v-if="user.role === 'user'" size="sm" variant="secondary" @click="pending = {user, action: 'promote'}">{{ t("admin.users.promote") }}</Button>
                        <Button v-else size="sm" variant="secondary" @click="pending = {user, action: 'demote'}">{{ t("admin.users.demote") }}</Button>
                    </div>
                    <span v-else class="text-xs text-[var(--text-muted)]">{{ t("admin.users.current") }}</span>
                </li>
            </ul>
            <div class="flex flex-col items-center gap-2">
                <Button v-if="next !== null" variant="secondary" size="sm" :loading="loadingMore" @click="load(false)">{{ t("common.loadMore") }}</Button>
                <p class="text-xs text-[var(--text-muted)]">{{ t("common.totalPeople", {count: formatNumber(total)}) }}</p>
            </div>
        </template>

        <!-- 危险操作确认 -->
        <Dialog :model-value="pending !== null" :title="pending ? actionText(pending.action).title : ''" size="sm" show-cancel :cancel-label="t('common.cancel')" :close-label="t('common.close')" :confirm-label="pending ? t('admin.users.confirmAction', {action: actionText(pending.action).verb}) : t('common.confirm')" :busy="acting" @confirm="confirmAction" @update:model-value="(open: boolean) => { if (!open) pending = null; }">
            <p v-if="pending" class="text-sm text-[var(--text-secondary)]">{{ t("admin.users.confirmDescription", {username: pending.user.username, action: actionText(pending.action).verb, description: actionText(pending.action).description}) }}</p>
        </Dialog>
    </div>
</template>
