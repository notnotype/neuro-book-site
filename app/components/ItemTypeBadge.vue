<script setup lang="ts">
import {computed} from "vue";
import type {WorkshopItemType} from "../../shared/dto/workshop.dto";

// 三类资产使用固定类别色，便于在列表中快速识别。
const props = withDefaults(defineProps<{
    type: WorkshopItemType;
    size?: "sm" | "md";
}>(), {
    size: "md",
});

const tone = computed(() => {
    if (props.type === "profile") {
        return {label: "Profile", icon: "i-lucide-cpu", cls: "border-[rgba(168,85,247,0.35)] bg-[rgba(168,85,247,0.15)] text-[#c084fc]"};
    }
    if (props.type === "workflow") {
        return {label: "Workflow", icon: "i-lucide-workflow", cls: "border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.14)] text-[#fbbf24]"};
    }
    return {label: "Skill", icon: "i-lucide-wrench", cls: "border-[rgba(20,184,166,0.35)] bg-[rgba(20,184,166,0.15)] text-[#2dd4bf]"};
});
</script>

<template>
    <span class="inline-flex items-center gap-1 rounded-full border font-medium" :class="[tone.cls, props.size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs']">
        <span :class="tone.icon" class="h-3.5 w-3.5"></span>{{ tone.label }}
    </span>
</template>
