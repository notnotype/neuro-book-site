# NeuroBook Workshop — Web UI / UX 设计与实现 walkthrough

> 本文记录早期整数版本与 `nbook-package.json` 阶段的历史过程。当前 Skill / Workflow / Profile 统一包协议、SemVer、文件浏览和发布工作台以 [Task 01](../01-agent-asset-workbench/README.md) 为准。

Phase 1 后端已建成（见 `PROJECT-STATUS.md` 与 neuro-book `docs/tasks/88-workshop-platform/README.md`）。本文件是 **Web 前端**的设计规范 + 持续 walkthrough。设计真相源仍是 neuro-book 88 文档的 Web 页面节；本文件在其上补充落地级交互与状态细节。

## 已定设计决策（2026-07-05，用户经预览选定）

- **浏览列表**：卡片网格（响应式，1/2/3 列）。
- **发布页**：分步向导（① 选 zip → ② 前端解析 manifest 就地展示校验 → ③ 填元数据 → ④ 上传发布）。
- **详情页**：双栏 + 右侧 sticky 下载侧栏；小屏侧栏堆到正文上方。
- **本轮范围**：全部页面一次做完（浏览 / 详情 / 作者页 / 发布 / 个人页 / admin / 登录注册）。

## 落地技术决策

- **图标**：`nuxt.config` 开 `unocss: { icons: true }`（模块默认 `wind3:true / icons:false`，`@iconify-json/lucide` 已装），用 `i-lucide-*` class。不新建 `uno.config.ts`，避免动到模板已依赖的 wind3 utilities。
- **description 渲染**：**纯文本 + `whitespace-pre-wrap`**，不解析 markdown / 不渲染 HTML。理由：88 文档把 "markdown sanitize / 禁 raw HTML" 列为门 A 安全债，明确"不实现也不顺手实现"；纯文本天然规避存储型 XSS，零新依赖。门 A 做安全加固时再引入 sanitized markdown。
- **评论**：纯文本，Vue 插值默认转义（后端契约即纯文本）。
- **分页**：卡片网格 + "加载更多" 追加，用后端 Page 的 `nextOffset`。
- **API 访问**：类型化 composable `useWorkshopApi`（全页面复用，DTO 取自 `shared/dto/workshop.dto.ts`），不在业务组件里散写 `$fetch` 结构。
- **错误文案**：`resolveApiErrorMessage(error, fallback)`（`@notnotype/nb-ui/utils`）。可恢复表单/加载错误写入口局部 error state；跨入口/后台/复制类即时反馈用 `useNotification()`。
- **主题**：沿用模板 dark + amber accent（`app/theme/default-theme.ts`）。

## 发现的既有缺口（本轮修复）

- 2026-07-05 当时的缺口：`app/pages/register.vue` 未发送必填邀请码，注册页对当时后端失效；当轮已修复。2026-07-27 起该旧合同由“必填注册码 + 可选邀请码”取代，见文末 follow-up。

## 应用壳与布局

- `app.vue`：`<NuxtLayout><NuxtPage/></NuxtLayout>` + `<NotificationViewport/>`，`onMounted` 应用主题。
- `app/layouts/default.vue`：顶栏 `AppHeader` + `<slot/>`，内容区 `max-w-6xl mx-auto`。浏览/详情/作者/发布/me/admin 用它。
- 登录/注册用 `definePageMeta({layout: false})` 保持全屏居中卡片。
- **AppHeader**：左 logo→`/`；中搜索框（回车跳 `/?q=`）；右按登录态切换——未登录显示 登录/注册；已登录显示 `发布` 按钮、用户菜单（`/me`、`退出`）、admin 额外 `管理` 入口。`useAuthState()` 提供 session，派生 `isLoggedIn` / `isAdmin`。

## useWorkshopApi 面（typed，返回 shared DTO）

读：`listItems(query)` `getItem(slug)` `getVersions(slug)` `getComments(slug,page)` `downloadHref(slug,version?)` `getUser(username)` `getMeta()`。
写（登录）：`createItem(body)` `uploadVersion(slug,{file,changelog})` `updateItem(slug,patch)` `like/unlike(slug)` `favorite/unfavorite(slug)` `addComment(slug,content)` `deleteComment(id)` `report(slug,reason)` `myFavorites(page)`，以及 `list/create/updateMyInviteCode` 管理本人邀请码。
admin：`create/list/updateRegistrationCode` 管理注册码，另有 `listReports(page)` `resolveReport(id)` `setItemStatus(id,status)`。

