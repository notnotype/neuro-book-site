<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from "vue";
import {onBeforeRouteLeave} from "vue-router";
import type {WorkshopItemDto} from "../../../shared/dto/workshop.dto";
import type {PackageWorkbenchState} from "../../utils/workshop-package";
import {buildDraftZip, createPackageDraft} from "../../utils/workshop-package";

definePageMeta({middleware: "auth"});

const route = useRoute();
const api = useWorkshopApi();
const notification = useNotification();
const {locale, t} = useI18n();
const {resolve} = useLocalizedApiError();
const {describeIssues} = useDraftIssueMessage();
const editingSlug = computed(() => typeof route.params.slug === "string" ? route.params.slug : "");
const editing = computed(() => editingSlug.value.length > 0 || item.value !== null);

const loading = ref(false);
const loadError = ref("");
const publishError = ref("");
const publishing = ref(false);
const item = ref<WorkshopItemDto | null>(null);
const initialBytes = ref<Uint8Array | undefined>();
const workbenchMounted = ref(false);
const workbenchKey = ref(0);
const workbench = ref<PackageWorkbenchState>({
    draft: createPackageDraft("skill", "new-asset", "1.0.0", locale.value),
    packageJson: null,
    error: t("publish.initializing"),
    validating: true,
    dirty: false,
});

const title = ref("");
const summary = ref("");
const description = ref("");
const tagsInput = ref("");
const changelog = ref("");
const metadataBaseline = ref("");
const slugInput = ref("");
const slugTouched = ref(false);

const tags = computed(() => tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean));
const metadataSnapshot = computed(() => JSON.stringify({
    title: title.value,
    summary: summary.value,
    description: description.value,
    tagsInput: tagsInput.value,
    changelog: changelog.value,
}));
const hasUnsavedDraft = computed(() => workbench.value.dirty || metadataSnapshot.value !== metadataBaseline.value);
const slugCandidate = computed(() => editingSlug.value || item.value?.slug || slugInput.value.trim());
const slugValid = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugCandidate.value) && slugCandidate.value.length >= 3);
const draftSlug = computed(() => slugCandidate.value);
const canPublish = computed(() => Boolean(workbench.value.packageJson)
    && !workbench.value.error
    && !workbench.value.validating
    && title.value.trim().length > 0
    && slugValid.value
    && item.value?.status !== "removed");

useHead({title: computed(() => editing.value ? t("publish.updateTitle", {title: item.value?.title ?? t("publish.asset")}) : t("publish.title"))});

/** 加载已有条目与最近源包；作者可读取 unlisted / removed 源包。 */
async function load(): Promise<void> {
    loading.value = true;
    loadError.value = "";
    try {
        if (editing.value) {
            const current = await api.getMyItem(editingSlug.value);
            item.value = current;
            slugInput.value = current.slug;
            title.value = current.title;
            summary.value = current.summary;
            description.value = current.description;
            tagsInput.value = current.tags.join(", ");
            initialBytes.value = current.latestVersion ? await api.getMyPackage(current.slug, current.latestVersion) : undefined;
        }
        metadataBaseline.value = metadataSnapshot.value;
        workbenchKey.value += 1;
        workbenchMounted.value = true;
    } catch (error) {
        loadError.value = resolve(error, "publish.loadFailed");
    } finally {
        loading.value = false;
    }
}

/** 接收工作台草稿、协议校验与未保存状态。 */
function updateWorkbench(next: PackageWorkbenchState): void {
    workbench.value = next;
    if (!item.value && !slugTouched.value && next.packageJson) {
        slugInput.value = suggestedSlug(next.packageJson.name);
    }
}

/** URL slug 与安装身份分离；点分 Profile key 默认转成可编辑的 kebab-case 建议。 */
function suggestedSlug(name: string): string {
    return name.replaceAll(".", "-");
}

/** 用户一旦手动修改 slug，后续安装名编辑不再覆盖其选择。 */
function setSlug(value: string): void {
    slugTouched.value = true;
    slugInput.value = value;
}

/** 创建草稿条目或复用既有条目，再原子提交版本与元数据。 */
async function publish(): Promise<void> {
    if (!canPublish.value || !workbench.value.packageJson) {
        return;
    }
    const built = await buildDraftZip(workbench.value.draft, draftSlug.value, item.value
        ? {
              type: item.value.type,
              ...(item.value.latestVersion ? {name: item.value.name, latestVersion: item.value.latestVersion} : {}),
          }
        : undefined);
    if (!built.ok) {
        publishError.value = describeIssues(built.issues);
        return;
    }
    publishing.value = true;
    publishError.value = "";
    try {
        let target = item.value;
        const updatingVersion = Boolean(target?.latestVersion);
        if (!target) {
            target = await api.createItem({
                slug: draftSlug.value,
                type: built.packageJson.neurobook.assetType,
                title: title.value.trim(),
                summary: summary.value.trim(),
                description: description.value,
                tags: tags.value,
            });
            item.value = target;
            slugInput.value = target.slug;
            window.history.replaceState(window.history.state, "", `/publish/${encodeURIComponent(target.slug)}`);
        }
        await api.uploadVersion(target.slug, {
            file: built.file,
            changelog: changelog.value.trim(),
            metadata: {
                title: title.value.trim(),
                summary: summary.value.trim(),
                description: description.value,
                tags: tags.value,
            },
        });
        notification.success(updatingVersion ? t("publish.versionPublished") : t("publish.published"));
        workbench.value = {...workbench.value, dirty: false, validating: false};
        metadataBaseline.value = metadataSnapshot.value;
        await navigateTo(`/items/${target.slug}`);
    } catch (error) {
        publishError.value = resolve(error, "publish.failed");
    } finally {
        publishing.value = false;
    }
}

