# DMIT HTTPS / 443 Runbook

本 runbook 只适用于 `nbook.notnotype.com` 在 DMIT 上接入现有 Xray 的维护窗口。当前状态是：应用固定 digest 已在 `127.0.0.1:3100` healthy；Nginx 80 端口只提供 ACME challenge，根路径返回 404；Xray 仍独占公网 443。没有 DNS 和维护窗口授权时，不执行下面的 443 步骤。

## 当前备份点

2026-07-27 备份了 Nginx、Xray/v2ray-agent 和 Xray systemd unit：

```text
/srv/neuro-book-site/ops/backups/task128-20260727T092738Z/
```

目录和文件均为 `root:root`，目录 `0700`，文件 `0600`。应用配置回滚副本另在：

```text
/srv/neuro-book-site/.env.task128-before-image-rollback
```

每个维护窗口开始前重新生成时间戳目录；不要覆盖旧备份。

## DNS 与 ACME

先添加唯一正式域名记录：

```text
nbook.notnotype.com.  A  64.186.225.48  TTL 300
```

确认公网解析后，在第二个 SSH 会话执行：

```bash
dig +short A nbook.notnotype.com @1.1.1.1
curl --fail --silent --show-error \
  -H 'Host: nbook.notnotype.com' \
  http://127.0.0.1/.well-known/acme-challenge/task128-probe
```

使用现有 `acme.sh` webroot 账号签发，不把 DNS API token 放到 DMIT：

```bash
sudo install -d -m 0755 -o root -g root /var/www/neuro-book-site-acme/.well-known/acme-challenge
sudo /root/.acme.sh/acme.sh --issue --server letsencrypt \
  -d nbook.notnotype.com \
  -w /var/www/neuro-book-site-acme
sudo install -d -m 0700 -o root -g root /etc/v2ray-agent/tls
sudo /root/.acme.sh/acme.sh --install-cert -d nbook.notnotype.com \
  --key-file /etc/v2ray-agent/tls/nbook.notnotype.com.key \
  --fullchain-file /etc/v2ray-agent/tls/nbook.notnotype.com.crt \
  --reloadcmd 'systemctl reload nginx'
```

签发后先验证证书 SAN、有效期和文件权限，再进入端口迁移。80 vhost 的正式根路径在 HTTPS 稳定后才改为 308 跳转。

## 非 443 预演

预演配置必须先让 Xray 增加 `127.0.0.1:31443` TLS inbound，并开启只接受 loopback 发来的 PROXY protocol；原公网 443 inbound 保持不变。站点 Nginx vhost 使用：

```nginx
listen 127.0.0.1:31444 ssl proxy_protocol;
server_name nbook.notnotype.com;
ssl_certificate /etc/v2ray-agent/tls/nbook.notnotype.com.crt;
ssl_certificate_key /etc/v2ray-agent/tls/nbook.notnotype.com.key;
set_real_ip_from 127.0.0.1;
real_ip_header proxy_protocol;
```

站点反代必须固定：

- `/api/v1/backups`：`client_max_body_size 1100m`、`proxy_request_buffering off`。
- `/api/v1/items/*/versions`：`client_max_body_size 22m`、`proxy_request_buffering off`。
- 其他请求：`client_max_body_size 2m`。
- `X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto=https` 和原始 `Host` 透传。

先临时用 loopback 30443 做 SNI 预演，使 PROXY protocol、站点 TLS、Xray TLS、真实 IP 和 Secure Cookie 全部经过真实链路；不得直接把临时端口发布公网：

```bash
sudo nginx -t
sudo /etc/v2ray-agent/xray/xray -test -confdir /etc/v2ray-agent/xray/conf
sudo systemctl reload xray
sudo systemctl reload nginx
curl --resolve nbook.notnotype.com:30443:127.0.0.1 \
  --fail --silent --show-error \
  https://nbook.notnotype.com:30443/api/health/live
curl --resolve nbook.notnotype.com:30443:127.0.0.1 \
  --fail --silent --show-error \
  https://nbook.notnotype.com:30443/api/health/ready
openssl s_client -connect 127.0.0.1:30443 \
  -servername dmit.notnotype.com -brief </dev/null
```

预演记录至少包含：两个 SNI 的证书与 TLS 版本、未知 SNI 默认到 Xray、应用日志中的真实客户端 IP、Secure Cookie 属性、1 GiB 边界请求、Xray 现有客户端实连和证书续期预演。任何一项失败都不进入 443。

## 443 维护窗口

维护开始前重新执行：磁盘余量、冷快照门禁、`nginx -t`、Xray `-test`、第二 SSH 会话、现有 Xray 客户端探测。记录当时的 `ss -lntp` 和服务状态。

Nginx stream 是 443 唯一监听者，按 SNI 分流并向两个 loopback upstream 都发送 PROXY protocol：

```nginx
map $ssl_preread_server_name $task128_upstream {
    nbook.notnotype.com 127.0.0.1:31444;
    default             127.0.0.1:31443;
}

server {
    listen 443 reuseport;
    proxy_pass $task128_upstream;
    proxy_protocol on;
    ssl_preread on;
}
```

执行顺序：先让 Xray 新 inbound 在 31443 healthy，再让站点 31444 healthy，最后停止原 Xray 443 inbound、启用 stream 443、`nginx -t`、reload Nginx，并立刻从公网探测 `nbook.notnotype.com` 和 `dmit.notnotype.com`。未知 SNI 默认 Xray；站点或任一现有客户端失败时立即回滚。

## 回滚

回滚目标是恢复“Xray 直接占有公网 443”的原状态，不在失败现场继续修：

```bash
sudo cp -a /srv/neuro-book-site/ops/backups/task128-<timestamp>/nginx-etc.tar.gz /tmp/
sudo cp -a /srv/neuro-book-site/ops/backups/task128-<timestamp>/v2ray-agent-etc.tar.gz /tmp/
sudo systemctl stop nginx
sudo tar --acls --xattrs -xzpf /tmp/nginx-etc.tar.gz -C /
sudo tar --acls --xattrs -xzpf /tmp/v2ray-agent-etc.tar.gz -C /
sudo systemctl restart xray
sudo nginx -t
sudo systemctl start nginx
sudo ss -lntp | grep -E ':(443|3100) '
openssl s_client -connect 127.0.0.1:443 -servername dmit.notnotype.com -brief </dev/null
```

回滚完成前不得改 DNS、删除备份或宣布上线。确认 Xray 和站点入口均稳定后，才清理临时 30443、31443、31444 配置；保留完整窗口备份和结果记录。
