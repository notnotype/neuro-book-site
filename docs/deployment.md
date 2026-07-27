# NeuroBook Site 单机部署

本文只覆盖应用容器。DMIT 的 DNS、证书、Nginx stream 和 Xray 443 切换必须使用 Task 128 单独的维护窗口 runbook，不能仅按本文直接改公网入口。

截至 2026-07-27，公开 GHCR 的 digest `sha256:6ec29b03a086920e9259f18a4ed8403b7c188002c8d57d1f037a7fbad118c726` 已在 DMIT 匿名拉取并运行；上一 digest `sha256:77f922014080e810e9852dc49ef0e71c40ed755eb8b817a934b76e6c2d394c19` 与冷快照 `/srv/neuro-book-site/snapshot-task128-pino-20260727T163249Z.tar` 保留用于整体回滚。stdout/持久 JSONL 对账、容器重建持久性、强制轮转、压缩文件读取和新旧 digest 往返均已实际通过；DNS、证书、Nginx stream 443 与 Xray 配置没有在本轮调整。

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

## 首次启动

```bash
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
curl --fail --silent http://127.0.0.1:3100/api/health/live
curl --fail --silent http://127.0.0.1:3100/api/health/ready
```

入口脚本会先创建 SQLite 文件并执行 `prisma migrate deploy`，成功后才启动 Nitro。生产配置缺失、仍是示例值或 migration 未应用时，容器不会进入 ready。

管理员只初始化一次。生成 24 字节随机密码，经 stdin 交给一次性容器；密码不会进入 argv、环境变量或容器日志：

```bash
ADMIN_INPUT="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n')"
printf '%s\n' "$ADMIN_INPUT" | sudo docker compose run --rm -T --entrypoint node site /app/dist/init-db.mjs
printf '管理员密码（仅此一次）: %s\n' "$ADMIN_INPUT"
unset ADMIN_INPUT
```

随后在 loopback 完成登录、设备码、Workshop、加密备份上传/下载和恢复 smoke。公网反代未接入前不要改 DNS。

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
