# Task 02：账号名称、注册体验与全站中英双语

## User Request / Topic

- 注册时输入中文名称会暴露 Zod 默认英文错误，用户无法判断错误字段。
- 区分稳定的登录账号名与支持中文的公开显示名称。
- 官方站支持简体中文、英文切换，并系统收口前端错误提示。

## Goal

- 密码注册与 GitHub 补全注册都显式填写显示名称。
- 服务端返回稳定错误码和结构化字段问题，前端不显示内部 message。
- 全站用户界面、日期数字、页面元信息和无障碍标签支持 `zh-CN` / `en-US`。
- 在本地、容器和浏览器验收通过后，经固定 digest 流程部署 DMIT。

## Current State

- 2026-07-31：实现、151 项测试、typecheck、production build、桌面/移动端 Playwright、Actions 容器门禁与 DMIT 固定 digest 部署均已通过。
- `username` 继续作为登录名、个人主页路径和作者引用，只允许 3–32 位 ASCII 字母、数字、下划线或连字符；`displayName` 为必填的 1–50 字符 Unicode 公开名称。
- `User.displayName` 原本已存在，无需数据库迁移；普通注册和 GitHub 补全注册现在都保存用户提交的显示名称。
- GitHub OAuth 在生产继续关闭；本轮只完成补全页与接口的可用实现和自动化验证，不改变开关。

## Decisions / Discussion

- 注册 DTO 增加必填 `displayName`；确认密码只在浏览器校验，不传服务端。
- 服务端不按语言翻译错误。所有 Web API 以 `data.error` 提供稳定代码，参数错误另附不含输入值的 `issues`。
- 语言使用 Cookie `neuro-book-site-locale` 持久化，URL 不增加语言前缀或 query。
- `no_prefix` 策略在所有首次入口执行浏览器语言检测，确保直接打开带注册码的分享链接也能选择正确语言；已有 Cookie 始终优先。
- 用户内容、包源码、协议标识和日志不翻译。资产模板只在创建草稿时按当前语言生成，之后切换语言不改写草稿。
- 站点消费的 nb-ui 组件均已有 label/slot 接口，本任务不修改 nb-ui。

## Implementation Walkthrough

### 注册与共享合同

- 新增浏览器和服务端共用的账号名、显示名称、注册码和邀请码 schema；资料编辑与注册复用同一个显示名称规则。
- 普通注册加入显示名称和确认密码；GitHub 补全页用上游名称预填显示名称，但允许修改。
- blur 与 submit 都执行字段校验，错误通过 `FormField.error` 关联红框、`aria-invalid` 与 `aria-describedby`；提交失败后聚焦第一个错误字段。
- 用户名冲突及注册码/邀请码状态错误带稳定 `field`；无效邀请码会让整个事务回滚，不创建用户，也不增加注册码使用次数。

### i18n 与格式化

- 引入 `@nuxtjs/i18n`，使用 `zh-CN`、`en-US` 和 `no_prefix`；语言 Cookie 的 Path、SameSite、Secure 与一年有效期由模块统一管理。
- 主导航、登录、注册、GitHub 补全和错误页都有语言入口。切换语言不刷新页面、不改变 URL，也不清空发布工作台内存草稿。
- 页面、组件、Dialog、通知、空状态、按钮、状态标签和无障碍标签已迁入同键语言资源；合同测试保证两份语言键完全一致。
- `<html lang>`、标题、描述 meta、日期、相对时间、数字和文件大小随当前语言变化。

### 错误治理

- `validateBody()` 与 multipart/query 校验统一返回 `validation_failed` 和有限结构化 issue，不发送 Zod 默认 message 或输入值。
- 新的前端错误解析器只读取 `data.error`、`field`、`issues` 和 `X-Request-ID`；不读取服务端原始 message。
- 可归属字段的错误留在字段旁，Dialog 内可恢复错误留在 Dialog，跨入口动作继续走通知。未知 5xx 使用统一服务不可用文案并附请求编号。
- Passport token 的 `authorization_pending` 等机器协议码保持不变。

## Verification / Test

### Automated

