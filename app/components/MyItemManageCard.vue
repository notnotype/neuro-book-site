<script setup lang="ts">
import {computed, ref} from "vue";
import type {WorkshopItemDto} from "../../shared/dto/workshop.dto";

const props = defineProps<{item: WorkshopItemDto}>();
const emit = defineEmits<{(event: "updated", item: WorkshopItemDto): void}>();
const api = useWorkshopApi();
const notification = useNotification();
const localizedError = useLocalizedApiError();
const {t} = useI18n();

const isPublished = computed(() => props.item.status === "published");
const isRemoved = computed(() => props.item.status === "removed");
const statusBadge = computed(() => {
    if (props.item.status === "published") {
        return {label: t("myItem.published"), cls: "border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.12)] text-[var(--status-success)]"};
    }
    if (props.item.status === "unlisted") {
        return {label: t("myItem.unlisted"), cls: "border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-muted)]"};
    }
    return {label: t("myItem.removed"), cls: "border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] text-[var(--status-danger)]"};
});

const showEdit = ref(false);
const editTitle = ref("");
const editSummary = ref("");
const editDescription = ref("");
const editTags = ref("");
const editBusy = ref(false);
const editError = ref("");
const toggling = ref(false);

/** 打开轻量元数据编辑；完整包与新版本统一进入发布工作台。 */
function openEdit(): void {
    editTitle.value = props.item.title;
    editSummary.value = props.item.summary;
    editDescription.value = props.item.description;
    editTags.value = props.item.tags.join(", ");
    editError.value = "";
    showEdit.value = true;
}

/** 保存列表卡片可直接修改的展示元数据。 */
async function saveEdit(): Promise<void> {
    editBusy.value = true;
    editError.value = "";
    try {
        const updated = await api.updateItem(props.item.slug, {
            title: editTitle.value.trim(),
            summary: editSummary.value.trim(),
            description: editDescription.value,
            tags: editTags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
        });
        emit("updated", updated);
        showEdit.value = false;
        notification.success(t("myItem.saved"));
    } catch (error) {
        editError.value = localizedError.resolve(error, "common.saveFailed");
    } finally {
        editBusy.value = false;
    }
}

/** 作者在 published / unlisted 之间切换；removed 由管理员控制。 */
async function toggleStatus(): Promise<void> {
    toggling.value = true;
    try {
        const status = isPublished.value ? "unlisted" : "published";
        const updated = await api.updateItem(props.item.slug, {status});
        emit("updated", updated);
        notification.success(status === "published" ? t("myItem.published") : t("myItem.unlisted"));
    } catch (error) {
        notification.error(localizedError.resolve(error, "common.actionFailed"));
    } finally {
        toggling.value = false;
    }
}
</script>

<template>
    <Panel padding="sm" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
            <ItemTypeBadge :type="item.type" size="sm" />
            <span v-if="item.containsExecutableCode" class="i-lucide-triangle-alert h-4 w-4 text-[var(--status-warning)]" :title="t('asset.executable')"></span>
            <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium" :class="statusBadge.cls">{{ statusBadge.label }}</span>
            <span class="ml-auto text-xs text-[var(--text-muted)]">{{ item.latestVersion ? `v${item.latestVersion}` : t("myItem.noVersion") }}</span>
        </div>
        <div><h3 class="font-medium text-[var(--text-main)]">{{ item.title }}</h3><p class="font-mono text-xs text-[var(--text-muted)]">{{ item.slug }}</p></div>
        <div class="flex flex-wrap items-center gap-2 border-t border-[var(--border-color)] pt-3">
            <Button v-if="isPublished" variant="secondary" size="sm" @click="navigateTo(`/items/${item.slug}`)"><span class="i-lucide-external-link h-4 w-4"></span>{{ t("myItem.view") }}</Button>
            <Button variant="secondary" size="sm" :disabled="isRemoved" @click="openEdit"><span class="i-lucide-pencil h-4 w-4"></span>{{ t("myItem.editInfo") }}</Button>
            <Button variant="secondary" size="sm" @click="navigateTo(`/publish/${item.slug}`)"><span class="i-lucide-package-open h-4 w-4"></span>{{ item.latestVersion ? t("myItem.updateAsset") : t("myItem.finishFirstVersion") }}</Button>
            <Button v-if="item.latestVersion" variant="subtle" size="sm" :disabled="isRemoved" :loading="toggling" @click="toggleStatus"><span :class="isPublished ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="h-4 w-4"></span>{{ isPublished ? t("myItem.unlist") : t("myItem.publish") }}</Button>
        </div>

        <Dialog v-model="showEdit" :title="t('myItem.editTitle')" size="md" show-cancel :cancel-label="t('common.cancel')" :confirm-label="t('common.save')" :close-label="t('common.close')" :busy="editBusy" @confirm="saveEdit">
            <div class="flex flex-col gap-3">
                <FormField :label="t('myItem.title')" required><FormInput v-model="editTitle" /></FormField>
                <FormField :label="t('myItem.summary')"><FormInput v-model="editSummary" /></FormField>
                <FormField :label="t('myItem.description')" :description="t('myItem.markdownDescription')"><FormTextarea v-model="editDescription" :rows="4" /></FormField>
                <FormField :label="t('myItem.tags')" :description="t('myItem.tagsDescription')"><FormInput v-model="editTags" /></FormField>
                <p v-if="editError" class="text-sm text-[var(--status-danger)]">{{ editError }}</p>
            </div>
        </Dialog>
    </Panel>
</template>
