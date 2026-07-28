#!/usr/bin/env bash
set -Eeuo pipefail

NEW_IMAGE="${1:-}"
SOURCE_COMMIT="${2:-}"
DEPLOY_ROOT="/srv/neuro-book-site"
LOCAL_READY_URL="http://127.0.0.1:3100/api/health/ready"
PUBLIC_READY_URL="https://nbook.notnotype.com/api/health/ready"
RESERVED_BYTES=4294967296

OPS_DIR=""
ENV_BACKUP=""
SNAPSHOT=""
SNAPSHOT_READY=0
DATA_MAY_HAVE_CHANGED=0

fail() {
    printf '错误：%s\n' "$1" >&2
    exit 1
}

wait_ready() {
    local url="$1"
    local attempts="${2:-60}"
    local attempt
    for ((attempt = 1; attempt <= attempts; attempt += 1)); do
        if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

rollback() {
    local original_status="$1"
    local failed_line="$2"
    local rollback_ready=0
    trap - ERR INT TERM
    set +e

    printf '\n升级在第 %s 行失败，开始恢复旧镜像和数据。\n' "$failed_line" >&2
    if [[ -d "$DEPLOY_ROOT" ]]; then
        cd "$DEPLOY_ROOT" || true
        docker compose logs --tail 200 site >&2 || true
        docker compose stop site >/dev/null 2>&1 || true

        if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
            cp -a -- "$ENV_BACKUP" .env
            chmod 0600 .env
        fi

        if [[ "$SNAPSHOT_READY" == "1" && "$DATA_MAY_HAVE_CHANGED" == "1" ]]; then
            local failed_data="$OPS_DIR/data.failed"
            if [[ -e data ]]; then
                mv -- data "$failed_data"
            fi
            tar --acls --xattrs -xpf "$SNAPSHOT" -C "$DEPLOY_ROOT"
        fi

        docker compose up -d site >&2 || true
        if wait_ready "$LOCAL_READY_URL" 60; then
            rollback_ready=1
            printf '旧版本已恢复，readiness 正常。失败现场保留在 %s\n' "$OPS_DIR" >&2
        else
            printf '严重：自动回滚后 readiness 仍失败，请保留当前 SSH 会话并人工处理 %s。\n' "$OPS_DIR" >&2
        fi
    fi

    if [[ "$rollback_ready" == "1" ]]; then
        exit "$original_status"
    fi
    exit 70
}

[[ "$NEW_IMAGE" =~ ^ghcr\.io/notnotype/neuro-book-site@sha256:[0-9a-f]{64}$ ]] \
    || fail "镜像必须是 neuro-book-site 的完整 GHCR digest。"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "source commit 必须是完整 Git SHA。"
[[ "$EUID" -eq 0 ]] || fail "远端升级脚本必须由 root 运行。"
[[ -d "$DEPLOY_ROOT" ]] || fail "部署目录不存在：$DEPLOY_ROOT"

cd "$DEPLOY_ROOT"
[[ -f compose.yml ]] || fail "缺少 compose.yml。"
[[ -f .env ]] || fail "缺少 .env。"
command -v flock >/dev/null || fail "服务器缺少 flock，不能建立升级互斥锁。"
command -v docker >/dev/null || fail "服务器缺少 docker。"
command -v curl >/dev/null || fail "服务器缺少 curl。"

install -d -m 0700 ops/deployments
exec 9>ops/deploy.lock
flock -n 9 || fail "另一项站点升级正在执行。"

IMAGE_LINE_COUNT="$(grep -c '^NB_SITE_IMAGE=' .env || true)"
[[ "$IMAGE_LINE_COUNT" == "1" ]] || fail ".env 必须恰好包含一条 NB_SITE_IMAGE。"
OLD_IMAGE="$(sed -n 's/^NB_SITE_IMAGE=//p' .env | tr -d '\r')"
[[ "$OLD_IMAGE" =~ ^ghcr\.io/notnotype/neuro-book-site@sha256:[0-9a-f]{64}$ ]] \
    || fail ".env 中的旧镜像不是合法 digest。"

docker compose config --quiet
if [[ "$OLD_IMAGE" == "$NEW_IMAGE" ]]; then
    wait_ready "$LOCAL_READY_URL" 5 || fail "镜像已是目标 digest，但本机 readiness 失败。"
    wait_ready "$PUBLIC_READY_URL" 5 || fail "镜像已是目标 digest，但公网 readiness 失败。"
    printf '服务器已经运行目标镜像，无需升级：%s\n' "$NEW_IMAGE"
    exit 0
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OPS_DIR="$DEPLOY_ROOT/ops/deployments/$TIMESTAMP"
install -d -m 0700 "$OPS_DIR"
ENV_BACKUP="$OPS_DIR/env.before"
cp -a -- .env "$ENV_BACKUP"
chmod 0600 "$ENV_BACKUP"

DATA_BYTES="$(du -sb -- data | awk '{print $1}')"
AVAILABLE_BYTES="$(df -PB1 -- "$DEPLOY_ROOT" | awk 'NR == 2 {print $4}')"
REQUIRED_BYTES="$((DATA_BYTES + RESERVED_BYTES))"
[[ "$AVAILABLE_BYTES" -ge "$REQUIRED_BYTES" ]] \
    || fail "拉取镜像前空间不足：available=$AVAILABLE_BYTES required=$REQUIRED_BYTES，停止升级。"

printf '拉取目标镜像：%s\n' "$NEW_IMAGE"
docker image pull "$NEW_IMAGE"

printf '使用目标镜像执行 Agent 资产归档只读 preflight。\n'
docker run --rm \
    --network none \
    --read-only \
    --tmpfs /tmp:size=64m,mode=1777 \
    --env-file .env \
    --volume "$DEPLOY_ROOT/data:/data:ro" \
    --entrypoint node \
    "$NEW_IMAGE" /app/dist/migrate-agent-assets.mjs --preflight

AVAILABLE_BYTES="$(df -PB1 -- "$DEPLOY_ROOT" | awk 'NR == 2 {print $4}')"
[[ "$AVAILABLE_BYTES" -ge "$REQUIRED_BYTES" ]] \
    || fail "拉取镜像后空间不足：available=$AVAILABLE_BYTES required=$REQUIRED_BYTES，停止升级。"

trap 'rollback $? $LINENO' ERR
trap 'rollback 130 $LINENO' INT TERM

printf '停止站点并创建冷快照。\n'
docker compose stop site
SNAPSHOT="$OPS_DIR/data.before.tar"
tar --acls --xattrs -cpf "$SNAPSHOT" data
chmod 0600 "$SNAPSHOT"
SNAPSHOT_READY=1

NEXT_ENV="$OPS_DIR/env.next"
awk -v image="$NEW_IMAGE" '
    BEGIN { replaced = 0 }
    /^NB_SITE_IMAGE=/ { print "NB_SITE_IMAGE=" image; replaced += 1; next }
    { print }
    END { if (replaced != 1) exit 42 }
' .env >"$NEXT_ENV"
chmod 0600 "$NEXT_ENV"
chown root:root "$NEXT_ENV"
mv -f -- "$NEXT_ENV" .env
DATA_MAY_HAVE_CHANGED=1

printf '启动新镜像并等待 readiness。\n'
docker compose up -d site
wait_ready "$LOCAL_READY_URL" 60

CONTAINER_ID="$(docker compose ps -q site)"
if [[ -z "$CONTAINER_ID" ]]; then
    printf '错误：Compose 没有返回 site 容器 ID。\n' >&2
    rollback 1 "$LINENO"
fi
RUNNING_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER_ID")"
if [[ "$RUNNING_IMAGE" != "$NEW_IMAGE" ]]; then
    printf '错误：运行镜像不匹配：%s\n' "$RUNNING_IMAGE" >&2
    rollback 1 "$LINENO"
fi
wait_ready "$PUBLIC_READY_URL" 15

RECEIPT="$OPS_DIR/deployment.txt"
{
    printf 'deployedAt=%s\n' "$TIMESTAMP"
    printf 'sourceCommit=%s\n' "$SOURCE_COMMIT"
    printf 'oldImage=%s\n' "$OLD_IMAGE"
    printf 'newImage=%s\n' "$NEW_IMAGE"
    printf 'snapshot=%s\n' "$SNAPSHOT"
} >"$RECEIPT"
chmod 0600 "$RECEIPT"

trap - ERR INT TERM
printf '升级完成。\n旧镜像：%s\n新镜像：%s\n冷快照：%s\n' "$OLD_IMAGE" "$NEW_IMAGE" "$SNAPSHOT"
