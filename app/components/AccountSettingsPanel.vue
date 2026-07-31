<script setup lang="ts">
import {computed, onMounted, reactive, ref} from "vue";
import type {MeProfileDto} from "../../shared/dto/auth.dto";
import type {PassportIdentityDto} from "../../shared/dto/passport.dto";
import {isRuntimeFlagEnabled} from "~/utils/runtime-flag";

// 账号设置面板（/me「账号设置」tab）：资料表单 / GitHub 绑定 / 密码三块。
const api = useWorkshopApi();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const {t} = useI18n();
const {formatDate} = useLocaleFormat();
const {refresh} = useAuthState();
const githubOAuthEnabled = computed(() => isRuntimeFlagEnabled(useRuntimeConfig().public.githubOAuthEnabled));

const profile = ref<MeProfileDto | null>(null);
const identities = ref<PassportIdentityDto[]>([]);
const loading = ref(false);
const loadError = ref("");

// ---- 资料表单（加载后从 profile 预填，整体提交） ----
const form = reactive({displayName: "", bio: "", websiteUrl: "", avatarUrl: ""});
const savingProfile = ref(false);

async function load(): Promise<void> {
    loading.value = true;
    loadError.value = "";
    try {
        const [me, ids] = await Promise.all([api.getMyProfile(), api.listIdentities()]);
        profile.value = me;
        identities.value = ids;
        form.displayName = me.displayName;
        form.bio = me.bio;
        form.websiteUrl = me.websiteUrl;
        form.avatarUrl = me.avatarUrl;
    } catch (error) {
        loadError.value = localizedError.resolve(error, "common.loadFailed");
    } finally {
        loading.value = false;
    }
}

async function saveProfile(): Promise<void> {
    savingProfile.value = true;
    try {
        profile.value = await api.updateMyProfile({...form});
        await refresh(); // 服务端已重写 session，刷新顶栏昵称/头像
        notification.success(t("account.profileSaved"));
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.saveFailed"));
    } finally {
        savingProfile.value = false;
    }
}

// ---- GitHub 绑定 ----
const githubIdentity = computed(() => identities.value.find((identity) => identity.provider === "github") ?? null);
const confirmingUnlink = ref(false); // 两步确认
const unlinking = ref(false);

async function unlinkGithub(): Promise<void> {
    const identity = githubIdentity.value;
    if (!identity) {
        return;
    }
    unlinking.value = true;
    try {
        await api.unlinkIdentity(identity.id);
        identities.value = identities.value.filter((row) => row.id !== identity.id);
        confirmingUnlink.value = false;
        notification.success(t("account.unlinked"));
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.actionFailed"));
    } finally {
        unlinking.value = false;
    }
}

// ---- 密码：hasPassword 时验旧密修改；免密账号（GitHub 注册）直接补设 ----
const password = reactive({current: "", next: "", confirm: ""});
const savingPassword = ref(false);

async function submitPassword(): Promise<void> {
    if (password.next !== password.confirm) {
        notification.error(t("account.passwordMismatch"));
        return;
    }
    savingPassword.value = true;
    try {
        await api.changePassword({
            ...(profile.value?.hasPassword ? {currentPassword: password.current} : {}),
            newPassword: password.next,
        });
        password.current = "";
        password.next = "";
        password.confirm = "";
        notification.success(profile.value?.hasPassword ? t("account.passwordChanged") : t("account.passwordSet"));
        await load(); // 刷新 hasPassword（补设后解锁解绑）
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.actionFailed"));
    } finally {
        savingPassword.value = false;
    }
}

onMounted(load);
</script>

