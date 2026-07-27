<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref, watch} from "vue";
// 仅类型导入（编译期擦除），运行时 CodeMirror 全部走 onMounted 内动态 import，
// 让 CM 进独立 async chunk：只有编辑器真正挂载的页面才加载（首屏不背 600K+）。
import type {EditorView} from "@codemirror/view";

// 轻量 CodeMirror 6 包装：v-model 绑定文本，language 决定语法高亮；readonly 用于包内容在线预览。
// 工坊为 SPA（ssr:false），编辑器仅在客户端 onMounted 挂载，无 SSR 水合问题。
// language/readonly 在挂载时固定；父组件切换时用 :key 强制重挂即可（无需 Compartment 重配）。
const props = withDefaults(
    defineProps<{
        modelValue: string;
        language: "tsx" | "markdown" | "plain"; // tsx = profile/代码文件，markdown = SKILL.md，plain = 无高亮文本
        placeholder?: string;
        minHeight?: string;
        readonly?: boolean; // 只读预览：禁编辑、不回传 v-model
    }>(),
    {placeholder: "", minHeight: "18rem", readonly: false},
);

const emit = defineEmits<{(e: "update:modelValue", value: string): void}>();

const host = ref<HTMLDivElement | null>(null);
// EditorView 是命令式实例，非响应式，用普通变量持有
let view: EditorView | null = null;
// 组件卸载先于动态 import 完成时，跳过挂载
let disposed = false;

onMounted(async () => {
    const [{EditorState}, cmView, {basicSetup}, {indentWithTab}, {javascript}, {markdown}, {oneDark}] = await Promise.all([
        import("@codemirror/state"),
        import("@codemirror/view"),
        import("codemirror"),
        import("@codemirror/commands"),
        import("@codemirror/lang-javascript"),
        import("@codemirror/lang-markdown"),
        import("@codemirror/theme-one-dark"),
    ]);
    if (disposed || !host.value) {
        return;
    }
    const {EditorView: View, keymap, placeholder: cmPlaceholder} = cmView;
    view = new View({
        parent: host.value,
        state: EditorState.create({
            doc: props.modelValue,
            extensions: [
                basicSetup,
                keymap.of([indentWithTab]), // Tab 缩进而非跳焦
                ...(props.language === "markdown" ? [markdown()] : props.language === "tsx" ? [javascript({jsx: true, typescript: true})] : []),
                oneDark,
                cmPlaceholder(props.placeholder),
                View.theme({
                    "&": {minHeight: props.minHeight, fontSize: "13px"},
                    ".cm-scroller": {fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"},
                }),
                ...(props.readonly
                    ? [EditorState.readOnly.of(true), View.editable.of(false)]
                    : [
                          // 文档变化时回传 v-model（只读预览不需要）
                          View.updateListener.of((update) => {
                              if (update.docChanged) {
                                  emit("update:modelValue", update.state.doc.toString());
                              }
                          }),
                      ]),
            ],
        }),
    });
});

// 外部改 modelValue（如清空 / 预填）时同步到编辑器，避免与内部编辑回环
watch(
    () => props.modelValue,
    (value) => {
        if (view && value !== view.state.doc.toString()) {
            view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: value}});
        }
    },
);

onBeforeUnmount(() => {
    disposed = true;
    view?.destroy();
    view = null;
});
</script>

<template>
    <div ref="host" class="overflow-hidden rounded-md border border-[var(--border-color)]"></div>
</template>

<style scoped>
:deep(.cm-editor) { height: 100%; }
:deep(.cm-editor.cm-focused) { outline: none; }
</style>
