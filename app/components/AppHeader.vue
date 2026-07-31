<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import type {DropdownItem} from "@notnotype/nb-ui/components";
import {isRuntimeFlagEnabled} from "~/utils/runtime-flag";

// 顶栏：左品牌、中搜索、右登录态导航。session 由 useAuthState 全局共享。
const {session, refresh, logout} = useAuthState();
const route = useRoute();
const notification = useNotification();
const {t} = useI18n();
const registrationEnabled = computed(() => isRuntimeFlagEnabled(useRuntimeConfig().public.registrationEnabled));

// 主题面板：调色板按钮弹出 ThemeSwitcher，点面板外自动关闭
const themeOpen = ref(false);
const themeRoot = ref<HTMLElement | null>(null);

/** 点击主题面板外部时关闭面板。 */
function onDocClick(e: MouseEvent): void {
    if (themeOpen.value && themeRoot.value && !themeRoot.value.contains(e.target as Node)) {
        themeOpen.value = false;
    }
}

// 搜索框初值同步 URL 的 q，回车跳浏览页
const keyword = ref(typeof route.query.q === "string" ? route.query.q : "");

const isLoggedIn = computed(() => Boolean(session.value.user));
const isAdmin = computed(() => session.value.user?.role === "admin");

// 已登录用户菜单项（admin 额外一项管理入口）
const userMenu = computed<DropdownItem[]>(() => {
    const items: DropdownItem[] = [{label: t("nav.me"), value: "me", iconClass: "i-lucide-user"}];
    if (isAdmin.value) {
        items.push({label: t("nav.admin"), value: "admin", iconClass: "i-lucide-shield"});
    }
    items.push({label: t("nav.logout"), value: "logout", iconClass: "i-lucide-log-out"});
    return items;
});

// 顶栏随布局挂载一次，刷新页面时恢复登录态
onMounted(() => {
    void refresh();
    document.addEventListener("click", onDocClick);
});

onBeforeUnmount(() => {
    document.removeEventListener("click", onDocClick);
});

function submitSearch(): void {
    const q = keyword.value.trim();
    void navigateTo(q ? {path: "/", query: {q}} : {path: "/"});
}

async function onUserMenu(value: string): Promise<void> {
    if (value === "me") {
        void navigateTo("/me");
    } else if (value === "admin") {
        void navigateTo("/admin");
    } else if (value === "logout") {
        await logout();
        notification.info(t("nav.loggedOut"));
        void navigateTo("/");
    }
}
</script>

<template>
    <!-- 站点顶栏，sticky 常驻 -->
    <header class="sticky top-0 z-50 border-b border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div class="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
            <!-- 左：品牌 logo -->
            <NuxtLink to="/" class="flex shrink-0 items-center gap-2 font-semibold text-[var(--text-main)]">
                <span class="i-lucide-box h-5 w-5 text-[var(--accent-main)]"></span>
                <span class="hidden sm:inline">NeuroBook</span>
            </NuxtLink>

            <!-- 中：搜索框 -->
            <form class="mx-auto flex w-full max-w-md items-center" @submit.prevent="submitSearch">
                <div class="relative w-full">
                    <span class="i-lucide-search pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"></span>
                    <input v-model="keyword" type="search" :placeholder="t('nav.searchPlaceholder')" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:shadow-[0_0_0_3px_var(--accent-bg)]" />
                </div>
            </form>

            <!-- 右：登录态导航 -->
            <nav class="flex shrink-0 items-center gap-2">
                <LocaleSwitcher />
                <!-- 主题切换弹出面板 -->
                <div ref="themeRoot" class="relative">
                    <button type="button" :title="t('nav.switchTheme')" :aria-label="t('nav.switchTheme')" class="nb-ui-focus-ring flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]" @click="themeOpen = !themeOpen">
                        <span class="i-lucide-palette h-4.5 w-4.5"></span>
                    </button>
                    <div v-if="themeOpen" class="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 shadow-[var(--shadow-panel)]">
                        <div class="mb-2 text-xs font-medium text-[var(--text-muted)]">{{ t("nav.theme") }}</div>
                        <ThemeSwitcher />
                    </div>
                </div>
                <template v-if="isLoggedIn">
                    <Button size="sm" @click="navigateTo('/publish')"><span class="i-lucide-upload h-4 w-4"></span><span class="hidden sm:inline">{{ t("nav.publish") }}</span></Button>
                    <Dropdown :items="userMenu" root-class="relative" menu-class="right-0 top-full mt-2 min-w-40" @select="onUserMenu">
                        <button type="button" class="flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]">
                            <UserAvatar :username="session.user?.username ?? '?'" :avatar-url="session.user?.avatarUrl" :size="20" />
                            <span class="hidden max-w-24 truncate sm:inline">{{ session.user?.displayName || session.user?.username }}</span>
                        </button>
                    </Dropdown>
                </template>
                <template v-else>
                    <Button size="sm" variant="secondary" @click="navigateTo('/login')">{{ t("nav.login") }}</Button>
                    <Button v-if="registrationEnabled" size="sm" @click="navigateTo('/register')">{{ t("nav.register") }}</Button>
                </template>
            </nav>
        </div>
    </header>
</template>
