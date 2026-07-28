<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {FileTreeNode, FormSelectOption} from "@notnotype/nb-ui/components";
import type {ItemVersionDto, PackageFileContentDto, PackageFileDto} from "../../shared/dto/workshop.dto";

const props = defineProps<{
    slug: string;
    versions: ItemVersionDto[];
}>();

const api = useWorkshopApi();
const route = useRoute();
const router = useRouter();
const files = ref<PackageFileDto[]>([]);
const version = ref("");
const selectedPath = ref("");
const expandedIds = ref<string[]>([]);
const active = ref<PackageFileContentDto | null>(null);
const listLoading = ref(false);
const contentLoading = ref(false);
const error = ref("");
const mobileTreeOpen = ref(false);
let requestGeneration = 0;

const versionOptions = computed<FormSelectOption[]>(() => props.versions.map((item) => ({label: `v${item.version}`, value: item.version})));

const treeNodes = computed<FileTreeNode[]>(() => {
    const nodes = new Map<string, FileTreeNode>();
    for (const file of files.value) {
        const parts = file.path.split("/");
        for (let index = 0; index < parts.length; index += 1) {
            const path = parts.slice(0, index + 1).join("/");
            const isFile = index === parts.length - 1;
            if (!nodes.has(path)) {
                nodes.set(path, {
                    id: path,
                    label: parts[index] ?? path,
                    kind: isFile ? "file" : "directory",
                    iconClass: isFile ? fileIcon(path) : undefined,
                    children: [],
                });
            }
        }
    }
    const roots: FileTreeNode[] = [];
    for (const node of nodes.values()) {
        const parent = nodes.get(parentPath(node.id));
        (parent?.children ?? roots).push(node);
    }
    const sort = (items: FileTreeNode[]): void => {
        items.sort((left, right) => left.kind === right.kind ? left.label.localeCompare(right.label) : left.kind === "directory" ? -1 : 1);
        items.forEach((item) => sort(item.children ?? []));
    };
    sort(roots);
    return roots;
});

const directoryPaths = computed(() => new Set(files.value.flatMap((file) => {
    const parts = file.path.split("/");
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
})));

const selectedFile = computed(() => files.value.find((file) => file.path === selectedPath.value) ?? null);
const directoryEntries = computed(() => {
    const current = selectedFile.value ? parentPath(selectedFile.value.path) : selectedPath.value;
    const rows = new Map<string, {path: string; name: string; kind: "file" | "directory"; size: number; previewable: boolean}>();
    for (const file of files.value) {
        if (parentPath(file.path) === current) {
            rows.set(file.path, {path: file.path, name: baseName(file.path), kind: "file", size: file.size, previewable: file.previewable});
            continue;
        }
        if (file.path.startsWith(current ? `${current}/` : "")) {
            const remainder = current ? file.path.slice(current.length + 1) : file.path;
            const first = remainder.split("/")[0];
            if (first && remainder.includes("/")) {
                const path = current ? `${current}/${first}` : first;
                rows.set(path, {path, name: first, kind: "directory", size: 0, previewable: false});
            }
        }
    }
    return [...rows.values()].sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === "directory" ? -1 : 1);
});

const breadcrumb = computed(() => {
    const path = selectedFile.value ? parentPath(selectedFile.value.path) : selectedPath.value;
    const parts = path ? path.split("/") : [];
    return [{label: "根目录", path: ""}, ...parts.map((part, index) => ({label: part, path: parts.slice(0, index + 1).join("/")}))];
});

const activeMarkdown = computed(() => {
    if (!active.value || renderKind(active.value.path) !== "markdown") {
        return null;
    }
    const content = active.value.content.replace(/\r\n/g, "\n");
    if (content.startsWith("---\n")) {
        const end = content.indexOf("\n---", 4);
        if (end !== -1) {
            return {frontmatter: content.slice(0, end + 4).trim(), body: content.slice(end + 4).replace(/^\s*\n/, "")};
        }
    }
    return {frontmatter: null, body: content};
});