均以 `shared/dto/workshop.dto.ts` 类型标注入参出参；上传走 `FormData`（file part 必带 filename）。

## 共享组件（app/components/）

- `ItemCard.vue`：网格卡片。type 徽章 + 标题 + title 副标题 + summary + tag chips + 统计（↓下载 / ♥赞 / 💬评论）+ 作者 + `v{latestVersion} · 相对时间`。profile 显示 ⚠ 小徽标。整卡链接到 `/items/:slug`。
- `ItemTypeBadge.vue`：skill / profile 彩色徽章（skill=accent 蓝绿向，profile=紫 + warning 感），props `{type, size?}`。
- `ExecutableWarning.vue`：profile 详情/发布页固定警示条——"此包含在你本机服务端进程执行的 TypeScript 代码，安装前请确认来源可信"。一行，status-warning 色。
- `StateBlock.vue`：列表/详情统一的 加载 / 空 / 错误 占位，props `{state: "loading"|"empty"|"error", message?, retry?}`。
- `TagChips.vue`：tag 数组渲染为 chip，可选 `to`（点击跳 `/?tags=`）。

小统计行、相对时间格式内联到 ItemCard/详情，不过度抽组件。相对时间用轻量本地函数（`Date` 在浏览器可用）。

## 页面规格

### `/` 浏览（index.vue）
顶部筛选条：type SegmentedControl（全部/skill/profile）+ 排序 Dropdown（最新/下载/点赞）+ 搜索框（与 AppHeader 搜索同步 `q`）。筛选状态映射到 URL query（`q/type/tags/sort`），刷新可复现、可分享。卡片网格 + 加载更多。空/错误走 StateBlock。tag chip 点击进 `tags` 过滤。

### `/items/[slug]` 详情
左主栏：头部（type 徽章 + slug + title + 作者链接 + tag chips）；profile 显示 ExecutableWarning；Tab（描述 / 版本 / 评论）。描述=纯文本 pre-wrap；版本=版本列表（version、changelog、大小、相对时间、下载该版）；评论=列表（楼层序、加载更多）+ 发表框（登录可见，未登录提示去登录）+ 本人/admin 可删。
右 sticky 侧栏：大 `下载` 按钮（最新版，`downloadHref`）；安装名（可复制）；统计（下载/赞/最新版/更新时间）；`收藏`（登录，切换态）；`举报`（登录，Dialog 填理由）。viewer 状态来自 detail 的 `viewer`。
状态权限：404→"条目不存在或已下架"整页 StateBlock。

### `/users/[username]` 作者页
作者资料（displayName/username/加入时间）+ 其 published 条目卡片网格（后端此接口不分页，直接铺）。404 走 StateBlock。

### `/publish` 发布向导（middleware: auth）
> 2026-07-06 友好上传改造后为准（详见文末 walkthrough）。四步：① **类型与来源**（发布模式 简单/完整包；简单模式选 skill/profile + 在线编辑或上传单文件/目录 zip；完整包上传自带 manifest 的 canonical zip）→ ② **填元数据**（slug/title/summary/description/tags，简单模式可选 minAppVersion）→ ③ **确认** → ④ **发布**（`buildUploadFile` 前端打成 canonical zip → `createItem` + `uploadVersion`）。简单模式 manifest 由表单生成、version 固定 v1、安装名 = slug；完整模式 type/name/version 取自包内 manifest。

> 前端打包只在浏览器把「友好输入」拼成 canonical zip，**真相源仍是后端校验**（version 递增、type/name 一致等以后端返回为准）。

### `/me` 个人页（middleware: auth）
两块（SegmentedControl 切）：
- 我的发布：列出自己全部条目（含 unlisted，依赖后端 `GET /api/v1/me/items`）。每条：编辑元数据（Dialog，复用 updateItem）、**传新版本**（复用 `PackageContentInput`：在线编辑 / 单文件 / 目录 zip / 完整包，平台自动把版本递增到 latest+1、沿用条目现有安装名）、`上架/下架`（published↔unlisted）。
- 我的收藏：`myFavorites` 分页卡片网格，取消收藏即时移除。

