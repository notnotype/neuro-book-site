# NeuroBook Passport 与官方站点 API v1

> 状态：**已实施（2026-07-22，Task 112 A/B/C 三阶段 + Task 119 账号第二轮；2026-07-27 扩订注册码/邀请码合同；2026-07-31 扩订账号名称与 Web 错误合同）**。
> 本文件是 Passport / 官方站点接口的唯一真相源。服务端（neuro-book-site）与实例客户端（neuro-book 仓）都以此为准；改动接口必须先改本文件。
> 产品讨论与实施 walkthrough 见 neuro-book 仓 `docs/tasks/112-passport-official-site/README.md`。

## 1. 定位与模块划分

neuro-book-site 是 **NeuroBook 官方站点**（模块化单体）。Workshop 是站内一个模块：

| 模块 | 职责 | 状态 |
| --- | --- | --- |
| Passport | 账号、设备授权、实例授权管理、scope | 本 spec 新增 |
| Workshop | 现有创意工坊全部功能 | 已建成，接口不变 |
| Backup | 实例 State Root 云备份与恢复 | 本 spec 新增，第一个在线服务 |
| Contribution / Knowledge | llmlint 贡献摄入、公共知识库 | 预留，不在 v1 |

核心原则：**统一身份、分离事实源**。官方站只做身份与在线服务，不做本地写作数据的真相源；离线写作永远完整可用。

## 2. 术语表（冻结）

| 术语 | 定义 |
| --- | --- |
| 实例（Instance） | 一份 NeuroBook 部署（Portable / Docker / 自部署）。**单实例单用户**。 |
| 实例密码 | `auth: true` 时的进门验证，纯本地，一实例一道门。与 Passport 无关。 |
| 账号槽位（Account Slot） | 实例内持有一份 Passport 授权的本地身份槽。**只管在线身份**（以谁的名义访问官方站），不管本地数据可见性。一个实例可有多个槽位（笔名场景），v1 实例侧只实现默认槽位。 |
| NeuroBook 账号（Passport Account） | 官方站的身份主体，即现有 `User` 表。产品主键永远是它，上游 OAuth（GitHub 等）只是登录入口。 |
| 注册码（Registration Code） | 管理员签发的注册准入凭据。可不限次数或限制次数，可设置过期时间并停用；注册时必填。 |
| 邀请码（Invite Code） | 已登录用户创建的可选邀请归属凭据。可限制次数、设置过期时间并停用，但不能替代注册码授予注册资格。 |
| 实例授权（Instance Authorization） | 一次设备码流批准产生的授权：绑定（账号, 实例名, scope 集合），承载一条 refresh token 链。可在面板单独吊销。 |
| Scope | 授权的权限范围字符串，见 §7。 |

## 3. 认证模型总览

站点接受两类凭证，受保护端点等价对待，但 Bearer 受 scope 限制：

1. **Web 会话**：cookie session（现有 `nuxt-auth-utils`），供浏览器 UI。拥有该账号的全部非 admin 权限；admin 端点只认 cookie session。
2. **Bearer access token**：`Authorization: Bearer nbp_at_...`，供实例 API 调用。经设备授权流获得，短时有效，配 refresh token 轮换。

设计约束：

- 实例侧永远拿不到账号密码；实例被攻破的爆炸半径 = 该授权的 scope，且可在面板单独吊销。
- 客户端不持有任何 client secret（实例是 public client）。
- 匿名边界不变：Workshop 浏览 / 详情 / 下载公开条目继续匿名可用，不需要任何凭证。

## 4. 通用约定

