# NeuroBook Site 单机部署

本文只覆盖应用容器。DMIT 的 DNS、证书、Nginx stream 和 Xray 443 切换必须使用 Task 128 单独的维护窗口 runbook，不能仅按本文直接改公网入口。

NeuroBook 官方站：账号关联、创意工坊与客户端加密云备份的模块化单体。Task 01 的 Skill / Workflow / Profile 统一包、SemVer、文件浏览、完整包发布工作台、静态源码校验、有界 ZIP、首版草稿和可恢复迁移已部署 DMIT。新版 `@notnotype/nb-ui` FileTree 固定到公开 commit `291b2d6`。密码注册已独立开放，GitHub OAuth 继续关闭；Task 02 的账号显示名称、中英双语、认证表单与开关链路收口均已部署并完成公网验收。t133 正在加入固定第一方 client 的 OAuth Authorization Code + S256 PKCE provider，尚未完成生产切换。

## 目录与权限

```bash
sudo install -d -m 0700 -o 10001 -g 10001 /srv/neuro-book-site/data
sudo install -d -m 0700 -o 10001 -g 10001 /srv/neuro-book-site/logs
cd /srv/neuro-book-site
sudo install -m 0600 -o root -g root .env.production.example .env
```

把 `compose.yml`、`.env.production.example` 和本文放入 `/srv/neuro-book-site`。编辑 `.env` 时：

- `NB_SITE_IMAGE` 必须是公开 GHCR 的完整 `@sha256:` digest，禁止 `latest`。
- `NUXT_SESSION_PASSWORD` 使用 48 字节 CSPRNG 结果，不得复用账号密码。
- 不得添加 `ADMIN_PASSWORD`、OAuth secret 或 GitHub Token。
- `NB_TRUSTED_PROXY_ADDRESSES` 固定为 Compose bridge 网关 `172.30.0.1`。
- `NUXT_PUBLIC_REGISTRATION_ENABLED` 是非敏感的密码注册开关；生产缺省和示例均为 `0`。准备接受有效注册码注册时设为 `1`，导航、登录页和 `/register` 会同时开放，但没有有效注册码仍无法创建账号。
- `NUXT_PUBLIC_GITHUB_OAUTH_ENABLED` 是非敏感的 GitHub OAuth 开关；浏览器和服务端共同读取它。`NB_PRIVATE_MODE=1` 时必须为 `0`，单独开启密码注册不会开放 GitHub 登录。
- `NB_LOG_LEVEL` 只接受 `debug`、`info`、`warn`、`error`，生产默认使用 `info`。
- `NB_LOG_FILE` 固定为 `/logs/site.jsonl`；生产缺失、使用相对路径或目录不可写时拒绝启动。

生成 Session secret：

```bash
openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'
```

填好后只做不回显 secret 的配置校验：

```bash
sudo test "$(stat -c '%a:%U:%G' .env)" = "600:root:root"
sudo docker compose config --quiet
```

两个 `NUXT_PUBLIC_*` 能力开关使用 Nuxt 标准运行时前缀，因此修改后只需重建容器，不需要为开关重新构建镜像。发布新版本前仍应在 loopback 分别确认页面入口和服务端门禁一致；私有模式与 OAuth 开关矛盾时应用会拒绝启动。

## 首次启动

```bash
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
curl --fail --silent http://127.0.0.1:3100/api/health/live
curl --fail --silent http://127.0.0.1:3100/api/health/ready
```

入口脚本会先创建 SQLite 文件、执行 `prisma migrate deploy`，再运行 `migrate-agent-assets --apply` 恢复或迁移归档；三步成功后才启动 Nitro。生产配置缺失、仍是示例值、migration 未应用，或数据库与 Workshop 归档无法证明一致时，容器不会进入 ready。

管理员只初始化一次。生成 24 字节随机密码，经 stdin 交给一次性容器；密码不会进入 argv、环境变量或容器日志：

