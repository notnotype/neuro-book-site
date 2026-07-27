<script setup lang="ts">
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {DropdownItem, SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {WorkshopItemDto, WorkshopItemType} from "../../shared/dto/workshop.dto";

// 浏览页：默认态三分区（编辑推荐 / 热门下载 / 最新发布）+ 卡片网格 + URL 同步过滤（q / type / tags / sort）+ 加载更多。
const route = useRoute();
const api = useWorkshopApi();
const notification = useNotification();

useHead({title: "浏览"});

const PAGE_SIZE = 24;

const items = ref<WorkshopItemDto[]>([]);
const total = ref(0);
// nextOffset 为 null 表示无更多
const nextOffset = ref<number | null>(null);
const loading = ref(false);       // 初次 / 换过滤时的整块加载
const loadingMore = ref(false);
const errorMsg = ref("");          // 空串表示无错误

// 从 URL query 派生当前过滤条件（刷新可复现、可分享）
const filters = computed(() => {
    const rawQ = route.query.q;
    const rawType = route.query.type;
    const rawSort = route.query.sort;
    const rawTags = route.query.tags;
    const q = typeof rawQ === "string" ? rawQ : "";
    // 直接落到字面量，避免依赖 route.query 联合类型的收窄
    const type: WorkshopItemType | undefined = rawType === "skill" ? "skill" : rawType === "profile" ? "profile" : undefined;
    const sort: "latest" | "downloads" | "likes" = rawSort === "downloads" ? "downloads" : rawSort === "likes" ? "likes" : "latest";
    const tags = typeof rawTags === "string" && rawTags.length > 0
        ? rawTags.split(",").map((tag) => tag.trim()).filter(Boolean)
        : [];
    return {q, type, sort, tags};
});

// 过滤条搜索框：本地态，随 URL 的 q 同步（AppHeader 搜索或 tag 跳转都会改 q）
const searchInput = ref(filters.value.q);
watch(() => filters.value.q, (value) => {
    searchInput.value = value;
});

// 默认态（无任何过滤）才展示推荐 / 热门分区；一旦筛选就退回纯列表
const isDefaultView = computed(() => !filters.value.q && !filters.value.type && filters.value.sort === "latest" && filters.value.tags.length === 0);

// 分区数据：编辑推荐（admin 精选）+ 热门下载；会话内只拉一次
const featuredItems = ref<WorkshopItemDto[]>([]);
const hotItems = ref<WorkshopItemDto[]>([]);
const sectionsLoaded = ref(false);

async function loadSections(): Promise<void> {
    if (sectionsLoaded.value) {
        return;
    }
    sectionsLoaded.value = true;
    try {
        const [featuredPage, hotPage] = await Promise.all([
            api.listItems({featured: true, limit: 6}),
            api.listItems({sort: "downloads", limit: 6}),
        ]);
        featuredItems.value = featuredPage.items;
        hotItems.value = hotPage.items;
    } catch {
        // 分区加载失败静默降级为纯列表；主列表有自己的错误态，这里不再叠加报错
        sectionsLoaded.value = false;
    }
}

const typeOptions: SegmentedControlOption[] = [
    {label: "全部", value: ""},
    {label: "Skill", value: "skill"},
    {label: "Profile", value: "profile"},
];

const sortItems = computed<DropdownItem[]>(() => [
    {label: "最新", value: "latest", active: filters.value.sort === "latest"},
    {label: "下载最多", value: "downloads", active: filters.value.sort === "downloads"},
    {label: "点赞最多", value: "likes", active: filters.value.sort === "likes"},
]);
const sortLabel = computed(() => sortItems.value.find((option) => option.active)?.label ?? "最新");

// 合并局部改动后重写 URL query（省略默认值，保持地址干净）
function applyFilters(patch: Partial<{q: string; type?: WorkshopItemType; sort: string; tags: string[]}>): void {
    const merged = {...filters.value, ...patch};
    const query: Record<string, string> = {};
    if (merged.q) {
        query.q = merged.q;
    }
    if (merged.type) {
        query.type = merged.type;
    }
    if (merged.sort && merged.sort !== "latest") {
        query.sort = merged.sort;
    }
    if (merged.tags.length > 0) {
        query.tags = merged.tags.join(",");
    }
    void navigateTo({path: "/", query});
}

function onType(value: SegmentedControlValue): void {
    const next = typeof value === "string" && value ? (value as WorkshopItemType) : undefined;
    applyFilters({type: next});
}

// 请求代数：快速切筛选 / 加载更多与筛选交错时，过期响应直接丢弃，防止旧数据混入新列表
let loadGen = 0;

async function load(reset: boolean): Promise<void> {
    const gen = ++loadGen;
    if (reset) {
        loading.value = true;
        errorMsg.value = "";
    } else {
        loadingMore.value = true;
    }
    try {
        const offset = reset ? 0 : nextOffset.value ?? 0;
        const page = await api.listItems({...filters.value, offset, limit: PAGE_SIZE});
        if (gen !== loadGen) {
            return; // 已有更新的请求发出，本次结果过期
        }
        items.value = reset ? page.items : [...items.value, ...page.items];
        total.value = page.total;
        nextOffset.value = page.hasMore ? page.nextOffset ?? null : null;
    } catch (error) {
        if (gen !== loadGen) {
            return;
        }
        // 初次加载失败落整页错误态；加载更多失败只弹通知，保留已加载内容
        if (reset) {
            errorMsg.value = resolveApiErrorMessage(error, "加载失败");
        } else {
            notification.error(resolveApiErrorMessage(error, "加载更多失败"));
        }
    } finally {
        // 过期请求不碰 loading 态，避免提前熄灭新请求的加载指示
        if (gen === loadGen) {
            loading.value = false;
            loadingMore.value = false;
        }
    }
}

// URL query 变化（过滤 / 搜索 / tag 跳转）→ 重置重拉；默认态补拉分区。immediate 兼营初次加载，
// 避免 onMounted 与 watch 双份同体分叉
watch(() => route.query, () => {
    void load(true);
    if (isDefaultView.value) {
        void loadSections();
    }
}, {immediate: true});
</script>

<template>
    <section class="flex flex-col gap-5">
        <!-- 过滤条 -->
        <Panel padding="sm" class="flex flex-wrap items-center gap-3">
            <SegmentedControl :model-value="filters.type ?? ''" :options="typeOptions" aria-label="按类型过滤" @update:model-value="onType" />
            <Dropdown :items="sortItems" root-class="relative" menu-class="left-0 top-full mt-2 min-w-36" @select="(value) => applyFilters({sort: value})">
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]">
                    <span class="i-lucide-arrow-down-wide-narrow h-3.5 w-3.5 text-[var(--text-muted)]"></span>排序：{{ sortLabel }}<span class="i-lucide-chevron-down h-3.5 w-3.5"></span>
                </button>
            </Dropdown>
            <form class="ml-auto flex min-w-56 flex-1 items-center sm:max-w-xs" @submit.prevent="applyFilters({q: searchInput.trim()})">
                <div class="relative w-full">
                    <span class="i-lucide-search pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"></span>
                    <input v-model="searchInput" type="search" placeholder="搜索标题 / 摘要 / 安装名…" class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-9 pr-3 text-xs text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:shadow-[0_0_0_3px_var(--accent-bg)]" />
                </div>
            </form>
        </Panel>

        <!-- 当前标签过滤提示 -->
        <div v-if="filters.tags.length > 0" class="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span>标签过滤：</span>
            <TagChips :tags="filters.tags" />
            <button type="button" class="text-xs text-[var(--accent-text)] hover:underline" @click="applyFilters({tags: []})">清除</button>
        </div>

        <!-- 默认态分区：编辑推荐 / 热门下载（有筛选时隐藏，退回纯列表） -->
        <template v-if="isDefaultView">
            <section v-if="featuredItems.length > 0">
                <h2 class="mb-3 flex items-center gap-2 text-base font-semibold text-[var(--text-main)]"><span class="i-lucide-star h-4 w-4 text-[var(--accent-main)]"></span>编辑推荐</h2>
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <ItemCard v-for="entry in featuredItems" :key="entry.id" :item="entry" />
                </div>
            </section>
            <section v-if="hotItems.length > 0">
                <h2 class="mb-3 flex items-center gap-2 text-base font-semibold text-[var(--text-main)]"><span class="i-lucide-flame h-4 w-4 text-[var(--status-warning)]"></span>热门下载</h2>
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <ItemCard v-for="entry in hotItems" :key="entry.id" :item="entry" />
                </div>
            </section>
        </template>

        <!-- 三态：加载 / 错误 / 空 / 网格 -->
        <StateBlock v-if="loading && items.length === 0" state="loading" />
        <StateBlock v-else-if="errorMsg && items.length === 0" state="error" :message="errorMsg" :retry="() => load(true)" />
        <StateBlock v-else-if="items.length === 0" state="empty" message="没有符合条件的条目" />
        <template v-else>
            <h2 v-if="isDefaultView" class="flex items-center gap-2 text-base font-semibold text-[var(--text-main)]"><span class="i-lucide-clock h-4 w-4 text-[var(--text-muted)]"></span>最新发布</h2>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <ItemCard v-for="item in items" :key="item.id" :item="item" />
            </div>
            <!-- 加载更多 / 计数 -->
            <div class="flex flex-col items-center gap-2 pt-2">
                <Button v-if="nextOffset !== null" variant="secondary" :loading="loadingMore" @click="load(false)">加载更多</Button>
                <p class="text-xs text-[var(--text-muted)]">共 {{ total }} 条{{ nextOffset === null ? "，已全部加载" : "" }}</p>
            </div>
        </template>
    </section>
</template>