### `/admin` 控制台（middleware: auth + admin 派生拦截）
非 admin 整页 StateBlock（"需要管理员权限"）。三块 Tab：
- 邀请码：签发（count）→ 展示新码明文（可复制）。
- 举报：列表（未处理在前）+ `resolve`。
- 条目管理：按 slug/id 查条目并 `removed`/恢复（`setItemStatus`）。本轮最简：输入条目 id + 目标状态。

## 状态与交互约定

- 每个数据页有明确 加载 / 空 / 错误 三态（StateBlock）。
- 破坏性/外发动作（举报、下架、删除评论）前用 Dialog 确认。
- 列表加载更多按钮在 `hasMore=false` 时隐藏，并显示"共 N 条"。
- 所有金额/计数用千分位无关的裸数字（第一版）。

## 构建波次

1. 地基：nuxt.config icons、useWorkshopApi、app.vue+layout+AppHeader、共享组件。
2. 读者页：index、items/[slug]、users/[username]。
3. 登录注册修复。
4. 发布向导。
5. `/me`（含后端补 `GET /me/items`）。
6. `/admin`。
7. 验证（typecheck/build）+ 文档回填。

## Implementation Walkthrough

- 2026-07-05：设计定稿（列表卡片网格 / 发布分步向导 / 详情双栏 / 全量范围），落本文件。技术决策：icons via unocss module flag、description 纯文本、typed composable。开始按波次实现。
- 2026-07-06：**Web 前端全量实现完成**（7 波次一次做完，页面全部落地）。交付：
    - 地基：`nuxt.config` 开 `unocss:{icons:true}`；类型化 `app/composables/useWorkshopApi.ts`（唯一 `$fetch` 出口，入出参全取 `shared/dto/workshop.dto.ts`）；`app/utils/format.ts`（相对时间 / 日期 / 字节，纯 `Date` 浏览器安全）；`app.vue` 挂 `NuxtLayout` + `NotificationViewport` + onMounted 应用主题；`layouts/default.vue` + `AppHeader.vue`（登录态切换、搜索跳 `/?q=`、admin 额外入口）。
    - 共享组件：`ItemCard` / `ItemTypeBadge` / `ExecutableWarning` / `TagChips` / `StateBlock` / `ItemComments` / `MyItemManageCard`。小统计行与相对时间内联，不过度抽组件。
    - 页面：`/`（index，筛选态映射 URL query 可分享、加载更多）、`/items/[slug]`（双栏 + 右 sticky 下载栏、描述 / 版本 / 评论 Tab、点赞 / 收藏乐观更新 + 失败回滚、举报 Dialog、404 整页态）、`/users/[username]`、`/login` + `/register`（补邀请码字段，修此前对新后端已失效的注册）、`/publish`（四步向导 + 前端 `fflate` 就地解析 manifest 早暴露错误 + `createdItem` ref 让重试跳过创建避免 slug 409）、`/me`（我的发布 / 我的收藏两 Tab，`createFeed` 工厂复用分页）、`/admin`（邀请码 / 举报 / 条目管理 + 非 admin 整页拦截）。
    - **后端补口**：新增 `server/api/v1/me/items.get.ts`（本人全部状态条目分页，含 unlisted / removed，按更新时间倒序），补上 neuro-book 88 文档标注的 Web 阶段缺口；加集成用例证明 unlisted 条目对作者 `/me/items` 可见、对公开 `/api/v1/items` 不可见。
  实现中修复：index.vue 的 `route.query` 联合类型不收窄到字面量（改为三元直接返回 `"skill"` / `"profile"` 等字面量）；IconButton 无 `ghost` variant（删评论按钮改 `danger`）；publish.vue 误写恒真的 `ExecutableWarning` 判定（删除）。
  验证：`typecheck`（nuxt prepare + prisma generate + vue-tsc）0 error；`build` 产物含 `me/items.get.mjs`、全组件与 UnoCSS 类解析通过；`test` 4 文件 **41 用例**全绿（集成 21，含新增 `/me/items` 用例）。**未做浏览器验证**（按项目规约，交用户手动验收）。
