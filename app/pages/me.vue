<script setup lang="ts">
import {onMounted, reactive, ref, watch} from "vue";
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {PageDto, WorkshopItemDto} from "../../shared/dto/workshop.dto";

// 个人页：我的发布（含 unlisted，可管理）/ 我的收藏 / 实例 / 备份 / 邀请好友 / 账号设置。
definePageMeta({middleware: "auth"});
const api = useWorkshopApi();
const notification = useNotification();
const route = useRoute();
const {t} = useI18n();
const {resolve} = useLocalizedApiError();
const {formatNumber} = useLocaleFormat();
useHead({title: computed(() => t("me.title"))});

const PAGE_SIZE = 24;

type MeTab = "published" | "favorites" | "instances" | "backups" | "invites" | "account";
const TAB_VALUES: MeTab[] = ["published", "favorites", "instances", "backups", "invites", "account"];

// GitHub 回调会带 ?tab=account 直达账号设置
const initialTab = TAB_VALUES.includes(route.query.tab as MeTab) ? route.query.tab as MeTab : "published";
const tab = ref<MeTab>(initialTab);
const tabOptions = computed<SegmentedControlOption[]>(() => [
    {label: t("me.tabs.published"), value: "published"},
    {label: t("me.tabs.favorites"), value: "favorites"},
    {label: t("me.tabs.instances"), value: "instances"},
    {label: t("me.tabs.backups"), value: "backups"},
    {label: t("me.tabs.invites"), value: "invites"},
    {label: t("me.tabs.account"), value: "account"},
]);

// 分页列表状态与加载逻辑（发布 / 收藏两处复用）
type ItemFeed = {
    list: WorkshopItemDto[];
    total: number;
    next: number | null; // null 表示无更多
    loading: boolean;
    loadingMore: boolean;
    error: string;
    loaded: boolean;
    load: (reset: boolean) => Promise<void>;
};

function createFeed(fetcher: (page: {offset: number; limit: number}) => Promise<PageDto<WorkshopItemDto>>): ItemFeed {
    const state = reactive<ItemFeed>({
        list: [],
        total: 0,
        next: null,
        loading: false,
        loadingMore: false,
        error: "",
        loaded: false,
        async load(reset: boolean) {
            if (reset) {
                state.loading = true;
                state.error = "";
            } else {
                state.loadingMore = true;
            }
            try {
                const offset = reset ? 0 : state.next ?? 0;
                const page = await fetcher({offset, limit: PAGE_SIZE});
                state.list = reset ? page.items : [...state.list, ...page.items];
                state.total = page.total;
                state.next = page.hasMore ? page.nextOffset ?? null : null;
                state.loaded = true;
            } catch (error) {
                if (reset) {
                    state.error = resolve(error, "common.loadFailed");
                } else {
                    notification.error(resolve(error, "common.loadMoreFailed"));
                }
            } finally {
                state.loading = false;
                state.loadingMore = false;
            }
        },
    });
    return state;
}

const published = createFeed((page) => api.myItems(page));
const favorites = createFeed((page) => api.myFavorites(page));

// 我的发布：某条目改动后就地替换
function onItemUpdated(updated: WorkshopItemDto): void {
    published.list = published.list.map((item) => item.id === updated.id ? updated : item);
}

// 我的收藏：取消收藏即时移除
async function unfavorite(item: WorkshopItemDto): Promise<void> {
    try {
        await api.unfavorite(item.slug);
        favorites.list = favorites.list.filter((fav) => fav.id !== item.id);
        favorites.total = Math.max(0, favorites.total - 1);
        notification.success(t("me.unfavorited"));
    } catch (error) {
        notification.error(resolve(error, "common.actionFailed"));
    }
}

