# NeuroBook OAuth Provider 与 llmlint SSO（Task 133）

## User Request / Topic

将 llmlint Web 从本地密码/注册认证切换为 NeuroBook 官方 OAuth Authorization Code + S256 PKCE；保持 llmlint 本地 `User.id` 与历史数据外键不变，通过 `User.neuroBookUserId` 关联官方用户，并准备 DMIT 正式部署。

## Goal

- 官方站提供固定第一方 `llmlint-web` client 的 OAuth metadata、授权、token 和 userinfo 端点。
- OAuth code 与 access token 只保存不可逆摘要；authorization code 一次性消费，禁止 plain PKCE、query bearer token 和 refresh token。
- llmlint 只保存 host-only sealed 本地 session；callback 只短时使用官方 access token，userinfo 后丢弃。
- 生产配置错误或仍存在旧本地 admin secret 时 fail closed。

## Current State

代码已提交并推送：官方 PR [#1](https://github.com/notnotype/neuro-book-site/pull/1) 检查通过；llmlint PR [#3](https://github.com/notnotype/llmlint/pull/3) 检查通过。官方线上尚未切换到该版本：公网 metadata 当前仍返回 Nuxt HTML，线上 SQLite 尚无 `OAuthClient` 表；llmlint DMIT 正式 unit、TLS vhost 和 443 stream 尚未启用。

## Decisions / Discussion

- 官方账号 ID 是稳定关联键；llmlint 本地自增 ID 继续作为评分、文本和批注外键。
- 同一官方 ID 重复登录复用原本地用户行；username 已被未映射的本地用户占用时拒绝自动合并并返回 `account_mapping_conflict`。
- secret 只能通过 stdin 写入官方 client 摘要初始化工具和 llmlint 远端 secret 文件，禁止进 argv、镜像或日志。
- 正式切换顺序：官方 provider migration/readiness → 官方 `llmlint-web` client 初始化 → llmlint secret 与服务 → Nginx/TLS 公网 → 真实浏览器 SSO。

## Verification / Test

- provider 与 llmlint typecheck 通过。
- provider 聚焦 OAuth 集成测试通过：metadata、redirect/scope/PKCE 拒绝、批准、一次性兑换、userinfo、重放和 token 认证边界。
- llmlint Node `node-server` build 通过；真实 `.output/server/index.mjs` 隔离 SQLite smoke 通过 health 200、SSO disabled 503、未认证页面 401。
- DMIT Ubuntu frozen build 通过；首次构建的 1.9 GiB 宿主 OOM 通过 4 GiB swap 与 1536 MiB heap 限制解决。
- 未完成真实公网 SSO 和双轴人评回收，原因是官方 provider 尚未部署且公网/TLS/secret 尚未完成。

## Implementation Walkthrough

1. 官方 Prisma 新增 `OAuthClient`、`OAuthAuthorizationCode`、`OAuthAccessToken` 及索引/外键。
2. 官方 Nitro 增加 RFC 8414 metadata、授权 GET/POST、token、userinfo 和 OAuth approve 页面。
3. 官方将 OAuth client secret 以 scrypt 摘要保存，并把 `scripts/oauth-client.ts` 编译为 `/app/dist/oauth-client.mjs`。
4. llmlint 删除密码登录、注册和 admin seed；新增 PKCE pending session、callback、官方用户映射和生产 fail-closed 配置。
5. 更新部署文档、环境模板、PROJECT-STATUS 与 Task 06 walkthrough，记录实际部署边界和验证证据。

## TODO / Follow-ups

- 合并双仓 PR（当前 PR #1 / PR #3 均 OPEN、检查通过；不由 Agent 自行合并）。
- 官方站部署 migration 和新镜像，初始化 `llmlint-web` client。
- 写入 llmlint DMIT secret，安装正式 Node unit、Nginx/TLS/stream 并验证公网 metadata。
- 真实浏览器完成一次 SSO 登录，确认本地用户映射与管理员权限。
- 在正式 origin 上回收 20 份双轴盲评并运行跨题材集成分析。
