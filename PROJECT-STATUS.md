# Project Status

## Summary

NeuroBook 官方站：账号关联、创意工坊与客户端加密云备份的模块化单体。Task 128 的代码生产化已完成：仓库硬切为 `neuro-book-site`，Workshop 有界流式上传、跨 Workshop/Backup 全站容量门禁、密文 `.nbbackup`、私有模式、live/ready、stdin 管理员创建/重置和非 root 只读容器合同均已落地。管理员注册码与用户邀请码已拆分，支持不限/限次、过期、停用和双参数注册链接；生产私有模式仍关闭注册。官方站已增加 Pino 结构化请求/异常日志、`X-Request-ID`、stdout + 专用持久日志卷和独立轮转合同。Windows typecheck/build 与 131 项全量测试通过，Actions `linux/amd64` 门禁通过。DMIT 已部署日志版本，完成双写、脱敏、容器重建持久性、强制轮转、压缩读取和 digest 回滚验收；本轮未调整 DNS、443、Nginx SNI 或 Xray。Public Invite Gate 不在本任务内。

设计真相源：neuro-book 仓 `docs/tasks/88-workshop-platform/README.md`。

## Product Facts

- Nuxt 4 SPA + Nitro API；Prisma 7/libSQL SQLite；`nuxt-auth-utils` cookie session；zod DTO；`@notnotype/nb-ui` 固定公开 Git commit，不依赖 Bun link。
- 管理员 `RegistrationCode` 负责注册准入，用户 `InviteCode` 只记录可选邀请归属；两类码支持不限/限次、过期和停用，注册页可从链接同时预填。生产 owner-only 私有模式服务端仍关闭注册和 GitHub OAuth，前端隐藏入口。
- Backup 只接收 `NBOOKBK1` magic、`.nbbackup` 和 `application/vnd.neurobook.backup`；`sha256` 是密文字节摘要，`keyId` 只用于客户端选择密钥，站点无法解密。
- 全站 Workshop + Backup 默认上限 6 GiB并保留 4 GiB 物理空间；两类上传共用串行容量门禁。Workshop 压缩包 20 MiB、解压 100 MiB、500 条目，并拒绝逃逸/重复路径和非法 manifest。
- `GET /api/health/live` 只证明进程可响应；`GET /api/health/ready` 检查数据库、待应用 migration、数据库/Workshop/Backup 目录读写。容量耗尽只返回 degraded + HTTP 200。
- 生产镜像使用 Bun 1.3.14 构建、Node 24.13.0 trixie slim 运行；Compose 约束非 root UID 10001、只读根、tmpfs、768 MiB、仅 loopback 3100 与固定可信 bridge。
- `bun run db:admin -- create|reset` 提供显式管理员密码维护；密码只从 stdin 读取，生产镜像内对应 `/app/dist/admin-password.mjs`，reset 会递增会话版本并注销旧会话。
- Pino 请求日志固定输出到 stdout 与 `/logs/site.jsonl`，响应带 `X-Request-ID`；成功健康检查降噪，URL query、header/body 和凭据不进入日志。Docker 控制台保留 10 MiB x 3，持久文件按 20 MiB x 14 独立轮转。
- DMIT 当前运行 Pino 日志版本的公开 GHCR digest `sha256:6ec29b03a086920e9259f18a4ed8403b7c188002c8d57d1f037a7fbad118c726`；上一 digest `sha256:77f922014080e810e9852dc49ef0e71c40ed755eb8b817a934b76e6c2d394c19` 与冷快照 `snapshot-task128-pino-20260727T163249Z.tar` 保留用于整体回滚，已实际完成旧版往返。
- `bun run deploy:dmit` 提供本地 push → Actions → GHCR digest → DMIT 升级编排：只接受干净 `master` 和正确 origin，不自动 commit/force push；远端串行执行镜像拉取、4 GiB 余量门禁、冷快照、原子 `.env` 切换、双 readiness 与失败整数据回滚，不接触 DNS/Nginx/443/Xray。
- 条目状态 `published / unlisted / removed`；非 published 对公开面（列表/详情/版本/下载/评论）一律 404。
- 包版本真相源是 zip 内 `nbook-package.json` 的 `version`，平台只校验严格递增；拒绝时直接提示应改为 N+1。
- zip 原样落盘 `WORKSHOP_FILES_DIR`（默认 `./data/files`），布局 `<filesDir>/<itemId>/<version>.zip`；下载字节与上传一致（集成测试 sha256 对比证明）。
- 发布 UX：canonical 包格式（zip + 根部 `nbook-package.json`）是唯一存储 / 下载 / 安装契约、后端不变；前端提供友好输入（profile 在线编辑 / 单文件，skill 在线编辑 / 目录 zip，另有「完整包」高级模式），**简单模式在浏览器就地生成 manifest 并自增 version** 后走同一 `createItem` + `uploadVersion` 端点。
- UI 地基与模板对齐（2026-07-07）：根 `uno.config.ts`（presetWind3 + presetIcons + nb-ui 图标 safelist）+ `css: ["@unocss/reset/tailwind.css", "~/styles/global.css"]` 双 reset（修 body margin 白边）；5 主题系统（dark/light/catppuccin/dracula/tokyo-night，`app/theme/themes.ts` + `useTheme`，localStorage key `neuro-book-site-theme`）+ 顶栏调色板弹出 `ThemeSwitcher`。
- 包内容在线预览（2026-07-08）：`GET /items/:slug/files`（文件清单 + previewable 判定）与 `GET /items/:slug/file-content?path=`（文本内容，扩展名白名单 + 200KB 上限），均走 published 可见性、不计下载数、每请求整读 zip 无缓存；解包收敛在 `workshop-package.ts` 的 `listPackageEntries`（fflate filter 零解压列清单）/ `readPackageEntry`（只解压目标条目），条目名反斜杠归一为 `/`；详情页「文件」Tab 消费（SKILL.md 渲染 markdown + frontmatter 折叠，代码走只读 CodeMirror）。
- 描述渲染已升级为 **sanitized markdown**（marked + DOMPurify，外链强制 `target=_blank rel=noopener`），门 A 安全债中的 markdown sanitize 项已消；评论仍是纯文本插值。
- 条目精选：`WorkshopItem.featured`（admin 经 `PATCH /admin/items/:id/featured` 打标），公开列表支持 `featured=1` 过滤；首页默认态展示「编辑推荐 / 热门下载 / 最新发布」三分区，任一筛选生效即退回纯列表。
- Windows 部署坑：Prisma 7 生成 client 顶层 `__dirname` polyfill 被 nitro bundle 后在 Windows 上启动即崩，`nuxt.config.ts` 里有 build-time rollup patch（`patch-prisma-generated-dirname`）兜底，Prisma 升级后若失效集成测试会在启动阶段暴露。