- Base path：新端点全部在 `/api/v1/` 下；破坏性变更升 `/api/v2/`。
- DTO 字段 camelCase，zod 校验（沿用现有 `shared/` DTO 模式）。
- 错误格式：所有业务错误以 `data.error` 返回稳定机器码。Web 参数错误固定为 `validation_failed`，并附不包含输入值和 Zod 原始 message 的 `issues: [{ path, code, minimum?, maximum? }]`；`code` 固定为 `required`、`too_short`、`too_long`、`below_minimum`、`above_maximum`、`invalid_format`、`invalid_value` 或 `password_mismatch`。字符串长度使用 `too_short` / `too_long`，数字和集合上下限使用 `below_minimum` / `above_maximum`。可归属单个字段的业务错误可附 `field`。Web 前端只按错误码本地化，不展示服务端 `message`。**token 端点例外**仅指它继续使用 RFC 8628 风格的既有业务码（`authorization_pending` 等，见 §6.4）。
- 未知 5xx 的 Web 界面显示统一本地化提示，并可附响应 `X-Request-ID` 供日志对账；服务端 message、stack、请求 body 和凭据不得回显。
- 时间一律 ISO 8601 UTC 字符串。
- 限流：设备码申请按 IP 限频；token 轮询必须遵守 `interval`，过快返回 `slow_down`。账号面（2026-07-22 第二轮起为正式合同，进程内固定窗口，超限 429，额度 env 可覆写供测试）：登录 10 次 / 5 分钟 / IP+用户名（`NB_LOGIN_RATE_LIMIT`；键上用户名防误伤共享出口，撒网式换名爆破由注册码准入门禁兜底）；注册（含 OAuth 补全注册，共享额度）5 次 / 小时 / IP（`NB_REGISTER_RATE_LIMIT`）；修改密码 5 次 / 小时 / 用户（`NB_PASSWORD_RATE_LIMIT`）。

## 5. 账号 API

### 5.1 基础端点

现有端点不变，作为 Passport Module 的账号基座：

| 端点 | 说明 |
| --- | --- |
| `POST /api/auth/register` | `{ username, displayName, password, registrationCode, inviteCode? }`。注册码必填并负责准入；邀请码可选，只记录邀请归属。两类码与用户创建在同一事务内消费。 |
| `POST /api/auth/login` / `POST /api/auth/logout` | cookie session。密码为空的 OAuth 免密账号走统一「用户名或密码错误」401，不泄露账号存在性。 |
| `GET /api/auth/me` | 当前会话账号。 |

账号自管理（cookie session 专属，2026-07-22 第二轮新增）：

| 端点 | 说明 |
| --- | --- |
| `GET /api/v1/me/profile` | 本人完整资料：`{ username, displayName, avatarUrl, bio, websiteUrl, hasPassword, joinedAt }`（`hasPassword=false` 即 OAuth 免密账号）。 |
| `PATCH /api/v1/me/profile` | `{ displayName, bio, websiteUrl, avatarUrl }`。bio ≤200；URL 字段为空或 http(s) 且 ≤500（avatarUrl 限 http(s) 防 `javascript:` 注入）。成功后刷新会话身份。 |
| `POST /api/v1/me/password` | `{ currentPassword?, newPassword }`。已有密码必须验旧密（错则 401）；**无密码账号免旧密补设**（OAuth 注册账号由此获得密码登录能力，也解锁解绑）。成功后 `sessionVersion + 1` 踢掉其他设备，当前会话重写保活。 |

注册与邀请凭据管理（cookie session 专属）：

| 端点 | 说明 |
| --- | --- |
| `GET /api/v1/admin/registration-codes` | 管理员分页查看全部注册码及其使用次数、过期和停用状态。 |
| `POST /api/v1/admin/registration-codes` | 管理员批量签发：`{ count, note, maxUses, expiresAt }`。`maxUses=null` 表示不限次数，`expiresAt=null` 表示永不过期。 |
| `PATCH /api/v1/admin/registration-codes/:id` | 管理员修改备注、使用上限、过期时间或停用状态；有限上限不能低于已使用次数。 |
| `GET /api/v1/me/invite-codes` | 当前用户查看自己创建的全部邀请码。 |
| `POST /api/v1/me/invite-codes` | 当前用户创建邀请码：`{ note, maxUses, expiresAt }`，空值语义同注册码。 |
| `PATCH /api/v1/me/invite-codes/:id` | 创建者修改自己的邀请码；他人邀请码统一返回 404。 |