/** 读取目标版本文件清单，并恢复 URL 中的路径。 */
async function loadList(targetVersion: string, targetPath: string): Promise<void> {
    const generation = ++requestGeneration;
    listLoading.value = true;
    error.value = "";
    active.value = null;
    try {
        const result = await api.getPackageFiles(props.slug, targetVersion);
        if (generation !== requestGeneration) {
            return;
        }
        files.value = result.files;
        version.value = result.version;
        const directories = new Set(result.files.flatMap((file) => {
            const parts = file.path.split("/");
            return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
        }));
        if (targetPath && !result.files.some((file) => file.path === targetPath) && !directories.has(targetPath)) {
            error.value = "指定的包内路径不存在";
            selectedPath.value = "";
        } else {
            selectedPath.value = targetPath;
            const pathParts = targetPath.split("/").filter(Boolean);
            const expandedDepth = directories.has(targetPath) ? pathParts.length : Math.max(0, pathParts.length - 1);
            expandedIds.value = pathParts.slice(0, expandedDepth).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
            if (result.files.find((file) => file.path === targetPath)?.previewable) {
                await loadFile(targetPath, result.version, generation);
            }
        }
    } catch (cause) {
        if (generation === requestGeneration) {
            error.value = resolveApiErrorMessage(cause, "文件列表加载失败");
        }
    } finally {
        if (generation === requestGeneration) {
            listLoading.value = false;
        }
    }
}

/** 读取一个可预览文本文件；不增加公开下载计数。 */
async function loadFile(path: string, targetVersion = version.value, generation = requestGeneration): Promise<void> {
    contentLoading.value = true;
    error.value = "";
    try {
        const result = await api.getPackageFileContent(props.slug, path, targetVersion);
        if (generation === requestGeneration) {
            active.value = result;
        }
    } catch (cause) {
        if (generation === requestGeneration) {
            error.value = resolveApiErrorMessage(cause, "文件内容加载失败");
        }
    } finally {
        if (generation === requestGeneration) {
            contentLoading.value = false;
        }
    }
}

/** 把版本/路径写入可分享 URL，并保留 files Tab。 */
async function navigateState(path: string, targetVersion = version.value): Promise<void> {
    await router.push({
        path: route.path,
        query: {tab: "files", version: targetVersion, ...(path ? {path} : {})},
    });
}

/** 文件树与目录行共用的导航入口。 */
async function openPath(path: string): Promise<void> {
    mobileTreeOpen.value = false;
    await navigateState(path);
}

/** 版本选择改变后回到该版本根目录。 */
async function changeVersion(value: string): Promise<void> {
    await navigateState("", value);
}

/** 文件树选择行为与 GitHub 一致：单击即浏览目录或打开文本文件。 */
function selectNode(node: FileTreeNode): void {
    void openPath(node.id);
}

/** 判断预览渲染类型。 */
function renderKind(path: string): "markdown" | "code" | "plain" {
    const lower = path.toLowerCase();
    return lower.endsWith(".md") || lower.endsWith(".markdown") ? "markdown"
        : /\.(?:ts|tsx|js|jsx|mjs|cjs|json|vue|css)$/.test(lower) ? "code" : "plain";
}

/** 文件图标按扩展名区分。 */
function fileIcon(path: string): string {
    const kind = renderKind(path);
    return kind === "markdown" ? "i-lucide-file-text" : kind === "code" ? "i-lucide-file-code" : "i-lucide-file";
}

