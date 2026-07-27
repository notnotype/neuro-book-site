<script setup lang="ts">
// 可执行代码警示条：profile 含会在本机服务端进程中执行的 TS 代码，详情 / 发布页固定展示。
</script>

<template>
    <div class="flex items-start gap-2 rounded-md border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] px-3 py-2 text-xs text-[var(--status-warning)]">
        <span class="i-lucide-triangle-alert mt-0.5 h-4 w-4 shrink-0"></span>
        <span>此 profile 含会在你本机服务端进程中执行的 TypeScript 代码。安装前请确认来源可信。</span>
    </div>
</template>