注册码与邀请码都采用原子条件更新消费。有限次数不会被并发注册穿透；任一可选邀请码无效时，整个注册事务回滚，注册码使用次数也不增加。分享链接使用 `/register?registrationCode=...&inviteCode=...`，可只带其中一个参数，但提交注册时仍必须有有效注册码。

账号名称合同：

- `username` 是不可修改的登录账号名，同时用于个人主页 URL 和作者引用。trim 后必须为 3–32 位 `[A-Za-z0-9_-]`，不接受中文。
- `displayName` 是公开显示名称。trim 后为 1–50 个 Unicode 字符，允许中文，注册后仍可通过资料接口修改；注册与资料编辑共用同一 schema。
- 普通注册页的 `confirmPassword` 只用于浏览器校验，不属于请求 DTO，也不得发送到服务端。
- `username_taken` 附 `field: "username"`；注册码与邀请码的 invalid / disabled / expired / exhausted / conflict 错误分别附 `field: "registrationCode"` 或 `field: "inviteCode"`。

### 5.2 上游 OAuth 关联（GitHub，2026-07-22 第二轮落地）

冻结原则：上游身份只能**关联**到 NeuroBook 账号（`PassportIdentity` 表，§10），不能替代它作为主键；解绑后账号照常存在。GitHub 注册**仍需注册码**，可同时填写邀请码；准入门禁对 OAuth 用户不豁免。

密码注册与 GitHub OAuth 是两个独立能力开关：`NUXT_PUBLIC_REGISTRATION_ENABLED` 只控制密码注册，`NUXT_PUBLIC_GITHUB_OAUTH_ENABLED` 只控制 GitHub 登录、关联与补全注册；`NB_PRIVATE_MODE=1` 时后者必须关闭。关闭密码注册不能阻断已经启用的 OAuth 补全流程。

站点回调路由 `GET /auth/github`（nuxt-auth-utils OAuth handler，env `NUXT_OAUTH_GITHUB_CLIENT_ID/SECRET`，GitHub OAuth App 回调地址 `https://<site>/auth/github`）。单路由三分支行为矩阵：

| 前置状态 | 行为 |
| --- | --- |
| GitHub 身份已绑定某账号 | 该账号 disabled → 302 `/login?error=disabled`；active → 写会话，302 `/`。当前已登录他人也切换到绑定账号。 |
| 未绑定 + 当前已登录 | 给当前账号建 `PassportIdentity`（绑定）；账号 `avatarUrl` 为空则自动填 GitHub 头像；302 `/me?tab=account&github=linked`。 |
| 未绑定 + 未登录 | pending 身份写入 session（sealed cookie，不落库）；302 `/register/github` 补全页（填用户名 + 注册码 + 可选邀请码，免设密码）。 |

配套端点：

| 端点 | 说明 |
| --- | --- |
| `GET /api/auth/register/oauth` | 补全页读取 pending 身份：`{ provider, providerUsername, suggestedUsername, displayName, avatarUrl }`；无 pending 404。 |
| `POST /api/auth/register/oauth` | `{ username, displayName, registrationCode, inviteCode? }`。从 session 读 pending 身份（无则 400）；GitHub 名称只用于预填，用户可以修改显示名称；事务内建账号（`passwordHash` 为空 + GitHub 头像）+ `PassportIdentity` + 消费两类码；成功写正式会话。 |
| `GET /api/v1/passport/identities` | 本账号已关联的上游身份列表（cookie session 专属）。 |
| `DELETE /api/v1/passport/identities/:id` | 解绑。**守卫：账号未设密码时拒绝（400），防唯一登录方式被移除后账号失联**；先经 `POST /api/v1/me/password` 补设密码。 |

预留（不在本轮实施，仅占位不冲突）：

