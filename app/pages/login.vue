<script setup lang="ts">
import {nextTick, reactive, ref} from "vue";
import {LoginRequestDtoSchema, type LoginRequestDto} from "../../shared/auth-schema";
import type {AuthSessionDto} from "../../shared/dto/auth.dto";
import type {ApiErrorSnapshot} from "../composables/useLocalizedApiError";
import {normalizeValidationIssues} from "../../shared/validation-issues";
import {isRuntimeFlagEnabled} from "~/utils/runtime-flag";

type LoginField = keyof LoginRequestDto;

definePageMeta({layout: false});

const {t, locale} = useI18n();
useHead(() => ({title: t("auth.loginTitle")}));

const {applySession} = useAuthState();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const route = useRoute();
const publicConfig = useRuntimeConfig().public;
const registrationEnabled = computed(() => isRuntimeFlagEnabled(publicConfig.registrationEnabled));
const githubOAuthEnabled = computed(() => isRuntimeFlagEnabled(publicConfig.githubOAuthEnabled));
const formRef = ref<HTMLFormElement | null>(null);
const username = ref("");
const password = ref("");
const busy = ref(false);
const errorMsg = ref("");
const routeErrorKey = ref<"" | "auth.disabled" | "auth.oauthFailed">("");
const lastServerError = ref<ApiErrorSnapshot | null>(null);
const fieldErrors = reactive<{[field in LoginField]?: string}>({});
const fieldOrder: LoginField[] = ["username", "password"];

onMounted(() => {
    if (route.query.error === "disabled") {
        routeErrorKey.value = "auth.disabled";
    } else if (route.query.error === "oauth") {
        routeErrorKey.value = "auth.oauthFailed";
    }
    if (routeErrorKey.value) errorMsg.value = t(routeErrorKey.value);
});

/** 回跳地址只接受站内路径，避免开放跳转。 */
function redirectTarget(): string {
    const raw = route.query.redirect;
    const value = typeof raw === "string" ? raw : "";
    return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

/** 读取登录表单当前值。 */
function values(): LoginRequestDto {
    return {username: username.value, password: password.value};
}

/** 校验一个已触碰字段，不提前显示其它字段的问题。 */
function validateField(field: LoginField): void {
    delete fieldErrors[field];
    const result = LoginRequestDtoSchema.safeParse(values());
    if (!result.success) {
        const issue = normalizeValidationIssues(result.error.issues).find((item) => item.path === field);
        if (issue) fieldErrors[field] = localizedError.issueMessage(issue);
    }
}

/** 校验完整登录表单并写回字段错误。 */
function validateForm(): ReturnType<typeof LoginRequestDtoSchema.safeParse> {
    for (const field of fieldOrder) delete fieldErrors[field];
    const result = LoginRequestDtoSchema.safeParse(values());
    if (!result.success) {
        for (const issue of normalizeValidationIssues(result.error.issues)) {
            if (issue.path && !fieldErrors[issue.path as LoginField]) {
                fieldErrors[issue.path as LoginField] = localizedError.issueMessage(issue);
            }
        }
    }
    return result;
}

/** 聚焦第一个错误字段。 */
async function focusFirstError(): Promise<void> {
    await nextTick();
    const first = fieldOrder.find((field) => fieldErrors[field]);
    if (first) formRef.value?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
}

/** 语言切换时只重绘当前可见错误，不唤醒未触碰字段。 */
function retranslateVisibleErrors(): void {
    const visibleFields = fieldOrder.filter((field) => fieldErrors[field]);
    const hadMessage = errorMsg.value !== "";
    for (const field of visibleFields) validateField(field);
    if (!lastServerError.value) {
        if (routeErrorKey.value && hadMessage) errorMsg.value = t(routeErrorKey.value);
        return;
    }
    const resolved = localizedError.form(lastServerError.value, "auth.loginFailed");
    for (const field of visibleFields) {
        if (!fieldErrors[field] && resolved.fields[field]) fieldErrors[field] = resolved.fields[field];
    }
    if (hadMessage) errorMsg.value = resolved.message;
}

watch(locale, retranslateVisibleErrors);

async function submit(): Promise<void> {
    busy.value = true;
    errorMsg.value = "";
    routeErrorKey.value = "";
    lastServerError.value = null;
    let shouldFocusError = false;
    try {
        const result = validateForm();
        if (!result.success) {
            shouldFocusError = true;
            return;
        }
        const session = await $fetch<AuthSessionDto>("/api/auth/login", {method: "POST", body: result.data});
        applySession(session);
        notification.success(t("auth.loginSuccess"));
        await navigateTo(redirectTarget());
    } catch (error) {
        lastServerError.value = localizedError.snapshot(error);
        const resolved = localizedError.form(lastServerError.value, "auth.loginFailed");
        Object.assign(fieldErrors, resolved.fields);
        errorMsg.value = resolved.message;
        shouldFocusError = true;
    } finally {
        busy.value = false;
        if (shouldFocusError) await focusFirstError();
    }
}
</script>

<template>
    <main class="relative flex min-h-screen items-center justify-center bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <div class="absolute right-4 top-4"><LocaleSwitcher /></div>
        <Panel class="w-full max-w-sm">
            <form ref="formRef" class="space-y-4" novalidate @submit.prevent="submit">
                <NuxtLink to="/" class="flex items-center justify-center gap-2 font-semibold"><span class="i-lucide-box h-5 w-5 text-[var(--accent-main)]"></span>NeuroBook</NuxtLink>
                <h1 class="text-center text-lg font-semibold">{{ t("auth.loginTitle") }}</h1>
                <FormField :label="t('auth.accountName')" :error="fieldErrors.username" required><FormInput v-model="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" @blur="validateField('username')" /></FormField>
                <FormField :label="t('auth.password')" :error="fieldErrors.password" required><FormInput v-model="password" name="password" type="password" autocomplete="current-password" @blur="validateField('password')" /></FormField>
                <p v-if="errorMsg" role="alert" class="text-sm text-[var(--status-danger)]">{{ errorMsg }}</p>
                <Button type="submit" block :loading="busy">{{ t("auth.loginAction") }}</Button>
                <div v-if="githubOAuthEnabled" class="flex items-center gap-2 text-xs text-[var(--text-muted)]"><span class="h-px flex-1 bg-[var(--border-color)]"></span>{{ t("auth.or") }}<span class="h-px flex-1 bg-[var(--border-color)]"></span></div>
                <a v-if="githubOAuthEnabled" href="/auth/github" class="block"><Button type="button" variant="secondary" block><span class="i-lucide-github h-4 w-4"></span>{{ t("auth.githubLogin") }}</Button></a>
                <NuxtLink v-if="registrationEnabled" to="/register" class="block text-center text-sm text-[var(--accent-text)] hover:underline">{{ t("auth.noAccount") }}</NuxtLink>
            </form>
        </Panel>
    </main>
</template>
