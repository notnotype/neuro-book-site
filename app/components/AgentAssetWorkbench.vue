<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import type {FileTreeMove, FileTreeNode, SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {AgentAssetType} from "../../shared/agent-asset-package";
import {AGENT_ASSET_LIMITS, packageRunsCode} from "../../shared/agent-asset-package";
import type {DraftEntry, DraftValidationExpectation, PackageDraft, PackageWorkbenchState} from "../utils/workshop-package";
import {
    addDraftEntry,
    buildDraftZip,
    bumpDraftVersion,
    createPackageDraft,
    deleteDraftEntry,
    draftEntriesFromFiles,
    draftFileTree,
    draftFromZip,
    editorLanguage,
    isEditableText,
    mergeDraftEntries,
    moveDraftEntry,
    parseDraftPackage,
    renameDraftEntry,
    updateDraftFile,
    updateDraftIdentity,
    updateDraftPackage,
    validateDraftPackage,
} from "../utils/workshop-package";

type BrowserFileEntry = {
    isFile: true;
    isDirectory: false;
    name: string;
    file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
};

type BrowserDirectoryEntry = {
    isFile: false;
    isDirectory: true;
    name: string;
    createReader: () => {
        readEntries: (success: (entries: BrowserEntry[]) => void, failure?: (error: DOMException) => void) => void;
    };
};

type BrowserEntry = BrowserFileEntry | BrowserDirectoryEntry;
type BrowserDataTransferItem = {webkitGetAsEntry?: () => BrowserEntry | null};

const props = withDefaults(defineProps<{
    initialBytes?: Uint8Array;
    initialType?: AgentAssetType;
    initialName?: string;
    initialVersion?: string;
    lockedType?: boolean;
    lockedIdentity?: boolean;
    latestVersion?: string;
}>(), {
    initialBytes: undefined,
    initialType: "skill",
    initialName: "new-asset",
    initialVersion: "1.0.0",
    lockedType: false,
    lockedIdentity: false,
    latestVersion: undefined,
});

const emit = defineEmits<{(event: "change", state: PackageWorkbenchState): void}>();
const notification = useNotification();

const draft = ref<PackageDraft>(createPackageDraft(props.initialType, props.initialName, props.initialVersion));
const dirty = ref(false);
const selectedId = ref<string | null>("package.json");
const expandedIds = ref<string[]>([]);
const localError = ref("");
let validationRevision = 0;
let identityRevision = 0;
const directoryInput = ref<HTMLInputElement | null>(null);
const directoryZipInput = ref<HTMLInputElement | null>(null);
const packageZipInput = ref<HTMLInputElement | null>(null);

const treeNodes = computed(() => draftFileTree(draft.value));
const selectedEntry = computed(() => draft.value.entries.find((entry) => entry.path === selectedId.value));
const parsed = computed(() => parseDraftPackage(draft.value));
const packageJson = computed(() => parsed.value.ok ? parsed.value.packageJson : null);
const selectedText = computed(() => isEditableText(selectedEntry.value) ? new TextDecoder().decode(selectedEntry.value?.bytes) : null);
const executable = computed(() => packageJson.value ? packageRunsCode(packageJson.value) : false);
const validationExpectation = computed<DraftValidationExpectation | undefined>(() => props.lockedType
    ? {
          type: props.initialType,
          ...(props.lockedIdentity ? {name: props.initialName, latestVersion: props.latestVersion} : {}),
      }
    : undefined);
const typeOptions = computed<SegmentedControlOption[]>(() => [
    {label: "Skill", value: "skill", disabled: props.lockedType && packageJson.value?.neurobook.assetType !== "skill"},
    {label: "Workflow", value: "workflow", disabled: props.lockedType && packageJson.value?.neurobook.assetType !== "workflow"},
    {label: "Profile", value: "profile", disabled: props.lockedType && packageJson.value?.neurobook.assetType !== "profile"},
]);

const entryDialog = ref(false);
const entryAction = ref<"file" | "directory" | "rename">("file");
const entryName = ref("");
const entryError = ref("");

/** 提交新草稿并向发布页同步校验状态。 */
function commit(next: PackageDraft, markDirty = true): void {
    draft.value = next;
    dirty.value = markDirty || dirty.value;
    localError.value = "";
    publishState();
}

/** 同步基础状态，并异步运行共享 TypeScript AST 校验。 */
function publishState(): void {
    const result = parseDraftPackage(draft.value);
    const revision = ++validationRevision;
    if (!result.ok) {
        emit("change", {draft: draft.value, packageJson: null, error: result.error, validating: false, dirty: dirty.value});
        return;
    }
    emit("change", {
        draft: draft.value,
        packageJson: result.packageJson,
        error: "",
        validating: true,
        dirty: dirty.value,
    });
    void validateDraftPackage(draft.value, validationExpectation.value).then((validated) => {
        if (revision !== validationRevision) {
            return;
        }
        emit("change", {
            draft: draft.value,
            packageJson: validated.ok ? validated.packageJson : result.packageJson,
            error: validated.ok ? "" : validated.error,
            validating: false,
            dirty: dirty.value,
        });
    });
}

/** 详情或更新页初始化 ZIP；新建页使用模板。 */
async function initialize(): Promise<void> {
    if (props.initialBytes) {
        const imported = await draftFromZip(props.initialBytes);
        if (imported.ok) {
            draft.value = imported.draft;
            const packageResult = parseDraftPackage(imported.draft);
            if (packageResult.ok) {
                const suggested = bumpDraftVersion(packageResult.packageJson.version, "patch");
                if (suggested) {
                    draft.value = updateDraftPackage(draft.value, {version: suggested});
                }
            }
        } else {
            localError.value = imported.error;
        }
    }
    expandedIds.value = draft.value.entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path);
    dirty.value = false;
    publishState();
}

