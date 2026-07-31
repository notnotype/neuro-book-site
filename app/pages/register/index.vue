<script setup lang="ts">
import {nextTick, reactive, ref} from "vue";
import {RegisterFormSchema, type RegisterForm} from "../../../shared/auth-schema";
import type {AuthSessionDto} from "../../../shared/dto/auth.dto";
import type {ApiErrorSnapshot} from "../../composables/useLocalizedApiError";
import {normalizeValidationIssues} from "../../../shared/validation-issues";
import {isRuntimeFlagEnabled} from "~/utils/runtime-flag";

type RegisterField = keyof RegisterForm;

definePageMeta({layout: false, middleware: "registration-enabled"});

const {t, locale} = useI18n();
useHead(() => ({title: t("auth.registerTitle")}));

const {applySession} = useAuthState();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const route = useRoute();
const publicConfig = useRuntimeConfig().public;
const githubOAuthEnabled = computed(() => isRuntimeFlagEnabled(publicConfig.githubOAuthEnabled));
const formRef = ref<HTMLFormElement | null>(null);
const displayName = ref("");
const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const registrationCode = ref(typeof route.query.registrationCode === "string" ? route.query.registrationCode : "");
const inviteCode = ref(typeof route.query.inviteCode === "string" ? route.query.inviteCode : "");
const busy = ref(false);
const errorMsg = ref("");
const lastServerError = ref<ApiErrorSnapshot | null>(null);
const fieldErrors = reactive<{[field in RegisterField]?: string}>({});
const fieldOrder: RegisterField[] = ["displayName", "username", "password", "confirmPassword", "registrationCode", "inviteCode"];

/** 读取当前表单快照；邀请码空串在 HTTP 提交时省略。 */
function values(): RegisterForm {
    return {
        displayName: displayName.value,
        username: username.value,
        password: password.value,
        confirmPassword: confirmPassword.value,
        registrationCode: registrationCode.value,
        inviteCode: inviteCode.value || undefined,
    };
}

/** 校验单个字段，不提前展示其它尚未触碰字段的错误。 */
function validateField(field: RegisterField): void {
    delete fieldErrors[field];
    const result = RegisterFormSchema.safeParse(values());
    if (!result.success) {
        const issue = normalizeValidationIssues(result.error.issues).find((item) => item.path === field);
        if (issue) {
            fieldErrors[field] = localizedError.issueMessage(issue);
        }
    }
}

/** 将共享 schema 的全部问题写回字段。 */
function validateForm(): ReturnType<typeof RegisterFormSchema.safeParse> {
    for (const field of fieldOrder) {
        delete fieldErrors[field];
    }
    const result = RegisterFormSchema.safeParse(values());
    if (!result.success) {
        for (const issue of normalizeValidationIssues(result.error.issues)) {
            if (issue.path && !fieldErrors[issue.path as RegisterField]) {
                fieldErrors[issue.path as RegisterField] = localizedError.issueMessage(issue);
            }
        }
    }
    return result;
}

/** 聚焦第一个错误字段，便于键盘与读屏用户继续修正。 */
async function focusFirstError(): Promise<void> {
    await nextTick();
    // 等提交按钮结束 disabled/loading 的当前事件循环，避免按钮复原时抢回焦点。
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const first = fieldOrder.find((field) => fieldErrors[field]);
    if (first) {
        formRef.value?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    }
}

/** 语言切换时只重绘当前可见错误，不提前展示其它字段。 */
function retranslateVisibleErrors(): void {
    const visibleFields = fieldOrder.filter((field) => fieldErrors[field]);
    const hadMessage = errorMsg.value !== "";
    for (const field of visibleFields) validateField(field);
    if (!lastServerError.value) return;
    const resolved = localizedError.form(lastServerError.value, "auth.registerFailed");
    for (const field of visibleFields) {
        if (!fieldErrors[field] && resolved.fields[field]) fieldErrors[field] = resolved.fields[field];
    }
    if (hadMessage) errorMsg.value = resolved.message;
}

watch(locale, retranslateVisibleErrors);

