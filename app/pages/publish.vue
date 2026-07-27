<script setup lang="ts">
import {resolveApiErrorMessage} from "@notnotype/nb-ui/utils";
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {WorkshopItemDto, WorkshopItemType} from "../../shared/dto/workshop.dto";
import type {ContentSource} from "../utils/workshop-package";
import {buildUploadFile} from "../utils/workshop-package";

// 发布向导：新建条目 + 首版上传。已有条目传新版本从 /me 入口走。
// 简单模式：在线编辑 / 单文件（profile）/ 目录 zip（skill）→ 平台生成 manifest、版本固定为 1。
// 完整包模式：上传自带 nbook-package.json 的 canonical zip，type/name/version 取自其 manifest。
definePageMeta({middleware: "auth"});
useHead({title: "发布资产"});

const api = useWorkshopApi();
const notification = useNotification();

// kebab-case，与后端 slug / manifest name 同口径
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const steps = [
    {n: 1, label: "类型与来源"},
    {n: 2, label: "填写元数据"},
    {n: 3, label: "确认"},
    {n: 4, label: "发布"},
] as const;

const step = ref<1 | 2 | 3 | 4>(1);

// 来源选择
const mode = ref<"simple" | "advanced">("simple");
const assetType = ref<WorkshopItemType>("skill");
const source = ref<ContentSource | null>(null);

const modeOptions: SegmentedControlOption[] = [
    {label: "简单模式", value: "simple"},
    {label: "完整包", value: "advanced"},
];
const typeOptions: SegmentedControlOption[] = [
    {label: "Skill", value: "skill"},
    {label: "Profile", value: "profile"},
];

// 元数据表单
const slug = ref("");
const title = ref("");
const summary = ref("");
const description = ref("");
const tagsInput = ref(""); // 逗号分隔
const minAppVersion = ref(""); // 简单模式可选；完整包取自 manifest

// 发布态
const publishing = ref(false);
const publishError = ref("");
// createItem 成功后记住条目，重试时跳过创建，避免 slug 409
const createdItem = ref<WorkshopItemDto | null>(null);

const slugValue = computed(() => slug.value.trim());
const slugValid = computed(() => slugValue.value.length >= 3 && slugValue.value.length <= 64 && KEBAB.test(slugValue.value));
const metaValid = computed(() => slugValid.value && title.value.trim().length > 0);
const tags = computed(() => tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean));

// 完整包模式下 type/name/version 以 manifest 为准，简单模式由平台生成
const advancedParsed = computed(() => (source.value?.kind === "advanced" ? source.value.parsed : null));
const effectiveType = computed<WorkshopItemType>(() => advancedParsed.value?.type ?? assetType.value);
const effectiveName = computed(() => advancedParsed.value?.name ?? slugValue.value);
const effectiveVersion = computed(() => advancedParsed.value?.version ?? 1);
const effectiveMinApp = computed(() => advancedParsed.value?.minAppVersion ?? (minAppVersion.value.trim() || undefined));

function onMode(value: SegmentedControlValue): void {
    mode.value = value as "simple" | "advanced";
    source.value = null; // 切模式后需重新提供内容
}
function onType(value: SegmentedControlValue): void {
    assetType.value = value as WorkshopItemType;
}

/** PackageContentInput 内容变化：记录来源，完整包模式下用 manifest.name 预填 slug/标题。 */
function onSource(next: ContentSource | null): void {
    source.value = next;
    if (next?.kind === "advanced") {
        slug.value = slug.value || next.parsed.name;
        title.value = title.value || next.parsed.name;
    }
}

function goNext(): void {
    if (step.value < 4) {
        step.value = (step.value + 1) as 1 | 2 | 3 | 4;
    }
}
function goBack(): void {
    if (step.value > 1) {
        step.value = (step.value - 1) as 1 | 2 | 3 | 4;
    }
}

