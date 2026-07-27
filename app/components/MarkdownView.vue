<script lang="ts">
import DOMPurify from "dompurify";
import {marked} from "marked";

// 模块级注册一次：外链一律新窗口打开并断开 opener（防钓鱼 / tab-nabbing）。
// 放 <script setup> 会随每个组件实例重复注册，这里保证全局只挂一个 hook。
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
    }
});
</script>

<script setup lang="ts">
import {computed} from "vue";

// 安全的 Markdown 渲染：marked 解析 + DOMPurify 消毒后 v-html。
// 用于条目描述与包内 .md 文件预览；评论仍是纯文本插值，不走这里。
const props = defineProps<{
    source: string;
}>();

const html = computed(() => {
    // breaks: 单换行渲染为 <br>——描述字段历史上按"纯文本保留换行"书写，保证存量内容不变形
    // marked 同步模式下 parse 返回 string；async 选项未开启，断言安全
    const raw = marked.parse(props.source, {gfm: true, breaks: true, async: false});
    return DOMPurify.sanitize(raw);
});
</script>

<template>
    <!-- Markdown 渲染容器：排版样式见下方 scoped，全部走主题变量 -->
    <div class="markdown-view text-sm leading-relaxed text-[var(--text-secondary)]" v-html="html"></div>
</template>

<style scoped>
.markdown-view :deep(h1),
.markdown-view :deep(h2),
.markdown-view :deep(h3),
.markdown-view :deep(h4),
.markdown-view :deep(h5),
.markdown-view :deep(h6) {
    color: var(--text-main);
    font-weight: 600;
    line-height: 1.4;
    margin: 1.25em 0 0.5em;
}
.markdown-view :deep(h1) { font-size: 1.35em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
.markdown-view :deep(h2) { font-size: 1.2em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.25em; }
.markdown-view :deep(h3) { font-size: 1.08em; }
.markdown-view :deep(h1:first-child),
.markdown-view :deep(h2:first-child),
.markdown-view :deep(h3:first-child) { margin-top: 0; }

.markdown-view :deep(p) { margin: 0.6em 0; }
.markdown-view :deep(ul),
.markdown-view :deep(ol) { margin: 0.6em 0; padding-left: 1.5em; }
.markdown-view :deep(ul) { list-style: disc; }
.markdown-view :deep(ol) { list-style: decimal; }
.markdown-view :deep(li) { margin: 0.25em 0; }

.markdown-view :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 2px; }
.markdown-view :deep(strong) { color: var(--text-main); font-weight: 600; }

.markdown-view :deep(code) {
    background: var(--bg-subtle);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 0.1em 0.35em;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
}
.markdown-view :deep(pre) {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 0.75em 1em;
    margin: 0.75em 0;
    overflow-x: auto;
}
.markdown-view :deep(pre code) { background: transparent; border: none; padding: 0; font-size: 0.85em; }

.markdown-view :deep(blockquote) {
    border-left: 3px solid var(--border-strong);
    color: var(--text-muted);
    margin: 0.75em 0;
    padding: 0.1em 0 0.1em 1em;
}

.markdown-view :deep(table) { border-collapse: collapse; margin: 0.75em 0; width: 100%; }
.markdown-view :deep(th),
.markdown-view :deep(td) { border: 1px solid var(--border-color); padding: 0.4em 0.75em; text-align: left; }
.markdown-view :deep(th) { background: var(--bg-subtle); color: var(--text-main); font-weight: 600; }

.markdown-view :deep(hr) { border: none; border-top: 1px solid var(--border-color); margin: 1.25em 0; }
.markdown-view :deep(img) { max-width: 100%; border-radius: 6px; }
</style>
