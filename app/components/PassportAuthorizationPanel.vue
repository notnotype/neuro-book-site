<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import type {AuthorizationDto} from "../../shared/dto/passport.dto";

// 已连接实例面板（spec §8）：列表 / 重命名 / 吊销。吊销是公网实例失守时的自救手段。

const api = useWorkshopApi();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const {t} = useI18n();
const {formatDateTime} = useLocaleFormat();
const {describeScope} = usePassportScopes();

const authorizations = ref<AuthorizationDto[]>([]);
const loading = ref(false);
const errorMsg = ref("");
const showRevoked = ref(false);

// 行内重命名状态：editingId 为空表示没有行处于编辑中
const editingId = ref<number | null>(null);
const editingName = ref("");
// 两步确认吊销：第一次点击进入确认态，再次点击执行
const confirmRevokeId = ref<number | null>(null);
const acting = ref(false);

const visible = computed(() => showRevoked.value ? authorizations.value : authorizations.value.filter((auth) => auth.revokedAt === null));
const revokedCount = computed(() => authorizations.value.filter((auth) => auth.revokedAt !== null).length);

async function load(): Promise<void> {
    loading.value = true;
    errorMsg.value = "";
    try {
        authorizations.value = await api.listAuthorizations();
    } catch (error) {
        errorMsg.value = localizedError.resolve(error, "common.loadFailed");
    } finally {
        loading.value = false;
    }
}

function startRename(auth: AuthorizationDto): void {
    editingId.value = auth.id;
    editingName.value = auth.instanceName;
}

async function saveRename(auth: AuthorizationDto): Promise<void> {
    const name = editingName.value.trim();
    if (!name || name === auth.instanceName) {
        editingId.value = null;
        return;
    }
    acting.value = true;
    try {
        const updated = await api.renameAuthorization(auth.id, name);
        authorizations.value = authorizations.value.map((item) => item.id === updated.id ? updated : item);
        editingId.value = null;
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.renameFailed"));
    } finally {
        acting.value = false;
    }
}

async function revoke(auth: AuthorizationDto): Promise<void> {
    if (confirmRevokeId.value !== auth.id) {
        confirmRevokeId.value = auth.id;
        return;
    }
    acting.value = true;
    try {
        await api.revokeAuthorization(auth.id);
        notification.success(t("passport.revokedSuccess"));
        confirmRevokeId.value = null;
        await load();
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.revokeFailed"));
    } finally {
        acting.value = false;
    }
}

/** 时间展示：精确到分钟即可 */
function formatTime(iso: string | null): string {
    if (!iso) {
        return t("passport.neverUsed");
    }
    return formatDateTime(iso);
}

onMounted(() => void load());
</script>

<template>
    <!-- 已连接实例列表 -->
    <div class="flex flex-col gap-4">
        <p class="text-sm text-[var(--text-muted)]">{{ t("passport.description") }}</p>

        <StateBlock v-if="loading && authorizations.length === 0" state="loading" />
        <StateBlock v-else-if="errorMsg && authorizations.length === 0" state="error" :message="errorMsg" :retry="load" />
        <StateBlock v-else-if="visible.length === 0" state="empty" :message="t('passport.empty')" />

        <ul v-else class="flex flex-col gap-3">
            <li v-for="auth in visible" :key="auth.id" class="flex flex-col gap-2 rounded-xl border border-[var(--border-color)] p-4" :class="auth.revokedAt ? 'opacity-60' : ''">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="i-lucide-monitor-smartphone h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
                    <template v-if="editingId === auth.id">
                        <FormInput v-model="editingName" name="instanceName" class="w-56" @keydown.enter="saveRename(auth)" />
                        <Button size="sm" :loading="acting" @click="saveRename(auth)">{{ t("common.save") }}</Button>
                        <Button size="sm" variant="subtle" @click="editingId = null">{{ t("common.cancel") }}</Button>
                    </template>
                    <template v-else>
                        <span class="font-medium text-[var(--text-main)]">{{ auth.instanceName }}</span>
                        <span v-if="auth.revokedAt" class="rounded px-1.5 py-0.5 text-xs text-[var(--status-danger)]">{{ t("passport.revoked") }}</span>
                    </template>
                    <span class="ml-auto text-xs text-[var(--text-muted)]">{{ t("passport.linkedAt", {time: formatTime(auth.createdAt)}) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                    <span v-for="scope in auth.scopes" :key="scope" class="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-xs text-[var(--text-muted)]" :title="describeScope(scope).detail">{{ describeScope(scope).label }}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-xs text-[var(--text-muted)]">{{ t("passport.lastUsed", {time: formatTime(auth.lastUsedAt)}) }}</span>
                    <template v-if="!auth.revokedAt">
                        <span class="flex-1"></span>
                        <Button size="sm" variant="subtle" :disabled="acting" @click="startRename(auth)"><span class="i-lucide-pencil h-3.5 w-3.5"></span>{{ t("passport.rename") }}</Button>
                        <Button size="sm" :variant="confirmRevokeId === auth.id ? 'danger' : 'subtle'" :loading="acting && confirmRevokeId === auth.id" @click="revoke(auth)">
                            <span class="i-lucide-shield-off h-3.5 w-3.5"></span>{{ confirmRevokeId === auth.id ? t("passport.confirmRevoke") : t("passport.revoke") }}
                        </Button>
                    </template>
                </div>
            </li>
        </ul>

        <button v-if="revokedCount > 0" class="self-start text-xs text-[var(--text-muted)] hover:underline" @click="showRevoked = !showRevoked">
            {{ t(showRevoked ? "passport.hideRevoked" : "passport.showRevoked", {count: revokedCount}) }}
        </button>
    </div>
</template>
