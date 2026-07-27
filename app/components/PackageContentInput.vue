<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {strToU8} from "fflate";
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {WorkshopItemType} from "../../shared/dto/workshop.dto";
import type {ContentSource, ParsedManifest} from "../utils/workshop-package";
import {parseCanonicalZip, validateSource} from "../utils/workshop-package";

// 资产内容输入：按类型 + 模式渲染「在线编辑 / 单文件 / 目录压缩包 / 完整包」输入，
// 产出 ContentSource 交父组件打包。发布向导与 /me 传新版本共用本组件。
// 表单内可恢复错误写本组件局部 error（zip 解析失败等），不外抛。
const props = defineProps<{
    type: WorkshopItemType;
    mode: "simple" | "advanced"; // simple = 平台生成 manifest；advanced = 上传完整 canonical zip
}>();

// 内容就绪时回传 ContentSource；无输入 / 校验失败时回传 null（父组件据此禁用下一步）
const emit = defineEmits<{(e: "change", source: ContentSource | null): void}>();

// 输入方式：simple+profile=editor/file；simple+skill=editor/dirzip；advanced=zip（单一，不显示选择器）
type InputMethod = "editor" | "file" | "dirzip" | "zip";

const methodOptions = computed<SegmentedControlOption[]>(() => {
    if (props.mode === "advanced") {
        return [{label: "上传完整包", value: "zip"}];
    }
    if (props.type === "profile") {
        return [{label: "在线编辑", value: "editor"}, {label: "上传单文件", value: "file"}];
    }
    return [{label: "在线编辑", value: "editor"}, {label: "上传目录压缩包", value: "dirzip"}];
});

const method = ref<InputMethod>("editor");
const localError = ref("");
const pickedName = ref(""); // 已选文件名展示

// 各输入方式的内容载体
const editorText = ref(""); // profile=.tsx 全文，skill=SKILL.md 全文
const uploadedBytes = ref<Uint8Array | null>(null); // 单文件 / 目录 zip 读出的字节
const advancedFile = ref<File | null>(null);
const advancedParsed = ref<ParsedManifest | null>(null);

const editorLanguage = computed<"tsx" | "markdown">(() => (props.type === "profile" ? "tsx" : "markdown"));
const editorPlaceholder = computed(() => (props.type === "profile" ? "粘贴或编写 profile 的 .tsx 全文…" : "编写 SKILL.md 全文…"));
const filePlaceholderHint = computed(() => (props.type === "profile" ? "选择单个 .tsx 文件（平台会按安装名重命名入口）" : "选择 skill 目录的 .zip（根部含 SKILL.md，无需 nbook-package.json）"));

// 类型 / 模式变化时重置全部输入
watch(
    () => [props.type, props.mode],
    () => {
        method.value = props.mode === "advanced" ? "zip" : "editor";
        reset();
    },
);

function reset(): void {
    localError.value = "";
    pickedName.value = "";
    editorText.value = "";
    uploadedBytes.value = null;
    advancedFile.value = null;
    advancedParsed.value = null;
    emit("change", null);
}

function onMethod(value: SegmentedControlValue): void {
    method.value = value as InputMethod;
    reset();
}

/** 依据当前方式与内容组装 ContentSource，校验后回传父组件。 */
function emitCurrent(): void {
    localError.value = "";
    let source: ContentSource | null = null;

    if (props.mode === "advanced") {
        if (advancedFile.value && advancedParsed.value) {
            source = {kind: "advanced", file: advancedFile.value, parsed: advancedParsed.value};
        }
    } else if (props.type === "profile") {
        const bytes = method.value === "editor" ? strToU8(editorText.value) : uploadedBytes.value;
        if (bytes && bytes.byteLength > 0) {
            source = {kind: "profile", bytes};
        }
    } else {
        if (method.value === "editor") {
            const bytes = strToU8(editorText.value);
            if (bytes.byteLength > 0) {
                source = {kind: "skill", bytes, isDirZip: false};
            }
        } else if (uploadedBytes.value) {
            source = {kind: "skill", bytes: uploadedBytes.value, isDirZip: true};
        }
    }

    if (!source) {
        emit("change", null); // 尚无输入，不报错，仅禁用下一步
        return;
    }
    const check = validateSource(source);
    if (!check.ok) {
        localError.value = check.error;
        emit("change", null);
        return;
    }
    emit("change", source);
}

