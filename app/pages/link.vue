<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {PendingDeviceDto} from "../../shared/dto/passport.dto";

// 设备码批准页（spec §6.3）：实例发起关联后，用户在此核对实例名与权限并批准/拒绝。
definePageMeta({middleware: "auth"});
const {t} = useI18n();
const {resolve} = useLocalizedApiError();
const {describeScope} = usePassportScopes();
useHead({title: computed(() => t("link.title"))});

const api = useWorkshopApi();
const notification = useNotification();
const route = useRoute();

const codeInput = ref(typeof route.query.code === "string" ? route.query.code : "");
const device = ref<PendingDeviceDto | null>(null); // 为空表示尚未查询到待批设备码
const instanceName = ref("");
const loading = ref(false);
const acting = ref(false);
const errorMsg = ref(""); // 查询/操作的可恢复错误，就地展示
// 终态：approved = 本人已批准；denied = 本人已拒绝（服务端态由 device.status 表达）
const finished = ref<"approved" | "denied" | null>(null);

/** 查询设备码详情 */
async function lookup(): Promise<void> {
    if (!codeInput.value.trim()) {
        errorMsg.value = t("link.codeRequired");
        return;
    }
    loading.value = true;
    errorMsg.value = "";
    finished.value = null;
    device.value = null;
    try {
        const found = await api.getPendingDevice(codeInput.value.trim());
        device.value = found;
        instanceName.value = found.instanceName;
    } catch (error) {
        errorMsg.value = resolve(error, "link.lookupFailed");
    } finally {
        loading.value = false;
    }
}

/** 批准关联 */
async function approve(): Promise<void> {
    if (!device.value) {
        return;
    }
    acting.value = true;
    try {
        await api.approveDevice(device.value.userCode, instanceName.value.trim() || device.value.instanceName);
        finished.value = "approved";
        notification.success(t("link.approved"));
    } catch (error) {
        notification.error(resolve(error, "link.approveFailed"));
    } finally {
        acting.value = false;
    }
}

/** 拒绝关联 */
async function deny(): Promise<void> {
    if (!device.value) {
        return;
    }
    acting.value = true;
    try {
        await api.denyDevice(device.value.userCode);
        finished.value = "denied";
    } catch (error) {
        notification.error(resolve(error, "common.actionFailed"));
    } finally {
        acting.value = false;
    }
}

onMounted(() => {
    if (codeInput.value) {
        void lookup();
    }
});
</script>

<template>
    <section class="mx-auto flex w-full max-w-xl flex-col gap-5">
        <div class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold text-[var(--text-main)]">{{ t("link.heading") }}</h1>
            <p class="text-sm text-[var(--text-muted)]">{{ t("link.description") }}</p>
        </div>

        <!-- 关联码输入 -->
        <Panel class="flex flex-col gap-3">
            <FormField :label="t('link.code')" required>
                <div class="flex items-center gap-2">
                    <FormInput v-model="codeInput" name="userCode" placeholder="XXXX-XXXX" class="flex-1 font-mono" @keydown.enter="lookup" />
                    <Button :loading="loading" @click="lookup">{{ t("link.lookup") }}</Button>
                </div>
            </FormField>
            <p v-if="errorMsg" class="text-sm text-[var(--status-danger)]">{{ errorMsg }}</p>
        </Panel>

        <!-- 已批准 / 已拒绝终态 -->
        <Panel v-if="finished === 'approved'" class="flex flex-col items-center gap-2 py-8 text-center">
            <span class="i-lucide-check-circle-2 h-10 w-10 text-[var(--status-success)]"></span>
            <p class="font-medium text-[var(--text-main)]">{{ t("link.approved") }}</p>
            <p class="text-sm text-[var(--text-muted)]">{{ t("link.approvedDescription") }}</p>
        </Panel>
        <Panel v-else-if="finished === 'denied'" class="flex flex-col items-center gap-2 py-8 text-center">
            <span class="i-lucide-ban h-10 w-10 text-[var(--status-danger)]"></span>
            <p class="font-medium text-[var(--text-main)]">{{ t("link.denied") }}</p>
            <p class="text-sm text-[var(--text-muted)]">{{ t("link.deniedDescription") }}</p>
        </Panel>

        <!-- 待批详情 -->
        <template v-else-if="device">
            <Panel v-if="device.status === 'pending'" class="flex flex-col gap-4">
                <div class="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <span class="i-lucide-monitor-smartphone h-4 w-4"></span>{{ t("link.requesting") }}
                </div>
                <FormField :label="t('link.instanceName')" :hint="t('link.instanceNameHint')">
                    <FormInput v-model="instanceName" name="instanceName" />
                </FormField>
                <div class="flex flex-col gap-2">
                    <p class="text-sm font-medium text-[var(--text-main)]">{{ t("link.permissions") }}</p>
                    <ul class="flex flex-col gap-2">
                        <li v-for="scope in device.scopes" :key="scope" class="flex items-start gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2">
                            <span class="i-lucide-key-round mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
                            <div class="min-w-0">
                                <p class="text-sm font-medium text-[var(--text-main)]">{{ describeScope(scope).label }}</p>
                                <p class="text-xs text-[var(--text-muted)]">{{ describeScope(scope).detail }}</p>
                            </div>
                        </li>
                    </ul>
                </div>
                <div class="flex items-center justify-end gap-2">
                    <Button variant="subtle" :disabled="acting" @click="deny">{{ t("link.deny") }}</Button>
                    <Button :loading="acting" @click="approve">{{ t("link.approve") }}</Button>
                </div>
            </Panel>
            <StateBlock v-else-if="device.status === 'expired'" state="error" :message="t('link.expired')" />
            <StateBlock v-else-if="device.status === 'denied'" state="error" :message="t('link.codeDenied')" />
            <StateBlock v-else state="error" :message="t('link.used')" />
        </template>
    </section>
</template>
