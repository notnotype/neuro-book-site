<script setup lang="ts">
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import {isRuntimeFlagEnabled} from "~/utils/runtime-flag";

// 注册页：注册码必填负责准入，邀请码可选并只记录邀请归属；两者可从分享链接预填。
definePageMeta({layout: false});
useHead({title: "注册"});

const {refresh} = useAuthState();
const notification = useNotification();
const route = useRoute();
const publicConfig = useRuntimeConfig().public;
const githubOAuthEnabled = computed(() => isRuntimeFlagEnabled(publicConfig.githubOAuthEnabled));
const username = ref("");
const password = ref("");
const registrationCode = ref(typeof route.query.registrationCode === "string" ? route.query.registrationCode : "");
const inviteCode = ref(typeof route.query.inviteCode === "string" ? route.query.inviteCode : "");
const busy = ref(false);
const errorMsg = ref(""); // 表单内可恢复错误，就地展示

onMounted(() => {
    if (!isRuntimeFlagEnabled(publicConfig.registrationEnabled)) {
        void navigateTo("/login", {replace: true});
    }
});

async function submit(): Promise<void> {
    busy.value = true;
    errorMsg.value = "";
    try {
        await $fetch("/api/auth/register", {
            method: "POST",
            body: {
                username: username.value,
                password: password.value,
                registrationCode: registrationCode.value.trim(),
                ...(inviteCode.value.trim() ? {inviteCode: inviteCode.value.trim()} : {}),
            },
        });
        await refresh();
        notification.success("注册成功");
        await navigateTo("/");
    } catch (error) {
        errorMsg.value = resolveApiErrorMessage(error, "注册失败");
    } finally {
        busy.value = false;
    }
}

/** GitHub 往返期间用当前 tab 的 sessionStorage 保留分享链接中的两个码。 */
function startGitHubRegister(): void {
    sessionStorage.setItem("nbook-registration-code", registrationCode.value.trim());
    sessionStorage.setItem("nbook-invite-code", inviteCode.value.trim());
    window.location.href = "/auth/github";
}
</script>

<template>
    <main class="flex min-h-screen items-center justify-center bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <Panel as="form" class="w-full max-w-sm space-y-4" @submit.prevent="submit">
            <NuxtLink to="/" class="flex items-center justify-center gap-2 font-semibold">
                <span class="i-lucide-box h-5 w-5 text-[var(--accent-main)]"></span>NeuroBook
            </NuxtLink>
            <h1 class="text-center text-lg font-semibold">注册</h1>
            <FormField label="注册码" required><FormInput v-model="registrationCode" name="registrationCode" autocomplete="off" /></FormField>
            <FormField label="邀请码（可选）"><FormInput v-model="inviteCode" name="inviteCode" autocomplete="off" /></FormField>
            <FormField label="用户名" description="3-32 个英文、数字、下划线或连字符。" required><FormInput v-model="username" name="username" autocomplete="username" /></FormField>
            <FormField label="密码" description="至少 8 个字符。" required><FormInput v-model="password" name="password" type="password" autocomplete="new-password" :minlength="8" /></FormField>
            <p v-if="errorMsg" class="text-sm text-[var(--status-danger)]">{{ errorMsg }}</p>
            <Button type="submit" block :loading="busy">注册</Button>
            <!-- GitHub OAuth 入口：未绑定账号会进补全注册（同样需要注册码，免设密码） -->
            <div v-if="githubOAuthEnabled" class="flex items-center gap-2 text-xs text-[var(--text-muted)]"><span class="h-px flex-1 bg-[var(--border-color)]"></span>或<span class="h-px flex-1 bg-[var(--border-color)]"></span></div>
            <Button v-if="githubOAuthEnabled" type="button" variant="secondary" block @click="startGitHubRegister"><span class="i-lucide-github h-4 w-4"></span>使用 GitHub 注册</Button>
            <NuxtLink to="/login" class="block text-center text-sm text-[var(--accent-text)] hover:underline">已有账号？去登录</NuxtLink>
        </Panel>
    </main>
</template>