## Recent Tasks

| Task | Status | Notes |
| --- | --- | --- |
| Initial Template | Done | Base fullstack skeleton is available. |
| Workshop 后端第一版 | Done | schema + 迁移 + DTO + API v1 + 邀请码注册 + zip 上传/下载 + 社交互动 + admin 管理；实现后审查修复并发窗口（邀请码双花、同版本上传先写库后落盘、slug 抢注 409）、下架条目可撤销收藏/点赞、meta 补 platformVersion；40 测试全绿（含 20 个真实 HTTP 集成用例，含并发用例）。 |
| Workshop Web 前端 | Done | 全量页面一次做完：`/`（筛选态映射 URL query）、`/items/:slug`（双栏 + sticky 下载栏 + 点赞/收藏乐观更新 + 举报 + 评论区 + 404 态）、`/users/:username`、`/publish`（四步向导 + 前端 fflate 解析 manifest + 重试防 slug 409）、`/me`（发布/收藏两 Tab）、`/admin`（邀请码/举报/条目管理）、`/login`+`/register`（补邀请码）。类型化 `useWorkshopApi` 单一 $fetch 出口；icons 走 unocss module flag；description 纯文本防 XSS。**后端补口** `GET /api/v1/me/items`（本人全部状态条目，含 unlisted）。typecheck / build 全绿，测试 40→41（新增 `/me/items` 集成用例）。未做浏览器验证。 |
| Workshop 友好上传 | Done | 前端增加友好输入：profile 在线编辑（CodeMirror）/ 单文件，skill 在线编辑 / 目录压缩包（自动剥离单层顶层文件夹 + 注入 manifest），保留「完整包」高级模式；简单模式 manifest 平台生成、version 自增（新建 1，传新版 latest+1）。**后端零改动**——客户端 `fflate` 打成 canonical zip 走现有 `createItem` + `uploadVersion`。新增 `app/utils/workshop-package.ts` / `CodeEditor.vue`（CodeMirror 6）/ `PackageContentInput.vue`（发布向导与 `/me` 复用）。typecheck / build 全绿，测试 41→50（新增 `workshop-package-client.test.ts`，含客户端包被后端 `parseWorkshopPackage` 接受的跨端契约）。未做浏览器验证。 |
| UI 地基同步模板 | Done | 同步 nb-fullstack-template 最新地基：新增 `uno.config.ts`（替代 nuxt.config `unocss:{icons:true}`）、`app/styles/global.css` + `@unocss/reset/tailwind.css`（修 body 默认 margin 白边）、5 主题系统（`themes.ts`/`useTheme`/`ThemeSwitcher`，localStorage `nb-workshop-theme`）+ 顶栏调色板弹出入口；删除单主题 `default-theme.ts`。nb-ui 为 symlink 本就最新。typecheck / build / 50 测试全绿。未做浏览器验证。 |
| 产品增强轮（预览/markdown/精选） | Done | ① 包内容在线预览：后端 `files` + `file-content` 两接口（published 可见性、白名单 + 200KB、不计下载数），详情页新增「文件」Tab（列表 ⇄ 单文件预览，SKILL.md 渲染 + frontmatter 折叠、代码只读 CodeMirror）；② 描述 sanitized markdown（marked + DOMPurify，新 `MarkdownView.vue`，门 A 债项 markdown sanitize 已消）；③ 精选：schema `featured` + admin featured 接口 + `featured=1` 过滤 + 首页三分区（编辑推荐/热门下载/最新发布）+ admin 条目管理精选开关 + 卡片星标；④ 性能小修：CodeMirror 全量改 onMounted 动态 import（最大 chunk 620K→204K）、全页面补 useHead 标题、详情页下载按钮点击反馈。typecheck / build 全绿，测试 50→53（预览往返 + 可见性 + 精选过滤/403 集成用例）。未做浏览器验证。 |
| 审查修复轮（8 finding） | Done | 产品增强轮 code review（8 角度 finder + 逐条 verifier）后一次修复：① admin 精选按钮从 stale `manageResult` 派生意图会改错条目 → 拆两个显式目标按钮 + 改 id 清结果；② MarkdownView 补 `breaks:true`（存量纯文本描述换行不再丢）+ 发布/编辑表单文案改「支持 Markdown 语法」；③ 预览 frontmatter 解析前 CRLF 归一（目录 zip 上传的 Windows 行尾）；④ 首页 `load()` 加请求代数守卫防加载更多×切筛选竞态，onMounted/watch 合并为 immediate watch；⑤ 预览解包收敛到 `listPackageEntries`（零解压列清单）/ `readPackageEntry`（只解压目标条目）双 helper，消除两路由逐字重复的 unzip 块并顺带归一反斜杠条目名；⑥ 删除基于「组件复用」错误假设的死代码 watcher（Nuxt 默认按插值路径 key 页面，条目切换=整页重挂载）；⑦ 站点标题统一 `app.vue` titleTemplate（此前两种后缀漂移）。typecheck / build / 53 测试全绿（重建后复跑确认新 helper 路径）。未做浏览器验证。 |
| nb-ui 深模块化跟进 | Done | 跟随 nb-ui 优化轮 3 的消费方收敛：`app/theme/themes.ts` 145 行全量复制 → re-export 垫片；`useTheme.ts` 67 行 → `createThemeStore({storageKey: "nb-workshop-theme"})` 8 行垫片；`uno.config.ts` safelist 改 `[...NB_UI_ICON_SAFELIST]`（来自 `@notnotype/nb-ui/uno`，顺带补上此前漏掉的 grip-vertical）。typecheck 绿；浏览器实测 :3003 图标渲染与调色板切 Dracula 持久化正常。 |
| Passport 与 Backup（Task 112 A+B） | Done | 官方站点改造第一轮：Prisma 四表（PassportDeviceCode/PassportAuthorization/PassportToken/InstanceBackup）；设备码流三端点（`device/code`、`token` 状态机含 slow_down/轮换/重放撤链、`revoke`）+ /link 页三端点 + 授权管理三端点；`requireAccess(event, scope)` 统一守卫，items POST / versions POST / items PATCH / me/items GET 四端点 Bearer 化（`requireOwnedItem` 加可选 user 参数），admin/社交面不接受 Bearer；Backup 五端点（busboy 流式上传边写边算 sha256 + 交互事务配额 + rotate 只淘汰同 label auto + sendStream 下载带 `x-nb-sha256`），配额三 env（`NB_BACKUP_*`）；前端 /link 批准页、me.vue 四 tab（新增已连接实例 PassportAuthorizationPanel / 云备份 BackupPanel）、登录页 `?redirect=` 回跳、useWorkshopApi 扩展。时序常量 env 可覆写（`NB_PASSPORT_*`）供测试稳定时序。新增 `tests/passport-backup.integration.test.ts`（19 用例：设备码全状态机/轮换撤链/Bearer scope 面/备份往返配额 rotate/限流 429），全量 72 测试绿。未做浏览器验证。 |
| 账号第二轮：GitHub OAuth + Profile + Admin 后台（Task 119） | Done | ① GitHub OAuth（spec §5.2 落地）：`PassportIdentity` 表 + `passwordHash` 转可空（null=OAuth 免密账号）；`/auth/github` 单路由三分支（已绑定登录[封禁拦截]/已登录绑定[头像顺手带入]/未登录进补全注册），决策抽 `resolveGitHubSignIn` 纯函数单测；pending 身份走 sealed session cookie（`setAuthSession` 改 replace 语义顺带清残留）；补全注册 `GET/POST /api/auth/register/oauth`（邀请码闸门保留，免设密码）+ `/register/github` 补全页（register.vue 移入 register/index.vue 防嵌套路由空白）；身份管理 `GET/DELETE /api/v1/passport/identities`（无密码禁解绑防失联）。② Profile：User 加 avatarUrl/bio/websiteUrl，`GET/PATCH /api/v1/me/profile`（avatarUrl 限 http(s) 防 javascript: 注入，成功刷新会话）；ItemAuthorDto/PublicUserDto/AuthUserDto 透出 avatarUrl；新 `UserAvatar.vue`（img 失败回落首字母色块）吃遍顶栏/卡片/详情/评论/作者页；me.vue 第 5 tab「账号设置」=`AccountSettingsPanel.vue`（资料表单/GitHub 绑定区/密码区）。③ 修改密码 `POST /api/v1/me/password`：验旧密或免密补设；sessionVersion+1 踢其他设备后重写当前会话保活。④ 防爆破（门 A 债消）：login 10 次/5min/IP+用户名、register（含 oauth）5 次/时/IP、改密 5 次/时/用户，额度 env 可覆写（`NB_LOGIN/REGISTER/PASSWORD_RATE_LIMIT`）。⑤ Admin 后台六 tab（概览/邀请码/举报/条目/用户/备份，新面板抽 `app/components/admin/`）：用户管理（搜索分页/封禁=disabled+sessionVersion+1 即时踢线且 Bearer 面同步拒/角色变更同样踢线重登/self-guard 防锁死）、站点统计 `admin/stats`、备份用量 `admin/backup-usage`+行明细+admin 删除、邀请码 note 字段+全量列表过滤。测试 72→94（`github-oauth.test.ts` 纯函数 7 用例 + `account-admin.integration.test.ts` 15 用例；旧文件补 `NB_REGISTER_RATE_LIMIT` 环境防限流误伤）。真实 GitHub 回调需浏览器验收（env `NUXT_OAUTH_GITHUB_CLIENT_ID/SECRET`，回调地址 `/auth/github`）。 |
| 注册码与邀请码分离（Task 119 follow-up） | Done | 管理员注册码负责准入，用户邀请码只记录可选归属；两类码支持不限/限次、过期、备注与停用。密码/OAuth 注册共用事务内 CAS 消费；旧一次性邀请码迁为不限次数注册码。`/admin` 支持签发/设置/复制链接，`/me` 增“邀请好友”，`/register` 可预填双参数。typecheck、build 与 123 项全量测试通过；未做浏览器验证，生产注册仍关闭。 |
| 官方站生产化与部署（Task 128） | In Progress | 代码、公开仓库/GHCR、`arch` 隔离容器验证、DMIT loopback、DNS/证书和 Nginx stream 443 均已完成；固定 digest、容器/主机重启、冷快照恢复和镜像回滚已演练。新增 `deploy:dmit` 将安全门禁编排为一个本地命令；脚本尚未执行真实 push/升级。待既有 Xray 客户端确认、真实 NeuroBook 闭环和 canary 发布。 |