<template>
    <StateBlock v-if="loading && !profile" state="loading" />
    <StateBlock v-else-if="loadError && !profile" state="error" :message="loadError" :retry="load" />

    <div v-else-if="profile" class="flex flex-col gap-5">
        <!-- 资料表单 -->
        <Panel as="form" class="space-y-4" @submit.prevent="saveProfile">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]"><span class="i-lucide-id-card h-4 w-4 text-[var(--accent-main)]"></span>{{ t("account.profile") }}</h2>
            <div class="flex items-start gap-4">
                <UserAvatar :username="profile.username" :avatar-url="form.avatarUrl" :size="64" />
                <div class="min-w-0 flex-1 space-y-3">
                    <FormField :label="t('auth.accountName')" :description="t('account.accountNameDescription')"><FormInput :model-value="profile.username" name="username" disabled /></FormField>
                    <FormField :label="t('auth.displayName')" required><FormInput v-model="form.displayName" name="displayName" :maxlength="50" /></FormField>
                </div>
            </div>
            <FormField :label="t('account.bio')" :description="t('account.bioDescription')"><FormTextarea v-model="form.bio" :rows="3" :maxlength="200" /></FormField>
            <FormField :label="t('account.website')" :description="t('account.websiteDescription')"><FormInput v-model="form.websiteUrl" name="websiteUrl" placeholder="https://example.com" /></FormField>
            <FormField :label="t('account.avatarUrl')" :description="t('account.avatarDescription')"><FormInput v-model="form.avatarUrl" name="avatarUrl" placeholder="https://…/avatar.png" /></FormField>
            <div class="flex justify-end"><Button type="submit" :loading="savingProfile">{{ t("account.saveProfile") }}</Button></div>
        </Panel>

        <!-- GitHub 绑定 -->
        <Panel v-if="githubOAuthEnabled" class="space-y-3">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]"><span class="i-lucide-github h-4 w-4 text-[var(--accent-main)]"></span>{{ t("account.githubAccount") }}</h2>
            <template v-if="githubIdentity">
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2.5">
                    <div class="min-w-0 text-sm">
                        <p class="truncate font-medium text-[var(--text-main)]">@{{ githubIdentity.providerUsername }}</p>
                        <p class="text-xs text-[var(--text-muted)]">{{ t("account.githubBoundAt", {date: formatDate(githubIdentity.createdAt)}) }}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <template v-if="confirmingUnlink">
                            <Button size="sm" variant="danger" :loading="unlinking" @click="unlinkGithub">{{ t("account.confirmUnlink") }}</Button>
                            <Button size="sm" variant="subtle" @click="confirmingUnlink = false">{{ t("common.cancel") }}</Button>
                        </template>
                        <Button v-else size="sm" variant="secondary" :disabled="!profile.hasPassword" @click="confirmingUnlink = true">{{ t("account.unlink") }}</Button>
                    </div>
                </div>
                <p v-if="!profile.hasPassword" class="text-xs text-[var(--status-warning)]">{{ t("account.unlinkWarning") }}</p>
            </template>
            <template v-else>
                <p class="text-sm text-[var(--text-secondary)]">{{ t("account.githubBindDescription") }}</p>
                <a href="/auth/github" class="inline-flex"><Button size="sm" variant="secondary"><span class="i-lucide-github h-4 w-4"></span>{{ t("account.bindGithub") }}</Button></a>
            </template>
        </Panel>

        <!-- 密码 -->
        <Panel as="form" class="space-y-4" @submit.prevent="submitPassword">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]"><span class="i-lucide-key-round h-4 w-4 text-[var(--accent-main)]"></span>{{ profile.hasPassword ? t("account.changePassword") : t("account.setPassword") }}</h2>
            <p v-if="!profile.hasPassword" class="text-sm text-[var(--text-secondary)]">{{ t("account.oauthPasswordDescription") }}</p>
            <FormField v-if="profile.hasPassword" :label="t('account.currentPassword')" required><FormInput v-model="password.current" name="currentPassword" type="password" autocomplete="current-password" /></FormField>
            <FormField :label="t('account.newPassword')" :description="t('account.newPasswordDescription')" required><FormInput v-model="password.next" name="newPassword" type="password" autocomplete="new-password" /></FormField>
            <FormField :label="t('account.confirmNewPassword')" required><FormInput v-model="password.confirm" name="confirmPassword" type="password" autocomplete="new-password" /></FormField>
            <div class="flex items-center justify-between gap-3">
                <p class="text-xs text-[var(--text-muted)]">{{ profile.hasPassword ? t("account.otherDevicesLogout") : "" }}</p>
                <Button type="submit" :loading="savingPassword" :disabled="password.next.length === 0">{{ profile.hasPassword ? t("account.changePassword") : t("account.setPassword") }}</Button>
            </div>
        </Panel>
    </div>
</template>