- 邮箱注册 / 验证：将来在 `User` 上加 `email` / `emailVerifiedAt`，不动现有用户名主链路。
- GitHub 之外的 provider：`PassportIdentity.provider` 已是自由字符串，加 provider 只加回调路由。

## 6. 设备授权流（实例关联账号的唯一流程）

采用 Device Authorization Grant（RFC 8628 的自洽子集；wire 格式用本站 camelCase DTO，不追求与通用 OAuth 库互操作——两端都是我们自己的代码）。选它的原因：自部署实例 origin 任意，无法预注册 redirect URI；设备码流对 web 部署、桌面端、无头服务器一条链路通吃。

### 6.1 流程

```text
实例设置页点「关联 NeuroBook 账号」
→ 实例后端 POST /passport/device/code（带期望 scope 与建议实例名）
→ 实例 UI 展示 verificationUriComplete（可点击）+ userCode
→ 用户在官方站 /link 页登录（或已登录），核对实例名与 scope，可改实例名，批准
→ 实例后端按 interval 轮询 POST /passport/token (grantType=device_code)
→ 批准后返回 accessToken + refreshToken + 账号信息
→ 实例把 refresh token 存入 App SQLite，绑定当前账号槽位
```

### 6.2 `POST /api/v1/passport/device/code`

匿名调用（实例发起）。

```ts
// 请求
{ instanceName: string; scopes: string[] }        // instanceName 为建议值，批准时用户可改
// 响应
{
    deviceCode: string;                            // 实例侧凭据，勿展示给用户
    userCode: string;                              // XXXX-XXXX，展示给用户
    verificationUri: string;                       // https://<site>/link
    verificationUriComplete: string;               // /link?code=XXXX-XXXX
    expiresIn: number;                             // 秒，默认 900
    interval: number;                              // 轮询最小间隔秒，默认 5
}
```

- `userCode`：8 位 Crockford base32（去混淆字符），格式 `XXXX-XXXX`，15 分钟过期。
- `scopes` 必须是 §7 已定义集合的子集，否则 400。
- 按 IP 限频（如 10 次/小时）。

### 6.3 站点批准页 `/link`

- 需要登录态；未登录先走登录/注册再回跳。
- 输入或经 query 带入 userCode → 展示：实例名（可编辑）、请求的 scope 清单（自然语言解释每个 scope 干什么）→「批准」/「拒绝」。
- 批准即创建 `PassportAuthorization`（并回写设备码的 `authorizationId`）；同一 userCode 只能消费一次。
- 页面消费的站内 API（cookie session 专属，Bearer 不可用）：

| 端点 | 说明 |
| --- | --- |
| `GET /api/v1/passport/device/:userCode` | 查待批设备码：`{ instanceName, scopes, status, expiresAt }`；不存在/已过期 404 |
| `POST /api/v1/passport/device/:userCode/approve` | `{ instanceName }`（可覆盖建议名）；仅 pending 且未过期可批准 |
| `POST /api/v1/passport/device/:userCode/deny` | 拒绝；仅 pending 可拒绝 |

### 6.4 `POST /api/v1/passport/token`

匿名调用。两种 grant：

```ts
// 请求（设备码兑换）
{ grantType: "device_code"; deviceCode: string }
// 请求（刷新轮换）
{ grantType: "refresh_token"; refreshToken: string }

// 成功响应（两种 grant 相同）
{
    accessToken: string;       // nbp_at_ 前缀，默认 30 分钟
    expiresIn: number;
    refreshToken: string;      // nbp_rt_ 前缀，每次刷新都轮换出新值
    scopes: string[];
    account: { id: number; username: string; displayName: string };
}

// 业务失败：HTTP 400，data.error 取值
// authorization_pending  用户尚未批准，继续按 interval 轮询
// slow_down              轮询过快，interval 加 5 秒再试
// expired_token          设备码过期，重新发起 device/code
// access_denied          用户点了拒绝，终止流程
// invalid_grant          refresh token 无效/已轮换被重放/授权已吊销 → 实例清除本地凭据，提示重新关联
```

