<script setup lang="ts">
import {computed, ref, watch} from "vue";

// 用户头像：有 avatarUrl 走 <img>（加载失败自动回落），否则回落用户名首字母色块。
// 色块颜色按用户名 hash 从固定色板取，保证同名恒色。
const props = withDefaults(defineProps<{
    username: string;
    avatarUrl?: string;
    /** 像素尺寸，默认 24（列表行内）；作者页头部等大位传 64+ */
    size?: number;
}>(), {
    avatarUrl: "",
    size: 24,
});

// img 加载失败态（403/404/断链），回落色块；地址变更时重置重试
const failed = ref(false);
watch(() => props.avatarUrl, () => {
    failed.value = false;
});

const showImage = computed(() => props.avatarUrl !== "" && !failed.value);

const FALLBACK_COLORS = ["#f87171", "#fb923c", "#fbbf24", "#4ade80", "#2dd4bf", "#38bdf8", "#818cf8", "#c084fc", "#f472b6"];

const fallbackColor = computed(() => {
    let hash = 0;
    for (const ch of props.username) {
        hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
    }
    return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
});

const initial = computed(() => (props.username[0] ?? "?").toUpperCase());

const boxStyle = computed(() => ({width: `${props.size}px`, height: `${props.size}px`, fontSize: `${Math.round(props.size * 0.45)}px`}));
</script>

<template>
    <img v-if="showImage" :src="props.avatarUrl" :alt="props.username" :style="boxStyle" class="shrink-0 rounded-full object-cover" referrerpolicy="no-referrer" @error="failed = true" />
    <span v-else :style="{...boxStyle, backgroundColor: fallbackColor}" class="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white">{{ initial }}</span>
</template>