- `bun run test`：22 个测试文件、151 个用例通过。
- `bun run typecheck`：通过。
- `bun run build`：通过；仅有既有 sourcemap、依赖注解、大 TypeScript 懒加载 chunk 和 Node 依赖弃用警告。
- `git diff --check`：通过；Git 仅报告当前 Windows worktree 的 LF/CRLF 转换提示。
- GitHub Actions Run `30633965111`：frozen install、typecheck、production build、全量测试和 `linux/amd64` Buildx 推送全部通过。
- 覆盖中文显示名称、中文账号名拒绝、长度边界、确认密码、结构化 issue 不泄露输入、普通/OAuth DTO、显示名称持久化、用户名冲突和邀请码事务回滚。
- i18n 合同覆盖语言键一致、所有入口浏览器语言检测、Cookie key、英文三类资产模板，以及前端禁止读取服务端原始 message。

### Playwright

- 桌面与 390×844 移动端注册页均无溢出、遮挡或控制台错误；Vue `<Suspense>` 只有框架 info。
- 中文与英文普通注册均成功，显示名称正确持久化；网络请求确认包含 `displayName` 且不包含 `confirmPassword`。
- 中文账号名错误归属账号名，邀请码错误归属邀请码；键盘和鼠标提交均聚焦第一个错误字段。
- 带注册码/邀请码的分享链接正确预填；切换语言不改变 URL，刷新后 Cookie 仍保留选择。
- 新 `en-US` 浏览器上下文首次直接打开无前缀页面时自动选择英文并写 Cookie；默认 `zh-CN` 浏览器上下文选择简体中文。
- 发布工作台切换语言后 URL、包名与既有英文模板内容保持不变；离开未保存草稿仍触发确认。

### Production Deployment

- source commit：`475cd74a808289f3515c699ed540bf5d0b586c41`。
- 新镜像：`ghcr.io/notnotype/neuro-book-site@sha256:e9b0ee2079a4f3536546ffb2a45786ba0d1cb47c6b864dec3fdf1f7333d34d8d`；上一镜像为 `sha256:580bf3f74bc51661d5541b0290c9675f523325e3c3b5e054bf0c3ca57b09b4b2`。
- 冷快照：`/srv/neuro-book-site/ops/deployments/20260731T132443Z/data.before.tar`；部署回执与上述 commit/digest 一致。
- 公网 live / ready 均通过，数据库、migration、Agent 资产、三类持久目录与容量检查全部为 `ok`；容器 Docker health 为 `healthy`。
- 生产注册页显示六个预期字段，注册码分享链接正常预填，GitHub 入口按私有模式隐藏；中英文切换保持 URL 与预填内容，Cookie 为 `Secure; SameSite=Lax; Path=/`，浏览器 0 console error / 0 warning。
- Pino stdout 与持久文件都出现结构化请求；`/srv/neuro-book-site/logs/site.jsonl` 为 `0600`、`10001:10001`。生产验收没有提交注册表单，也没有创建测试账号。

## Deviations From Plan

- 本机没有 Docker CLI，无法在 Windows 直接执行 `linux/amd64` 非 root 容器验证；该门禁最终由 GitHub Actions container job 完成，未把本地 production build 冒充容器证据。
- 生产保持 GitHub OAuth 关闭，因此没有在真实 GitHub OAuth App 上执行回调验收；补全注册接口、事务和页面通过测试覆盖。
- `@nuxtjs/i18n` 自带 Cookie 管理已经满足一年有效期、Path、SameSite 与生产 Secure 合同，没有再写一套自定义 Cookie 插件。
- 本轮未修改 nb-ui；当前站点使用的组件都能从业务层传入 label/slot。

## Changed Areas

- `shared/auth-schema.ts`、`auth-server-schema.ts`、`validation-issues.ts`：共享账号与结构化校验合同。
- `server/api/auth/register*`、`server/utils/api-error.ts`、Web API：显示名称持久化和稳定错误码。
- `i18n/locales/*`、`nuxt.config.ts`、`LocaleSwitcher.vue`：中英文资源、检测与切换。
- `app/composables/useLocalizedApiError.ts`、`useLocaleFormat.ts`：本地化错误与格式化出口。
- 全部站点页面和业务组件：界面文案、通知、Dialog、状态与无障碍标签迁移。
- `reference/passport/api-v1.md`、`PROJECT-STATUS.md`、`RELEASE.md`：稳定合同、仓库状态和用户发布说明。

## TODO / Follow-ups

- [x] GitHub Actions 完成 frozen install、测试、typecheck、build 与 `linux/amd64` 镜像构建。
- [x] 部署固定 GHCR digest，并记录 Actions run、digest、冷快照和公网 smoke。
- [ ] 未来启用 GitHub OAuth 时，用真实 OAuth App 单独验收回调、补全注册与错误回跳。
