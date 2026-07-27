<script setup lang="ts">
import {onMounted} from "vue";

// 站点标题唯一后缀出口：页面 useHead 只写前缀（如「浏览」），无标题页回落品牌名
useHead({titleTemplate: (title) => title ? `${title} · NeuroBook` : "NeuroBook"});

// 应用启动时恢复上次选择的主题（localStorage），默认 Default Dark。
const {initTheme} = useTheme();

onMounted(() => {
    initTheme();
});
</script>

<template>
    <NuxtLayout>
        <NuxtPage />
    </NuxtLayout>
    <NotificationViewport />
</template>