## Known Follow-ups

- **官方站点改造已实施（neuro-book Task 112 + Task 119）**：Passport、Backup、GitHub OAuth、Profile、管理员后台及注册码/邀请码分离均已落地，spec 真相源 `reference/passport/api-v1.md`。个人页六个分区（含“邀请好友”）；admin 六个分区（含“注册码”）。全量 123 项测试通过。待浏览器验收（GitHub OAuth 需配置真实 OAuth App）。
- **Task 128 公网阶段待完成**：DNS、证书和 443 已接入，站点与 Xray 服务端探测通过；仍需用户确认全部既有 Xray 客户端，再启用 80 → HTTPS 跳转并进入真实 NeuroBook 闭环。HTTPS 稳定前不能把 NeuroBook 默认官方站地址改为 `https://nbook.notnotype.com`。DMIT 整盘损坏仍会同时丢失站点数据与同盘快照，这是 owner-only 私有内测明确接受的剩余风险。

- Web 页面 UI 已建成（含后端补口 `GET /me/items`）。仍未定的语义问题：admin 恢复 removed 条目的目标状态（当前强制回 published，作者原 unlisted 意愿会丢失）、`GET /users/:username` 条目列表是否分页（前端当前直接铺）、`me/favorites` 是否以灰态展示已下架条目（当前直接过滤掉）。
- 安全债清单（88 文档记录）：Workshop 公网上传的大小、解压总量、条目数、逃逸/重复路径、上传/评论限频已由 Task 128 收口。仍未实现下载/点赞计数去重等公开邀请 Gate 项；评论保持纯文本插值。
- 真实 builtin profile key 带点（如 `leader.default`），与 manifest name 的 kebab-case 约束冲突，Web/客户端集成阶段需要定命名迁移策略。
