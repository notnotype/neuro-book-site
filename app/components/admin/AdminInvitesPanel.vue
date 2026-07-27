<script setup lang="ts">
import {onMounted, ref} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {InviteCodeDto} from "../../../shared/dto/workshop.dto";

// admin 邀请码：签发（数量 + 用途备注）+ 本次签发明文复制 + 全量列表（按使用状态过滤）。
const api = useWorkshopApi();
const notification = useNotification();

// ---- 签发 ----
const inviteCount = ref<number | null>(1);
const inviteNote = ref("");
const issuing = ref(false);
const issuedCodes = ref<InviteCodeDto[]>([]); // 最近签发的明文，供复制

async function issueCodes(): Promise<void> {
    const count = inviteCount.value ?? 1;
    issuing.value = true;
    try {
        const codes = await api.createInviteCodes(count, inviteNote.value.trim());
        issuedCodes.value = [...codes, ...issuedCodes.value];
        notification.success(`已签发 ${codes.length} 个邀请码`);
        await loadList(true);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "签发失败"));
    } finally {
        issuing.value = false;
    }
}

async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        notification.success("已复制");
    } catch {
        notification.error("复制失败，请手动选择");
    }
}

// ---- 全量列表 ----
const PAGE_SIZE = 20;
type InviteFilter = "all" | "unused" | "used";
const filter = ref<InviteFilter>("all");
const filterOptions: SegmentedControlOption[] = [
    {label: "全部", value: "all"},
    {label: "未使用", value: "unused"},
    {label: "已使用", value: "used"},
];

const list = ref<InviteCodeDto[]>([]);
const total = ref(0);
const next = ref<number | null>(null);
const listLoading = ref(false);
const loadingMore = ref(false);
const listError = ref("");

async function loadList(reset: boolean): Promise<void> {
    if (reset) {
        listLoading.value = true;
        listError.value = "";
    } else {
        loadingMore.value = true;
    }
    try {
        const offset = reset ? 0 : next.value ?? 0;
        const page = await api.listInviteCodes({offset, limit: PAGE_SIZE, filter: filter.value});
        list.value = reset ? page.items : [...list.value, ...page.items];
        total.value = page.total;
        next.value = page.hasMore ? page.nextOffset ?? null : null;
    } catch (error) {
        if (reset) {
            listError.value = resolveApiErrorMessage(error, "加载失败");
        } else {
            notification.error(resolveApiErrorMessage(error, "加载更多失败"));
        }
    } finally {
        listLoading.value = false;
        loadingMore.value = false;
    }
}

function switchFilter(value: SegmentedControlValue): void {
    filter.value = value as InviteFilter;
    void loadList(true);
}

onMounted(() => loadList(true));
</script>

<template>
    <div class="flex flex-col gap-4">
        <!-- 签发表单 -->
        <Panel class="flex flex-col gap-3">
            <h2 class="text-sm font-medium text-[var(--text-main)]">签发邀请码</h2>
            <div class="flex flex-wrap items-end gap-3">
                <FormField label="数量" class="w-32"><FormNumberInput v-model="inviteCount" :min="1" :max="100" /></FormField>
                <FormField label="用途备注（可选）" class="min-w-56 flex-1"><FormInput v-model="inviteNote" name="note" :maxlength="120" placeholder="发给谁 / 什么活动，仅管理员可见" /></FormField>
                <Button :loading="issuing" @click="issueCodes"><span class="i-lucide-ticket h-4 w-4"></span>签发</Button>
            </div>
        </Panel>

        <!-- 本次签发明文 -->
        <Panel v-if="issuedCodes.length > 0" class="flex flex-col gap-2">
            <h2 class="text-sm font-medium text-[var(--text-main)]">本次签发（请及时复制分发）</h2>
            <ul class="flex flex-col gap-2">
                <li v-for="code in issuedCodes" :key="code.id" class="flex items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-1.5">
                    <span class="truncate font-mono text-sm text-[var(--text-main)]">{{ code.code }}</span>
                    <IconButton title="复制" variant="accent" @click="copyText(code.code)"><span class="i-lucide-copy h-4 w-4"></span></IconButton>
                </li>
            </ul>
        </Panel>

        <!-- 全量列表 -->
        <Panel class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="text-sm font-medium text-[var(--text-main)]">已签发列表</h2>
                <SegmentedControl :model-value="filter" :options="filterOptions" aria-label="使用状态过滤" @update:model-value="switchFilter" />
            </div>
            <StateBlock v-if="listLoading && list.length === 0" state="loading" />
            <StateBlock v-else-if="listError && list.length === 0" state="error" :message="listError" :retry="() => loadList(true)" />
            <StateBlock v-else-if="list.length === 0" state="empty" message="没有符合条件的邀请码" />
            <template v-else>
                <ul class="flex flex-col gap-1.5">
                    <li v-for="code in list" :key="code.id" class="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border-color)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-xs">
                        <span class="flex min-w-0 items-center gap-2">
                            <span class="truncate font-mono text-sm text-[var(--text-main)]">{{ code.code }}</span>
                            <span v-if="code.usedBy" class="inline-flex shrink-0 items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">已用 · @{{ code.usedBy }}</span>
                            <span v-else class="inline-flex shrink-0 items-center rounded-full border border-[rgba(74,222,128,0.35)] bg-[rgba(74,222,128,0.12)] px-1.5 py-0.5 text-[10px] text-[#4ade80]">未使用</span>
                        </span>
                        <span class="shrink-0 text-[var(--text-muted)]">{{ code.note ? `${code.note} · ` : "" }}{{ formatDate(code.createdAt) }}{{ code.usedAt ? ` · 使用于 ${formatDate(code.usedAt)}` : "" }}</span>
                    </li>
                </ul>
                <div class="flex flex-col items-center gap-2">
                    <Button v-if="next !== null" variant="secondary" size="sm" :loading="loadingMore" @click="loadList(false)">加载更多</Button>
                    <p class="text-xs text-[var(--text-muted)]">共 {{ total }} 个</p>
                </div>
            </template>
        </Panel>
    </div>
</template>