/** 选择节点；目录单击仅选择，展开由 FileTree 自己发受控事件。 */
function selectNode(node: FileTreeNode): void {
    selectedId.value = node.id;
}

/** 双击目录展开，双击文件选中并进入编辑。 */
function activateNode(node: FileTreeNode): void {
    selectedId.value = node.id;
    if (node.kind === "directory" && !expandedIds.value.includes(node.id)) {
        expandedIds.value = [...expandedIds.value, node.id];
    }
}

/** 更新当前文本文件；二进制文件不会进入此函数。 */
function editSelected(content: string): void {
    if (!selectedEntry.value || selectedEntry.value.bytes.length === new TextEncoder().encode(content).length
        && new TextDecoder().decode(selectedEntry.value.bytes) === content) {
        return;
    }
    commit(updateDraftFile(draft.value, selectedEntry.value.path, content));
}

/** 打开新建文件/目录或重命名 Dialog。 */
function openEntryDialog(action: "file" | "directory" | "rename"): void {
    entryAction.value = action;
    entryName.value = action === "rename" ? selectedEntry.value?.path.split("/").at(-1) ?? "" : "";
    entryError.value = "";
    entryDialog.value = true;
}

/** 应用 Dialog 中的文件树结构修改。 */
function applyEntryDialog(): void {
    const name = entryName.value.trim();
    if (!name) {
        entryError.value = "名称不能为空";
        return;
    }
    let result: ReturnType<typeof addDraftEntry> | ReturnType<typeof renameDraftEntry>;
    if (entryAction.value === "rename") {
        if (!selectedEntry.value || selectedEntry.value.path === "package.json") {
            entryError.value = "根 package.json 不能重命名";
            return;
        }
        result = renameDraftEntry(draft.value, selectedEntry.value.path, name);
    } else {
        const parent = selectedEntry.value?.kind === "directory"
            ? selectedEntry.value.path
            : selectedEntry.value?.path.includes("/") ? selectedEntry.value.path.slice(0, selectedEntry.value.path.lastIndexOf("/")) : "";
        const path = parent ? `${parent}/${name}` : name;
        result = addDraftEntry(draft.value, {path, kind: entryAction.value, bytes: new Uint8Array()});
    }
    if (!result.ok) {
        entryError.value = result.error;
        return;
    }
    commit(result.draft);
    selectedId.value = entryAction.value === "rename"
        ? result.draft.entries.find((entry) => entry.path.endsWith(`/${name}`) || entry.path === name)?.path ?? selectedId.value
        : result.draft.entries.find((entry) => entry.path.endsWith(`/${name}`) || entry.path === name)?.path ?? selectedId.value;
    entryDialog.value = false;
}

/** 删除选中条目；目录会连同后代删除。 */
function removeSelected(): void {
    const entry = selectedEntry.value;
    if (!entry || entry.path === "package.json") {
        return;
    }
    if (!window.confirm(`确认删除 ${entry.path}${entry.kind === "directory" ? " 及其全部内容" : ""}？`)) {
        return;
    }
    commit(deleteDraftEntry(draft.value, entry.path));
    selectedId.value = "package.json";
}

/** 应用 FileTree 拖拽移动。 */
function moveEntry(move: FileTreeMove): void {
    const result = moveDraftEntry(draft.value, move);
    if (!result.ok) {
        notification.error(result.error);
        return;
    }
    commit(result.draft);
    selectedId.value = result.selectedPath;
}