**Refresh token 轮换与重放撤链**：每次 `refresh_token` grant 都签发新 refresh token 并将旧值标记 `rotated`。凡收到 `rotated` / `revoked` 状态的旧 token，视为泄露重放，**立即吊销整条授权**（对应实例下次请求全部 401，需重新关联）。

### 6.5 `POST /api/v1/passport/revoke`

匿名调用（实例主动注销，如用户在实例侧点「取消关联」）。

```ts
{ refreshToken: string }   // 幂等；无论 token 是否有效都返回 200
```

### 6.6 Token 格式与存储

- 全部为不透明随机串（256-bit，base64url），带前缀便于泄露识别：`nbp_at_`（access）、`nbp_rt_`（refresh）。
- 服务端只存 SHA-256 摘要，不存明文。
- Access token 落库带 `expiresAt`，请求时一次查表校验；过期条目定期清扫。选不透明 token 而非 JWT：吊销即时生效，站点规模下一次 SQLite 查表成本可忽略。
- Refresh token 无绝对过期，闲置 90 天（可配）作废。
- 实例侧：refresh token 存 App SQLite，按账号槽位归属；access token 内存持有即可。

## 7. Scope 表

v1 签发：

| Scope | 允许的端点 | 说明 |
| --- | --- | --- |
| `workshop:publish` | `POST /items`、`POST /items/:slug/versions`、`PATCH /items/:slug`（本人条目）、`GET /me/items` | 从实例内发布 / 更新工坊资产 |
| `backup:write` | `POST /backups`、`DELETE /backups/:id` | 上传 / 删除备份 |
| `backup:read` | `GET /backups`、`GET /backups/:id`、`GET /backups/:id/download` | 列出 / 下载备份 |

保留字（勿挪用）：`workshop:read`（公开面目前匿名即可，暂不签发）、`contribution:submit`、`memory:*`。

规则：

- Bearer 请求命中未授权 scope 的端点 → 403，错误码 `insufficient_scope`。
- Admin 端点（`/api/v1/admin/*`）永远不接受 Bearer。
- 点赞 / 收藏 / 评论等社交端点 v1 不开放给 Bearer（没有实例内消费场景），cookie session 专属。

## 8. 授权管理 API（面板消费，cookie session）

| 端点 | 说明 |
| --- | --- |
| `GET /api/v1/passport/authorizations` | 列出本账号全部实例授权：`{ id, instanceName, scopes, createdAt, lastUsedAt, revokedAt }[]`（含已吊销，前端可过滤） |
| `PATCH /api/v1/passport/authorizations/:id` | `{ instanceName }` 重命名 |
| `DELETE /api/v1/passport/authorizations/:id` | 吊销：整条 token 链立即失效。**用户在公网实例失守时唯一的自救手段，属 v1 验收范围。** |

`lastUsedAt` 在每次 access token 校验通过时懒更新（可批量 / 节流，精确到分钟足够）。

## 9. Backup API（第一个在线服务）

### 9.1 归属与生命周期

- 备份归属 **NeuroBook 账号**，不归属实例授权——灾难恢复的核心场景就是旧实例没了、换新实例恢复。吊销授权**不**删除备份。
- 每份备份快照 `instanceLabel`（取上传时授权的 instanceName），仅作展示与轮换分组，不构成权限边界。
- 服务端把归档当 **opaque blob**：只存字节 + 元数据，不解包、不理解内容。归档格式合同属于客户端（§9.4），两端可独立演进。

### 9.2 端点

Bearer（scope 见 §7）与 cookie session 均可调用；面板用 session，实例用 Bearer。

**`POST /api/v1/backups`** — 上传（`backup:write`）

`multipart/form-data`：`meta`（JSON 字符串）+ `file`（归档字节）。

