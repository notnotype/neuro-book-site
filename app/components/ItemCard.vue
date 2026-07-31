<script setup lang="ts">
import type {WorkshopItemDto} from "../../shared/dto/workshop.dto";

// 网格卡片：整卡链接到详情。内部 tag chips 走非 linkable 版，避免 <a> 嵌套。
defineProps<{
    item: WorkshopItemDto;
}>();
const {t} = useI18n();
const {relativeTime, formatNumber} = useLocaleFormat();
</script>

<template>
    <NuxtLink :to="`/items/${item.slug}`" class="group flex h-full flex-col gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 transition-colors hover:border-[var(--accent-main)]">
        <!-- 头部：类型徽章 + 精选星标 + 代码审查提示 -->
        <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
                <ItemTypeBadge :type="item.type" size="sm" />
                <span v-if="item.featured" class="i-lucide-star h-3.5 w-3.5 text-[var(--accent-main)]" :title="t('asset.featured')"></span>
            </div>
            <span v-if="item.containsExecutableCode" class="i-lucide-triangle-alert h-4 w-4 text-[var(--status-warning)]" :title="t('asset.executable')"></span>
        </div>

        <!-- 标题 + 摘要 -->
        <div class="flex-1">
            <h3 class="line-clamp-1 font-semibold text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-text)]">{{ item.title }}</h3>
            <p v-if="item.summary" class="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">{{ item.summary }}</p>
        </div>

        <!-- tag chips（最多展示 4 个） -->
        <TagChips :tags="item.tags.slice(0, 4)" />

        <!-- 统计行：下载 / 点赞 / 评论 + 版本 -->
        <div class="flex items-center justify-between gap-2 border-t border-[var(--border-color)] pt-3 text-xs text-[var(--text-muted)]">
            <div class="flex items-center gap-3">
                <span class="inline-flex items-center gap-1"><span class="i-lucide-download h-3.5 w-3.5"></span>{{ formatNumber(item.downloadCount) }}</span>
                <span class="inline-flex items-center gap-1"><span class="i-lucide-heart h-3.5 w-3.5"></span>{{ formatNumber(item.likeCount) }}</span>
                <span class="inline-flex items-center gap-1"><span class="i-lucide-message-square h-3.5 w-3.5"></span>{{ formatNumber(item.commentCount) }}</span>
            </div>
            <span>{{ item.latestVersion ? `v${item.latestVersion}` : t("asset.unpublished") }}</span>
        </div>

        <!-- 作者 + 更新时间 -->
        <div class="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
            <span class="inline-flex min-w-0 items-center gap-1.5"><UserAvatar :username="item.author.username" :avatar-url="item.author.avatarUrl" :size="18" /><span class="truncate">{{ item.author.displayName }}</span></span>
            <span class="shrink-0">{{ relativeTime(item.updatedAt) }}</span>
        </div>
    </NuxtLink>
</template>