/** 结构化修改包名，并同步三类入口源码中的安装身份。 */
async function setPackageName(value: string): Promise<void> {
    const revision = ++identityRevision;
    const result = await updateDraftIdentity(draft.value, value.trim());
    if (revision !== identityRevision) {
        return;
    }
    if (!result.ok) {
        localError.value = result.error;
        return;
    }
    commit(result.draft);
}

/** 修改自定义 SemVer；非法值会让发布按钮保持禁用。 */
function setPackageVersion(value: string): void {
    commit(updateDraftPackage(draft.value, {version: value.trim()}));
}

/** 应用 patch/minor/major SemVer 建议。 */
function bumpVersion(release: "patch" | "minor" | "major"): void {
    if (!packageJson.value) {
        return;
    }
    const version = bumpDraftVersion(packageJson.value.version, release);
    if (version) {
        commit(updateDraftPackage(draft.value, {version}));
    }
}

/** 切换资产类型会重建模板，避免旧入口与新协议混杂。 */
function changeType(value: SegmentedControlValue): void {
    const assetType = value as AgentAssetType;
    if (props.lockedType) {
        return;
    }
    if (packageJson.value?.neurobook.assetType === assetType) {
        return;
    }
    if (dirty.value && !window.confirm("切换资产类型会重建包模板并丢弃当前文件，是否继续？")) {
        return;
    }
    const name = packageJson.value?.name ?? props.initialName;
    const version = packageJson.value?.version ?? props.initialVersion;
    selectedId.value = "package.json";
    expandedIds.value = [];
    commit(createPackageDraft(assetType, name, version));
}

/** 将目录选择或拖入的多个文件合并到草稿，并对覆盖做一次确认。 */
async function importFiles(files: File[]): Promise<void> {
    const imported = await draftEntriesFromFiles(files);
    if (!imported.ok) {
        localError.value = imported.error;
        return;
    }
    let merged = mergeDraftEntries(draft.value, imported.entries, false);
    if (!merged.ok) {
        localError.value = merged.error;
        return;
    }
    if (merged.conflicts.length > 0) {
        if (!window.confirm(`将覆盖 ${merged.conflicts.length} 个同名文件，是否继续？`)) {
            return;
        }
        merged = mergeDraftEntries(draft.value, imported.entries, true);
    }
    if (!merged.ok) {
        localError.value = merged.error;
        return;
    }
    commit(merged.draft);
}

/** 导入目录 ZIP，自动剥离常见的单层顶级文件夹。 */
async function importDirectoryZip(file: File): Promise<void> {
    const imported = await draftFromZip(file, true);
    if (!imported.ok) {
        localError.value = imported.error;
        return;
    }
    let merged = mergeDraftEntries(draft.value, imported.draft.entries, false);
    if (!merged.ok) {
        localError.value = merged.error;
        return;
    }
    if (merged.conflicts.length > 0) {
        if (!window.confirm(`目录 ZIP 将覆盖 ${merged.conflicts.length} 个同名条目，是否继续？`)) {
            return;
        }
        merged = mergeDraftEntries(draft.value, imported.draft.entries, true);
    }
    if (!merged.ok) {
        localError.value = merged.error;
        return;
    }
    commit(merged.draft);
}

/** 导入完整包会替换整个草稿，但允许先导入不完整包再在线修正。 */
async function importPackageZip(file: File): Promise<void> {
    const imported = await draftFromZip(file);
    if (!imported.ok) {
        localError.value = imported.error;
        return;
    }
    const validated = await validateDraftPackage(imported.draft, validationExpectation.value);
    if (!validated.ok) {
        localError.value = validated.error;
        return;
    }
    if (dirty.value && !window.confirm("导入完整包会替换当前草稿，是否继续？")) {
        return;
    }
    commit(imported.draft);
    selectedId.value = "package.json";
    expandedIds.value = imported.draft.entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path);
}

/** 导出当前完整包，不经过服务器。 */
async function exportPackage(): Promise<void> {
    const result = await buildDraftZip(draft.value, packageJson.value?.name ?? "agent-asset", validationExpectation.value);
    if (!result.ok) {
        localError.value = result.error;
        return;
    }
    const url = URL.createObjectURL(result.file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.file.name;
    anchor.click();
    URL.revokeObjectURL(url);
}

/** 读取 Chromium 目录拖拽条目；底层浏览器 API 只有回调形式，因此在边界包装成 Promise。 */
async function readBrowserEntry(entry: BrowserEntry, prefix = ""): Promise<Array<{path: string; file: File}>> {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
        return [{path, file}];
    }
    const reader = entry.createReader();
    const children: BrowserEntry[] = [];
    while (true) {
        const batch = await new Promise<BrowserEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) {
            break;
        }
        children.push(...batch);
    }
    const nested = await Promise.all(children.map((child) => readBrowserEntry(child, path)));
    return nested.flat();
}

