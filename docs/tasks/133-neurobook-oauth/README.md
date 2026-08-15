# NeuroBook OAuth Provider 与 llmlint SSO（Task 133）

## User Request / Topic

将 llmlint Web 从本地密码/注册认证切换为 NeuroBook 官方 OAuth Authorization Code + S256 PKCE；保持 llmlint 本地 `User.id` 与历史数据外键不变，通过 `User.neuroBookUserId` 关联官方用户，并准备 DMIT 正式部署。

## Goal

- 官方站提供固定第一方 `llmlint-web` client 的 OAuth metadata、授权、token 和 userinfo 端点。
- OAuth code 与 access token 只保存不可逆摘要；authorization code 一次性消费，禁止 plain PKCE、query bearer token 和 refresh token。
- llmlint 只保存 host-only sealed 本地 session；callback 只短时使用官方 access token，userinfo 后丢弃。
- 生产配置错误或仍存在旧本地 admin secret 时 fail closed。

## Current State

官方 provider 与 llmlint SSO 已在 DMIT 公网切换完成；consent navigation 修复已随官方 PR [#2](https://github.com/notnotype/neuro-book-site/pull/2) 的提交 `36249a6` 部署。真实浏览器随后确认 callback 已到达 llmlint，但 token 交换返回 401：`openid-client` 按 RFC 6749 对 Basic 中的 client secret 做表单编码，`@node-oauth/oauth2-server` 5.3.0 未逆解码；本修复在 provider transport 层完成规范化，待合入部署后复验完整 SSO。

## Decisions / Discussion

- 官方账号 ID 是稳定关联键；llmlint 本地自增 ID 继续作为评分、文本和批注外键。
- 同一官方 ID 重复登录复用原本地用户行；username 已被未映射的本地用户占用时拒绝自动合并并返回 `account_mapping_conflict`。
- secret 只能通过 stdin 写入官方 client 摘要初始化工具和 llmlint 远端 secret 文件，禁止进 argv、镜像或日志。
- 正式切换顺序：官方 provider migration/readiness → 官方 `llmlint-web` client 初始化 → llmlint secret 与服务 → Nginx/TLS 公网 → 真实浏览器 SSO。

## Verification / Test

- consent navigation 修复已通过官方 `bun run typecheck`、`bun run build` 和 167 项全量测试，并部署镜像 `ghcr.io/notnotype/neuro-book-site@sha256:2a3029c938a2c995fc28839602d0c3100a9c7de67d965382d69d3aada19ee761`；冷快照为 `/srv/neuro-book-site/ops/deployments/20260815T032801Z/data.before.tar`。
- 部署后真实浏览器已从授权页到达 `https://llmlint.notnotype.com/auth/neurobook`；provider 同时记录 `POST /api/v1/oauth/token` 401，证明 consent 跳转问题已消除、失败点后移到 client 认证。
- 两侧 secret 已在 DMIT 内安全比对：llmlint 运行进程、secret 文件与 provider scrypt 摘要一致；原始 Basic 探针通过 client 认证并返回预期 `invalid_grant`，标准表单编码 Basic 则复现 401。实际 secret 有 4 个字符需要百分号编码，未输出 secret 本身。
- Basic 兼容修复的聚焦测试先以 token 401 失败，修复后 `bunx vitest run tests/oauth-client.integration.test.ts` 5 项通过；测试 secret 固定含保留字符，并覆盖非法 `%ZZ` 表单转义拒绝。`bun run typecheck`、`bun run build` 与 `bun run test`（167 tests passed）通过。
- 双轴盲评尚未回收；生产 `DocJudgment=0`，需先完成真实 SSO 闭环。

## Implementation Walkthrough

1. 官方 Prisma 新增 `OAuthClient`、`OAuthAuthorizationCode`、`OAuthAccessToken` 及索引/外键。
2. 官方 Nitro 增加 RFC 8414 metadata、授权 GET/POST、token、userinfo 和 OAuth approve 页面。
3. 官方将 OAuth client secret 以 scrypt 摘要保存，并把 `scripts/oauth-client.ts` 编译为 `/app/dist/oauth-client.mjs`。
4. llmlint 删除密码登录、注册和 admin seed；新增 PKCE pending session、callback、官方用户映射和生产 fail-closed 配置。
5. 更新部署文档、环境模板、PROJECT-STATUS 与 Task 06 walkthrough，记录实际部署边界和验证证据。
6. OAuth consent page 改用浏览器顶层表单导航提交；批准端点保留精确 Origin、query 和 PKCE 校验，同时严格接受 JSON 或 `application/x-www-form-urlencoded` 的唯一 `allowed` 字段。
7. token transport 按 RFC 6749 §2.3.1 解码 Basic 中分别做过 `application/x-www-form-urlencoded` 编码的 client ID 与 secret，再把规范化 header 交给固定版本 OAuth library；不轮换或输出现有 secret。

## TODO / Follow-ups

- 合入并部署 client_secret_basic 解码修复，随后用真实浏览器完成授权批准、token/userinfo、llmlint 本地用户映射和管理员权限验收。
- 更新 llmlint Task 06 walkthrough，记录两段生产故障根因、修复版本和闭环证据。
- 在正式 origin 上回收 20 份双轴盲评并运行跨题材集成分析。