```ts
// meta
{
    sha256: string;              // 64 位小写 hex；对完整密文 envelope 计算
    keyId: string;               // 16 位小写 hex；只标识客户端解密密钥，不具备解密能力
    appVersion: string;          // 产生备份的 NeuroBook 版本
    kind: "manual" | "auto";     // 手动备份 / 定时备份
    comment?: string;            // 为空表示无备注
    rotate?: boolean;            // true 时：配额不足则自动删除同 instanceLabel 最旧的 auto 备份腾位；manual 永不被自动删除
}
// 响应：Backup DTO
{ id, instanceLabel, kind, fileSize, sha256, keyId, appVersion, comment, createdAt }
```

- 配额不足且无法通过 rotate 腾出 → 413，错误码 `quota_exceeded`，附当前用量。
- 只接受加密 envelope；服务端不解析、不解密归档内容。旧明文 zip 直接拒绝。
- 落盘 `NB_BACKUP_DIR`（默认 `./data/backups`）`/<userId>/<backupId>.nbbackup`，与 Workshop 文件同级分目录。

**`GET /api/v1/backups`** — 列表（`backup:read`），按 createdAt 倒序，支持 `instanceLabel` 过滤。响应附配额用量：`{ items: BackupDto[], quota: { usedBytes, maxBytes, count, maxCount, maxFileBytes } }`（面板用量条与实例端预检共用）。

**`GET /api/v1/backups/:id`** — 单条元数据（`backup:read`）。

**`GET /api/v1/backups/:id/download`** — 密文字节流（`backup:read`），响应类型为 `application/vnd.neurobook.backup`，响应头带 `x-nb-sha256` 与 `x-nb-key-id`。

**`DELETE /api/v1/backups/:id`** — 删除（`backup:write`），幂等。

### 9.3 配额（服务端可配，env）

| 配置 | 默认 |
| --- | --- |
| `NB_BACKUP_MAX_FILE_BYTES` 单份上限 | 1 GiB |
| `NB_BACKUP_QUOTA_BYTES` 每账号总量 | 2 GiB |
| `NB_BACKUP_MAX_COUNT` 每账号份数 | 5 |

Workshop 与 Backup 还共同受 `NB_STORAGE_MAX_BYTES` 全站逻辑上限和 `NB_STORAGE_RESERVED_BYTES` 物理磁盘保留空间约束。全站容量不足返回 HTTP 507 与 `storage_capacity_exceeded`；账号配额不足仍返回 413 与 `quota_exceeded`。容量不足不得阻断读取和删除。

v1 用单请求流式上传（校验 Content-Length），够覆盖以文本为主的 State Root。超大工程的分块上传是将来的扩展（预留 `POST /backups/uploads` 命名空间），不改变已有端点语义。

### 9.4 归档与加密格式合同（客户端侧，服务端不感知）

- zip 打包**整个 State Root**（Portable 即 `data/`）：`workspace/`（含 `workspace/.nbook` 应用库）、`config.yaml`、`.env`。
- 排除：`secrets/`、`logs/`、锁文件与临时文件（`*.lock`、`*.tmp`、SQLite `-wal`/`-shm`）。SQLite 一致快照失败时整次备份失败，不按原文件降级。
- zip 根放 `nb-backup.json`：`{ formatVersion: 2, appVersion, createdAt, encryption: "AES-256-GCM" }`。
- 第一次备份由系统 CSPRNG 生成 32 字节 Backup Master Key。恢复码固定为 `NBK1-<base64url-key>-<checksum>`；checksum 是 key 的 SHA-256 前 4 字节 hex，`keyId` 是前 8 字节 hex。
- 外层 envelope 固定为：8 字节 ASCII magic `NBOOKBK1`、4 字节大端 header 长度、UTF-8 JSON header、ciphertext、16 字节 GCM tag。header 以固定字段顺序包含 `formatVersion:1`、`algorithm:"AES-256-GCM"`、`keyId` 和 12 字节随机 nonce，并连同 magic/长度前缀作为 AAD。
- zip 压缩输出直接进入 cipher，不落完整明文 zip。恢复先校验密文 sha256，再完整验证 GCM tag，最后才解包和校验内层 manifest。
- 主密钥只保存于实例 `State Root/secrets/backup-keyring.json`，该目录不进入归档。官方站只可见账号、实例名、时间、密文大小、应用版本、类型、备注与 `keyId`。