/** 接收文件或目录拖入，并保留目录相对路径。 */
async function handleDrop(event: DragEvent): Promise<void> {
    const items = [...(event.dataTransfer?.items ?? [])] as BrowserDataTransferItem[];
    const roots = items.map((item) => (item as BrowserDataTransferItem).webkitGetAsEntry?.()).filter((entry): entry is BrowserEntry => entry !== null && entry !== undefined);
    if (roots.length === 0) {
        await importFiles([...(event.dataTransfer?.files ?? [])]);
        return;
    }
    const located = (await Promise.all(roots.map((entry) => readBrowserEntry(entry)))).flat();
    if (located.length > AGENT_ASSET_LIMITS.entries
        || located.reduce((total, item) => total + item.file.size, 0) > AGENT_ASSET_LIMITS.uncompressedBytes) {
        localError.value = "拖入内容超过 500 个文件或 100 MiB 上限";
        return;
    }
    const entries: DraftEntry[] = [];
    for (const item of located) {
        entries.push({path: item.path, kind: "file", bytes: new Uint8Array(await item.file.arrayBuffer())});
    }
    let merged = mergeDraftEntries(draft.value, entries, false);
    if (!merged.ok) {
        localError.value = merged.error;
        return;
    }
    if (merged.conflicts.length > 0 && window.confirm(`将覆盖 ${merged.conflicts.length} 个同名文件，是否继续？`)) {
        merged = mergeDraftEntries(draft.value, entries, true);
    } else if (merged.conflicts.length > 0) {
        return;
    }
    if (!merged.ok) {
        localError.value = merged.error;
        return;
    }
    commit(merged.draft);
}

onMounted(() => void initialize());
</script>