/** 放弃尚未上传首版的服务端草稿。 */
async function discardDraft(): Promise<void> {
    if (!item.value || item.value.latestVersion || !window.confirm(t("publish.discardConfirm"))) {
        return;
    }
    try {
        await api.discardItemDraft(item.value.slug);
        workbench.value = {...workbench.value, dirty: false};
        metadataBaseline.value = metadataSnapshot.value;
        notification.success(t("publish.draftDeleted"));
        await navigateTo("/me?tab=published");
    } catch (error) {
        publishError.value = resolve(error, "publish.deleteDraftFailed");
    }
}

/** 离开内存草稿时给出明确确认，避免把未上传内容误当作已保存。 */
function confirmLeave(): boolean {
    return !hasUnsavedDraft.value || window.confirm(t("publish.leaveConfirm"));
}

function beforeUnload(event: BeforeUnloadEvent): void {
    if (hasUnsavedDraft.value) {
        event.preventDefault();
        event.returnValue = "";
    }
}

onBeforeRouteLeave(() => confirmLeave());
onMounted(() => {
    window.addEventListener("beforeunload", beforeUnload);
    void load();
});
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>

<template>
    <section class="mx-auto flex max-w-6xl flex-col gap-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div><h1 class="text-xl font-semibold text-[var(--text-main)]">{{ editing ? t("publish.updateHeading") : t("publish.title") }}</h1><p class="mt-1 text-sm text-[var(--text-secondary)]">{{ t("publish.description") }}</p></div>
            <Button variant="secondary" @click="navigateTo('/me?tab=published')"><span class="i-lucide-list h-4 w-4"></span>{{ t("me.tabs.published") }}</Button>
        </div>

        <StateBlock v-if="loading" state="loading" />
        <StateBlock v-else-if="loadError" state="error" :message="loadError" :retry="load" />
        <template v-else-if="workbenchMounted">
            <div v-if="item?.status === 'removed'" class="flex items-start gap-2 rounded-md border border-[var(--status-danger)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)]"><span class="i-lucide-circle-alert mt-0.5 h-4 w-4 shrink-0 text-[var(--status-danger)]"></span><span>{{ t("publish.removedWarning") }}</span></div>

            <!-- 条目元数据 -->
            <Panel class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField v-if="!editing" :label="t('publish.slug')" :description="t('publish.slugDescription')" required>
                    <FormInput :model-value="slugInput" placeholder="my-awesome-skill" @update:model-value="setSlug" />
                </FormField>
                <FormField :label="t('myItem.title')" required><FormInput v-model="title" /></FormField>
                <FormField :label="t('myItem.summary')"><FormInput v-model="summary" /></FormField>
                <FormField :label="t('myItem.tags')" :description="t('myItem.tagsDescription')"><FormInput v-model="tagsInput" :placeholder="t('publish.tagsPlaceholder')" /></FormField>
                <FormField class="md:col-span-2" :label="t('myItem.description')" :description="t('myItem.markdownDescription')"><FormTextarea v-model="description" :rows="4" /></FormField>
            </Panel>

            <!-- 完整包编辑器 -->
            <AgentAssetWorkbench
                :key="workbenchKey"
                :initial-bytes="initialBytes"
                :initial-type="item?.type ?? 'skill'"
                :initial-name="item?.name || editingSlug || 'new-asset'"
                :locked-type="editing"
                :locked-identity="Boolean(item?.latestVersion)"
                :latest-version="item?.latestVersion ?? undefined"
                @change="updateWorkbench"
            />

            <Panel class="flex flex-col gap-3">
                <FormField :label="t('publish.changelog')"><FormTextarea v-model="changelog" :rows="3" :placeholder="t('publish.changelogPlaceholder')" /></FormField>
                <p v-if="workbench.error" class="text-sm text-[var(--status-danger)]">{{ workbench.error }}</p>
                <p v-if="publishError" class="text-sm text-[var(--status-danger)]">{{ publishError }}</p>
                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-color)] pt-3">
                    <p class="text-xs text-[var(--text-muted)]">{{ workbench.packageJson ? `${workbench.packageJson.neurobook.assetType} · ${workbench.packageJson.name} · v${workbench.packageJson.version}` : t("publish.fixPackage") }}</p>
                    <div class="flex items-center gap-2">
                        <Button v-if="item && !item.latestVersion" variant="danger" :disabled="publishing" @click="discardDraft"><span class="i-lucide-trash-2 h-4 w-4"></span>{{ t("publish.discard") }}</Button>
                        <Button :disabled="!canPublish" :loading="publishing" @click="publish"><span class="i-lucide-upload h-4 w-4"></span>{{ item?.latestVersion ? t("publish.publishVersion") : t("publish.title") }}</Button>
                    </div>
                </div>
            </Panel>
        </template>
    </section>
</template>
