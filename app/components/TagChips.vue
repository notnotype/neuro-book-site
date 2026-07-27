<script setup lang="ts">
import {resolveComponent} from "vue";

// tag chips。linkable 时每个 chip 变为可点击链接，跳到该 tag 的浏览过滤（/?tags=）。
// 注意：放在整卡链接（如 ItemCard）内部时不要传 linkable，避免 <a> 嵌套 <a>。
const props = defineProps<{
    tags: string[];
    linkable?: boolean;
}>();

// 按需解析全局注册的 NuxtLink；非 linkable 时退化为 span
const chipTag = props.linkable ? resolveComponent("NuxtLink") : "span";
</script>

<template>
    <div v-if="tags.length > 0" class="flex flex-wrap gap-1.5">
        <component
            :is="chipTag"
            v-for="tag in tags"
            :key="tag"
            :to="linkable ? {path: '/', query: {tags: tag}} : undefined"
            class="inline-flex items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
            :class="linkable ? 'transition-colors hover:border-[var(--accent-main)] hover:text-[var(--accent-text)]' : ''"
        >#{{ tag }}</component>
    </div>
</template>