<template>
    <!-- 资产包工作台：左侧文件树，右侧结构化协议与内容编辑。 -->
    <div class="flex min-h-[36rem] flex-col overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div class="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
            <Button size="sm" variant="secondary" @click="openEntryDialog('file')"><span class="i-lucide-file-plus h-4 w-4"></span>新建文件</Button>
            <Button size="sm" variant="secondary" @click="openEntryDialog('directory')"><span class="i-lucide-folder-plus h-4 w-4"></span>新建目录</Button>
            <Button size="sm" variant="subtle" :disabled="!selectedEntry || selectedEntry.path === 'package.json'" @click="openEntryDialog('rename')"><span class="i-lucide-pencil h-4 w-4"></span>重命名</Button>
            <Button size="sm" variant="subtle" :disabled="!selectedEntry || selectedEntry.path === 'package.json'" @click="removeSelected"><span class="i-lucide-trash-2 h-4 w-4"></span>删除</Button>
            <span class="hidden h-5 w-px bg-[var(--border-color)] sm:block"></span>
            <Button size="sm" variant="secondary" @click="directoryInput?.click()"><span class="i-lucide-folder-input h-4 w-4"></span>导入目录</Button>
            <Button size="sm" variant="secondary" @click="directoryZipInput?.click()"><span class="i-lucide-file-archive h-4 w-4"></span>目录 ZIP</Button>
            <Button size="sm" variant="secondary" @click="packageZipInput?.click()"><span class="i-lucide-package-open h-4 w-4"></span>完整包</Button>
            <Button size="sm" variant="subtle" class="sm:ml-auto" @click="exportPackage"><span class="i-lucide-download h-4 w-4"></span>导出包</Button>
            <input ref="directoryInput" type="file" multiple webkitdirectory class="hidden" @change="importFiles([...($event.target as HTMLInputElement).files ?? []])" />
            <input ref="directoryZipInput" type="file" accept=".zip,application/zip" class="hidden" @change="($event.target as HTMLInputElement).files?.[0] && importDirectoryZip(($event.target as HTMLInputElement).files![0]!)" />
            <input ref="packageZipInput" type="file" accept=".zip,application/zip" class="hidden" @change="($event.target as HTMLInputElement).files?.[0] && importPackageZip(($event.target as HTMLInputElement).files![0]!)" />
        </div>

        <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)]">
            <!-- 文件树 -->
            <aside class="min-h-48 overflow-auto border-b border-[var(--border-color)] p-2 md:border-b-0 md:border-r" @dragover.prevent @drop.prevent="handleDrop">
                <FileTree
                    :nodes="treeNodes"
                    :selected-id="selectedId"
                    :expanded-ids="expandedIds"
                    draggable
                    aria-label="资产包文件"
                    @update:expanded-ids="expandedIds = $event"
                    @select="selectNode"
                    @activate="activateNode"
                    @move="moveEntry"
                />
            </aside>

            <!-- 编辑区 -->
            <section class="flex min-w-0 flex-col overflow-auto p-4">
                <div v-if="selectedEntry?.path === 'package.json' && packageJson" class="mb-4 grid grid-cols-1 gap-3 border-b border-[var(--border-color)] pb-4 lg:grid-cols-2">
                    <FormField label="资产类型">
                        <SegmentedControl :model-value="packageJson.neurobook.assetType" :options="typeOptions" aria-label="资产类型" @update:model-value="changeType" />
                    </FormField>
                    <FormField label="安装名" :description="packageJson.neurobook.assetType === 'profile' ? '小写点分 key；每段可使用连字符，Profile 入口会同步重命名。' : 'kebab-case；固定入口会同步重命名。'">
                        <FormInput :model-value="packageJson.name" @update:model-value="setPackageName" />
                    </FormField>
                    <FormField label="版本" description="使用 SemVer。">
                        <div class="flex flex-wrap gap-2">
                            <FormInput class="min-w-36 flex-1" :model-value="packageJson.version" @update:model-value="setPackageVersion" />
                            <Button size="sm" variant="secondary" @click="bumpVersion('patch')">patch</Button>
                            <Button size="sm" variant="secondary" @click="bumpVersion('minor')">minor</Button>
                            <Button size="sm" variant="secondary" @click="bumpVersion('major')">major</Button>
                        </div>
                    </FormField>
                    <FormField label="最低 NeuroBook 版本" description="可选 SemVer。">
                        <FormInput :model-value="packageJson.neurobook.minAppVersion ?? ''" placeholder="0.8.0" @update:model-value="commit(updateDraftPackage(draft, {minAppVersion: $event.trim()}))" />
                    </FormField>
                </div>

                <div v-if="executable" class="mb-3 flex items-start gap-2 rounded-md border border-[var(--status-warning)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                    <span class="i-lucide-shield-alert mt-0.5 h-4 w-4 shrink-0 text-[var(--status-warning)]"></span>
                    <span>这个资产包含会在用户设备上运行的代码。发布前请确认所有脚本、依赖和入口内容。</span>
                </div>

                <template v-if="selectedEntry?.kind === 'file'">
                    <div class="mb-2 flex items-center justify-between gap-3">
                        <span class="min-w-0 truncate font-mono text-xs text-[var(--text-secondary)]">{{ selectedEntry.path }}</span>
                        <span class="shrink-0 text-xs text-[var(--text-muted)]">{{ formatBytes(selectedEntry.bytes.byteLength) }}</span>
                    </div>
                    <CodeEditor
                        v-if="selectedText !== null"
                        :key="selectedEntry.path"
                        :model-value="selectedText"
                        :language="editorLanguage(selectedEntry.path)"
                        min-height="24rem"
                        @update:model-value="editSelected"
                    />
                    <div v-else class="flex min-h-56 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-color)] text-[var(--text-muted)]">
                        <span class="i-lucide-file h-8 w-8"></span>
                        <p class="text-sm">二进制文件仅保留，不提供在线编辑</p>
                    </div>
                </template>
                <div v-else-if="selectedEntry?.kind === 'directory'" class="flex min-h-56 items-center justify-center text-sm text-[var(--text-muted)]">已选择目录 {{ selectedEntry.path }}</div>
                <div v-else class="flex min-h-56 items-center justify-center text-sm text-[var(--text-muted)]">从左侧选择文件</div>

                <p v-if="localError || !parsed.ok" class="mt-3 text-sm text-[var(--status-danger)]">{{ localError || (!parsed.ok ? parsed.error : '') }}</p>
                <p class="mt-2 text-xs text-[var(--text-muted)]">{{ draft.entries.length }} 个条目 · 草稿仅保存在当前页面</p>
            </section>
        </div>

        <Dialog v-model="entryDialog" :title="entryAction === 'rename' ? '重命名' : entryAction === 'file' ? '新建文件' : '新建目录'" size="sm" show-cancel confirm-label="确定" @confirm="applyEntryDialog">
            <FormField label="名称" required>
                <FormInput v-model="entryName" autofocus @keydown.enter="applyEntryDialog" />
            </FormField>
            <p v-if="entryError" class="mt-2 text-sm text-[var(--status-danger)]">{{ entryError }}</p>
        </Dialog>
    </div>
</template>
