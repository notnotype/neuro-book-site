<script setup lang="ts">
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";

definePageMeta({
    middleware: "auth",
});

const notification = useNotification();
const protectedResult = ref("");

onMounted(async () => {
    try {
        const result = await $fetch<{ok: true; username: string}>("/api/protected");
        protectedResult.value = `API 已验证当前用户：${result.username}`;
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "验证登录状态失败"));
        await navigateTo("/login");
    }
});
</script>

<template>
    <main class="min-h-screen bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <section class="mx-auto max-w-3xl space-y-4">
            <Button variant="ghost" @click="navigateTo('/')">返回首页</Button>
            <Panel>
                <h1 class="text-xl font-semibold">受保护页面</h1>
                <p class="mt-2 text-sm text-[var(--text-secondary)]">这个页面展示模板中需要登录的页面和 API 写法。</p>
                <p class="mt-4 text-sm text-[var(--accent-text)]">{{ protectedResult || "正在验证 session..." }}</p>
            </Panel>
        </section>
    </main>
</template>
