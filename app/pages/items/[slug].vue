<script setup lang="ts">
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {ItemVersionDto, WorkshopItemDto} from "../../../shared/dto/workshop.dto";

// 条目详情：左主栏（头部 + 描述/版本/评论 Tab）+ 右侧 sticky 下载/操作侧栏。
const route = useRoute();
const router = useRouter();
const api = useWorkshopApi();
const {session} = useAuthState();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const {t} = useI18n();
const {formatDate, relativeTime, formatBytes, formatNumber} = useLocaleFormat();

const slug = computed(() => String(route.params.slug));
const isLoggedIn = computed(() => Boolean(session.value.user));

const item = ref<WorkshopItemDto | null>(null);
const versions = ref<ItemVersionDto[]>([]);
const loading = ref(false);
const errorMsg = ref("");     // 空串表示无一般错误
const notFound = ref(false);  // 404：条目不存在或已下架

// viewer / 计数的本地副本，供乐观更新
const liked = ref(false);
const favorited = ref(false);
const likeCount = ref(0);
const commentCount = ref(0);

type DetailTab = "desc" | "files" | "versions" | "comments";
const detailTabs: DetailTab[] = ["desc", "files", "versions", "comments"];
const activeTab = ref<DetailTab>(detailTabs.includes(route.query.tab as DetailTab) ? route.query.tab as DetailTab : "desc");
// 「文件」Tab 首次访问才挂载 PackageFileBrowser（懒加载，切走后保留状态）
const filesVisited = ref(activeTab.value === "files");
watch(activeTab, (tab) => {
    if (tab === "files") {
        filesVisited.value = true;
    }
});
watch(() => route.query.tab, (tab) => {
    activeTab.value = detailTabs.includes(tab as DetailTab) ? tab as DetailTab : "desc";
});
const tabOptions = computed<SegmentedControlOption[]>(() => [
    {label: t("item.tabs.description"), value: "desc"},
    // 有版本才提供包内容预览
    ...(item.value?.latestVersion ? [{label: t("item.tabs.files"), value: "files"}] : []),
    {label: t("item.tabs.versions"), value: "versions", count: versions.value.length},
    {label: t("item.tabs.comments"), value: "comments", count: commentCount.value},
]);

/** 切换详情分区并把状态写入 URL；离开文件分区时清理包路径参数。 */
async function selectTab(value: SegmentedControlValue): Promise<void> {
    const tab = value as DetailTab;
    await router.push({
        path: route.path,
        query: tab === "files" ? {...route.query, tab} : {tab},
    });
}

// 下载按钮点击反馈：短暂切换文案，让用户确认点击已生效
const downloadFlash = ref(false);
function onDownloadClick(): void {
    downloadFlash.value = true;
    setTimeout(() => {
        downloadFlash.value = false;
    }, 2000);
}

// 举报 Dialog
const showReport = ref(false);
const reportReason = ref("");
const reporting = ref(false);

useHead({title: computed(() => item.value?.title)});

async function load(): Promise<void> {
    loading.value = true;
    errorMsg.value = "";
    notFound.value = false;
    try {
        // 详情与版本并行拉取
        const [detail, versionList] = await Promise.all([api.getItem(slug.value), api.getVersions(slug.value)]);
        item.value = detail;
        versions.value = versionList;
        liked.value = detail.viewer?.liked ?? false;
        favorited.value = detail.viewer?.favorited ?? false;
        likeCount.value = detail.likeCount;
        commentCount.value = detail.commentCount;
    } catch (error) {
        // $fetch 抛 FetchError，statusCode/status 标识 HTTP 状态
        const status = (error as {response?: {status?: number}; statusCode?: number; status?: number}).response?.status ?? (error as {statusCode?: number}).statusCode ?? (error as {status?: number}).status;
        if (status === 404) {
            notFound.value = true;
        } else {
            errorMsg.value = localizedError.resolve(error, "common.loadFailed");
        }
    } finally {
        loading.value = false;
    }
}

async function toggleLike(): Promise<void> {
    if (!isLoggedIn.value) {
        notification.info(t("item.signInToLike"));
        return;
    }
    const was = liked.value;
    // 乐观更新，失败回滚
    liked.value = !was;
    likeCount.value += was ? -1 : 1;
    try {
        const state = was ? await api.unlike(slug.value) : await api.like(slug.value);
        liked.value = state.liked;
        likeCount.value = state.likeCount;
    } catch (error) {
        liked.value = was;
        likeCount.value += was ? 1 : -1;
        notification.error(localizedError.resolve(error, "common.actionFailed"));
    }
}