/** 相对路径父目录。 */
function parentPath(path: string): string {
    return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** 相对路径文件名。 */
function baseName(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

watch(
    () => [String(route.query.version ?? ""), String(route.query.path ?? "")],
    ([routeVersion, routePath]) => {
        const targetVersion = props.versions.some((item) => item.version === routeVersion)
            ? routeVersion
            : props.versions[0]?.version ?? "";
        if (targetVersion) {
            if (routeVersion !== targetVersion) {
                void router.replace({
                    path: route.path,
                    query: {...route.query, tab: "files", version: targetVersion},
                });
                return;
            }
            void loadList(targetVersion, routePath ?? "");
        }
    },
    {immediate: true},
);
</script>

<template>
    <!-- GitHub 式包文件浏览：版本与路径都存入 URL。 -->
    <div class="overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div class="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
            <div class="w-40"><FormSelect :model-value="version" :options="versionOptions" aria-label="资产版本" @update:model-value="changeVersion" /></div>
            <nav class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm" aria-label="包内路径">
                <template v-for="(part, index) in breadcrumb" :key="part.path || 'root'">
                    <span v-if="index > 0" class="i-lucide-chevron-right h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                    <button type="button" class="shrink-0 text-[var(--accent-text)] hover:underline" @click="openPath(part.path)">{{ part.label }}</button>
                </template>
                <template v-if="selectedFile">
                    <span class="i-lucide-chevron-right h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                    <span class="min-w-0 truncate font-mono text-xs text-[var(--text-main)]">{{ baseName(selectedFile.path) }}</span>
                </template>
            </nav>
            <Button class="md:hidden" size="sm" variant="secondary" @click="mobileTreeOpen = !mobileTreeOpen"><span class="i-lucide-files h-4 w-4"></span>文件</Button>
        </div>

        <StateBlock v-if="listLoading && files.length === 0" state="loading" />
        <StateBlock v-else-if="error && files.length === 0" state="error" :message="error" :retry="() => loadList(version, selectedPath)" />
        <div v-else class="grid min-h-[30rem] grid-cols-1 md:grid-cols-[17rem_minmax(0,1fr)]">
            <aside :class="mobileTreeOpen ? 'block' : 'hidden md:block'" class="max-h-72 overflow-auto border-b border-[var(--border-color)] p-2 md:max-h-none md:border-b-0 md:border-r">
                <FileTree
                    :nodes="treeNodes"
                    :selected-id="selectedPath || null"
                    :expanded-ids="expandedIds"
                    aria-label="资产包文件"
                    @update:expanded-ids="expandedIds = $event"
                    @select="selectNode"
                    @activate="selectNode"
                />
            </aside>

            <section class="min-w-0 overflow-auto p-4">
                <StateBlock v-if="contentLoading" state="loading" />
                <template v-else-if="selectedFile && !selectedFile.previewable">
                    <div class="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-[var(--text-muted)]">
                        <span class="i-lucide-file h-9 w-9"></span>
                        <div><p class="font-mono text-sm text-[var(--text-main)]">{{ selectedFile.path }}</p><p class="mt-1 text-xs">{{ formatBytes(selectedFile.size) }} · 不支持在线预览</p></div>
                    </div>
                </template>
                <template v-else-if="active">
                    <details v-if="activeMarkdown?.frontmatter" class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2">
                        <summary class="cursor-pointer text-xs font-medium text-[var(--text-secondary)]">YAML frontmatter</summary>
                        <pre class="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-[var(--text-muted)]">{{ activeMarkdown.frontmatter }}</pre>
                    </details>
                    <MarkdownView v-if="activeMarkdown" :source="activeMarkdown.body" />
                    <CodeEditor v-else-if="renderKind(active.path) === 'code'" :model-value="active.content" language="tsx" readonly min-height="26rem" />
                    <pre v-else class="whitespace-pre-wrap break-words font-mono text-sm text-[var(--text-main)]">{{ active.content }}</pre>
                </template>
                <template v-else>
                    <ul class="overflow-hidden rounded-md border border-[var(--border-color)]">
                        <li v-for="entry in directoryEntries" :key="entry.path" class="border-b border-[var(--border-color)] last:border-b-0">
                            <button type="button" class="flex h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-[var(--bg-hover)]" @click="openPath(entry.path)">
                                <span :class="entry.kind === 'directory' ? 'i-lucide-folder' : fileIcon(entry.path)" class="h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                                <span class="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-main)]">{{ entry.name }}</span>
                                <span v-if="entry.kind === 'file'" class="shrink-0 text-xs text-[var(--text-muted)]">{{ formatBytes(entry.size) }}</span>
                            </button>
                        </li>
                    </ul>
                </template>
                <p v-if="error" class="mt-3 text-sm text-[var(--status-danger)]">{{ error }}</p>
            </section>
        </div>
    </div>
</template>
