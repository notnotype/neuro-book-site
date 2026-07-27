<script setup lang="ts">
import {computed, ref} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {WorkshopItemDto} from "../../shared/dto/workshop.dto";
import type {ContentSource} from "../utils/workshop-package";
import {buildUploadFile} from "../utils/workshop-package";

// 个人页「我的发布」条目管理卡：编辑元数据 / 传新版本 / 上下架。
// 所有改动通过 updated 事件把最新条目回传给父组件，父组件就地替换。
const props = defineProps<{item: WorkshopItemDto}>();
const emit = defineEmits<{(e: "updated", item: WorkshopItemDto): void}>();

const api = useWorkshopApi();
const notification = useNotification();

const isPublished = computed(() => props.item.status === "published");
const isRemoved = computed(() => props.item.status === "removed");

// 状态徽章文案 / 配色
const statusBadge = computed(() => {
    if (props.item.status === "published") {
        return {label: "已上架", cls: "border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.12)] text-[var(--status-success)]"};
    }
    if (props.item.status === "unlisted") {
        return {label: "已下架", cls: "border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-muted)]"};
    }
    return {label: "管理员下架", cls: "border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] text-[var(--status-danger)]"};
});

// ---- 编辑元数据 Dialog ----
const showEdit = ref(false);
const editTitle = ref("");
const editSummary = ref("");
const editDescription = ref("");
const editTags = ref("");
const editBusy = ref(false);
const editError = ref("");

function openEdit(): void {
    editTitle.value = props.item.title;
    editSummary.value = props.item.summary;
    editDescription.value = props.item.description;
    editTags.value = props.item.tags.join(", ");
    editError.value = "";
    showEdit.value = true;
}

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
        notification.success("已保存");
    } catch (error) {
        editError.value = resolveApiErrorMessage(error, "保存失败");
    } finally {
        editBusy.value = false;
    }
}

// ---- 传新版本 Dialog ----
const showUpload = ref(false);
const uploadMode = ref<"simple" | "advanced">("simple");
const uploadSource = ref<ContentSource | null>(null);
const uploadChangelog = ref("");
const uploadBusy = ref(false);
const uploadError = ref("");

const uploadModeOptions: SegmentedControlOption[] = [
    {label: "简单模式", value: "simple"},
    {label: "完整包", value: "advanced"},
];

// 简单模式下平台自动把版本递增到 latest+1；安装名沿用条目现有安装名（尚无首版时回退 slug）
const nextVersion = computed(() => (props.item.latestVersion ?? 0) + 1);
const uploadName = computed(() => props.item.name || props.item.slug);

function openUpload(): void {
    uploadMode.value = "simple";
    uploadSource.value = null;
    uploadChangelog.value = "";
    uploadError.value = "";
    showUpload.value = true;
}

function onUploadMode(value: SegmentedControlValue): void {
    uploadMode.value = value as "simple" | "advanced";
    uploadSource.value = null;
}

function onUploadSource(src: ContentSource | null): void {
    uploadSource.value = src;
}

async function doUpload(): Promise<void> {
    const src = uploadSource.value;
    if (!src) {
        uploadError.value = "请先提供新版本内容";
        return;
    }
    uploadBusy.value = true;
    uploadError.value = "";
    try {
        // 完整包 version/name 取自 manifest；简单模式由平台自增并沿用现有安装名
        const advanced = src.kind === "advanced" ? src.parsed : null;
        const built = buildUploadFile(src, {
            slug: props.item.slug,
            name: advanced?.name ?? uploadName.value,
            version: advanced?.version ?? nextVersion.value,
            minAppVersion: advanced?.minAppVersion,
        });
        if (!built.ok) {
            uploadError.value = built.error;
            return;
        }
        const version = await api.uploadVersion(props.item.slug, {file: built.file, changelog: uploadChangelog.value.trim()});
        // 上传成功后本地更新最新版本号（uploadVersion 返回版本 dto，不含条目）
        emit("updated", {...props.item, latestVersion: version.version});
        showUpload.value = false;
        notification.success(`已发布 v${version.version}`);
    } catch (error) {
        uploadError.value = resolveApiErrorMessage(error, "上传失败");
    } finally {
        uploadBusy.value = false;
    }
}

