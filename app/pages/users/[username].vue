<script setup lang="ts">
import type {PublicUserDto} from "../../../shared/dto/workshop.dto";

// 作者公开页：资料 + 其全部 published 条目（后端不分页，直接铺）。
const route = useRoute();
const api = useWorkshopApi();
const {t} = useI18n();
const {resolve} = useLocalizedApiError();
const {formatDate, formatNumber} = useLocaleFormat();

const username = computed(() => String(route.params.username));
const user = ref<PublicUserDto | null>(null);
const loading = ref(false);
const errorMsg = ref("");
const notFound = ref(false);

useHead({title: computed(() => user.value?.displayName)});

async function load(): Promise<void> {
    loading.value = true;
    errorMsg.value = "";
    notFound.value = false;
    try {
        user.value = await api.getUser(username.value);
    } catch (error) {
        const status = (error as {statusCode?: number; status?: number}).statusCode ?? (error as {status?: number}).status;
        if (status === 404) {
            notFound.value = true;
        } else {
            errorMsg.value = resolve(error, "common.loadFailed");
        }
    } finally {
        loading.value = false;
    }
}

onMounted(load);
watch(username, load);
</script>

<template>
    <StateBlock v-if="notFound" state="empty" :message="t('profile.notFound')" />
    <StateBlock v-else-if="loading && !user" state="loading" />
    <StateBlock v-else-if="errorMsg && !user" state="error" :message="errorMsg" :retry="load" />

    <section v-else-if="user" class="flex flex-col gap-6">
        <!-- 作者资料：头像 + 昵称 + 签名 + 网站 -->
        <Panel class="flex items-start gap-4">
            <UserAvatar :username="user.username" :avatar-url="user.avatarUrl" :size="56" />
            <div class="min-w-0 flex-1">
                <h1 class="truncate text-xl font-semibold text-[var(--text-main)]">{{ user.displayName }}</h1>
                <p class="text-sm text-[var(--text-muted)]">@{{ user.username }} · {{ t("profile.joinedAt", {date: formatDate(user.joinedAt)}) }}</p>
                <p v-if="user.bio" class="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{{ user.bio }}</p>
                <a v-if="user.websiteUrl" :href="user.websiteUrl" target="_blank" rel="noopener noreferrer" class="mt-1.5 inline-flex items-center gap-1 text-sm text-[var(--accent-text)] hover:underline">
                    <span class="i-lucide-link h-3.5 w-3.5"></span><span class="truncate">{{ user.websiteUrl }}</span>
                </a>
            </div>
        </Panel>

        <!-- 该作者的公开条目 -->
        <div>
            <h2 class="mb-3 text-sm font-medium text-[var(--text-secondary)]">{{ t("profile.publicItems", {count: formatNumber(user.items.length)}) }}</h2>
            <StateBlock v-if="user.items.length === 0" state="empty" :message="t('profile.noItems')" />
            <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <ItemCard v-for="item in user.items" :key="item.id" :item="item" />
            </div>
        </div>
    </section>
</template>
