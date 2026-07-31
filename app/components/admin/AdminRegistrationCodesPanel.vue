<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {RegistrationCodeDto} from "../../../shared/dto/access-code.dto";

const api = useWorkshopApi();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const {t} = useI18n();
const {formatDate, formatNumber} = useLocaleFormat();

const count = ref<number | null>(1);
const note = ref("");
const limitMode = ref<"unlimited" | "limited">("unlimited");
const maxUses = ref<number | null>(1);
const expiresAt = ref("");
const issuing = ref(false);
const issuedCodes = ref<RegistrationCodeDto[]>([]);

const PAGE_SIZE = 20;
const list = ref<RegistrationCodeDto[]>([]);
const total = ref(0);
const next = ref<number | null>(null);
const listLoading = ref(false);
const loadingMore = ref(false);
const listError = ref("");

const editing = ref<RegistrationCodeDto | null>(null);
const editNote = ref("");
const editLimitMode = ref<"unlimited" | "limited">("unlimited");
const editMaxUses = ref<number | null>(1);
const editExpiresAt = ref("");
const editBusy = ref(false);
const editError = ref("");

/** 把 datetime-local 值转为服务端 ISO；空值表示永不过期。 */
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

/** 派生码的当前状态，耗尽优先于普通可用态。 */
function codeStatus(code: RegistrationCodeDto): "active" | "disabled" | "expired" | "exhausted" {
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

function statusText(code: RegistrationCodeDto): string {
    return t(`accessCode.${codeStatus(code)}`);
}

async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        notification.success(t("common.copySucceeded"));
    } catch {
        notification.error(t("common.copyFailed"));
    }
}

/** 复制带注册码的站内注册链接。 */
async function copyRegistrationLink(code: string): Promise<void> {
    const url = new URL("/register", window.location.origin);
    url.searchParams.set("registrationCode", code);
    await copyText(url.toString());
}

async function issueCodes(): Promise<void> {
    issuing.value = true;
    try {
        const created = await api.createRegistrationCodes(count.value ?? 1, {
            note: note.value.trim(),
            maxUses: limitMode.value === "limited" ? maxUses.value ?? 1 : null,
            expiresAt: expirationIso(expiresAt.value),
        });
        issuedCodes.value = [...created, ...issuedCodes.value];
        notification.success(t("accessCode.issuedCount", {count: formatNumber(created.length)}));
        await loadList(true);
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.createFailed"));
    } finally {
        issuing.value = false;
    }
}

async function loadList(reset: boolean): Promise<void> {
    if (reset) {
        listLoading.value = true;
        listError.value = "";
    } else {
        loadingMore.value = true;
    }
    try {
        const offset = reset ? 0 : next.value ?? 0;
        const page = await api.listRegistrationCodes({offset, limit: PAGE_SIZE});
        list.value = reset ? page.items : [...list.value, ...page.items];
        total.value = page.total;
        next.value = page.hasMore ? page.nextOffset ?? null : null;
    } catch (error) {
        if (reset) {
            listError.value = localizedError.resolve(error, "common.loadFailed");
        } else {
            notification.error(localizedError.resolve(error, "common.loadMoreFailed"));
        }
    } finally {
        listLoading.value = false;
        loadingMore.value = false;
    }
}

function openEdit(code: RegistrationCodeDto): void {
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
        const updated = await api.updateRegistrationCode(editing.value.id, {
            note: editNote.value.trim(),
            maxUses: editLimitMode.value === "limited" ? editMaxUses.value ?? 1 : null,
            expiresAt: expirationIso(editExpiresAt.value),
        });
        list.value = list.value.map((code) => code.id === updated.id ? updated : code);
        editing.value = null;
        notification.success(t("accessCode.registrationSaved"));
    } catch (error) {
        editError.value = localizedError.resolve(error, "common.saveFailed");
    } finally {
        editBusy.value = false;
    }
}

async function toggleDisabled(code: RegistrationCodeDto): Promise<void> {
    try {
        const updated = await api.updateRegistrationCode(code.id, {disabled: !code.disabledAt});
        list.value = list.value.map((item) => item.id === updated.id ? updated : item);
        notification.success(updated.disabledAt ? t("accessCode.registrationDisabled") : t("accessCode.registrationEnabled"));
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.actionFailed"));
    }
}

onMounted(() => loadList(true));
</script>

