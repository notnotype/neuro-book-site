<script setup lang="ts">
import {computed} from "vue";
import type {WorkshopItemType} from "../../shared/dto/workshop.dto";

// 类型徽章：skill = 青绿（工具/技能），profile = 紫（含可执行代码，偏警示色系）。
const props = withDefaults(defineProps<{
    type: WorkshopItemType;
    size?: "sm" | "md";
}>(), {
    size: "md",
});

const tone = computed(() => props.type === "profile"
    ? {label: "Profile", icon: "i-lucide-cpu", cls: "border-[rgba(168,85,247,0.35)] bg-[rgba(168,85,247,0.15)] text-[#c084fc]"}
    : {label: "Skill", icon: "i-lucide-wrench", cls: "border-[rgba(20,184,166,0.35)] bg-[rgba(20,184,166,0.15)] text-[#2dd4bf]"});
</script>

<template>
    <span class="inline-flex items-center gap-1 rounded-full border font-medium" :class="[tone.cls, props.size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs']">
        <span :class="tone.icon" class="h-3.5 w-3.5"></span>{{ tone.label }}
    </span>
</template>