// ---- 上下架 ----
const toggling = ref(false);
async function toggleStatus(): Promise<void> {
    toggling.value = true;
    try {
        const next = isPublished.value ? "unlisted" : "published";
        const updated = await api.updateItem(props.item.slug, {status: next});
        emit("updated", updated);
        notification.success(next === "published" ? "已上架" : "已下架");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "操作失败"));
    } finally {
        toggling.value = false;
    }
}
</script>

<template>
    <Panel padding="sm" class="flex flex-col gap-3">
        <!-- 头部：类型 + 状态 + 版本 -->
        <div class="flex flex-wrap items-center gap-2">
            <ItemTypeBadge :type="item.type" size="sm" />
            <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium" :class="statusBadge.cls">{{ statusBadge.label }}</span>
            <span class="ml-auto text-xs text-[var(--text-muted)]">{{ item.latestVersion ? `v${item.latestVersion}` : "未发布版本" }}</span>
        </div>

        <!-- 标题 + slug -->
        <div>
            <h3 class="font-medium text-[var(--text-main)]">{{ item.title }}</h3>
            <p class="font-mono text-xs text-[var(--text-muted)]">{{ item.slug }}</p>
        </div>

        <!-- 操作条 -->
        <div class="flex flex-wrap items-center gap-2 border-t border-[var(--border-color)] pt-3">
            <Button v-if="isPublished" variant="secondary" size="sm" @click="navigateTo(`/items/${item.slug}`)"><span class="i-lucide-external-link h-4 w-4"></span>查看</Button>
            <Button variant="secondary" size="sm" :disabled="isRemoved" @click="openEdit"><span class="i-lucide-pencil h-4 w-4"></span>编辑</Button>
            <Button variant="secondary" size="sm" :disabled="isRemoved" @click="openUpload"><span class="i-lucide-upload h-4 w-4"></span>传新版本</Button>
            <Button variant="subtle" size="sm" :disabled="isRemoved" :loading="toggling" @click="toggleStatus">
                <span :class="isPublished ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="h-4 w-4"></span>{{ isPublished ? "下架" : "上架" }}
            </Button>
        </div>

        <!-- 编辑元数据 Dialog -->
        <Dialog v-model="showEdit" title="编辑条目" size="md" show-cancel confirm-label="保存" :busy="editBusy" @confirm="saveEdit">
            <div class="flex flex-col gap-3">
                <FormField label="标题" required><FormInput v-model="editTitle" /></FormField>
                <FormField label="摘要"><FormInput v-model="editSummary" /></FormField>
                <FormField label="描述" description="支持 Markdown 语法。"><FormTextarea v-model="editDescription" :rows="4" /></FormField>
                <FormField label="标签" description="逗号分隔，最多 10 个。"><FormInput v-model="editTags" /></FormField>
                <p v-if="editError" class="text-sm text-[var(--status-danger)]">{{ editError }}</p>
            </div>
        </Dialog>

        <!-- 传新版本 Dialog -->
        <Dialog v-model="showUpload" title="上传新版本" size="lg" show-cancel confirm-label="上传" :busy="uploadBusy" @confirm="doUpload">
            <div class="flex flex-col gap-3">
                <SegmentedControl :model-value="uploadMode" :options="uploadModeOptions" aria-label="上传方式" @update:model-value="onUploadMode" />
                <p class="text-sm text-[var(--text-secondary)]">
                    <template v-if="uploadMode === 'simple'">在线编辑或上传内容，平台自动打包为 <strong class="text-[var(--text-main)]">v{{ nextVersion }}</strong>（安装名 {{ uploadName }}）。</template>
                    <template v-else>上传自带 nbook-package.json 的完整 zip，版本号取自 manifest，须大于当前 v{{ item.latestVersion ?? 0 }}。</template>
                </p>
                <PackageContentInput :type="item.type" :mode="uploadMode" @change="onUploadSource" />
                <FormField label="更新说明（可选）"><FormTextarea v-model="uploadChangelog" :rows="3" placeholder="这一版改了什么…" /></FormField>
                <p v-if="uploadError" class="text-sm text-[var(--status-danger)]">{{ uploadError }}</p>
            </div>
        </Dialog>
    </Panel>
</template>