async function toggleFavorite(): Promise<void> {
    if (!isLoggedIn.value) {
        notification.info(t("item.signInToFavorite"));
        return;
    }
    const was = favorited.value;
    favorited.value = !was;
    try {
        const state = was ? await api.unfavorite(slug.value) : await api.favorite(slug.value);
        favorited.value = state.favorited;
    } catch (error) {
        favorited.value = was;
        notification.error(localizedError.resolve(error, "common.actionFailed"));
    }
}

function openReport(): void {
    if (!isLoggedIn.value) {
        notification.info(t("item.signInToReport"));
        return;
    }
    reportReason.value = "";
    showReport.value = true;
}

async function submitReport(): Promise<void> {
    const reason = reportReason.value.trim();
    if (!reason) {
        return;
    }
    reporting.value = true;
    try {
        await api.report(slug.value, reason);
        notification.success(t("item.reportSubmitted"));
        showReport.value = false;
    } catch (error) {
        notification.error(localizedError.resolve(error, "item.reportFailed"));
    } finally {
        reporting.value = false;
    }
}

async function copyInstallName(): Promise<void> {
    if (!item.value?.name) {
        return;
    }
    try {
        await navigator.clipboard.writeText(item.value.name);
        notification.success(t("item.installNameCopied"));
    } catch {
        notification.error(t("common.copyFailed"));
    }
}

// Nuxt 默认按插值路径 key 页面组件：/items/a → /items/b 是整页重挂载（非组件复用），
// slug 在实例生命周期内不会变化，无需 watch slug 重拉
onMounted(load);
</script>