### 9.5 恢复流程（实例侧，v1 范围）

实例下载密文并校验 sha256，根据 `keyId` 选择本地密钥；缺少密钥时必须由用户导入恢复码。GCM 完整性验证通过后，再次流式解密并解包到 State Root 同级 `restore-<timestamp>/`，最后引导用户停机换目录。运行中进程不覆盖自己的 State Root。

## 10. 数据模型增量（Prisma 草案）

```prisma
// 设备码：一次关联流程的短命凭据
model PassportDeviceCode {
    id              Int      @id @default(autoincrement())
    deviceCodeHash  String   @unique   // sha256(deviceCode)
    userCode        String   @unique   // XXXX-XXXX 展示码
    instanceName    String              // 实例建议名，批准时可被用户覆盖
    scopesJson      String              // JSON string[]
    status          String              // pending / approved / denied / expired / consumed
    approvedById    Int?                // 为空表示尚未有用户处理
    authorizationId Int?                // 批准时创建的授权 id；为空表示未批准。兑换（consume）只签发 token
    expiresAt       DateTime
    lastPolledAt    DateTime?           // 为空表示实例尚未轮询过；用于 slow_down 判定
    createdAt       DateTime @default(now())
}

// 实例授权：token 链的宿主，面板管理单位
model PassportAuthorization {
    id           Int       @id @default(autoincrement())
    userId       Int
    instanceName String
    scopesJson   String
    lastUsedAt   DateTime?             // 为空表示批准后从未使用
    revokedAt    DateTime?             // 为空表示有效
    createdAt    DateTime  @default(now())
    user   User                    @relation(fields: [userId], references: [id])
    tokens PassportToken[]
    @@index([userId, revokedAt])
}

// access 与 refresh 统一存摘要；refresh 轮换靠 status 流转
model PassportToken {
    id              Int      @id @default(autoincrement())
    authorizationId Int
    kind            String   // access / refresh
    tokenHash       String   @unique
    status          String   // active / rotated / revoked（access 只有 active，过期即清扫）
    expiresAt       DateTime?           // access 必填；refresh 为空表示不设绝对过期（闲置作废另算）
    createdAt       DateTime @default(now())
    authorization PassportAuthorization @relation(fields: [authorizationId], references: [id])
    @@index([authorizationId, kind, status])
}

// 实例备份：账号级资产
model InstanceBackup {
    id            Int      @id @default(autoincrement())
    userId        Int
    instanceLabel String
    kind          String   // manual / auto
    fileSize      Int
    sha256        String
    keyId         String
    appVersion    String
    comment       String   @default("")
    storagePath   String   // 相对 NB_BACKUP_DIR
    createdAt     DateTime @default(now())
    user User @relation(fields: [userId], references: [id])
    @@index([userId, createdAt])
}
// 上游 OAuth 身份（§5.2）：只关联不替代，一个上游身份至多绑一个账号
model PassportIdentity {
    id               Int      @id @default(autoincrement())
    provider         String   // "github"（自由字符串，扩 provider 不改表）
    providerUserId   String   // 上游用户唯一 id（GitHub 数字 id 字符串化）
    providerUsername String   // 上游展示名快照（GitHub login），仅展示用
    userId           Int
    createdAt        DateTime @default(now())
    user User @relation(fields: [userId], references: [id])
    @@unique([provider, providerUserId])
    @@index([userId])
}

// 管理员签发的注册准入凭据；maxUses 为空表示不限次数
model RegistrationCode {
    id          Int       @id @default(autoincrement())
    code        String    @unique
    note        String    @default("")
    maxUses     Int?
    usedCount   Int       @default(0)
    lastUsedAt  DateTime?
    expiresAt   DateTime?
    disabledAt  DateTime?
    createdById Int
    createdAt   DateTime  @default(now())
    createdBy User   @relation("RegistrationCodeCreated", fields: [createdById], references: [id])
    users     User[] @relation("RegistrationCodeUses")
    @@index([createdById])
    @@index([disabledAt, expiresAt])
}

// 用户创建的可选邀请归属凭据；不能替代注册码
model InviteCode {
    id         Int       @id @default(autoincrement())
    code       String    @unique
    note       String    @default("")
    maxUses    Int?
    usedCount  Int       @default(0)
    lastUsedAt DateTime?
    expiresAt  DateTime?
    disabledAt DateTime?
    ownerId    Int
    createdAt  DateTime  @default(now())
    owner User   @relation("InviteCodeCreated", fields: [ownerId], references: [id])
    users User[] @relation("InviteCodeUses")
    @@index([ownerId, createdAt])
    @@index([disabledAt, expiresAt])
}
```

