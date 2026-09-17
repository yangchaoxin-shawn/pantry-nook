#!/usr/bin/env bash
# 仅用于已有 v2 媒体部署的兼容升级；无参数显示帮助，默认 --check。
set -Eeuo pipefail

usage() {
  printf '%s\n' \
    '用法：bash release.sh --release-id ID --manifest-sha256 SHA [--check]' \
    '应用：追加 --apply --compatible-migrations-reviewed' \
    '固定读取 /tmp 下四个制品；不支持首装、换卷、改 Nginx 或破坏性 migration。' \
    '必须把脚本作为文件运行，不使用 ssh ... bash < script.sh。'
}

fail() { printf '%s\n' "$*" >&2; return 1; }
checksum() { sha256sum "$1" | cut -d ' ' -f 1; }

compose_at() {
  local directory=$1 tag=$2
  shift 2
  PANTRY_BACKEND_IMAGE_TAG="$tag" docker compose --project-name pantry-nook \
    --project-directory "$directory" --env-file "$directory/.env" \
    -f "$directory/docker-compose.yml" "$@"
}

database() { compose_at "$BACKEND_DIR" "$OLD_TAG" exec -T pantry-db "$@"; }

setup_paths() {
  SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  CHECKS="$SCRIPT_DIR/release_checks.py"
  BACKEND_DIR=/data/pantry-nook
  FRONTEND_DIR=/usr/local/nginx/html/pantry-nook
  SHARED=/data/pantry-nook-shared
  MANIFEST="/tmp/pantry-nook-release-${RELEASE_ID}.json"
  RECORD_DIR="$SHARED/releases/$RELEASE_ID"
  BACKEND_STAGE="$BACKEND_DIR.stage.$RELEASE_ID"
  FRONTEND_STAGE="$FRONTEND_DIR.stage.$RELEASE_ID"
  BACKEND_BACKUP="$BACKEND_DIR.bak.$RELEASE_ID"
  FRONTEND_BACKUP="$FRONTEND_DIR.bak.$RELEASE_ID"
  FAILED_BACKEND="$BACKEND_DIR.failed.$RELEASE_ID"
  FAILED_FRONTEND="$FRONTEND_DIR.failed.$RELEASE_ID"
  DB_BACKUP="$SHARED/backups/pantry_nook-$RELEASE_ID.dump"
  MEDIA_BACKUP="$SHARED/backups/pantry-media-$RELEASE_ID.tar.gz"
  NGINX_CONF=/usr/local/nginx/cert.d/preview.conf
  NGINX_BACKUP="$NGINX_CONF.bak.$RELEASE_ID"
  NGINX_BIN=/usr/local/nginx/sbin/nginx
  MEDIA_VOLUME=pantry-media-data
}

