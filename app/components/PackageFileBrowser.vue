<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {PackageFileContentDto, PackageFileDto} from "../../shared/dto/workshop.dto";

// 包内容在线预览：文件列表视图 ⇄ 单文件预览视图。
// 预览最新版；下载前给用户"看清包里是什么"的途径（profile 是本机执行的代码，信任决策关键）。
const props = defineProps<{
    slug: string;
}>();

const api = useWorkshopApi();

// 文件列表态
const files = ref<PackageFileDto[]>([]);
const version = ref<number | null>(null); // null = 尚未加载
const listLoading = ref(false);
const listError = ref(""); // 空串表示无错误

// 单文件预览态；active 为 null 表示当前在列表视图
const active = ref<PackageFileContentDto | null>(null);
const contentLoading = ref(false);
const contentError = ref("");

/** 按文件名后缀决定预览渲染方式。 */
function renderKind(path: string): "markdown" | "code" | "plain" {
    const lower = path.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
        return "markdown";
    }
    if (/\.(ts|tsx|js|jsx|mjs|cjs|json|vue|css)$/.test(lower)) {
        return "code";
    }
    return "plain";
}

/** 文件列表行图标。 */
function fileIcon(file: PackageFileDto): string {
    const kind = renderKind(file.path);
    if (!file.previewable) {
        return "i-lucide-file";
    }
    return kind === "markdown" ? "i-lucide-file-text" : kind === "code" ? "i-lucide-file-code" : "i-lucide-file-text";
}

// Markdown 预览：SKILL.md 等常见带 YAML frontmatter，截出来单独展示避免渲染成怪表格
const activeMarkdown = computed(() => {
    if (!active.value || renderKind(active.value.path) !== "markdown") {
        return null;
    }
    // 行尾归一：目录 zip 上传保留作者原始行尾，CRLF 会让 frontmatter 检测与 marked 渲染都走样
    const content = active.value.content.replace(/\r\n/g, "\n");
    if (content.startsWith("---\n")) {
        const end = content.indexOf("\n---", 4);
        if (end !== -1) {
            return {frontmatter: content.slice(0, end + 4).trim(), body: content.slice(end + 4).replace(/^\s*\n/, "")};
        }
    }
    return {frontmatter: null, body: content};
});

async function loadList(): Promise<void> {
    listLoading.value = true;
    listError.value = "";
    try {
        const result = await api.getPackageFiles(props.slug);
        files.value = result.files;
        version.value = result.version;
    } catch (error) {
        listError.value = resolveApiErrorMessage(error, "文件列表加载失败");
    } finally {
        listLoading.value = false;
    }
}

async function openFile(file: PackageFileDto): Promise<void> {
    if (!file.previewable) {
        return;
    }
    contentLoading.value = true;
    contentError.value = "";
    try {
        active.value = await api.getPackageFileContent(props.slug, file.path);
    } catch (error) {
        contentError.value = resolveApiErrorMessage(error, "文件内容加载失败");
    } finally {
        contentLoading.value = false;
    }
}

function backToList(): void {
    active.value = null;
    contentError.value = "";
}

// 挂载即拉列表（父组件按 Tab 首次切入才挂载）。Nuxt 默认按插值路径 key 页面组件，
// /items/a → /items/b 是整页重挂载，slug 在实例生命周期内不会变化，无需 watch。
onMounted(() => {
    void loadList();
});
</script>

<template>
    <!-- 包文件浏览器 -->
    <div>
        <!-- 列表视图 -->
        <template v-if="!active">
            <StateBlock v-if="listLoading" state="loading" />
            <StateBlock v-else-if="listError" state="error" :message="listError" :retry="loadList" />
            <StateBlock v-else-if="files.length === 0 && version === null" state="empty" message="尚未上传任何版本" />
            <template v-else>
                <p class="mb-2 text-xs text-[var(--text-muted)]">v{{ version }} · {{ files.length }} 个文件 · 点击可预览文本文件</p>
                <ul class="flex flex-col overflow-hidden rounded-md border border-[var(--border-color)]">
                    <li v-for="file in files" :key="file.path" class="border-b border-[var(--border-color)] last:border-b-0">
                        <button
                            type="button"
                            class="flex w-full items-center gap-2 bg-[var(--bg-panel)] px-3 py-2 text-left text-sm transition-colors"
                            :class="file.previewable ? 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]' : 'cursor-default text-[var(--text-muted)]'"
                            :disabled="contentLoading"
                            @click="openFile(file)"
                        >
                            <span :class="fileIcon(file)" class="h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                            <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ file.path }}</span>
                            <span class="shrink-0 text-xs text-[var(--text-muted)]">{{ formatBytes(file.size) }}</span>
                            <span v-if="!file.previewable" class="shrink-0 text-[11px] text-[var(--text-muted)]">不支持预览</span>
                        </button>
                    </li>
                </ul>
                <p v-if="contentError" class="mt-2 text-xs text-[var(--status-danger)]">{{ contentError }}</p>
            </template>
        </template>

        <!-- 单文件预览视图 -->
        <template v-else>
            <div class="mb-2 flex items-center gap-2">
                <Button variant="subtle" size="sm" @click="backToList"><span class="i-lucide-arrow-left h-4 w-4"></span>返回文件列表</Button>
                <span class="min-w-0 truncate font-mono text-xs text-[var(--text-secondary)]">{{ active.path }}</span>
                <span class="shrink-0 text-xs text-[var(--text-muted)]">{{ formatBytes(active.size) }}</span>
            </div>
            <StateBlock v-if="contentLoading" state="loading" />
            <template v-else-if="activeMarkdown">
                <!-- YAML frontmatter 折叠展示，正文渲染 markdown -->
                <details v-if="activeMarkdown.frontmatter" class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)]">
                    <summary class="cursor-pointer px-3 py-1.5 text-xs text-[var(--text-muted)]">frontmatter 元信息</summary>
                    <pre class="overflow-x-auto px-3 pb-2 font-mono text-xs text-[var(--text-secondary)]">{{ activeMarkdown.frontmatter }}</pre>
                </details>
                <MarkdownView :source="activeMarkdown.body" />
            </template>
            <!-- 代码 / 纯文本走只读 CodeMirror；:key 保证切文件重挂 -->
            <CodeEditor v-else :key="active.path" :model-value="active.content" :language="renderKind(active.path) === 'code' ? 'tsx' : 'plain'" readonly min-height="8rem" />
        </template>
    </div>
</template>