`User` 表增量：2026-07-22 将 `passwordHash` 转可空（为空 = OAuth 免密账号，不能密码登录），并新增 profile 字段 `avatarUrl` / `bio` / `websiteUrl`。2026-07-27 增加 `registrationCodeId` 与 `inviteCodeId` 两个可空归属外键；旧的一次性 `InviteCode` 数据迁为不限次数 `RegistrationCode`，已有使用者归属保留到 `registrationCodeId`，新的用户邀请码表从空表开始。

## 11. 实例侧客户端合同（neuro-book 仓职责）

- 设置页新增「NeuroBook 账号」面板：发起设备码流、展示关联状态（账号名 / scope / 站点地址）、取消关联（调 §6.5 revoke + 清本地凭据）。
- 官方站地址可配（自部署站点场景），默认官方域名。
- refresh token 存 App SQLite，按账号槽位归属；v1 只有默认槽位，表结构直接带 `slotId` 以免将来迁移。
- 401/`invalid_grant` 的统一处理：清凭据 → UI 退回未关联态 → 提示重新关联，不得静默重试。
- 备份客户端：手动备份按钮 + 可选定时（`kind: auto` + `rotate: true`）；打包遵守 §9.4（SQLite 需 checkpoint 后拷贝）。
- **离线不降级**：未关联时所有本地功能照常；「关联」永远是被动入口，不做启动弹窗。

## 12. 面板（站点 UI 能力清单）

- `/link`：设备码批准页（§6.3）。
- 用户面板（现有 `/me` 扩展或独立 `/settings`，实施时定）：账号信息与改密、**已连接实例**（列表 / 重命名 / 吊销，含 lastUsedAt）、**备份管理**（列表 / 下载 / 删除 / 用量与配额展示）。

## 13. 实施阶段与开放问题

阶段（每段完成都可独立上线）：

- **A — Passport 地基**：schema、设备码流、token 端点与轮换撤链、`/link` 页、授权管理 API + 面板页。
- **B — Backup 服务端**：三张表之 `InstanceBackup`、上传/列表/下载/删除、配额与 rotate、面板备份页。
- **C — 实例客户端**（neuro-book 仓）：设置页关联面板、凭据存储、备份/恢复 UI。
- **D — 账号第二轮**（2026-07-22）：GitHub OAuth 关联/登录/注册补全（§5.2）、profile 与改密（§5.1）、账号面限流（§4）。
- **E — 注册码与邀请码分离**（2026-07-27）：管理员注册码负责准入；用户邀请码记录可选归属；两类码支持不限/限次、过期、停用与分享链接。
- 预留：邮箱注册、Contribution。

开放问题（实施时定，不阻塞 spec）：

1. 恢复应用机制（§9.5 两候选）。
2. 站点是否需要「备份在线预览」（列 zip 清单）——倾向不做，保持 opaque。
3. 生产何时启用 GitHub OAuth。密码注册已经独立开放；GitHub OAuth 仍由私有模式强制关闭，启用前需要真实 OAuth App 回调验收。