```bash
ADMIN_INPUT="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n')"
printf '%s\n' "$ADMIN_INPUT" | sudo docker compose run --rm -T --entrypoint node site /app/dist/init-db.mjs
printf '管理员密码（仅此一次）: %s\n' "$ADMIN_INPUT"
unset ADMIN_INPUT
```

随后在 loopback 完成登录、设备码、Workshop、加密备份上传/下载和恢复 smoke。公网反代未接入前不要改 DNS。

## llmlint OAuth client 初始化

官方站只保存 llmlint client secret 的不可逆摘要；同一份 secret 还必须写入 llmlint DMIT 的 `/srv/llmlint/secrets/web.env`。先在密码管理器中生成并保存至少 32 个字符的随机 secret，再用 stdin 执行一次性幂等初始化，不要把 secret 放进命令参数、镜像环境变量或日志：

```bash
read -r -s -p "llmlint OAuth client secret: " OAUTH_CLIENT_SECRET
printf '\n'
printf '%s\n' "$OAUTH_CLIENT_SECRET" | sudo docker compose exec -T site \
  node /app/dist/oauth-client.mjs --ensure llmlint-web
unset OAUTH_CLIENT_SECRET
```

命令只会创建或更新固定的 `llmlint-web` client，redirect URI 固定为 `https://llmlint.notnotype.com/auth/neurobook`，scope 固定为 `profile`。初始化前必须先确认当前容器已由 entrypoint 完成 Prisma migration；初始化后再把同一 secret 写入 llmlint 的生产 secret 文件并启动 llmlint 服务。

 [C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book-site/.worktree/t133-neurobook-oauth/PROJECT-STATUS.md#7AF9]

## 管理员密码维护

源码环境使用一个显式命令管理管理员密码。`create` 只新建不存在的管理员，`reset` 只重置已存在且角色为 admin 的账号；两种模式均拒绝隐式覆盖或提升普通账号：

```bash
ADMIN_INPUT="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n')"
printf '%s\n' "$ADMIN_INPUT" | bun run db:admin -- create
printf '管理员密码（仅此一次）: %s\n' "$ADMIN_INPUT"
unset ADMIN_INPUT
```

生产容器使用镜像内编译好的 Node 工具。重置会递增 `sessionVersion`，使全部旧登录会话失效；不会改变账号角色或启用状态：

```bash
cd /srv/neuro-book-site
ADMIN_INPUT="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n')"
printf '%s\n' "$ADMIN_INPUT" | sudo docker compose exec -T site \
  node /app/dist/admin-password.mjs reset
printf '管理员新密码（仅此一次）: %s\n' "$ADMIN_INPUT"
unset ADMIN_INPUT
```

管理员用户名读取 `ADMIN_USERNAME`，未配置时为 `admin`。密码至少 16 个字符，只能经 stdin 输入；不要把密码放入命令参数、环境文件或运维日志。

## 运行时约束检查

```bash
sudo docker compose exec -T site id
sudo docker compose exec -T site sh -c 'test "$(id -u)" = 10001 && touch /tmp/write-ok'
! sudo docker compose exec -T site sh -c 'touch /app/should-fail'
sudo docker inspect neuro-book-site-site-1 --format '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.Memory}} {{.Config.User}}'
```

预期为：UID `10001`、`/tmp` 可写、`/app` 写入失败、只读根文件系统为 `true`、内存上限 `805306368`、镜像用户 `10001:10001`。

## 升级前冷快照

私有内测只做同盘冷快照，不是异地灾难恢复。快照前先确保可用空间至少为“当前数据体积 + 4 GiB”：

```bash
cd /srv/neuro-book-site
DATA_BYTES="$(sudo du -sb data | awk '{print $1}')"
AVAILABLE_BYTES="$(df -PB1 . | awk 'NR==2 {print $4}')"
REQUIRED_BYTES="$((DATA_BYTES + 4294967296))"
test "$AVAILABLE_BYTES" -ge "$REQUIRED_BYTES" || { echo '空间不足，停止升级'; exit 1; }

sudo docker compose stop site
SNAPSHOT="snapshot-$(date -u +%Y%m%dT%H%M%SZ).tar"
sudo tar --acls --xattrs -cpf "$SNAPSHOT" data
sudo docker compose start site
curl --fail --silent http://127.0.0.1:3100/api/health/ready
printf 'snapshot=%s\n' "$SNAPSHOT"
```

不得在应用仍写入 SQLite 时制作“热 tar”。DMIT 整盘损坏会同时丢失数据和同盘快照，这是已接受的内测剩余风险。
`logs/` 有独立轮转和容量边界，不进入站点冷快照，也不计入 Workshop/Backup 用户配额。

## 固定 digest 升级与回滚

记录旧 digest，完成冷快照后再修改 `.env` 的 `NB_SITE_IMAGE`：

```bash
sudo docker compose pull
sudo docker compose up -d
curl --fail --silent http://127.0.0.1:3100/api/health/ready
```

镜像回滚只需恢复旧 digest 并再次 `pull/up`。如果新版本已经执行不兼容 migration，必须停止容器、保留失败现场，并从对应冷快照整体恢复 `data/`；禁止只替换 SQLite 而保留新版本文件目录。

### Agent 资产协议迁移

包含 `20260728090000_agent_asset_package` 与 `20260729090000_agent_asset_publish_integrity` 的版本会把公开整数版本映射为 SemVer，并保留原整数作为 ZIP 寻址 ordinal；随后原子迁移旧 `nbook-package.json`，补齐代码风险字段和发布一致性约束。生产尚未执行，本节描述已交付的自动门禁，不构成部署授权。

`upgrade-dmit.sh` 在停站和写入任何持久数据前，先用目标镜像执行只读 preflight：容器无网络、根文件系统只读、`data/` 只读挂载，只允许在 tmpfs 验证候选 ZIP。preflight 会计算旧数据库/ZIP 摘要、执行有界归档验证并报告动作；任何缺文件、摘要不符、未知 schema 或 sidecar 歧义都会在冷快照前停止升级。

preflight 通过后，自动升级才会停止站点并制作整份 `data/` 冷快照。新容器 entrypoint 依次执行 Prisma migration 与 `migrate-agent-assets --apply`：schema 0 的 `.backup` 只有匹配旧数据库摘要才会恢复，schema 1 的正式文件必须匹配新数据库摘要；无法唯一判断恢复方向时直接退出。成功后 readiness 轻量检查 schema、正式文件大小和残留 sidecar。

需要单独审计目标镜像时，可在修改 `.env` 前运行与部署脚本同等的只读探针：

```bash
cd /srv/neuro-book-site
TARGET_IMAGE='ghcr.io/notnotype/neuro-book-site@sha256:<target-digest>'
sudo docker run --rm \
  --network none \
  --read-only \
  --tmpfs /tmp:size=64m,mode=1777 \
  --env-file .env \
  --volume "$PWD/data:/data:ro" \
  --entrypoint node \
  "$TARGET_IMAGE" /app/dist/migrate-agent-assets.mjs --preflight
```

任一步失败都停止继续，保留部署目录中的 preflight/容器日志和失败数据，并由升级脚本从同一份冷快照整体恢复数据库与 Workshop ZIP。禁止只替换 SQLite、手工删除 sidecar，或在摘要不匹配时跳过 guard。

## 快速推送并升级 DMIT

仓库提供本地编排命令。它只部署已经提交且工作区干净的 `master`，不会自动创建 commit：

```powershell
# 只读检查仓库、分支、origin、gh 和 SSH alias
bun run deploy:dmit -- --dry-run

# 交互确认后执行完整流程
bun run deploy:dmit

# 自动化调用时跳过输入 deploy 的确认步骤
bun run deploy:dmit -- --yes
```

本地需要 `git`、已登录的 `gh` 和可用的 `ssh dmit`；远端需要 `sudo -n`、Docker Compose、`flock` 与 `curl`。完整流程固定为：

1. 拒绝非 `master`、错误 origin、未提交改动和非快进 push；执行 `git push origin HEAD:master`，永不 force push。
2. 等待该 commit 的 `container.yml` verify 与 container job 全部成功；从公开 GHCR 的 `sha-<commit>` tag 解析完整 `@sha256:` digest。
3. 通过远端互斥锁进入 `/srv/neuro-book-site`，先拉取镜像、检查“当前 data 大小 + 4 GiB”余量，再用目标镜像和只读 data volume 执行 Agent 资产 preflight；失败时尚未停站或写数据。
4. 停止站点制作冷快照，原子替换 `.env` 中唯一的 `NB_SITE_IMAGE`；新 entrypoint 执行 Prisma migration 与 Agent 资产 apply guard，随后检查 loopback/public readiness 与实际容器镜像引用。
5. 新版本启动、migration、镜像身份或 readiness 任一失败时，保留失败日志和新数据目录，恢复旧 `.env` 与整份冷快照后重启旧镜像。

每次尝试的 `.env` 备份、冷快照、部署回执或失败数据保存在 `/srv/neuro-book-site/ops/deployments/<UTC timestamp>/`，权限为 root-only。脚本不修改 DNS、证书、Nginx、443 或 Xray，也不删除旧镜像和历史快照。

首次真实运行发现本机 GitHub CLI 不支持 `gh run list --commit`。脚本已改为列出 `master + workflow + push event` 的近期结构化结果，再用完整 `headSha` 精确匹配；兼容修复仍在任何 DMIT 写入之前 fail closed。修复后的完整升级与同 digest 幂等重跑均已通过。

## 日志与人工检查

```bash
sudo docker compose ps
sudo docker compose logs --tail 200 site
sudo docker compose logs -f --tail 200 site
sudo tail -f /srv/neuro-book-site/logs/site.jsonl
curl --fail --silent http://127.0.0.1:3100/api/health/ready
```

stdout 与 `site.jsonl` 都是 Pino JSONL。每个请求响应都有 `X-Request-ID`，可以用同一个 `requestId` 在两处对账；成功的 live/ready 健康检查不写 info，失败或 degraded 才写。日志不记录 query、请求/响应 body、Cookie、Authorization、User-Agent、密码、token、设备码、恢复码、备份密钥、注册码或邀请码。

Docker `json-file` 仍按单文件 10 MiB、保留 3 份轮转。持久文件使用仓库提供的专用 logrotate 配置和小时级 timer：

```bash
cd /srv/neuro-book-site
sudo install -m 0644 docker/logrotate/neuro-book-site /etc/logrotate.d/neuro-book-site
sudo install -m 0644 docker/systemd/neuro-book-site-logrotate.service /etc/systemd/system/neuro-book-site-logrotate.service
sudo install -m 0644 docker/systemd/neuro-book-site-logrotate.timer /etc/systemd/system/neuro-book-site-logrotate.timer
sudo logrotate --debug /etc/logrotate.d/neuro-book-site
sudo systemctl daemon-reload
sudo systemctl enable --now neuro-book-site-logrotate.timer
sudo systemctl list-timers neuro-book-site-logrotate.timer
```

配置在 `site.jsonl` 达到 20 MiB 时使用 `copytruncate`，保留 14 份并压缩旧文件，最坏占用约 300 MiB。部署验收时可强制轮转两次并检查压缩文件；两次之间发一个普通请求，确保当前日志非空：

```bash
sudo logrotate --force /etc/logrotate.d/neuro-book-site
curl --fail --silent http://127.0.0.1:3100/api/v1/meta >/dev/null
sudo logrotate --force /etc/logrotate.d/neuro-book-site
sudo gzip --test /srv/neuro-book-site/logs/site.jsonl.2.gz
```

本阶段不配置外部可用性或 TLS 告警，依赖 Docker health、readiness、Nginx/应用日志和人工检查；这是降低后的私有内测验收标准。
