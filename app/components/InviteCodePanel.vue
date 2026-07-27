<script setup lang="ts">
import {onMounted, ref} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {InviteCodeDto} from "../../shared/dto/access-code.dto";

const api = useWorkshopApi();
const notification = useNotification();

const note = ref("");
const limitMode = ref<"unlimited" | "limited">("unlimited");
const maxUses = ref<number | null>(1);
const expiresAt = ref("");
const registrationCode = ref("");
const creating = ref(false);
const loading = ref(false);
const errorMsg = ref("");
const codes = ref<InviteCodeDto[]>([]);

const editing = ref<InviteCodeDto | null>(null);
const editNote = ref("");
const editLimitMode = ref<"unlimited" | "limited">("unlimited");
const editMaxUses = ref<number | null>(1);
const editExpiresAt = ref("");
const editBusy = ref(false);
const editError = ref("");

/** 把 datetime-local 值转为 ISO；空值表示永不过期。 */
function expirationIso(value: string): string | null {
    return value ? new Date(value).toISOString() : null;
}

/** 把 ISO 时间转回 datetime-local 输入值。 */
function localDateTime(value: string | null): string {
    if (!value) {
        return "";
    }
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function codeStatus(code: InviteCodeDto): "active" | "disabled" | "expired" | "exhausted" {
    if (code.disabledAt) {
        return "disabled";
    }
    if (code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now()) {
        return "expired";
    }
    if (code.maxUses !== null && code.usedCount >= code.maxUses) {
        return "exhausted";
    }
    return "active";
}

function statusText(code: InviteCodeDto): string {
    return {active: "可用", disabled: "已停用", expired: "已过期", exhausted: "已用完"}[codeStatus(code)];
}

async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        notification.success("已复制");
    } catch {
        notification.error("复制失败，请手动选择");
    }
}

/** 复制邀请注册链接；填写注册码时把两个参数放进同一链接。 */
async function copyInviteLink(inviteCode: string): Promise<void> {
    const url = new URL("/register", window.location.origin);
    const accessCode = registrationCode.value.trim();
    if (accessCode) {
        url.searchParams.set("registrationCode", accessCode);
    }
    url.searchParams.set("inviteCode", inviteCode);
    await copyText(url.toString());
}

async function load(): Promise<void> {
    loading.value = true;
    errorMsg.value = "";
    try {
        codes.value = await api.listMyInviteCodes();
    } catch (error) {
        errorMsg.value = resolveApiErrorMessage(error, "加载失败");
    } finally {
        loading.value = false;
    }
}

async function createCode(): Promise<void> {
    creating.value = true;
    try {
        const created = await api.createMyInviteCode({
            note: note.value.trim(),
            maxUses: limitMode.value === "limited" ? maxUses.value ?? 1 : null,
            expiresAt: expirationIso(expiresAt.value),
        });
        codes.value = [created, ...codes.value];
        notification.success("邀请码已创建");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "创建失败"));
    } finally {
        creating.value = false;
    }
}

function openEdit(code: InviteCodeDto): void {
    editing.value = code;
    editNote.value = code.note;
    editLimitMode.value = code.maxUses === null ? "unlimited" : "limited";
    editMaxUses.value = code.maxUses ?? Math.max(1, code.usedCount);
    editExpiresAt.value = localDateTime(code.expiresAt);
    editError.value = "";
}

async function saveEdit(): Promise<void> {
    if (!editing.value) {
        return;
    }
    editBusy.value = true;
    editError.value = "";
    try {
        const updated = await api.updateMyInviteCode(editing.value.id, {
            note: editNote.value.trim(),
            maxUses: editLimitMode.value === "limited" ? editMaxUses.value ?? 1 : null,
            expiresAt: expirationIso(editExpiresAt.value),
        });
        codes.value = codes.value.map((code) => code.id === updated.id ? updated : code);
        editing.value = null;
        notification.success("邀请码设置已保存");
    } catch (error) {
        editError.value = resolveApiErrorMessage(error, "保存失败");
    } finally {
        editBusy.value = false;
    }
}

async function toggleDisabled(code: InviteCodeDto): Promise<void> {
    try {
        const updated = await api.updateMyInviteCode(code.id, {disabled: !code.disabledAt});
        codes.value = codes.value.map((item) => item.id === updated.id ? updated : item);
        notification.success(updated.disabledAt ? "邀请码已停用" : "邀请码已启用");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "操作失败"));
    }
}

