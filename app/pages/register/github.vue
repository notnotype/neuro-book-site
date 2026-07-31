<script setup lang="ts">
import {nextTick, reactive, ref} from "vue";
import type {PendingOAuthDto} from "../../../shared/dto/auth.dto";
import {OAuthRegisterRequestDtoSchema, type OAuthRegisterRequestDto} from "../../../shared/auth-schema";
import {normalizeValidationIssues} from "../../../shared/validation-issues";
import {isRuntimeFlagEnabled} from "~/utils/runtime-flag";

type OAuthField = keyof OAuthRegisterRequestDto;

definePageMeta({layout: false});

const {t} = useI18n();
useHead(() => ({title: t("auth.completeGithub")}));

const api = useWorkshopApi();
const {refresh} = useAuthState();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const publicConfig = useRuntimeConfig().public;
const formRef = ref<HTMLFormElement | null>(null);
const pending = ref<PendingOAuthDto | null>(null);
const loading = ref(true);
const missing = ref(false);
const displayName = ref("");
const username = ref("");
const registrationCode = ref("");
const inviteCode = ref("");
const busy = ref(false);
const errorMsg = ref("");
const fieldErrors = reactive<{[field in OAuthField]?: string}>({});
const fieldOrder: OAuthField[] = ["displayName", "username", "registrationCode", "inviteCode"];

onMounted(async () => {
    if (!isRuntimeFlagEnabled(publicConfig.githubOAuthEnabled) || !isRuntimeFlagEnabled(publicConfig.registrationEnabled)) {
        await navigateTo("/login", {replace: true});
        return;
    }
    try {
        pending.value = await api.getPendingOAuth();
        displayName.value = pending.value.displayName || pending.value.providerUsername;
        username.value = pending.value.suggestedUsername;
        registrationCode.value = sessionStorage.getItem("nbook-registration-code") ?? "";
        inviteCode.value = sessionStorage.getItem("nbook-invite-code") ?? "";
    } catch {
        missing.value = true;
    } finally {
        loading.value = false;
    }
});

function values(): OAuthRegisterRequestDto {
    return {
        displayName: displayName.value,
        username: username.value,
        registrationCode: registrationCode.value,
        inviteCode: inviteCode.value || undefined,
    };
}

function validateField(field: OAuthField): void {
    delete fieldErrors[field];
    const result = OAuthRegisterRequestDtoSchema.safeParse(values());
    if (!result.success) {
        const issue = normalizeValidationIssues(result.error.issues).find((item) => item.path === field);
        if (issue) {
            fieldErrors[field] = localizedError.issueMessage(issue);
        }
    }
}

async function focusFirstError(): Promise<void> {
    await nextTick();
    // 等提交按钮结束 disabled/loading 的当前事件循环，避免按钮复原时抢回焦点。
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const first = fieldOrder.find((field) => fieldErrors[field]);
    if (first) {
        formRef.value?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    }
}

async function submit(): Promise<void> {
    busy.value = true;
    errorMsg.value = "";
    let shouldFocusError = false;
    for (const field of fieldOrder) {
        delete fieldErrors[field];
    }
    try {
        const result = OAuthRegisterRequestDtoSchema.safeParse(values());
        if (!result.success) {
            for (const issue of normalizeValidationIssues(result.error.issues)) {
                if (issue.path && !fieldErrors[issue.path as OAuthField]) {
                    fieldErrors[issue.path as OAuthField] = localizedError.issueMessage(issue);
                }
            }
            shouldFocusError = true;
            return;
        }
        await api.completeOAuthRegister(result.data);
        sessionStorage.removeItem("nbook-registration-code");
        sessionStorage.removeItem("nbook-invite-code");
        await refresh();
        notification.success(t("auth.registerWelcome"));
        await navigateTo("/");
    } catch (error) {
        const resolved = localizedError.form(error, "auth.registerFailed");
        Object.assign(fieldErrors, resolved.fields);
        errorMsg.value = resolved.message;
        shouldFocusError = true;
    } finally {
        busy.value = false;
        if (shouldFocusError) {
            await focusFirstError();
        }
    }
}
</script>

<template>
    <main class="relative flex min-h-screen items-center justify-center bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <div class="absolute right-4 top-4"><LocaleSwitcher /></div>
        <Panel class="w-full max-w-sm space-y-4">
            <NuxtLink to="/" class="flex items-center justify-center gap-2 font-semibold"><span class="i-lucide-box h-5 w-5 text-[var(--accent-main)]"></span>NeuroBook</NuxtLink>
            <StateBlock v-if="loading" state="loading" :message="t('common.loading')" />
            <template v-else-if="missing">
                <StateBlock state="empty" :message="t('auth.pendingMissing')" />
                <NuxtLink to="/login" class="block"><Button variant="secondary" block>{{ t("auth.pendingRestart") }}</Button></NuxtLink>
            </template>
            <form v-else-if="pending" ref="formRef" class="space-y-4" @submit.prevent="submit">
                <h1 class="text-center text-lg font-semibold">{{ t("auth.completeRegistration") }}</h1>
                <div class="flex items-center gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2.5">
                    <UserAvatar :username="pending.providerUsername" :avatar-url="pending.avatarUrl" :size="36" />
                    <div class="min-w-0 text-sm">
                        <p class="truncate font-medium text-[var(--text-main)]"><span class="i-lucide-github mr-1 inline-block h-3.5 w-3.5 align-[-2px]"></span>@{{ pending.providerUsername }}</p>
                        <p class="text-xs text-[var(--text-muted)]">{{ t("auth.githubLoginDescription") }}</p>
                    </div>
                </div>
                <FormField :label="t('auth.displayName')" :description="t('auth.displayNameDescription')" :error="fieldErrors.displayName" required><FormInput v-model="displayName" name="displayName" autocomplete="name" :maxlength="50" @blur="validateField('displayName')" /></FormField>
                <FormField :label="t('auth.accountName')" :description="t('auth.accountNameDescription')" :error="fieldErrors.username" required><FormInput v-model="username" name="username" autocomplete="username" :maxlength="32" autocapitalize="none" spellcheck="false" @blur="validateField('username')" /></FormField>
                <FormField :label="t('auth.registrationCode')" :error="fieldErrors.registrationCode" required><FormInput v-model="registrationCode" name="registrationCode" autocomplete="off" :maxlength="100" @blur="validateField('registrationCode')" /></FormField>
                <FormField :label="t('auth.inviteCode')" :error="fieldErrors.inviteCode"><FormInput v-model="inviteCode" name="inviteCode" autocomplete="off" :maxlength="100" @blur="validateField('inviteCode')" /></FormField>
                <p v-if="errorMsg" role="alert" class="text-sm text-[var(--status-danger)]">{{ errorMsg }}</p>
                <Button type="submit" block :loading="busy">{{ t("auth.registerAction") }}</Button>
                <NuxtLink to="/login" class="block text-center text-sm text-[var(--accent-text)] hover:underline">{{ t("auth.useAnotherLogin") }}</NuxtLink>
            </form>
        </Panel>
    </main>
</template>