- 2026-07-06（后续）：**友好上传改造**——消灭「手写 `nbook-package.json` + 手拼 zip + 手维护 version」三摩擦。
    - 设计原则：canonical 包格式（zip + 根部 manifest）作为存储 / 下载 / Phase 2 安装契约**保持不变，后端零改动**；只在前端增加友好输入方式，用 `fflate` 就地打成 canonical zip，再走现有 `createItem` + `uploadVersion`。后端 `parseWorkshopPackage` 仍是校验真相源。
    - 输入方式：**profile** = 在线编辑（`.tsx`）/ 上传单文件；**skill** = 在线编辑（`SKILL.md`，覆盖绝大多数单文件 skill）/ 上传 skill 目录压缩包（**无需 manifest**）。另保留 **「完整包」高级模式**（上传自带 manifest 的 canonical zip，`type`/`name`/`version` 取自其 manifest）。用户经预览选定 = CodeMirror 编辑器 + 保留完整包回退。
    - manifest 由发布表单**自动生成**，version **平台自增**（新建 = 1，`/me` 传新版 = latest+1），简单模式安装名 = slug；profile 入口文件名由平台按 name 生成，顺带绕开 builtin key 带点与 kebab-case 冲突。目录 zip **自动剥离单层顶层文件夹**（Windows 右键压缩文件夹产生的 `my-skill/` 前缀），并覆盖用户自带旧 manifest（表单为真相源）。
    - 新增产物：`app/utils/workshop-package.ts`（客户端打包 `buildUploadFile` / `parseCanonicalZip` / `validateSource` + 剥离顶层目录）；`app/components/CodeEditor.vue`（CodeMirror 6 轻量包装，`v-model` + `language=tsx/markdown`，仅客户端挂载，SPA 无水合问题）；`app/components/PackageContentInput.vue`（输入方式 UI，发布向导与 `/me` 复用）。
    - 改造：`publish.vue` 四步向导重构为「类型与来源 → 元数据 → 确认 → 发布」；`MyItemManageCard.vue`「传新版本」对话框接入同组件 + 自动版本号 / 沿用现有安装名。
    - 依赖：`bun add codemirror @codemirror/lang-javascript @codemirror/lang-markdown @codemirror/theme-one-dark`。**避坑**：bun 首装 `codemirror` 元包目录为空（Windows 抽取 glitch，子包 `@codemirror/*` 齐全），`rm -rf node_modules/codemirror && bun add codemirror --force` 修复。TS 侧 `Uint8Array<ArrayBufferLike>` 不满足 DOM `BlobPart`，`new File([bytes as BlobPart], ...)` 断言收窄。
    - 验证：`typecheck` 0 error；`build` 通过（CodeMirror 正常打包，Σ 8.44 MB / 2.59 MB gzip）；`test` **41 → 50**（新增 `tests/workshop-package-client.test.ts` 9 用例，含「客户端生成的包被**后端** `parseWorkshopPackage` 接受」的跨端契约断言）。**未做浏览器验证**。
- 2026-07-07：**UI 地基同步 nb-fullstack-template**——修 body 默认 margin 白边并补齐主题系统。
    - 根因：workshop 派生自旧版模板，没有任何 CSS reset（浏览器默认 `body{margin:8px}` 露白边），且只有单一 dark 主题。
    - 同步内容（三块均从模板拷贝）：① `app/styles/global.css` + nuxt.config `css: ["@unocss/reset/tailwind.css", "~/styles/global.css"]`（html/body margin 归零、box-sizing、字体栈、细滚动条、选区色）；② 根 `uno.config.ts`（presetWind3 + presetIcons(scale 1.1) + nb-ui 图标 safelist），**删除** nuxt.config 的 `unocss:{icons:true}` 避免双份配置；③ 5 主题系统：`app/theme/themes.ts`（dark/light/catppuccin/dracula/tokyo-night）+ `app/composables/useTheme.ts`（localStorage key 改 `nb-workshop-theme`）+ `ThemeSwitcher.vue`；`app.vue` 改为 `initTheme()`，删除 `default-theme.ts`。dark 主题 accent 本就是 amber，默认视觉无回退。
    - 入口：`AppHeader.vue` 右侧新增调色板按钮（`i-lucide-palette`），弹出面板放 ThemeSwitcher，document click 点外关闭。
    - nb-ui 为 `link:` symlink 直连本地仓，源码天然最新，无需同步动作。
    - 验证：typecheck 0 error；build 通过（Σ 8.44 MB / 2.59 MB gzip）；50 测试全绿。**未做浏览器验证**。
