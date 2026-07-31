<script setup lang="ts">
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import {isRuntimeFlagEnabled} from "~/utils/runtime-flag";

// 登录页：全屏居中卡片，不套默认布局（无顶栏）。
definePageMeta({layout: false});
useHead({title: "登录"});

const {refresh} = useAuthState();
const notification = useNotification();
const route = useRoute();
const publicConfig = useRuntimeConfig().public;
const registrationEnabled = computed(() => isRuntimeFlagEnabled(publicConfig.registrationEnabled));
const githubOAuthEnabled = computed(() => isRuntimeFlagEnabled(publicConfig.githubOAuthEnabled));
const username = ref("");
const password = ref("");
const busy = ref(false);
const errorMsg = ref(""); // 表单内可恢复错误，就地展示

// GitHub 回调失败态经 query 回到登录页（/auth/github onError 与封禁拦截）
onMounted(() => {
    if (route.query.error === "disabled") {
        errorMsg.value = "该账号已被封禁，无法登录";
    } else if (route.query.error === "oauth") {
        errorMsg.value = "GitHub 登录失败，请重试";
    }
});

// 回跳地址：只接受站内路径，防开放跳转
function redirectTarget(): string {
    const raw = route.query.redirect;
    const value = typeof raw === "string" ? raw : "";
    return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

async function submit(): Promise<void> {
    busy.value = true;
    errorMsg.value = "";
    try {
        await $fetch("/api/auth/login", {method: "POST", body: {username: username.value, password: password.value}});
        await refresh();
        notification.success("登录成功");
        await navigateTo(redirectTarget());
    } catch (error) {
        errorMsg.value = resolveApiErrorMessage(error, "登录失败");
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <main class="flex min-h-screen items-center justify-center bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <Panel as="form" class="w-full max-w-sm space-y-4" @submit.prevent="submit">
            <NuxtLink to="/" class="flex items-center justify-center gap-2 font-semibold">
                <span class="i-lucide-box h-5 w-5 text-[var(--accent-main)]"></span>NeuroBook
            </NuxtLink>
            <h1 class="text-center text-lg font-semibold">登录</h1>
            <FormField label="用户名" required><FormInput v-model="username" name="username" autocomplete="username" /></FormField>
            <FormField label="密码" required><FormInput v-model="password" name="password" type="password" autocomplete="current-password" /></FormField>
            <p v-if="errorMsg" class="text-sm text-[var(--status-danger)]">{{ errorMsg }}</p>
            <Button type="submit" block :loading="busy">登录</Button>
            <!-- GitHub OAuth 入口：已绑定直接登录；未绑定进补全注册 -->
            <div v-if="githubOAuthEnabled" class="flex items-center gap-2 text-xs text-[var(--text-muted)]"><span class="h-px flex-1 bg-[var(--border-color)]"></span>或<span class="h-px flex-1 bg-[var(--border-color)]"></span></div>
            <a v-if="githubOAuthEnabled" href="/auth/github" class="block"><Button type="button" variant="secondary" block><span class="i-lucide-github h-4 w-4"></span>使用 GitHub 登录</Button></a>
            <NuxtLink v-if="registrationEnabled" to="/register" class="block text-center text-sm text-[var(--accent-text)] hover:underline">还没有账号？去注册</NuxtLink>
        </Panel>
    </main>
</template>