async function publish(): Promise<void> {
    if (!source.value) {
        return;
    }
    publishing.value = true;
    publishError.value = "";
    try {
        // 先在前端打包成 canonical zip（简单模式生成 manifest；完整包直接透传）
        const built = buildUploadFile(source.value, {
            slug: slugValue.value,
            name: effectiveName.value,
            version: effectiveVersion.value,
            minAppVersion: effectiveMinApp.value,
        });
        if (!built.ok) {
            publishError.value = built.error;
            return;
        }
        // createItem 成功后不再重复创建（重试只补上传），避免 slug 抢注 409
        if (!createdItem.value) {
            createdItem.value = await api.createItem({
                slug: slugValue.value,
                type: effectiveType.value,
                title: title.value.trim(),
                summary: summary.value.trim(),
                description: description.value,
                tags: tags.value,
            });
        }
        await api.uploadVersion(createdItem.value.slug, {file: built.file, changelog: ""});
        notification.success("发布成功");
        await navigateTo(`/items/${createdItem.value.slug}`);
    } catch (error) {
        publishError.value = resolveApiErrorMessage(error, "发布失败");
    } finally {
        publishing.value = false;
    }
}
</script>

<template>
    <section class="mx-auto flex max-w-2xl flex-col gap-6">
        <h1 class="text-xl font-semibold text-[var(--text-main)]">发布资产</h1>

        <!-- 步骤条 -->
        <ol class="flex items-center gap-2">
            <template v-for="(item, index) in steps" :key="item.n">
                <li class="flex items-center gap-2">
                    <span class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium" :class="step > item.n ? 'bg-[var(--accent-main)] text-[var(--text-inverse)]' : step === item.n ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] ring-1 ring-[var(--accent-main)]' : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'">
                        <span v-if="step > item.n" class="i-lucide-check h-3.5 w-3.5"></span>
                        <span v-else>{{ item.n }}</span>
                    </span>
                    <span class="text-xs" :class="step >= item.n ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'">{{ item.label }}</span>
                </li>
                <li v-if="index < steps.length - 1" class="h-px w-6 bg-[var(--border-color)]"></li>
            </template>
        </ol>

        <Panel class="flex flex-col gap-5">
            <!-- Step 1：类型与来源 -->
            <div v-show="step === 1" class="flex flex-col gap-4">
                <FormField label="发布模式" description="简单模式由平台自动生成 nbook-package.json 与版本号；完整包沿用手写 manifest 的 zip。">
                    <SegmentedControl :model-value="mode" :options="modeOptions" aria-label="发布模式" @update:model-value="onMode" />
                </FormField>
                <FormField v-if="mode === 'simple'" label="资产类型">
                    <SegmentedControl :model-value="assetType" :options="typeOptions" aria-label="资产类型" @update:model-value="onType" />
                </FormField>
                <ExecutableWarning v-if="effectiveType === 'profile'" />
                <PackageContentInput :type="assetType" :mode="mode" @change="onSource" />
                <p v-if="mode === 'advanced'" class="text-xs text-[var(--text-muted)]">完整包模式下类型 / 安装名 / 版本取自包内 manifest。</p>
            </div>

            <!-- Step 2：填写元数据 -->
            <div v-show="step === 2" class="flex flex-col gap-4">
                <FormField label="slug" description="全局唯一，kebab-case，3-64 字符，发布后不可改。" required>
                    <FormInput v-model="slug" name="slug" placeholder="my-awesome-skill" />
                </FormField>
                <p v-if="slug && !slugValid" class="-mt-2 text-xs text-[var(--status-danger)]">slug 必须是 kebab-case，长度 3-64。</p>
                <FormField label="标题" required><FormInput v-model="title" name="title" placeholder="给它一个吸引人的名字" /></FormField>
                <FormField label="摘要" description="一句话简介，列表卡片会展示。"><FormInput v-model="summary" name="summary" /></FormField>
                <FormField label="描述" description="支持 Markdown 语法。"><FormTextarea v-model="description" :rows="5" /></FormField>
                <FormField label="标签" description="用逗号分隔，最多 10 个。"><FormInput v-model="tagsInput" name="tags" placeholder="写作, 校对, 中文" /></FormField>
                <FormField v-if="mode === 'simple'" label="NeuroBook 兼容下限（可选）" description="留空表示不声明，例如 0.5.0。"><FormInput v-model="minAppVersion" name="minAppVersion" placeholder="0.5.0" /></FormField>
                <div class="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
                    <span class="i-lucide-lock h-3.5 w-3.5"></span>
                    <span v-if="mode === 'simple'">安装名将使用 slug（<strong class="text-[var(--text-secondary)]">{{ slugValue || "…" }}</strong>），版本从 v1 开始。</span>
                    <span v-else>类型 <strong class="text-[var(--text-secondary)]">{{ effectiveType }}</strong> · 安装名 <strong class="text-[var(--text-secondary)]">{{ effectiveName }}</strong> · v{{ effectiveVersion }}（取自 manifest）。</span>
                </div>
            </div>

            <!-- Step 3：确认 -->
            <div v-show="step === 3" class="flex flex-col gap-4">
                <p class="text-sm text-[var(--text-secondary)]">确认下列信息后进入发布。首版会以 v{{ effectiveVersion }} 落库。</p>
                <dl class="grid grid-cols-1 gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm sm:grid-cols-2">
                    <div><dt class="text-xs text-[var(--text-muted)]">slug</dt><dd class="mt-0.5 font-mono text-[var(--text-main)]">{{ slugValue }}</dd></div>
                    <div><dt class="text-xs text-[var(--text-muted)]">类型 / 版本</dt><dd class="mt-0.5 text-[var(--text-main)]">{{ effectiveType }} · v{{ effectiveVersion }}</dd></div>
                    <div><dt class="text-xs text-[var(--text-muted)]">安装名</dt><dd class="mt-0.5 font-mono text-[var(--text-main)]">{{ effectiveName }}</dd></div>
                    <div><dt class="text-xs text-[var(--text-muted)]">兼容下限</dt><dd class="mt-0.5 text-[var(--text-main)]">{{ effectiveMinApp ? `NeuroBook ≥ ${effectiveMinApp}` : "未声明" }}</dd></div>
                    <div class="sm:col-span-2"><dt class="text-xs text-[var(--text-muted)]">标题</dt><dd class="mt-0.5 text-[var(--text-main)]">{{ title.trim() }}</dd></div>
                    <div v-if="tags.length" class="sm:col-span-2"><dt class="text-xs text-[var(--text-muted)]">标签</dt><dd class="mt-1"><TagChips :tags="tags" /></dd></div>
                </dl>
            </div>

            <!-- Step 4：发布 -->
            <div v-show="step === 4" class="flex flex-col gap-4">
                <p class="text-sm text-[var(--text-secondary)]">一切就绪，点击发布把资产打包上传。</p>
                <p v-if="publishError" class="text-sm text-[var(--status-danger)]">{{ publishError }}</p>
            </div>

            <!-- 步骤导航 -->
            <div class="flex items-center justify-between border-t border-[var(--border-color)] pt-4">
                <Button variant="subtle" :disabled="step === 1 || publishing" @click="goBack"><span class="i-lucide-arrow-left h-4 w-4"></span>上一步</Button>
                <Button v-if="step === 1" :disabled="!source" @click="goNext">下一步<span class="i-lucide-arrow-right h-4 w-4"></span></Button>
                <Button v-else-if="step === 2" :disabled="!metaValid" @click="goNext">下一步<span class="i-lucide-arrow-right h-4 w-4"></span></Button>
                <Button v-else-if="step === 3" @click="goNext">下一步<span class="i-lucide-arrow-right h-4 w-4"></span></Button>
                <Button v-else :loading="publishing" @click="publish"><span class="i-lucide-upload h-4 w-4"></span>发布</Button>
            </div>
        </Panel>
    </section>
</template>