async function submit(): Promise<void> {
    busy.value = true;
    errorMsg.value = "";
    lastServerError.value = null;
    let shouldFocusError = false;
    try {
        const result = validateForm();
        if (!result.success) {
            shouldFocusError = true;
            return;
        }
        const {confirmPassword: _confirmPassword, ...body} = result.data;
        const session = await $fetch<AuthSessionDto>("/api/auth/register", {method: "POST", body});
        applySession(session);
        notification.success(t("auth.registerSuccess"));
        await navigateTo("/");
    } catch (error) {
        lastServerError.value = localizedError.snapshot(error);
        const resolved = localizedError.form(lastServerError.value, "auth.registerFailed");
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

/** GitHub 往返期间用当前 tab 的 sessionStorage 保留分享链接中的两个码。 */
function startGitHubRegister(): void {
    sessionStorage.setItem("nbook-registration-code", registrationCode.value.trim());
    sessionStorage.setItem("nbook-invite-code", inviteCode.value.trim());
    window.location.href = "/auth/github";
}
</script>

<template>
    <main class="relative flex min-h-screen items-center justify-center bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <div class="absolute right-4 top-4"><LocaleSwitcher /></div>
        <Panel class="w-full max-w-sm">
            <form ref="formRef" class="space-y-4" novalidate @submit.prevent="submit">
            <NuxtLink to="/" class="flex items-center justify-center gap-2 font-semibold"><span class="i-lucide-box h-5 w-5 text-[var(--accent-main)]"></span>NeuroBook</NuxtLink>
            <h1 class="text-center text-lg font-semibold">{{ t("auth.registerTitle") }}</h1>
            <FormField :label="t('auth.displayName')" :description="t('auth.displayNameDescription')" :error="fieldErrors.displayName" required><FormInput v-model="displayName" name="displayName" autocomplete="name" :maxlength="50" @blur="validateField('displayName')" /></FormField>
            <FormField :label="t('auth.accountName')" :description="t('auth.accountNameDescription')" :error="fieldErrors.username" required><FormInput v-model="username" name="username" autocomplete="username" :maxlength="32" autocapitalize="none" spellcheck="false" @blur="validateField('username')" /></FormField>
            <FormField :label="t('auth.password')" :description="t('auth.passwordDescription')" :error="fieldErrors.password" required><FormInput v-model="password" name="password" type="password" autocomplete="new-password" :minlength="8" :maxlength="200" @blur="validateField('password')" /></FormField>
            <FormField :label="t('auth.confirmPassword')" :error="fieldErrors.confirmPassword" required><FormInput v-model="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" :maxlength="200" @blur="validateField('confirmPassword')" /></FormField>
            <FormField :label="t('auth.registrationCode')" :error="fieldErrors.registrationCode" required><FormInput v-model="registrationCode" name="registrationCode" autocomplete="off" :maxlength="100" autocapitalize="none" spellcheck="false" @blur="validateField('registrationCode')" /></FormField>
            <FormField :label="t('auth.inviteCode')" :error="fieldErrors.inviteCode"><FormInput v-model="inviteCode" name="inviteCode" autocomplete="off" :maxlength="100" autocapitalize="none" spellcheck="false" @blur="validateField('inviteCode')" /></FormField>
            <p v-if="errorMsg" role="alert" class="text-sm text-[var(--status-danger)]">{{ errorMsg }}</p>
            <Button type="submit" block :loading="busy">{{ t("auth.registerAction") }}</Button>
            <div v-if="githubOAuthEnabled" class="flex items-center gap-2 text-xs text-[var(--text-muted)]"><span class="h-px flex-1 bg-[var(--border-color)]"></span>{{ t("auth.or") }}<span class="h-px flex-1 bg-[var(--border-color)]"></span></div>
            <Button v-if="githubOAuthEnabled" type="button" variant="secondary" block @click="startGitHubRegister"><span class="i-lucide-github h-4 w-4"></span>{{ t("auth.githubRegister") }}</Button>
            <NuxtLink to="/login" class="block text-center text-sm text-[var(--accent-text)] hover:underline">{{ t("auth.hasAccount") }}</NuxtLink>
            </form>
        </Panel>
    </main>
</template>