<template>
    <div class="flex flex-col gap-4">
        <!-- 注册码签发表单 -->
        <Panel class="flex flex-col gap-3">
            <h2 class="text-sm font-medium text-[var(--text-main)]">{{ t("accessCode.issueRegistration") }}</h2>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                <FormField :label="t('accessCode.count')"><FormNumberInput v-model="count" :min="1" :max="100" /></FormField>
                <FormField :label="t('accessCode.useLimit')">
                    <select v-model="limitMode" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-main)]"><option value="unlimited">{{ t("accessCode.unlimitedUses") }}</option><option value="limited">{{ t("accessCode.limitedUses") }}</option></select>
                </FormField>
                <FormField v-if="limitMode === 'limited'" :label="t('accessCode.maxUses')"><FormNumberInput v-model="maxUses" :min="1" :max="100000" /></FormField>
                <FormField :label="t('accessCode.expiresAt')"><FormInput v-model="expiresAt" type="datetime-local" /></FormField>
                <FormField :label="t('accessCode.note')"><FormInput v-model="note" :maxlength="120" /></FormField>
            </div>
            <Button class="self-start" :loading="issuing" @click="issueCodes"><span class="i-lucide-ticket h-4 w-4"></span>{{ t("accessCode.issue") }}</Button>
        </Panel>

        <!-- 本次签发 -->
        <Panel v-if="issuedCodes.length > 0" class="flex flex-col gap-2">
            <h2 class="text-sm font-medium text-[var(--text-main)]">{{ t("accessCode.issuedNow") }}</h2>
            <ul class="flex flex-col gap-2">
                <li v-for="code in issuedCodes" :key="code.id" class="flex items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-1.5">
                    <span class="truncate font-mono text-sm text-[var(--text-main)]">{{ code.code }}</span>
                    <span class="flex gap-1"><IconButton :title="t('accessCode.copyRegistration')" @click="copyText(code.code)"><span class="i-lucide-copy h-4 w-4"></span></IconButton><IconButton :title="t('accessCode.copyRegistrationLink')" variant="accent" @click="copyRegistrationLink(code.code)"><span class="i-lucide-link h-4 w-4"></span></IconButton></span>
                </li>
            </ul>
        </Panel>

        <!-- 注册码列表 -->
        <Panel class="flex flex-col gap-3">
            <h2 class="text-sm font-medium text-[var(--text-main)]">{{ t("accessCode.registrationCodes") }}</h2>
            <StateBlock v-if="listLoading && list.length === 0" state="loading" />
            <StateBlock v-else-if="listError && list.length === 0" state="error" :message="listError" :retry="() => loadList(true)" />
            <StateBlock v-else-if="list.length === 0" state="empty" :message="t('accessCode.noRegistrationCodes')" />
            <template v-else>
                <ul class="flex flex-col gap-2">
                    <li v-for="code in list" :key="code.id" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2">
                        <div class="min-w-0">
                            <p class="flex flex-wrap items-center gap-2"><span class="font-mono text-sm text-[var(--text-main)]">{{ code.code }}</span><span class="text-xs text-[var(--text-muted)]">{{ statusText(code) }}</span></p>
                            <p class="text-xs text-[var(--text-muted)]">{{ t("accessCode.usage", {used: formatNumber(code.usedCount), maximum: code.maxUses === null ? t("common.unlimited") : formatNumber(code.maxUses)}) }}<span v-if="code.expiresAt"> · {{ t("accessCode.expires", {date: formatDate(code.expiresAt)}) }}</span><span v-if="code.note"> · {{ code.note }}</span></p>
                        </div>
                        <div class="flex gap-1"><IconButton :title="t('accessCode.copyRegistration')" @click="copyText(code.code)"><span class="i-lucide-copy h-4 w-4"></span></IconButton><IconButton :title="t('accessCode.copyRegistrationLink')" @click="copyRegistrationLink(code.code)"><span class="i-lucide-link h-4 w-4"></span></IconButton><IconButton :title="t('accessCode.editSettings')" @click="openEdit(code)"><span class="i-lucide-settings-2 h-4 w-4"></span></IconButton><IconButton :title="code.disabledAt ? t('accessCode.enable') : t('accessCode.disable')" :variant="code.disabledAt ? 'accent' : 'danger'" @click="toggleDisabled(code)"><span :class="code.disabledAt ? 'i-lucide-play' : 'i-lucide-ban'" class="h-4 w-4"></span></IconButton></div>
                    </li>
                </ul>
                <div class="flex flex-col items-center gap-2"><Button v-if="next !== null" variant="secondary" size="sm" :loading="loadingMore" @click="loadList(false)">{{ t("common.loadMore") }}</Button><p class="text-xs text-[var(--text-muted)]">{{ t("common.totalItems", {count: formatNumber(total)}) }}</p></div>
            </template>
        </Panel>

        <!-- 注册码设置 -->
        <Dialog :model-value="editing !== null" :title="t('accessCode.registrationSettings')" size="sm" show-cancel :cancel-label="t('common.cancel')" :confirm-label="t('common.save')" :close-label="t('common.close')" :busy="editBusy" @update:model-value="(open: boolean) => { if (!open) editing = null; }" @confirm="saveEdit">
            <div class="flex flex-col gap-3">
                <FormField :label="t('accessCode.note')"><FormInput v-model="editNote" :maxlength="120" /></FormField>
                <FormField :label="t('accessCode.useLimit')"><select v-model="editLimitMode" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-main)]"><option value="unlimited">{{ t("accessCode.unlimitedUses") }}</option><option value="limited">{{ t("accessCode.limitedUses") }}</option></select></FormField>
                <FormField v-if="editLimitMode === 'limited'" :label="t('accessCode.maxUses')"><FormNumberInput v-model="editMaxUses" :min="editing?.usedCount || 1" :max="100000" /></FormField>
                <FormField :label="t('accessCode.expiresAt')"><FormInput v-model="editExpiresAt" type="datetime-local" /></FormField>
                <p v-if="editError" class="text-sm text-[var(--status-danger)]">{{ editError }}</p>
            </div>
        </Dialog>
    </div>
</template>
