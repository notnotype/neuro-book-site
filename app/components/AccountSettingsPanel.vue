<script setup lang="ts">
import {computed, onMounted, reactive, ref} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {MeProfileDto} from "../../shared/dto/auth.dto";
import type {PassportIdentityDto} from "../../shared/dto/passport.dto";
import {isRuntimeFlagEnabled} from "~/utils/runtime-flag";

// 账号设置面板（/me「账号设置」tab）：资料表单 / GitHub 绑定 / 密码三块。
const api = useWorkshopApi();
const notification = useNotification();
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
        loadError.value = resolveApiErrorMessage(error, "加载失败");
    } finally {
        loading.value = false;
    }
}

async function saveProfile(): Promise<void> {
    savingProfile.value = true;
    try {
        profile.value = await api.updateMyProfile({...form});
        await refresh(); // 服务端已重写 session，刷新顶栏昵称/头像
        notification.success("资料已保存");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "保存失败"));
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
        notification.success("已解绑 GitHub 账号");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "解绑失败"));
    } finally {
        unlinking.value = false;
    }
}

// ---- 密码：hasPassword 时验旧密修改；免密账号（GitHub 注册）直接补设 ----
const password = reactive({current: "", next: "", confirm: ""});
const savingPassword = ref(false);

async function submitPassword(): Promise<void> {
    if (password.next !== password.confirm) {
        notification.error("两次输入的新密码不一致");
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
        notification.success(profile.value?.hasPassword ? "密码已修改，其他设备需重新登录" : "密码已设置，现在可以用密码登录了");
        await load(); // 刷新 hasPassword（补设后解锁解绑）
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "操作失败"));
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
            <h2 class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]"><span class="i-lucide-id-card h-4 w-4 text-[var(--accent-main)]"></span>个人资料</h2>
            <div class="flex items-start gap-4">
                <UserAvatar :username="profile.username" :avatar-url="form.avatarUrl" :size="64" />
                <div class="min-w-0 flex-1 space-y-3">
                    <FormField label="用户名" description="用户名是登录与主页地址标识，不可修改。"><FormInput :model-value="profile.username" name="username" disabled /></FormField>
                    <FormField label="昵称" required><FormInput v-model="form.displayName" name="displayName" :maxlength="50" /></FormField>
                </div>
            </div>
            <FormField label="签名" description="最长 200 字，展示在你的公开主页。"><FormTextarea v-model="form.bio" :rows="3" :maxlength="200" /></FormField>
            <FormField label="个人网站" description="以 http(s):// 开头。"><FormInput v-model="form.websiteUrl" name="websiteUrl" placeholder="https://example.com" /></FormField>
            <FormField label="头像地址" description="以 http(s):// 开头的图片链接；绑定 GitHub 时会自动带入 GitHub 头像。"><FormInput v-model="form.avatarUrl" name="avatarUrl" placeholder="https://…/avatar.png" /></FormField>
            <div class="flex justify-end"><Button type="submit" :loading="savingProfile">保存资料</Button></div>
        </Panel>

        <!-- GitHub 绑定 -->
        <Panel v-if="githubOAuthEnabled" class="space-y-3">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]"><span class="i-lucide-github h-4 w-4 text-[var(--accent-main)]"></span>GitHub 账号</h2>
            <template v-if="githubIdentity">
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2.5">
                    <div class="min-w-0 text-sm">
                        <p class="truncate font-medium text-[var(--text-main)]">@{{ githubIdentity.providerUsername }}</p>
                        <p class="text-xs text-[var(--text-muted)]">绑定于 {{ formatDate(githubIdentity.createdAt) }}，可用 GitHub 一键登录</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <template v-if="confirmingUnlink">
                            <Button size="sm" variant="danger" :loading="unlinking" @click="unlinkGithub">确认解绑</Button>
                            <Button size="sm" variant="subtle" @click="confirmingUnlink = false">取消</Button>
                        </template>
                        <Button v-else size="sm" variant="secondary" :disabled="!profile.hasPassword" @click="confirmingUnlink = true">解绑</Button>
                    </div>
                </div>
                <p v-if="!profile.hasPassword" class="text-xs text-[var(--status-warning)]">当前账号未设置密码，GitHub 是唯一登录方式；先在下方设置密码后才能解绑。</p>
            </template>
            <template v-else>
                <p class="text-sm text-[var(--text-secondary)]">绑定后可用 GitHub 一键登录；账号没有头像时会自动带入 GitHub 头像。</p>
                <a href="/auth/github" class="inline-flex"><Button size="sm" variant="secondary"><span class="i-lucide-github h-4 w-4"></span>绑定 GitHub</Button></a>
            </template>
        </Panel>

        <!-- 密码 -->
        <Panel as="form" class="space-y-4" @submit.prevent="submitPassword">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]"><span class="i-lucide-key-round h-4 w-4 text-[var(--accent-main)]"></span>{{ profile.hasPassword ? "修改密码" : "设置密码" }}</h2>
            <p v-if="!profile.hasPassword" class="text-sm text-[var(--text-secondary)]">你通过 GitHub 注册，还没有密码。设置密码后可以用「用户名 + 密码」登录，也可以解绑 GitHub。</p>
            <FormField v-if="profile.hasPassword" label="当前密码" required><FormInput v-model="password.current" name="currentPassword" type="password" autocomplete="current-password" /></FormField>
            <FormField label="新密码" description="至少 8 位。" required><FormInput v-model="password.next" name="newPassword" type="password" autocomplete="new-password" /></FormField>
            <FormField label="确认新密码" required><FormInput v-model="password.confirm" name="confirmPassword" type="password" autocomplete="new-password" /></FormField>
            <div class="flex items-center justify-between gap-3">
                <p class="text-xs text-[var(--text-muted)]">{{ profile.hasPassword ? "修改成功后其他设备会被踢下线。" : "" }}</p>
                <Button type="submit" :loading="savingPassword" :disabled="password.next.length === 0">{{ profile.hasPassword ? "修改密码" : "设置密码" }}</Button>
            </div>
        </Panel>
    </div>
</template>
