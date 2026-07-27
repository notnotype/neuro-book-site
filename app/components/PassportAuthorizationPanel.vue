<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {AuthorizationDto} from "../../shared/dto/passport.dto";
import {describeScope} from "../utils/passport-scopes";

// 已连接实例面板（spec §8）：列表 / 重命名 / 吊销。吊销是公网实例失守时的自救手段。

const api = useWorkshopApi();
const notification = useNotification();

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
        errorMsg.value = resolveApiErrorMessage(error, "加载失败");
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
        notification.error(resolveApiErrorMessage(error, "重命名失败"));
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
        notification.success("已吊销该实例的授权");
        confirmRevokeId.value = null;
        await load();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "吊销失败"));
    } finally {
        acting.value = false;
    }
}

/** 时间展示：精确到分钟即可 */
function formatTime(iso: string | null): string {
    if (!iso) {
        return "从未使用";
    }
    return new Date(iso).toLocaleString(undefined, {dateStyle: "short", timeStyle: "short"});
}

onMounted(() => void load());
</script>

<template>
    <!-- 已连接实例列表 -->
    <div class="flex flex-col gap-4">
        <p class="text-sm text-[var(--text-muted)]">通过设备码关联的 NeuroBook 实例。怀疑实例失守时，立即在这里吊销它的授权。</p>

        <StateBlock v-if="loading && authorizations.length === 0" state="loading" />
        <StateBlock v-else-if="errorMsg && authorizations.length === 0" state="error" :message="errorMsg" :retry="load" />
        <StateBlock v-else-if="visible.length === 0" state="empty" message="还没有关联任何实例。在 NeuroBook 实例的设置页发起「关联 NeuroBook 账号」即可。" />

        <ul v-else class="flex flex-col gap-3">
            <li v-for="auth in visible" :key="auth.id" class="flex flex-col gap-2 rounded-xl border border-[var(--border-color)] p-4" :class="auth.revokedAt ? 'opacity-60' : ''">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="i-lucide-monitor-smartphone h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
                    <template v-if="editingId === auth.id">
                        <FormInput v-model="editingName" name="instanceName" class="w-56" @keydown.enter="saveRename(auth)" />
                        <Button size="sm" :loading="acting" @click="saveRename(auth)">保存</Button>
                        <Button size="sm" variant="subtle" @click="editingId = null">取消</Button>
                    </template>
                    <template v-else>
                        <span class="font-medium text-[var(--text-main)]">{{ auth.instanceName }}</span>
                        <span v-if="auth.revokedAt" class="rounded px-1.5 py-0.5 text-xs text-[var(--status-danger)]">已吊销</span>
                    </template>
                    <span class="ml-auto text-xs text-[var(--text-muted)]">关联于 {{ formatTime(auth.createdAt) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                    <span v-for="scope in auth.scopes" :key="scope" class="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-xs text-[var(--text-muted)]" :title="describeScope(scope).detail">{{ describeScope(scope).label }}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-xs text-[var(--text-muted)]">最近使用：{{ formatTime(auth.lastUsedAt) }}</span>
                    <template v-if="!auth.revokedAt">
                        <span class="flex-1"></span>
                        <Button size="sm" variant="subtle" :disabled="acting" @click="startRename(auth)"><span class="i-lucide-pencil h-3.5 w-3.5"></span>重命名</Button>
                        <Button size="sm" :variant="confirmRevokeId === auth.id ? 'danger' : 'subtle'" :loading="acting && confirmRevokeId === auth.id" @click="revoke(auth)">
                            <span class="i-lucide-shield-off h-3.5 w-3.5"></span>{{ confirmRevokeId === auth.id ? "确认吊销？" : "吊销" }}
                        </Button>
                    </template>
                </div>
            </li>
        </ul>

        <button v-if="revokedCount > 0" class="self-start text-xs text-[var(--text-muted)] hover:underline" @click="showRevoked = !showRevoked">
            {{ showRevoked ? "隐藏" : "显示" }}已吊销的授权（{{ revokedCount }}）
        </button>
    </div>
</template>
