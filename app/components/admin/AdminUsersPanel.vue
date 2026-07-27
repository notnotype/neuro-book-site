<script setup lang="ts">
import {onMounted, ref} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {AdminUserDto} from "../../../shared/dto/admin.dto";

// admin 用户管理：搜索 + 分页列表，行内封禁/解封、授予/收回 admin（两步确认走 Dialog）。
const api = useWorkshopApi();
const notification = useNotification();
const {session} = useAuthState();

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

const ACTION_TEXT = {
    disable: {title: "封禁用户", verb: "封禁", desc: "封禁后该用户无法登录，在线会话与实例授权立即失效；其条目不会自动下架。"},
    enable: {title: "解封用户", verb: "解封", desc: "解封后该用户可重新登录。"},
    promote: {title: "授予管理员", verb: "授予 admin", desc: "对方将获得全部管理权限，并被踢下线需重新登录。"},
    demote: {title: "收回管理员", verb: "收回 admin", desc: "对方将失去管理权限，并被踢下线需重新登录。"},
} as const;

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
            errorMsg.value = resolveApiErrorMessage(error, "加载失败");
        } else {
            notification.error(resolveApiErrorMessage(error, "加载更多失败"));
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
        notification.success(`已${ACTION_TEXT[action].verb} @${user.username}`);
        pending.value = null;
        await load(true);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "操作失败"));
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
                <input v-model="search" type="search" placeholder="搜索用户名 / 昵称" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]" />
            </div>
            <Button type="submit" variant="secondary" size="sm">搜索</Button>
        </form>

        <StateBlock v-if="loading && users.length === 0" state="loading" />
        <StateBlock v-else-if="errorMsg && users.length === 0" state="error" :message="errorMsg" :retry="() => load(true)" />
        <StateBlock v-else-if="users.length === 0" state="empty" message="没有匹配的用户" />
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
                                <span v-if="user.status === 'disabled'" class="inline-flex shrink-0 items-center rounded-full border border-[rgba(244,63,94,0.35)] bg-[rgba(244,63,94,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--status-danger)]">已封禁</span>
                                <span v-if="user.hasGithub" class="i-lucide-github h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" title="已绑定 GitHub"></span>
                                <span v-if="!user.hasPassword" class="inline-flex shrink-0 items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]" title="OAuth 注册，未设密码">免密</span>
                            </p>
                            <p class="text-xs text-[var(--text-muted)]">条目 {{ user.itemCount }} · 注册于 {{ formatDate(user.createdAt) }} · {{ user.lastLoginAt ? `最近登录 ${relativeTime(user.lastLoginAt)}` : "从未登录" }}</p>
                        </div>
                    </div>
                    <!-- 右：操作（不对自己展示） -->
                    <div v-if="!isSelf(user)" class="flex shrink-0 items-center gap-2">
                        <Button v-if="user.status === 'active'" size="sm" variant="danger" @click="pending = {user, action: 'disable'}">封禁</Button>
                        <Button v-else size="sm" variant="secondary" @click="pending = {user, action: 'enable'}">解封</Button>
                        <Button v-if="user.role === 'user'" size="sm" variant="secondary" @click="pending = {user, action: 'promote'}">设为 admin</Button>
                        <Button v-else size="sm" variant="secondary" @click="pending = {user, action: 'demote'}">收回 admin</Button>
                    </div>
                    <span v-else class="text-xs text-[var(--text-muted)]">（当前登录）</span>
                </li>
            </ul>
            <div class="flex flex-col items-center gap-2">
                <Button v-if="next !== null" variant="secondary" size="sm" :loading="loadingMore" @click="load(false)">加载更多</Button>
                <p class="text-xs text-[var(--text-muted)]">共 {{ total }} 人</p>
            </div>
        </template>

        <!-- 危险操作确认 -->
        <Dialog :model-value="pending !== null" :title="pending ? ACTION_TEXT[pending.action].title : ''" size="sm" show-cancel :confirm-label="pending ? `确认${ACTION_TEXT[pending.action].verb}` : '确认'" :busy="acting" @confirm="confirmAction" @update:model-value="(open: boolean) => { if (!open) pending = null; }">
            <p v-if="pending" class="text-sm text-[var(--text-secondary)]">对 @{{ pending.user.username }} 执行「{{ ACTION_TEXT[pending.action].verb }}」？{{ ACTION_TEXT[pending.action].desc }}</p>
        </Dialog>
    </div>
</template>
