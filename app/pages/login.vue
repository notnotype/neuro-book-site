<script setup lang="ts">
import {isRuntimeFlagEnabled} from "~/utils/runtime-flag";

definePageMeta({layout: false});

const {t} = useI18n();
useHead(() => ({title: t("auth.loginTitle")}));

const {refresh} = useAuthState();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const route = useRoute();
const publicConfig = useRuntimeConfig().public;
const registrationEnabled = computed(() => isRuntimeFlagEnabled(publicConfig.registrationEnabled));
const githubOAuthEnabled = computed(() => isRuntimeFlagEnabled(publicConfig.githubOAuthEnabled));
const username = ref("");
const password = ref("");
const busy = ref(false);
const errorMsg = ref("");

onMounted(() => {
    if (route.query.error === "disabled") {
        errorMsg.value = t("auth.disabled");
    } else if (route.query.error === "oauth") {
        errorMsg.value = t("auth.oauthFailed");
    }
});

/** 回跳地址只接受站内路径，避免开放跳转。 */
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
        notification.success(t("auth.loginSuccess"));
        await navigateTo(redirectTarget());
    } catch (error) {
        errorMsg.value = localizedError.resolve(error, "auth.loginFailed");
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <main class="relative flex min-h-screen items-center justify-center bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <div class="absolute right-4 top-4"><LocaleSwitcher /></div>
        <Panel as="form" class="w-full max-w-sm space-y-4" @submit.prevent="submit">
            <NuxtLink to="/" class="flex items-center justify-center gap-2 font-semibold"><span class="i-lucide-box h-5 w-5 text-[var(--accent-main)]"></span>NeuroBook</NuxtLink>
            <h1 class="text-center text-lg font-semibold">{{ t("auth.loginTitle") }}</h1>
            <FormField :label="t('auth.accountName')" required><FormInput v-model="username" name="username" autocomplete="username" /></FormField>
            <FormField :label="t('auth.password')" required><FormInput v-model="password" name="password" type="password" autocomplete="current-password" /></FormField>
            <p v-if="errorMsg" role="alert" class="text-sm text-[var(--status-danger)]">{{ errorMsg }}</p>
            <Button type="submit" block :loading="busy">{{ t("auth.loginAction") }}</Button>
            <div v-if="githubOAuthEnabled" class="flex items-center gap-2 text-xs text-[var(--text-muted)]"><span class="h-px flex-1 bg-[var(--border-color)]"></span>{{ t("auth.or") }}<span class="h-px flex-1 bg-[var(--border-color)]"></span></div>
            <a v-if="githubOAuthEnabled" href="/auth/github" class="block"><Button type="button" variant="secondary" block><span class="i-lucide-github h-4 w-4"></span>{{ t("auth.githubLogin") }}</Button></a>
            <NuxtLink v-if="registrationEnabled" to="/register" class="block text-center text-sm text-[var(--accent-text)] hover:underline">{{ t("auth.noAccount") }}</NuxtLink>
        </Panel>
    </main>
</template>