- 2026-07-08：**产品增强轮**（用户拍板"预览 + Markdown + 首页分区 + 性能小修"一次做完）。
    - **包内容在线预览**（下载决策链最大缺口：profile 是本机执行的代码，此前下载前是黑盒）：后端新增 `GET /items/:slug/files`（文件清单 + `previewable` 判定：扩展名/裸文件名白名单 + 200KB 上限，`isPreviewableFile` 纯函数）与 `GET /items/:slug/file-content?path=`（UTF-8 文本；path 走 zip 条目对象键查找，天然无路径穿越），均复用 `requirePublishedItem` 可见性与 `resolveItemVersion`（新抽的版本解析 helper，download 同步复用）、**不计下载数**；取舍=每请求整读 zip 解包无缓存。前端详情页新增「文件」Tab（有版本才显示，首次切入懒挂载 `PackageFileBrowser.vue`：列表 ⇄ 单文件预览，`.md` 渲染 markdown + YAML frontmatter 折叠展示，代码/文本走只读 CodeMirror）。
    - **描述 sanitized markdown**：新 `MarkdownView.vue`（marked GFM + DOMPurify；`afterSanitizeAttributes` hook 模块级注册一次，外链强制 `target=_blank rel=noopener noreferrer`；排版样式全走主题变量）。详情页描述 Tab 从纯文本 pre-wrap 切换；**门 A 安全债的 markdown sanitize 项就此提前消掉**；评论保持纯文本插值。
    - **首页分区/精选**：schema 加 `WorkshopItem.featured` + `@@index([status, featured])`（迁移 `20260708000000_item_featured`）；`PATCH /admin/items/:id/featured`（照 status.patch 形态）；列表接口支持 `featured=1`。首页默认态（无 q/type/tags 且 sort=latest）展示「编辑推荐（空则整区隐藏）/ 热门下载 / 最新发布」三分区（前两区会话内拉一次，失败静默降级纯列表），任一筛选生效退回纯列表；admin 条目管理加"设为精选/取消精选"；ItemCard 加精选星标。
    - **性能小修**：`CodeEditor.vue` 的 7 个 CodeMirror import 全部改为 onMounted 内动态 import（并加 `readonly` + `language="plain"` 供预览复用）——**最大前端 chunk 620K→204K**，CM 只在编辑/预览真正挂载时加载；全页面补 useHead 标题（浏览/发布/个人中心/管理/登录/注册）；详情页下载按钮加"已开始下载 ✓"2 秒反馈。
    - 验证：typecheck 0 error；build 通过；测试 **50 → 53**（新增集成用例：预览文件列表与 v1 内容字节一致 + 不存在 path 404 + 不计下载数、unlisted 后预览 404、admin 精选打标 → `featured=1` 命中 → 非 admin 403 → 取消后为空）。本地 dev 库已 `db:deploy` 应用 featured 迁移。**未做浏览器验证**。