onMounted(load);
</script>

<template>
    <div class="flex flex-col gap-4">
        <!-- 邀请码创建 -->
        <Panel class="flex flex-col gap-3">
            <h2 class="text-sm font-medium text-[var(--text-main)]">创建邀请码</h2>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <FormField label="使用次数"><select v-model="limitMode" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-main)]"><option value="unlimited">不限次数</option><option value="limited">限制次数</option></select></FormField>
                <FormField v-if="limitMode === 'limited'" label="最多使用"><FormNumberInput v-model="maxUses" :min="1" :max="100000" /></FormField>
                <FormField label="过期时间"><FormInput v-model="expiresAt" type="datetime-local" /></FormField>
                <FormField label="备注"><FormInput v-model="note" :maxlength="120" /></FormField>
            </div>
            <Button class="self-start" :loading="creating" @click="createCode"><span class="i-lucide-user-plus h-4 w-4"></span>创建</Button>
        </Panel>

        <!-- 分享链接附加注册码 -->
        <Panel class="flex flex-col gap-2">
            <h2 class="text-sm font-medium text-[var(--text-main)]">分享链接</h2>
            <FormField label="附带注册码（可选）"><FormInput v-model="registrationCode" autocomplete="off" placeholder="留空时只附带邀请码" /></FormField>
        </Panel>

        <!-- 本人邀请码列表 -->
        <StateBlock v-if="loading && codes.length === 0" state="loading" />
        <StateBlock v-else-if="errorMsg && codes.length === 0" state="error" :message="errorMsg" :retry="load" />
        <StateBlock v-else-if="codes.length === 0" state="empty" message="还没有邀请码" />
        <ul v-else class="flex flex-col gap-2">
            <li v-for="code in codes" :key="code.id" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
                <div class="min-w-0">
                    <p class="flex flex-wrap items-center gap-2"><span class="font-mono text-sm text-[var(--text-main)]">{{ code.code }}</span><span class="text-xs text-[var(--text-muted)]">{{ statusText(code) }}</span></p>
                    <p class="text-xs text-[var(--text-muted)]">已用 {{ code.usedCount }} / {{ code.maxUses ?? "不限" }}{{ code.expiresAt ? ` · ${formatDate(code.expiresAt)} 到期` : "" }}{{ code.note ? ` · ${code.note}` : "" }}</p>
                </div>
                <div class="flex gap-1"><IconButton title="复制邀请码" @click="copyText(code.code)"><span class="i-lucide-copy h-4 w-4"></span></IconButton><IconButton title="复制注册链接" variant="accent" @click="copyInviteLink(code.code)"><span class="i-lucide-link h-4 w-4"></span></IconButton><IconButton title="编辑设置" @click="openEdit(code)"><span class="i-lucide-settings-2 h-4 w-4"></span></IconButton><IconButton :title="code.disabledAt ? '启用' : '停用'" :variant="code.disabledAt ? 'accent' : 'danger'" @click="toggleDisabled(code)"><span :class="code.disabledAt ? 'i-lucide-play' : 'i-lucide-ban'" class="h-4 w-4"></span></IconButton></div>
            </li>
        </ul>

        <!-- 邀请码设置 -->
        <Dialog :model-value="editing !== null" title="邀请码设置" size="sm" show-cancel confirm-label="保存" :busy="editBusy" @update:model-value="(open: boolean) => { if (!open) editing = null; }" @confirm="saveEdit">
            <div class="flex flex-col gap-3">
                <FormField label="备注"><FormInput v-model="editNote" :maxlength="120" /></FormField>
                <FormField label="使用次数"><select v-model="editLimitMode" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-main)]"><option value="unlimited">不限次数</option><option value="limited">限制次数</option></select></FormField>
                <FormField v-if="editLimitMode === 'limited'" label="最多使用"><FormNumberInput v-model="editMaxUses" :min="editing?.usedCount || 1" :max="100000" /></FormField>
                <FormField label="过期时间"><FormInput v-model="editExpiresAt" type="datetime-local" /></FormField>
                <p v-if="editError" class="text-sm text-[var(--status-danger)]">{{ editError }}</p>
            </div>
        </Dialog>
    </div>
</template>