onMounted(() => {
    // GitHub 绑定回跳提示（github.get.ts 三种终态），提示后清掉 query 防刷新重复弹
    const github = route.query.github;
    if (github === "linked") {
        notification.success(t("me.githubLinked"));
    } else if (github === "already") {
        notification.info(t("me.githubAlreadyLinked"));
    } else if (github === "conflict") {
        notification.error(t("me.githubConflict"));
    }
    if (github) {
        void navigateTo({path: "/me", query: {tab: tab.value}}, {replace: true});
    }
    if (tab.value === "published") {
        void published.load(true);
    }
});
// 切到某标签时按需首次加载
watch(tab, (current) => {
    if (current === "favorites" && !favorites.loaded) {
        void favorites.load(true);
    }
    if (current === "published" && !published.loaded) {
        void published.load(true);
    }
});
</script>

<template>
    <section class="flex flex-col gap-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <h1 class="text-xl font-semibold text-[var(--text-main)]">{{ t("me.title") }}</h1>
            <Button size="sm" @click="navigateTo('/publish')"><span class="i-lucide-upload h-4 w-4"></span>{{ t("me.publishNew") }}</Button>
        </div>

        <SegmentedControl :model-value="tab" :options="tabOptions" :aria-label="t('me.sectionLabel')" @update:model-value="(value: SegmentedControlValue) => tab = value as MeTab" />

        <!-- 我的发布 -->
        <template v-if="tab === 'published'">
            <StateBlock v-if="published.loading && published.list.length === 0" state="loading" />
            <StateBlock v-else-if="published.error && published.list.length === 0" state="error" :message="published.error" :retry="() => published.load(true)" />
            <StateBlock v-else-if="published.list.length === 0" state="empty" :message="t('me.noPublished')" />
            <template v-else>
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <MyItemManageCard v-for="item in published.list" :key="item.id" :item="item" @updated="onItemUpdated" />
                </div>
                <div class="flex flex-col items-center gap-2">
                    <Button v-if="published.next !== null" variant="secondary" :loading="published.loadingMore" @click="published.load(false)">{{ t("common.loadMore") }}</Button>
                    <p class="text-xs text-[var(--text-muted)]">{{ t("common.totalItems", {count: formatNumber(published.total)}) }}</p>
                </div>
            </template>
        </template>

        <!-- 已连接实例（Passport 授权管理） -->
        <PassportAuthorizationPanel v-else-if="tab === 'instances'" />

        <!-- 云备份管理 -->
        <BackupPanel v-else-if="tab === 'backups'" />

        <!-- 邀请码与注册链接 -->
        <InviteCodePanel v-else-if="tab === 'invites'" />

        <!-- 账号设置（资料 / GitHub 绑定 / 密码） -->
        <AccountSettingsPanel v-else-if="tab === 'account'" />

        <!-- 我的收藏 -->
        <template v-else>
            <StateBlock v-if="favorites.loading && favorites.list.length === 0" state="loading" />
            <StateBlock v-else-if="favorites.error && favorites.list.length === 0" state="error" :message="favorites.error" :retry="() => favorites.load(true)" />
            <StateBlock v-else-if="favorites.list.length === 0" state="empty" :message="t('me.noFavorites')" />
            <template v-else>
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div v-for="fav in favorites.list" :key="fav.id" class="flex flex-col gap-1.5">
                        <ItemCard :item="fav" />
                        <Button variant="subtle" size="sm" block @click="unfavorite(fav)"><span class="i-lucide-bookmark-x h-4 w-4"></span>{{ t("me.unfavorite") }}</Button>
                    </div>
                </div>
                <div class="flex flex-col items-center gap-2">
                    <Button v-if="favorites.next !== null" variant="secondary" :loading="favorites.loadingMore" @click="favorites.load(false)">{{ t("common.loadMore") }}</Button>
                    <p class="text-xs text-[var(--text-muted)]">{{ t("common.totalItems", {count: formatNumber(favorites.total)}) }}</p>
                </div>
            </template>
        </template>
    </section>
</template>