// 编辑器输入 → 即时回传
watch(editorText, () => {
    if (method.value === "editor") {
        emitCurrent();
    }
});

/** 读取所选文件字节（单文件 / 目录 zip / 完整包）。 */
async function onPick(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    localError.value = "";
    if (!file) {
        return;
    }
    pickedName.value = file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (method.value === "zip") {
        if (!file.name.toLowerCase().endsWith(".zip")) {
            localError.value = "请选择 .zip 文件";
            emit("change", null);
            return;
        }
        const result = parseCanonicalZip(bytes);
        if (!result.ok) {
            localError.value = result.error;
            advancedFile.value = null;
            advancedParsed.value = null;
            emit("change", null);
            return;
        }
        advancedFile.value = file;
        advancedParsed.value = result.manifest;
        emitCurrent();
        return;
    }

    if (method.value === "dirzip" && !file.name.toLowerCase().endsWith(".zip")) {
        localError.value = "请选择 .zip 文件";
        emit("change", null);
        return;
    }
    if (method.value === "file" && !/\.(tsx|ts)$/i.test(file.name)) {
        localError.value = "请选择 .tsx 文件";
        emit("change", null);
        return;
    }
    uploadedBytes.value = bytes;
    emitCurrent();
}
</script>

<template>
    <div class="flex flex-col gap-3">
        <!-- 输入方式选择（advanced 仅一种，隐藏） -->
        <SegmentedControl v-if="methodOptions.length > 1" :model-value="method" :options="methodOptions" aria-label="输入方式" @update:model-value="onMethod" />

        <!-- 在线编辑 -->
        <template v-if="method === 'editor'">
            <CodeEditor :key="editorLanguage" v-model="editorText" :language="editorLanguage" :placeholder="editorPlaceholder" />
        </template>

        <!-- 单文件 / 目录 zip / 完整包 -->
        <template v-else>
            <label class="flex cursor-pointer flex-col gap-1 rounded-md border border-dashed border-[var(--border-color)] px-3 py-4 text-sm hover:border-[var(--accent-main)]">
                <span class="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span class="i-lucide-upload h-4 w-4"></span>
                    <span>{{ pickedName || "点击选择文件" }}</span>
                </span>
                <span class="text-xs text-[var(--text-muted)]">{{ method === "zip" ? "上传自带 nbook-package.json 的完整 canonical zip" : filePlaceholderHint }}</span>
                <input type="file" :accept="method === 'file' ? '.tsx,.ts' : '.zip'" class="hidden" @change="onPick" />
            </label>

            <!-- advanced 解析结果摘要 -->
            <dl v-if="method === 'zip' && advancedParsed" class="grid grid-cols-2 gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm">
                <div><dt class="text-xs text-[var(--text-muted)]">类型</dt><dd class="mt-0.5"><ItemTypeBadge :type="advancedParsed.type" size="sm" /></dd></div>
                <div><dt class="text-xs text-[var(--text-muted)]">安装名</dt><dd class="mt-0.5 font-mono text-[var(--text-main)]">{{ advancedParsed.name }}</dd></div>
                <div><dt class="text-xs text-[var(--text-muted)]">版本</dt><dd class="mt-0.5 text-[var(--text-main)]">v{{ advancedParsed.version }}</dd></div>
                <div><dt class="text-xs text-[var(--text-muted)]">兼容下限</dt><dd class="mt-0.5 text-[var(--text-main)]">{{ advancedParsed.minAppVersion ? `≥ ${advancedParsed.minAppVersion}` : "未声明" }}</dd></div>
            </dl>
        </template>

        <p v-if="localError" class="text-sm text-[var(--status-danger)]">{{ localError }}</p>
    </div>
</template>
