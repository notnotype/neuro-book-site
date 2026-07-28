<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from "vue";
import {onBeforeRouteLeave} from "vue-router";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {WorkshopItemDto} from "../../../shared/dto/workshop.dto";
import type {PackageWorkbenchState} from "../../utils/workshop-package";
import {buildDraftZip, createPackageDraft} from "../../utils/workshop-package";

definePageMeta({middleware: "auth"});

const route = useRoute();
const api = useWorkshopApi();
const notification = useNotification();
const editingSlug = computed(() => typeof route.params.slug === "string" ? route.params.slug : "");
const editing = computed(() => editingSlug.value.length > 0);

const loading = ref(false);
const loadError = ref("");
const publishError = ref("");
const publishing = ref(false);
const item = ref<WorkshopItemDto | null>(null);
const initialBytes = ref<Uint8Array | undefined>();
const workbenchMounted = ref(false);
const workbenchKey = ref(0);
const workbench = ref<PackageWorkbenchState>({
    draft: createPackageDraft("skill"),
    packageJson: null,
    error: "正在初始化包草稿",
    dirty: false,
});

const title = ref("");
const summary = ref("");
const description = ref("");
const tagsInput = ref("");
const changelog = ref("");
const metadataBaseline = ref("");

const tags = computed(() => tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean));
const metadataSnapshot = computed(() => JSON.stringify({
    title: title.value,
    summary: summary.value,
    description: description.value,
    tagsInput: tagsInput.value,
    changelog: changelog.value,
}));
const hasUnsavedDraft = computed(() => workbench.value.dirty || metadataSnapshot.value !== metadataBaseline.value);
const slugCandidate = computed(() => editingSlug.value || workbench.value.packageJson?.name || "");
const slugValid = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugCandidate.value) && slugCandidate.value.length >= 3);
const draftSlug = computed(() => slugCandidate.value);
const canPublish = computed(() => Boolean(workbench.value.packageJson)
    && !workbench.value.error
    && title.value.trim().length > 0
    && slugValid.value
    && item.value?.status !== "removed");

useHead({title: computed(() => editing.value ? `更新 ${item.value?.title ?? "资产"}` : "发布资产")});

/** 加载已有条目与最近源包；作者可读取 unlisted / removed 源包。 */
async function load(): Promise<void> {
    loading.value = true;
    loadError.value = "";
    try {
        if (editing.value) {
            const current = await api.getMyItem(editingSlug.value);
            item.value = current;
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
        loadError.value = resolveApiErrorMessage(error, "发布工作台加载失败");
    } finally {
        loading.value = false;
    }
}

/** 接收工作台草稿、协议校验与未保存状态。 */
function updateWorkbench(next: PackageWorkbenchState): void {
    workbench.value = next;
}

/** 创建或更新条目元数据，然后上传同一份受检 ZIP。 */
async function publish(): Promise<void> {
    if (!canPublish.value || !workbench.value.packageJson) {
        return;
    }
    const built = buildDraftZip(workbench.value.draft, draftSlug.value);
    if (!built.ok) {
        publishError.value = built.error;
        return;
    }
    publishing.value = true;
    publishError.value = "";
    try {
        let target = item.value;
        if (target) {
            target = await api.updateItem(target.slug, {
                title: title.value.trim(),
                summary: summary.value.trim(),
                description: description.value,
                tags: tags.value,
            });
        } else {
            target = await api.createItem({
                slug: draftSlug.value,
                type: built.packageJson.neurobook.assetType,
                title: title.value.trim(),
                summary: summary.value.trim(),
                description: description.value,
                tags: tags.value,
            });
            item.value = target;
        }
        await api.uploadVersion(target.slug, {file: built.file, changelog: changelog.value.trim()});
        notification.success(editing.value ? "新版本已发布" : "资产已发布");
        workbench.value = {...workbench.value, dirty: false};
        metadataBaseline.value = metadataSnapshot.value;
        await navigateTo(`/items/${target.slug}`);
    } catch (error) {
        publishError.value = resolveApiErrorMessage(error, "发布失败");
    } finally {
        publishing.value = false;
    }
}

/** 离开内存草稿时给出明确确认，避免把未上传内容误当作已保存。 */
function confirmLeave(): boolean {
    return !hasUnsavedDraft.value || window.confirm("当前草稿尚未发布，离开后这些改动会丢失。是否继续？");
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
            <div><h1 class="text-xl font-semibold text-[var(--text-main)]">{{ editing ? "更新发布资产" : "发布资产" }}</h1><p class="mt-1 text-sm text-[var(--text-secondary)]">在浏览器内整理完整包，发布时才上传。</p></div>
            <Button variant="secondary" @click="navigateTo('/me?tab=published')"><span class="i-lucide-list h-4 w-4"></span>我的发布</Button>
        </div>

        <StateBlock v-if="loading" state="loading" />
        <StateBlock v-else-if="loadError" state="error" :message="loadError" :retry="load" />
        <template v-else-if="workbenchMounted">
            <div v-if="item?.status === 'removed'" class="flex items-start gap-2 rounded-md border border-[var(--status-danger)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)]"><span class="i-lucide-circle-alert mt-0.5 h-4 w-4 shrink-0 text-[var(--status-danger)]"></span><span>该资产已被管理员下架。你可以查看、修订和导出源包，但管理员恢复前不能发布。</span></div>

            <!-- 条目元数据 -->
            <Panel class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField v-if="!editing" label="发布 slug" description="由安装名生成，发布后不可修改。" required>
                    <FormInput :model-value="workbench.packageJson?.name ?? ''" placeholder="my-awesome-skill" disabled />
                </FormField>
                <FormField label="标题" required><FormInput v-model="title" /></FormField>
                <FormField label="摘要"><FormInput v-model="summary" /></FormField>
                <FormField label="标签" description="用逗号分隔，最多 10 个。"><FormInput v-model="tagsInput" placeholder="写作, 校对" /></FormField>
                <FormField class="md:col-span-2" label="描述" description="支持 Markdown 语法。"><FormTextarea v-model="description" :rows="4" /></FormField>
            </Panel>

            <!-- 完整包编辑器 -->
            <AgentAssetWorkbench
                :key="workbenchKey"
                :initial-bytes="initialBytes"
                :initial-type="item?.type ?? 'skill'"
                :initial-name="item?.name || editingSlug || 'new-asset'"
                :locked-type="editing"
                @change="updateWorkbench"
            />

            <Panel class="flex flex-col gap-3">
                <FormField label="更新说明（可选）"><FormTextarea v-model="changelog" :rows="3" placeholder="这一版改了什么…" /></FormField>
                <p v-if="workbench.error" class="text-sm text-[var(--status-danger)]">{{ workbench.error }}</p>
                <p v-if="publishError" class="text-sm text-[var(--status-danger)]">{{ publishError }}</p>
                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-color)] pt-3">
                    <p class="text-xs text-[var(--text-muted)]">{{ workbench.packageJson ? `${workbench.packageJson.neurobook.assetType} · ${workbench.packageJson.name} · v${workbench.packageJson.version}` : "请先修复 package.json" }}</p>
                    <Button :disabled="!canPublish" :loading="publishing" @click="publish"><span class="i-lucide-upload h-4 w-4"></span>{{ editing ? "发布新版本" : "发布资产" }}</Button>
                </div>
            </Panel>
        </template>
    </section>
</template>