<template>
    <!-- 404 / 加载 / 错误整页态 -->
    <StateBlock v-if="notFound" state="empty" :message="t('item.notFound')" />
    <StateBlock v-else-if="loading && !item" state="loading" />
    <StateBlock v-else-if="errorMsg && !item" state="error" :message="errorMsg" :retry="load" />

    <!-- 小屏侧栏在上、正文在下；大屏 row-reverse 把侧栏放到右侧 -->
    <div v-else-if="item" class="flex flex-col gap-6 lg:flex-row-reverse lg:items-start">
        <!-- 右侧 sticky 下载 / 操作侧栏 -->
        <aside class="w-full lg:sticky lg:top-20 lg:w-80 lg:shrink-0">
            <Panel class="flex flex-col gap-4">
                <a :href="api.downloadHref(slug)" download class="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-sm font-semibold text-[var(--text-inverse)] transition hover:opacity-90" @click="onDownloadClick">
                    <template v-if="downloadFlash"><span class="i-lucide-check h-4 w-4"></span>{{ t("item.downloadStarted") }}</template>
                    <template v-else><span class="i-lucide-download h-4 w-4"></span>{{ t("item.downloadLatest") }}</template>
                </a>

                <!-- 安装名（可复制） -->
                <div v-if="item.name" class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--text-muted)]">{{ t("item.installName") }}</span>
                    <button type="button" class="group flex items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1.5 text-left text-sm text-[var(--text-main)] transition-colors hover:border-[var(--accent-main)]" @click="copyInstallName">
                        <span class="truncate font-mono text-xs">{{ item.name }}</span>
                        <span class="i-lucide-copy h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent-text)]"></span>
                    </button>
                </div>

                <!-- 统计 -->
                <dl class="grid grid-cols-2 gap-3 text-sm">
                    <div><dt class="text-xs text-[var(--text-muted)]">{{ t("item.downloads") }}</dt><dd class="mt-0.5 font-medium text-[var(--text-main)]">{{ formatNumber(item.downloadCount) }}</dd></div>
                    <div><dt class="text-xs text-[var(--text-muted)]">{{ t("item.likes") }}</dt><dd class="mt-0.5 font-medium text-[var(--text-main)]">{{ formatNumber(likeCount) }}</dd></div>
                    <div><dt class="text-xs text-[var(--text-muted)]">{{ t("item.latestVersion") }}</dt><dd class="mt-0.5 font-medium text-[var(--text-main)]">{{ item.latestVersion ? `v${item.latestVersion}` : t("asset.unpublished") }}</dd></div>
                    <div><dt class="text-xs text-[var(--text-muted)]">{{ t("item.updatedAt") }}</dt><dd class="mt-0.5 font-medium text-[var(--text-main)]">{{ relativeTime(item.updatedAt) }}</dd></div>
                </dl>

                <!-- 收藏 / 点赞 / 举报 -->
                <div class="flex flex-col gap-2 border-t border-[var(--border-color)] pt-3">
                    <div class="grid grid-cols-2 gap-2">
                        <Button variant="secondary" size="sm" @click="toggleLike">
                            <span :class="liked ? 'i-lucide-heart text-[var(--status-danger)]' : 'i-lucide-heart'" class="h-4 w-4"></span>{{ liked ? t("item.liked") : t("item.like") }}
                        </Button>
                        <Button variant="secondary" size="sm" @click="toggleFavorite">
                            <span :class="favorited ? 'i-lucide-bookmark-check text-[var(--accent-text)]' : 'i-lucide-bookmark'" class="h-4 w-4"></span>{{ favorited ? t("item.favorited") : t("item.favorite") }}
                        </Button>
                    </div>
                    <Button variant="subtle" size="sm" @click="openReport"><span class="i-lucide-flag h-4 w-4"></span>{{ t("item.report") }}</Button>
                </div>
            </Panel>
        </aside>

        <!-- 左主栏 -->
        <div class="min-w-0 flex-1">
            <!-- 头部 -->
            <header class="flex flex-col gap-3">
                <div class="flex flex-wrap items-center gap-2">
                    <ItemTypeBadge :type="item.type" />
                    <span class="font-mono text-xs text-[var(--text-muted)]">{{ item.slug }}</span>
                </div>
                <h1 class="text-2xl font-semibold text-[var(--text-main)]">{{ item.title }}</h1>
                <p v-if="item.summary" class="text-sm text-[var(--text-secondary)]">{{ item.summary }}</p>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-muted)]">
                    <NuxtLink :to="`/users/${item.author.username}`" class="inline-flex items-center gap-1.5 hover:text-[var(--accent-text)]"><UserAvatar :username="item.author.username" :avatar-url="item.author.avatarUrl" :size="18" />{{ item.author.displayName }}</NuxtLink>
                    <span>{{ t("item.publishedAt", {date: formatDate(item.createdAt)}) }}</span>
                </div>
                <TagChips :tags="item.tags" linkable />
                <ExecutableWarning v-if="item.containsExecutableCode" />
            </header>

            <!-- Tab 切换 -->
            <div class="mt-5">
                <SegmentedControl :model-value="activeTab" :options="tabOptions" :aria-label="t('item.sectionLabel')" @update:model-value="selectTab" />
            </div>

            <!-- Tab 内容 -->
            <div class="mt-4">
                <!-- 描述（sanitized markdown 渲染） -->
                <div v-show="activeTab === 'desc'">
                    <MarkdownView v-if="item.description" :source="item.description" />
                    <StateBlock v-else state="empty" :message="t('item.noDescription')" />
                </div>

                <!-- 包内容在线预览（首次切入才挂载） -->
                <div v-show="activeTab === 'files'">
                    <PackageFileBrowser v-if="filesVisited" :slug="slug" :versions="versions" />
                </div>

                <!-- 版本历史 -->
                <div v-show="activeTab === 'versions'">
                    <StateBlock v-if="versions.length === 0" state="empty" :message="t('item.noVersions')" />
                    <ul v-else class="flex flex-col gap-3">
                        <li v-for="ver in versions" :key="ver.id" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                            <div class="flex items-center justify-between gap-2">
                                <span class="flex items-center gap-1.5 font-medium text-[var(--text-main)]">v{{ ver.version }}<span v-if="ver.containsExecutableCode" class="i-lucide-triangle-alert h-3.5 w-3.5 text-[var(--status-warning)]" :title="t('asset.executable')"></span></span>
                                <span class="text-xs text-[var(--text-muted)]">{{ relativeTime(ver.createdAt) }}</span>
                            </div>
                            <p v-if="ver.changelog" class="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{{ ver.changelog }}</p>
                            <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                                <span>{{ formatBytes(ver.fileSize) }} · {{ ver.minAppVersion ? t("item.requiresVersion", {version: ver.minAppVersion}) : t("item.noMinimumVersion") }}</span>
                                <a :href="api.downloadHref(slug, ver.version)" download class="inline-flex items-center gap-1 text-[var(--accent-text)] hover:underline"><span class="i-lucide-download h-3.5 w-3.5"></span>{{ t("item.downloadVersion") }}</a>
                            </div>
                        </li>
                    </ul>
                </div>

                <!-- 评论 -->
                <div v-show="activeTab === 'comments'">
                    <ItemComments :slug="slug" @count-delta="(delta: number) => commentCount += delta" />
                </div>
            </div>
        </div>

        <!-- 举报 Dialog -->
        <Dialog v-model="showReport" :title="t('item.reportTitle')" size="sm" show-cancel :cancel-label="t('common.cancel')" :confirm-label="t('item.submitReport')" :close-label="t('common.close')" :busy="reporting" @confirm="submitReport">
            <div class="flex flex-col gap-2">
                <p class="text-sm text-[var(--text-secondary)]">{{ t("item.reportDescription") }}</p>
                <FormTextarea v-model="reportReason" :rows="4" :placeholder="t('item.reportPlaceholder')" :maxlength="2000" />
            </div>
        </Dialog>
    </div>
</template>
