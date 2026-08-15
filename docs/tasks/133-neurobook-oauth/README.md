# NeuroBook OAuth Provider 与 llmlint SSO（Task 133）

## User Request / Topic

将 llmlint Web 从本地密码/注册认证切换为 NeuroBook 官方 OAuth Authorization Code + S256 PKCE；保持 llmlint 本地 `User.id` 与历史数据外键不变，通过 `User.neuroBookUserId` 关联官方用户，并准备 DMIT 正式部署。

## Goal

- 官方站提供固定第一方 `llmlint-web` client 的 OAuth metadata、授权、token 和 userinfo 端点。
- OAuth code 与 access token 只保存不可逆摘要；authorization code 一次性消费，禁止 plain PKCE、query bearer token 和 refresh token。
- llmlint 只保存 host-only sealed 本地 session；callback 只短时使用官方 access token，userinfo 后丢弃。
- 生产配置错误或仍存在旧本地 admin secret 时 fail closed。

## Current State

官方 provider 与 llmlint SSO 已在 DMIT 公网切换完成；公网 metadata、health、443 SNI 和 31445 直连门禁均已验收。首次真实授权批准时发现 consent page 使用 `fetch(..., redirect: "manual")` 读取跨站 302，浏览器返回 `opaqueredirect`（status 0、无 `Location`），因此 callback 未到达；本修复改为顶层表单 POST，待合入后重新部署并完成真实闭环。

## Decisions / Discussion

- 官方账号 ID 是稳定关联键；llmlint 本地自增 ID 继续作为评分、文本和批注外键。
- 同一官方 ID 重复登录复用原本地用户行；username 已被未映射的本地用户占用时拒绝自动合并并返回 `account_mapping_conflict`。
- secret 只能通过 stdin 写入官方 client 摘要初始化工具和 llmlint 远端 secret 文件，禁止进 argv、镜像或日志。
- 正式切换顺序：官方 provider migration/readiness → 官方 `llmlint-web` client 初始化 → llmlint secret 与服务 → Nginx/TLS 公网 → 真实浏览器 SSO。

## Verification / Test

- provider 与 llmlint typecheck 通过；provider 聚焦 OAuth 集成测试原有 5 项全通过，本修复将完整 S256 批准用例改为表单体并增加非法/重复表单拒绝覆盖，5 项仍全通过。
- DMIT 生产 `GET https://llmlint.notnotype.com/api/health` 返回 `{"status":"ok","service":"llmlint-web","database":"ok"}`；443 SNI 与 31445 直连门禁已验收。
- 真实失败证据：官方 `POST /api/v1/oauth/authorize` 多次返回 302，生产 `OAuthAuthorizationCode=17`、`OAuthAccessToken=0`，llmlint access log 没有 `/auth/neurobook` callback 请求。
- 本修复已通过官方 `bun run typecheck`、`bun run build` 与 `bunx vitest run tests/oauth-client.integration.test.ts`（5 tests passed）；生产重新部署和真实公网 SSO 回调仍待完成。
- 双轴盲评尚未回收；生产 `DocJudgment=0`，需先完成真实 SSO 闭环。

## Implementation Walkthrough

1. 官方 Prisma 新增 `OAuthClient`、`OAuthAuthorizationCode`、`OAuthAccessToken` 及索引/外键。
2. 官方 Nitro 增加 RFC 8414 metadata、授权 GET/POST、token、userinfo 和 OAuth approve 页面。
3. 官方将 OAuth client secret 以 scrypt 摘要保存，并把 `scripts/oauth-client.ts` 编译为 `/app/dist/oauth-client.mjs`。
4. llmlint 删除密码登录、注册和 admin seed；新增 PKCE pending session、callback、官方用户映射和生产 fail-closed 配置。
5. 更新部署文档、环境模板、PROJECT-STATUS 与 Task 06 walkthrough，记录实际部署边界和验证证据。
6. OAuth consent page 改用浏览器顶层表单导航提交；批准端点保留精确 Origin、query 和 PKCE 校验，同时严格接受 JSON 或 `application/x-www-form-urlencoded` 的唯一 `allowed` 字段。

## TODO / Follow-ups

- 合入并部署本次 OAuth consent navigation 修复，随后用真实浏览器完成授权批准、llmlint callback、本地用户映射和管理员权限验收。
- 更新 llmlint Task 06 walkthrough，记录生产故障根因、修复版本和闭环证据。
- 在正式 origin 上回收 20 份双轴盲评并运行跨题材集成分析。
