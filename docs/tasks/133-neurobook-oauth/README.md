# NeuroBook OAuth Provider 与 llmlint SSO（Task 133）

## User Request / Topic

将 llmlint Web 从本地密码/注册认证切换为 NeuroBook 官方 OAuth Authorization Code + S256 PKCE；保持 llmlint 本地 `User.id` 与历史数据外键不变，通过 `User.neuroBookUserId` 关联官方用户，并准备 DMIT 正式部署。

## Goal

- 官方站提供固定第一方 `llmlint-web` client 的 OAuth metadata、授权、token 和 userinfo 端点。
- OAuth code 与 access token 只保存不可逆摘要；authorization code 一次性消费，禁止 plain PKCE、query bearer token 和 refresh token。
- llmlint 只保存 host-only sealed 本地 session；callback 只短时使用官方 access token，userinfo 后丢弃。
- 生产配置错误或仍存在旧本地 admin secret 时 fail closed。

## Current State

官方 provider 与 llmlint SSO 已在 DMIT 公网完成技术闭环。consent navigation 修复随官方 PR [#2](https://github.com/notnotype/neuro-book-site/pull/2) 部署；RFC 6749 Basic 表单解码修复随官方 PR [#3](https://github.com/notnotype/neuro-book-site/pull/3) 的提交 `4ab01f4` 部署。隔离临时官方用户已在真实浏览器完成授权批准、token、userinfo、llmlint session、本地用户映射和 20 项盲评池读取，随后临时用户、注册码、code/token 与 llmlint 映射均已清理。剩余工作只有 owner admin 实际登录确认与 20 份双轴盲评。

## Decisions / Discussion

- 官方账号 ID 是稳定关联键；llmlint 本地自增 ID 继续作为评分、文本和批注外键。
- 同一官方 ID 重复登录复用原本地用户行；username 已被未映射的本地用户占用时拒绝自动合并并返回 `account_mapping_conflict`。
- secret 只能通过 stdin 写入官方 client 摘要初始化工具和 llmlint 远端 secret 文件，禁止进 argv、镜像或日志。
- 正式切换顺序：官方 provider migration/readiness → 官方 `llmlint-web` client 初始化 → llmlint secret 与服务 → Nginx/TLS 公网 → 真实浏览器 SSO。

## Verification / Test

- consent navigation 修复部署镜像为 `ghcr.io/notnotype/neuro-book-site@sha256:2a3029c938a2c995fc28839602d0c3100a9c7de67d965382d69d3aada19ee761`；浏览器随后已从授权页到达 llmlint callback，并把第二个失败点收窄为 token 401。
- Basic 解码修复已通过 `bun run typecheck`、`bun run build`、`bun run test`（167 tests passed）和 OAuth 聚焦测试（5 tests passed）；PR #3 的 CI verify 成功。测试 secret 固定含保留字符，并覆盖非法 `%ZZ` 表单转义拒绝。
- Basic 修复生产提交为 `4ab01f4b2f70a458703e03e3a60631654fcb598a`，镜像为 `ghcr.io/notnotype/neuro-book-site@sha256:b9a06dfcde012757b7af94bba4335f9585f4b4897345a3ed631b2dc32f82a8d1`，冷快照为 `/srv/neuro-book-site/ops/deployments/20260815T040948Z/data.before.tar`；官方 readiness 与 llmlint health 均为 ok。
- 生产浏览器闭环：授权后落到 `https://llmlint.notnotype.com/contribute`；`/api/auth/me` 200 且 `authEnabled=true`、`ssoEnabled=true`，`/api/style-review` 200 且 `count=20`。provider 对临时用户生成 1 个 consumed code 和 1 个 access token，llmlint `User.neuroBookUserId` 精确映射官方 ID。
- 隔离验收数据已清理：临时官方用户、注册码、OAuth code/token 与 llmlint 用户均为 0；生产恢复 `User=2`、`DocJudgment=0`。owner admin 的实际权限与 20 份双轴盲评仍待用户完成。

## Implementation Walkthrough

1. 官方 Prisma 新增 `OAuthClient`、`OAuthAuthorizationCode`、`OAuthAccessToken` 及索引/外键。
2. 官方 Nitro 增加 RFC 8414 metadata、授权 GET/POST、token、userinfo 和 OAuth approve 页面。
3. 官方将 OAuth client secret 以 scrypt 摘要保存，并把 `scripts/oauth-client.ts` 编译为 `/app/dist/oauth-client.mjs`。
4. llmlint 删除密码登录、注册和 admin seed；新增 PKCE pending session、callback、官方用户映射和生产 fail-closed 配置。
5. 更新部署文档、环境模板、PROJECT-STATUS 与 Task 06 walkthrough，记录实际部署边界和验证证据。
6. OAuth consent page 改用浏览器顶层表单导航提交；批准端点保留精确 Origin、query 和 PKCE 校验，同时严格接受 JSON 或 `application/x-www-form-urlencoded` 的唯一 `allowed` 字段。
7. token transport 按 RFC 6749 §2.3.1 解码 Basic 中分别做过 `application/x-www-form-urlencoded` 编码的 client ID 与 secret，再把规范化 header 交给固定版本 OAuth library；不轮换或输出现有 secret。

## TODO / Follow-ups

- owner admin 使用真实账号完成一次 SSO 登录，确认 `/style-review` 可访问并提交 20 份双轴盲评。
- 更新 llmlint Task 06 walkthrough，记录两段生产故障根因、修复版本和闭环证据。
- 运行跨题材集成分析并同步最终结论。
