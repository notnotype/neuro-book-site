<script setup lang="ts">
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {CommentDto} from "../../shared/dto/workshop.dto";

// 条目评论区：楼层正序分页 + 登录可发表 + 本人/admin 可删（删除走确认 Dialog）。
// 通过 count-delta 把评论数增减回传给详情页，保持侧栏统计实时。
const props = defineProps<{slug: string}>();
const emit = defineEmits<{(e: "count-delta", delta: number): void}>();

const api = useWorkshopApi();
const {session} = useAuthState();
const notification = useNotification();

const PAGE_SIZE = 20;
const comments = ref<CommentDto[]>([]);
const total = ref(0);
const nextOffset = ref<number | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const errorMsg = ref("");

const draft = ref("");
const posting = ref(false);

// 删除确认：记住待删评论 id，null 表示关闭确认框
const confirmingId = ref<number | null>(null);
const deleting = ref(false);

const isLoggedIn = computed(() => Boolean(session.value.user));

// 本人或 admin 可删
function canDelete(comment: CommentDto): boolean {
    const user = session.value.user;
    if (!user) {
        return false;
    }
    return user.role === "admin" || comment.author.username === user.username;
}

async function load(reset: boolean): Promise<void> {
    if (reset) {
        loading.value = true;
        errorMsg.value = "";
    } else {
        loadingMore.value = true;
    }
    try {
        const offset = reset ? 0 : nextOffset.value ?? 0;
        const page = await api.getComments(props.slug, {offset, limit: PAGE_SIZE});
        comments.value = reset ? page.items : [...comments.value, ...page.items];
        total.value = page.total;
        nextOffset.value = page.hasMore ? page.nextOffset ?? null : null;
    } catch (error) {
        if (reset) {
            errorMsg.value = resolveApiErrorMessage(error, "评论加载失败");
        } else {
            notification.error(resolveApiErrorMessage(error, "加载更多失败"));
        }
    } finally {
        loading.value = false;
        loadingMore.value = false;
    }
}

async function submit(): Promise<void> {
    const content = draft.value.trim();
    if (!content) {
        return;
    }
    posting.value = true;
    try {
        const created = await api.addComment(props.slug, content);
        comments.value = [...comments.value, created]; // 楼层正序，新评论追加到末尾
        total.value += 1;
        draft.value = "";
        emit("count-delta", 1);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "评论发表失败"));
    } finally {
        posting.value = false;
    }
}

async function confirmDelete(): Promise<void> {
    if (confirmingId.value === null) {
        return;
    }
    deleting.value = true;
    const targetId = confirmingId.value;
    try {
        await api.deleteComment(targetId);
        comments.value = comments.value.filter((comment) => comment.id !== targetId);
        total.value = Math.max(0, total.value - 1);
        emit("count-delta", -1);
        confirmingId.value = null;
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "删除失败"));
    } finally {
        deleting.value = false;
    }
}

onMounted(() => load(true));
</script>

<template>
    <div class="flex flex-col gap-4">
        <!-- 发表框（登录可见） -->
        <div v-if="isLoggedIn" class="flex flex-col gap-2">
            <FormTextarea v-model="draft" :rows="3" placeholder="友善地留下你的想法…" :maxlength="2000" />
            <div class="flex justify-end">
                <Button size="sm" :loading="posting" :disabled="draft.trim().length === 0" @click="submit">发表评论</Button>
            </div>
        </div>
        <p v-else class="rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            <NuxtLink to="/login" class="text-[var(--accent-text)] hover:underline">登录</NuxtLink> 后可以发表评论。
        </p>

        <!-- 列表三态 -->
        <StateBlock v-if="loading" state="loading" message="评论加载中…" />
        <StateBlock v-else-if="errorMsg" state="error" :message="errorMsg" :retry="() => load(true)" />
        <StateBlock v-else-if="comments.length === 0" state="empty" message="还没有评论，来抢沙发" />
        <template v-else>
            <ul class="flex flex-col gap-3">
                <li v-for="comment in comments" :key="comment.id" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex items-center gap-2 text-sm">
                            <UserAvatar :username="comment.author.username" :avatar-url="comment.author.avatarUrl" :size="20" />
                            <NuxtLink :to="`/users/${comment.author.username}`" class="font-medium text-[var(--text-main)] hover:text-[var(--accent-text)]">{{ comment.author.displayName }}</NuxtLink>
                            <span class="text-xs text-[var(--text-muted)]">{{ relativeTime(comment.createdAt) }}</span>
                        </div>
                        <IconButton v-if="canDelete(comment)" title="删除评论" variant="danger" size="sm" @click="confirmingId = comment.id">
                            <span class="i-lucide-trash-2 h-4 w-4"></span>
                        </IconButton>
                    </div>
                    <p class="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{{ comment.content }}</p>
                </li>
            </ul>
            <div class="flex flex-col items-center gap-2">
                <Button v-if="nextOffset !== null" variant="secondary" size="sm" :loading="loadingMore" @click="load(false)">加载更多评论</Button>
                <p class="text-xs text-[var(--text-muted)]">共 {{ total }} 条评论</p>
            </div>
        </template>

        <!-- 删除确认 -->
        <Dialog
            :model-value="confirmingId !== null"
            title="删除评论"
            size="sm"
            show-cancel
            confirm-label="删除"
            :busy="deleting"
            @update:model-value="(visible) => { if (!visible) confirmingId = null; }"
            @confirm="confirmDelete"
        >
            <p class="text-sm text-[var(--text-secondary)]">确定删除这条评论吗？此操作不可撤销。</p>
        </Dialog>
    </div>
</template>