check_candidate() {
  [[ $(uname -s) == Linux && $EUID == 0 ]] || fail '仅在目标 Linux 服务器以 root 执行'
  for command in docker python3 tar sha256sum flock curl readlink; do command -v "$command" >/dev/null; done
  for path in "$BACKEND_DIR" "$FRONTEND_DIR"; do
    [[ -d "$path" && $(readlink -f "$path") == "$path" ]] || fail "固定路径缺失或包含软链接：$path"
  done
  [[ -f "$BACKEND_DIR/.env" && ! -L "$BACKEND_DIR/.env" ]] || fail '缺少服务器本机 .env'
  [[ $(stat -c %a "$BACKEND_DIR/.env") == 600 ]] || fail '.env 权限必须为 600'
  [[ $(grep -c '^PANTRY_MEDIA_VOLUME_NAME=pantry-media-data$' "$BACKEND_DIR/.env") == 1 ]] || fail '固定媒体卷设置错误'
  for path in "$RECORD_DIR" "$BACKEND_STAGE" "$FRONTEND_STAGE" "$BACKEND_BACKUP" \
    "$FRONTEND_BACKUP" "$FAILED_BACKEND" "$FAILED_FRONTEND" "$DB_BACKUP" "$MEDIA_BACKUP" "$NGINX_BACKUP"; do
    [[ ! -e "$path" && ! -L "$path" ]] || fail "release 路径已使用：$path"
  done
  local metadata
  metadata=$(python3 "$CHECKS" verify --manifest "$MANIFEST" --release-id "$RELEASE_ID" --manifest-sha256 "$MANIFEST_SHA")
  IFS=$'\t' read -r IMAGE_TAG IMAGE_ID PLATFORM <<< "$metadata"
  case $(uname -m) in x86_64) [[ $PLATFORM == linux/amd64 ]] ;; aarch64|arm64) [[ $PLATFORM == linux/arm64 ]] ;; *) return 1 ;; esac
  metadata=$(python3 "$CHECKS" record --record "$BACKEND_DIR/DEPLOYED_RELEASE.txt")
  IFS=$'\t' read -r OLD_TAG OLD_IMAGE <<< "$metadata"
  [[ $(docker inspect pantry-backend --format '{{.Image}}') == "$OLD_IMAGE" ]]
  [[ $(docker image inspect "pantry-nook-backend:$OLD_TAG" --format '{{.Id}}') == "$OLD_IMAGE" ]]
  [[ $(docker inspect pantry-backend --format '{{.State.Health.Status}}') == healthy ]]
  [[ $(docker inspect pantry-db --format '{{.State.Health.Status}}') == healthy ]]
  [[ $(docker inspect pantry-backend --format '{{range .Mounts}}{{if eq .Destination "/data/media"}}{{.Type}}:{{.Name}}{{end}}{{end}}') == volume:pantry-media-data ]]
  [[ $(docker inspect pantry-db --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}:{{.Name}}{{end}}{{end}}') == volume:pantry-db-data ]]
  docker volume inspect pantry-media-data >/dev/null
  docker volume inspect pantry-db-data >/dev/null
  python3 "$CHECKS" compose-check --backend "$BACKEND_DIR" --tag "$OLD_TAG"
  "$NGINX_BIN" -t
  NGINX_SHA=$(checksum "$NGINX_CONF")
  ENV_SHA=$(checksum "$BACKEND_DIR/.env")
  printf '%s\n' '只读预检通过。尚未解包、加载镜像、停止服务或写入业务数据。'
}

prepare_candidate() {
  # 这些动作必须在停写之前完成。失败留下唯一 staging，不能用同一 release ID 盲重试。
  install -d -m 700 "$SHARED/backups" "$SHARED/releases"
  mkdir -m 700 "$RECORD_DIR" "$BACKEND_STAGE" "$FRONTEND_STAGE"
  cp -p "$MANIFEST" "$RECORD_DIR/local-manifest.json"
  tar -xzf "/tmp/pantry-nook-backend-$RELEASE_ID.tgz" -C "$BACKEND_STAGE" --no-same-owner
  tar -xzf "/tmp/pantry-nook-frontend-$RELEASE_ID.tgz" -C "$FRONTEND_STAGE" --no-same-owner
  python3 "$CHECKS" stage-check --manifest "$MANIFEST" --backend "$BACKEND_STAGE"
  cp -p "$BACKEND_DIR/.env" "$BACKEND_STAGE/.env"
  python3 "$CHECKS" compose-check --backend "$BACKEND_STAGE" --tag "$IMAGE_TAG"
  tar -xOzf "/tmp/pantry-nook-backend-image-$RELEASE_ID.tar.gz" \
    "pantry-nook-backend-image-$RELEASE_ID.tar" | docker image load
  [[ $(docker image inspect "pantry-nook-backend:$IMAGE_TAG" --format '{{.Id}}') == "$IMAGE_ID" ]]
  [[ $(docker image inspect "pantry-nook-backend:$IMAGE_TAG" --format '{{.Os}}/{{.Architecture}}') == "$PLATFORM" ]]
  [[ $(docker image inspect "pantry-nook-backend:$OLD_TAG" --format '{{.Id}}') == "$OLD_IMAGE" ]] || fail '旧镜像 tag 在准备时发生改变'
  database psql -U postgres -d pantry_nook -Atc \
    'select concat_ws(chr(9), version, checksum, applied_at::text) from schema_migrations order by version' \
    > "$RECORD_DIR/migrations-precheck.tsv"
  python3 "$CHECKS" migrations --manifest "$MANIFEST" --before "$RECORD_DIR/migrations-precheck.tsv"
  find "$FRONTEND_STAGE" -type d -exec chmod 755 {} \;
  find "$FRONTEND_STAGE" -type f -exec chmod 644 {} \;
  [[ $(checksum "$NGINX_CONF") == "$NGINX_SHA" && $(checksum "$BACKEND_DIR/.env") == "$ENV_SHA" ]] || fail '准备期间配置已改变'
  cp -p "$NGINX_CONF" "$NGINX_BACKUP"
}

backup_state() {
  [[ $(database psql -U postgres -d pantry_nook -Atc "select count(*) from journal_uploads where status='processing'") == 0 ]] || fail '仍有 processing 上传，拒绝备份'
  database psql -U postgres -d pantry_nook -Atc \
    'select concat_ws(chr(9), version, checksum, applied_at::text) from schema_migrations order by version' \
    > "$RECORD_DIR/migrations-before.tsv"
  python3 "$CHECKS" migrations --manifest "$MANIFEST" --before "$RECORD_DIR/migrations-before.tsv"
  database pg_dump -U postgres -d pantry_nook -Fc > "$DB_BACKUP"
  # 只有这一条命令显式读取备份文件；整个脚本不通过 stdin 传输。
  database pg_restore --list < "$DB_BACKUP" > "$RECORD_DIR/db-backup-list.txt"
  docker run --rm --network none --entrypoint python \
    -v "$MEDIA_VOLUME:/source:ro" -v "$SHARED:/shared" \
    -v "$SCRIPT_DIR/backup_media.py:/backup_media.py:ro" "$OLD_IMAGE" /backup_media.py \
    --source /source --output "/shared/backups/pantry-media-$RELEASE_ID.tar.gz" \
    --manifest "/shared/releases/$RELEASE_ID/media-manifest.tsv"
  [[ -s "$DB_BACKUP" && -s "$RECORD_DIR/db-backup-list.txt" && -s "$MEDIA_BACKUP" && -f "$RECORD_DIR/media-manifest.tsv" ]]
  sha256sum "$DB_BACKUP" > "$RECORD_DIR/db-backup.sha256"
  sha256sum "$MEDIA_BACKUP" > "$RECORD_DIR/media-backup.sha256"
  sha256sum "$RECORD_DIR/media-manifest.tsv" > "$RECORD_DIR/media-manifest.sha256"
  chmod 600 "$DB_BACKUP" "$MEDIA_BACKUP" "$RECORD_DIR"/*
  python3 "$BACKEND_STAGE/scripts/server-release-record.py" prepare \
    --manifest "$RECORD_DIR/local-manifest.json" --record "$RECORD_DIR/deployed-release.txt" \
    --database-backup "$DB_BACKUP" --database-backup-sha-file "$RECORD_DIR/db-backup.sha256" \
    --media-volume "$MEDIA_VOLUME" --media-backup "$MEDIA_BACKUP" \
    --media-backup-sha-file "$RECORD_DIR/media-backup.sha256" \
    --media-manifest "$RECORD_DIR/media-manifest.tsv" --media-manifest-sha-file "$RECORD_DIR/media-manifest.sha256" \
    --backend-backup "$BACKEND_BACKUP" --frontend-backup "$FRONTEND_BACKUP" --nginx-backup "$NGINX_BACKUP" \
    --migrations-before "$RECORD_DIR/migrations-before.tsv" --migrations-after "$RECORD_DIR/migrations-after.tsv"
  python3 "$BACKEND_STAGE/scripts/server-release-record.py" set-status \
    --record "$RECORD_DIR/deployed-release.txt" --status deploying
  cp -p "$RECORD_DIR/deployed-release.txt" "$BACKEND_STAGE/DEPLOYED_RELEASE.txt"
}

wait_healthy() {
  local expected=$1
  for ((attempt=0; attempt<90; attempt++)); do
    if [[ $(docker inspect pantry-backend --format '{{.State.Health.Status}}') == healthy ]] && \
      curl --max-time 5 -fsS http://127.0.0.1:8014/health >/dev/null; then
      [[ $(docker inspect pantry-backend --format '{{.Image}}') == "$expected" ]]
      return
    fi
    sleep 2
  done
  fail '后端未在等待时间内健康'
}

switch_candidate() {
  # 标志在各次 move 前设置；发生半切换时由实际目录位置决定恢复动作。
  BACKEND_MOVE_STARTED=1
  mv "$BACKEND_DIR" "$BACKEND_BACKUP"
  mv "$BACKEND_STAGE" "$BACKEND_DIR"
  FRONTEND_MOVE_STARTED=1
  mv "$FRONTEND_DIR" "$FRONTEND_BACKUP"
  mv "$FRONTEND_STAGE" "$FRONTEND_DIR"
  NEW_START_REQUESTED=1
  compose_at "$BACKEND_DIR" "$IMAGE_TAG" up -d --no-build --no-deps pantry-backend
  wait_healthy "$IMAGE_ID"
  [[ $(docker inspect pantry-backend --format '{{range .Mounts}}{{if eq .Destination "/data/media"}}{{.Type}}:{{.Name}}{{end}}{{end}}') == volume:pantry-media-data ]]
  database psql -U postgres -d pantry_nook -Atc \
    'select concat_ws(chr(9), version, checksum, applied_at::text) from schema_migrations order by version' \
    > "$RECORD_DIR/migrations-after.tsv"
  python3 "$CHECKS" migrations --manifest "$MANIFEST" --before "$RECORD_DIR/migrations-before.tsv" --after "$RECORD_DIR/migrations-after.tsv"
  [[ $(checksum "$NGINX_CONF") == "$NGINX_SHA" ]] || fail '检测到共享 Nginx 配置被其他任务改变，请核查'
  diff -u "$NGINX_BACKUP" "$NGINX_CONF"
  "$NGINX_BIN" -t
}

recover_previous() {
  # 不恢复数据库、不删卷；兼容 migration 与新产生的数据保留。
  if ((NEW_START_REQUESTED)); then
    local existing_container
    # Compose 可能已移除旧容器却未创建新容器；ls 成功且为空时仍可恢复。
    # daemon 不可达会使 ls 失败，此时不猜测容器状态或移动目录。
    existing_container=$(docker container ls --all --filter 'name=^/pantry-backend$' --format '{{.ID}}') || return 1
    if [[ -n $existing_container ]]; then docker stop --time 180 pantry-backend || return 1; fi
  fi
  if ((FRONTEND_MOVE_STARTED)) && [[ -d "$FRONTEND_BACKUP" ]]; then
    if [[ -e "$FRONTEND_DIR" ]]; then mv "$FRONTEND_DIR" "$FAILED_FRONTEND" || return 1; fi
    mv "$FRONTEND_BACKUP" "$FRONTEND_DIR" || return 1
  fi
  if ((BACKEND_MOVE_STARTED)) && [[ -d "$BACKEND_BACKUP" ]]; then
    if [[ -e "$BACKEND_DIR" ]]; then mv "$BACKEND_DIR" "$FAILED_BACKEND" || return 1; fi
    mv "$BACKEND_BACKUP" "$BACKEND_DIR" || return 1
  fi
  if ((NEW_START_REQUESTED)); then
    compose_at "$BACKEND_DIR" "$OLD_TAG" up -d --no-build --no-deps pantry-backend || return 1
  else
    docker start pantry-backend || return 1
  fi
  wait_healthy "$OLD_IMAGE" || return 1
  printf '%s\n' '已恢复旧代码和后端；数据卷未恢复或删除。失败制品与证据已保留。'
}

finish() {
  local result=$?
  trap - EXIT INT TERM
  if ((result != 0 && STOP_REQUESTED && !SWITCH_COMPLETE)); then
    set +e
    if recover_previous; then
      printf '%s\n' 'recovered_previous' > "$RECORD_DIR/execution-state.txt"
    else
      printf '%s\n' 'RECOVERY_FAILED' > "$RECORD_DIR/execution-state.txt"
      printf '%s\n' '自动恢复失败。停止后续发布；按当前目录与记录人工恢复，不重跑相同 release。' >&2
    fi
  fi
  exit "$result"
}

apply_candidate() {
  STOP_REQUESTED=0 BACKEND_MOVE_STARTED=0 FRONTEND_MOVE_STARTED=0 NEW_START_REQUESTED=0 SWITCH_COMPLETE=0
  trap finish EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  prepare_candidate
  STOP_REQUESTED=1
  docker stop --time 180 pantry-backend
  [[ $(docker inspect pantry-backend --format '{{.State.Status}}') == exited ]]
  backup_state
  switch_candidate
  printf '%s\n' 'awaiting_public_verification' > "$RECORD_DIR/execution-state.txt"
  SWITCH_COMPLETE=1
  printf '%s\n' '代码切换及服务器检查完成。发布记录仍为 deploying，须完成公网只读验收并记录未覆盖项。'
}

main() {
  local mode=check reviewed=0
  RELEASE_ID='' MANIFEST_SHA=''
  (($#)) || { usage; return; }
  while (($#)); do
    case $1 in
      --release-id) (($# >= 2)) || return 2; RELEASE_ID=$2; shift 2 ;;
      --manifest-sha256) (($# >= 2)) || return 2; MANIFEST_SHA=$2; shift 2 ;;
      --check) mode=check; shift ;;
      --apply) mode=apply; shift ;;
      --compatible-migrations-reviewed) reviewed=1; shift ;;
      --help) usage; return ;;
      *) usage; return 2 ;;
    esac
  done
  [[ $RELEASE_ID =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || fail 'release ID 格式错误'
  [[ $MANIFEST_SHA =~ ^[0-9a-f]{64}$ ]] || fail '必须传入本机核对的 manifest SHA256'
  [[ -f ${BASH_SOURCE[0]} ]] || fail '必须从已传输的脚本文件执行'
  if [[ $mode == apply ]]; then ((reviewed)) || fail '应用前须独立审查确认 migration 与旧版本兼容'; fi
  setup_paths
  if [[ $mode == apply ]]; then
    [[ -d "$SHARED" && $(readlink -f "$SHARED") == "$SHARED" ]] || fail '固定 shared 目录缺失或为软链接'
    exec 9>"$SHARED/deploy.lock"
    flock -n 9 || fail '已有 Pantry Nook 发布在执行'
    umask 077
  fi
  check_candidate
  if [[ $mode == apply ]]; then apply_candidate; fi
}

# 单元测试可 source 函数并注入假命令；正常执行的目标路径不接受环境变量覆盖。
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@" < /dev/null; fi
