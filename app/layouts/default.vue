<script setup lang="ts">
// 默认布局：顶栏 AppHeader + 居中内容容器。
// 登录 / 注册页用 definePageMeta({layout: false}) 走全屏卡片，不套此布局。
</script>

<template>
    <!-- 站点根容器：铺满高度 + 主题背景 -->
    <div class="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <main class="mx-auto w-full max-w-6xl px-4 py-6">
            <slot />
        </main>
    </div>
</template>
