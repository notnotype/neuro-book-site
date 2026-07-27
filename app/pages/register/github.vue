<script setup lang="ts">
import {onMounted, ref} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {PendingOAuthDto} from "../../../shared/dto/auth.dto";

// GitHub 补全注册页：/auth/github 未绑定且未登录时跳来。
// pending 身份在 sealed session cookie 里，这里只补用户名 + 邀请码（免设密码）。
definePageMeta({layout: false});
useHead({title: "完成 GitHub 注册"});

const api = useWorkshopApi();
const {refresh} = useAuthState();
const notification = useNotification();
const publicConfig = useRuntimeConfig().public;

const pending = ref<PendingOAuthDto | null>(null);
const loading = ref(true);
const missing = ref(false); // 无 pending（直接访问 / 会话过期）

const username = ref("");
const inviteCode = ref("");
const busy = ref(false);
const errorMsg = ref("");

onMounted(async () => {
    if (publicConfig.githubOAuthEnabled !== true || publicConfig.registrationEnabled !== true) {
        await navigateTo("/login", {replace: true});
        return;
    }
    try {
        pending.value = await api.getPendingOAuth();
        username.value = pending.value.suggestedUsername;
    } catch {
        missing.value = true;
    } finally {
        loading.value = false;
    }
});

async function submit(): Promise<void> {
    busy.value = true;
    errorMsg.value = "";
    try {
        await api.completeOAuthRegister({username: username.value, inviteCode: inviteCode.value.trim()});
        await refresh();
        notification.success("注册成功，欢迎加入");
        await navigateTo("/");
    } catch (error) {
        errorMsg.value = resolveApiErrorMessage(error, "注册失败");
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <main class="flex min-h-screen items-center justify-center bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <Panel class="w-full max-w-sm space-y-4">
            <NuxtLink to="/" class="flex items-center justify-center gap-2 font-semibold">
                <span class="i-lucide-box h-5 w-5 text-[var(--accent-main)]"></span>NeuroBook
            </NuxtLink>

            <StateBlock v-if="loading" state="loading" />

            <!-- 直接访问 / pending 过期：引导回登录页重新发起 -->
            <template v-else-if="missing">
                <StateBlock state="empty" message="没有待完成的 GitHub 注册" />
                <NuxtLink to="/login" class="block"><Button variant="secondary" block>回登录页重新发起</Button></NuxtLink>
            </template>

            <form v-else-if="pending" class="space-y-4" @submit.prevent="submit">
                <h1 class="text-center text-lg font-semibold">完成注册</h1>
                <!-- GitHub 身份确认卡 -->
                <div class="flex items-center gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2.5">
                    <UserAvatar :username="pending.providerUsername" :avatar-url="pending.avatarUrl" :size="36" />
                    <div class="min-w-0 text-sm">
                        <p class="truncate font-medium text-[var(--text-main)]"><span class="i-lucide-github mr-1 inline-block h-3.5 w-3.5 align-[-2px]"></span>@{{ pending.providerUsername }}</p>
                        <p class="text-xs text-[var(--text-muted)]">将作为你的 GitHub 登录方式，无需设置密码</p>
                    </div>
                </div>
                <FormField label="用户名" description="3-32 个英文、数字、下划线或连字符，注册后不可修改。" required><FormInput v-model="username" name="username" autocomplete="username" /></FormField>
                <FormField label="邀请码" description="注册需要管理员签发的邀请码。" required><FormInput v-model="inviteCode" name="inviteCode" autocomplete="off" /></FormField>
                <p v-if="errorMsg" class="text-sm text-[var(--status-danger)]">{{ errorMsg }}</p>
                <Button type="submit" block :loading="busy">创建账号</Button>
                <NuxtLink to="/login" class="block text-center text-sm text-[var(--accent-text)] hover:underline">改用其他方式登录</NuxtLink>
            </form>
        </Panel>
    </main>
</template>