- 2026-07-08（后续）：**审查修复轮**——对产品增强轮做 medium 深度 code review（8 角度 finder + 逐条 adversarial verifier），8 个 finding 成立并一次修复；另有 4 个候选被源码级证据推翻。
    - **修复清单**：
        1. `admin.vue` 精选按钮从上一次操作结果（`manageResult?.featured`）派生文案与发送值，换条目 id 后会按旧条目状态改新条目 → 拆成「设为精选」「取消精选」两个常驻显式按钮（接口幂等，与恢复/下架同一设计语言：**按钮一律显式声明目标状态，不从状态派生意图**），并 `watch(manageId)` 清空旧结果面板。
        2. `MarkdownView.vue` 补 `breaks: true`——存量描述都是按「纯文本，支持换行」提示写的，marked 默认会把单换行折叠掉；`publish.vue` / `MyItemManageCard.vue` 描述字段文案同步改为「支持 Markdown 语法。」。
        3. `PackageFileBrowser.vue` frontmatter 解析前 `\r\n` 归一——目录 zip 上传保留作者原始行尾，CRLF 的 SKILL.md 此前检测不到 `---\n`，整段 YAML 会渲染成 hr + 乱版式。
        4. `index.vue` `load()` 加请求代数守卫（`loadGen`，过期响应含 loading 态一律丢弃）——「加载更多」在途时切筛选，旧响应会把旧筛选条目追加进新列表并覆盖 total/nextOffset；顺带把 onMounted 与 query watcher 的重复体合并为 `{immediate: true}` watch。
        5. 预览两路由逐字重复的 `unzipSync`+try/catch 收敛到 `workshop-package.ts` 新 helper：`listPackageEntries`（fflate `filter` 只读中央目录头部即返回 false，**零解压**列清单）与 `readPackageEntry`（filter 精确匹配，**只解压目标条目**）；条目名反斜杠归一为 `/`（个别违规 Windows 归档器经完整包模式流入时，目录占位与裸文件名白名单不再误判）。将来 zip bomb 守卫只需落在这两个 helper。
        6. 删除死代码 watcher：`items/[slug].vue` 的 `watch(slug)` 与 `PackageFileBrowser.vue` 的 `watch(props.slug)`。
        7. 站点标题统一：`app.vue` 挂 `titleTemplate`（唯一后缀出口），nuxt.config 删静态 title 防二次拼接，8 个页面 useHead 只写前缀——此前已漂移出「· Workshop」「· NeuroBook Workshop」两种后缀。
    - **关键避坑（本轮最有复用价值的发现）**：Nuxt 默认 `generateRouteKey` = 插值路径（`node_modules/nuxt/dist/pages/runtime/utils.js`），`/items/a → /items/b` 是**整页重挂载而非 vue-router 式组件复用**，且退场页面经 `RouteProvider` 注入的 route 被冻结（getter 回落 previousRoute）。review 中 4 个「导航离开触发多余请求 / 跨条目状态泄漏」类候选全部因此被推翻，代码里按组件复用心智写的 slug watcher 也因此是永不触发的死代码。以后在本仓写 param 页面：重挂载语义下不需要 watch params，也不会有跨条目复用泄漏。
    - **刻意不修**（记录避免重议）：预览接口 `requirePublishedItem` 的 DTO include 超取（SQLite 小数据代价可忽略）、预览内容客户端 memo、版本 Tab 逐版下载反馈、usePagedList 抽取（4 处分页复制是既有全仓模式，属独立重构）、zip bomb / 头部 size 造假防护（既有安全债，按门 A/B 回补）。
    - 验证：typecheck 0 error；build 通过（Σ 8.45 MB / 2.6 MB gzip）；**重新 build 后**复跑测试 53 全绿（集成测试 spawn `.output` 产物，先 build 才真正执行到新 helper 路径——预览往返 / 404 / 400 语义均通过）。**未做浏览器验证**。

## 2026-07-27 注册码与邀请码改造

- 注册准入与邀请归属拆成两个概念：管理员在 `/admin` 的“注册码”分区签发注册码；普通用户在 `/me` 的“邀请好友”分区创建邀请码。邀请码可选，不能绕过必填注册码。
- 两类码都支持不限次数、有限次数、过期时间、备注和停用/启用。管理员可批量签发注册码；用户只能查看和修改自己创建的邀请码。
- 管理员可复制只带注册码的 `/register?registrationCode=...` 链接。用户可复制带邀请码的链接，并可手动附加注册码形成 `/register?registrationCode=...&inviteCode=...`。
- 注册页从 URL 预填两类码；GitHub OAuth 往返通过当前标签页的 `sessionStorage` 暂存两类码。密码注册与 OAuth 补全注册共用服务端原子消费合同。
- 数据库将旧的一次性管理员邀请码迁为不限次数注册码，并保留已有注册归属；新的用户邀请码表从空表开始。
- 当时生产私有模式同时关闭注册与 GitHub OAuth，只准备能力，不自动通过 Public Invite Gate，也不对外发码。该结论已由下方 2026-07-29 follow-up 调整。
- 验证：注册码不限次数复用、有限次数并发门禁、过期/停用、邀请码归属/越权和迁移均由 HTTP 集成测试覆盖；未自动执行浏览器验证。

## 2026-07-29 注册链接生产门禁修复

- 根因：生产构建把 `registrationEnabled` 固定为 `false`，同时服务端又让 `NB_PRIVATE_MODE=1` 强制关闭注册。因此分享链接虽然能命中 `/register`，页面挂载后仍跳到登录页，绕过页面直接提交也只会得到 `403 registration_disabled`。
- 密码注册改用独立运行时开关 `NUXT_PUBLIC_REGISTRATION_ENABLED`。生产缺省关闭，显式设为 `1/true` 时，导航和登录页展示注册入口，注册链接继续预填注册码与可选邀请码，服务端进入现有注册码原子消费流程。
- `NB_PRIVATE_MODE=1` 继续约束 GitHub OAuth；开启密码注册不会开放 OAuth。前端统一兼容 Nuxt public config 的 boolean 构建值和 string 运行时覆盖值，避免环境变量已设为 `1` 但 `=== true` 仍判假的第二次漂移。
- 本轮只修改 `dev` 代码、示例和验证，不提交、不推送、不部署，也不改 DMIT 环境。线上链接继续保持关闭，直到后续发布新镜像并在 DMIT 设置 `NUXT_PUBLIC_REGISTRATION_ENABLED=1`。
- 验证实际结果：首次生产测试发现 Nuxt 会把环境值 `1` 注入为数字 `1`，不是预想的字符串；共享解析器因此扩为 `boolean | string | number` 并增加 `1/0` 回归。隔离 `dev` 提交并只应用本补丁后，typecheck、build、运行时/配置/生产双门禁 19 项及账号管理 16 项通过；`api-v1` 25 项中与注册有关的用例均通过，最后 2 个既有 Workshop 用例稳定超时。主工作区检查另被在途的 TypeScript 7 / vue-tsc 不兼容和 Workshop 缺失导出阻断，均未在本任务中改动。
- 与原计划的出入：没有执行全量绿灯，因为当前 `dev` 在途改动存在上述两个独立基线问题；没有执行浏览器验收、提交、推送、DMIT 环境修改或生产部署，符合本轮边界。

## 2026-07-31 注册门禁生产部署

- 公网复现确认 `/register` 带不带 query 都返回 HTTP 200，旧页面公开配置为 `registrationEnabled:false`，挂载后由前端 `replace` 跳到 `/login`；旧注册 API 同时返回 `403 registration_disabled`。注册码本身没有参与这次失败。
- 修复以 `dev` 提交 `d279a3a` 保存开发线，再合并为 `master` 提交 `65b84bc`。本地 typecheck、production build、11 项运行时/配置单测与 24 项生产门禁/账号集成测试通过；Actions Run `30623487821` 全部成功。
- DMIT 使用不可变 digest `sha256:580bf3f74bc51661d5541b0290c9675f523325e3c3b5e054bf0c3ca57b09b4b2` 完成升级；停站前 Agent 资产 preflight 为 `checked=2 / migrated=0`，冷快照为 `ops/deployments/20260731T102913Z/data.before.tar`。
- 新镜像 readiness 通过后才原子写入唯一的 `NUXT_PUBLIC_REGISTRATION_ENABLED=1` 并重建同一 digest 容器；配置备份为 `ops/deployments/20260731T103001Z-registration/env.before`。公网页面现为 `registrationEnabled:1`，空注册请求进入正常 DTO 校验返回 400，GitHub OAuth 继续返回 404。
- Pino stdout 与 `/logs/site.jsonl` 均记录 `/register` 200、注册 API 400 和 OAuth 404，请求 query 未进入日志。仓库规则不允许自动浏览器验收，因此本轮没有代替用户提交真实注册表单；真实注册码没有被测试消耗。
- 实际偏差：一次性远端配置脚本在全部配置、重建和 readiness 步骤完成后，因 Windows CRLF 在末尾多报一条 `$'\\r': command not found`。独立检查确认环境变量、容器 digest、内外 readiness 和日志均正确；临时脚本已删除，没有将该执行方式纳入仓库运维入口。
