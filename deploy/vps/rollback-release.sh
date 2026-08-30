#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

log() {
  printf '[idosi-rollback] %s\n' "$*"
}

die() {
  log "ERROR: $*" >&2
  return 1
}

read_report_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$REPORT_FILE" | head -n 1
}

REPORT_FILE="${1:-}"
[[ -n "$REPORT_FILE" && -f "$REPORT_FILE" ]] || die 'Cần truyền đường dẫn deployment report .env đã tạo khi deploy.'

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_DIR="$IDOSI_ROOT/deploy/vps"
BACKUP_DIR="${IDOSI_BACKUP_DIR:-$COMPOSE_DIR/backups}"
LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"
HEALTH_RETRIES="${IDOSI_HEALTH_RETRIES:-18}"
HEALTH_DELAY_SECONDS="${IDOSI_HEALTH_DELAY_SECONDS:-5}"
[[ "$HEALTH_RETRIES" =~ ^[1-9][0-9]*$ ]] || die 'IDOSI_HEALTH_RETRIES phải là số nguyên dương.'
[[ "$HEALTH_DELAY_SECONDS" =~ ^[1-9][0-9]*$ ]] || die 'IDOSI_HEALTH_DELAY_SECONDS phải là số nguyên dương.'
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RECOVERY_INCIDENT_FILE="$BACKUP_DIR/rollback-recovery-$TIMESTAMP.env"
RECOVERY_LOG_FILE="$BACKUP_DIR/rollback-recovery-$TIMESTAMP.log"

for command_name in git docker flock sha256sum sed head date awk basename mktemp mv chmod cat; do
  command -v "$command_name" >/dev/null 2>&1 || die "Thiếu lệnh bắt buộc: $command_name"
done
docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin không hoạt động.'
[[ -d "$IDOSI_ROOT/.git" ]] || die "Không tìm thấy Git repository tại $IDOSI_ROOT."
[[ -f "$COMPOSE_DIR/compose.yml" ]] || die 'Không tìm thấy deploy/vps/compose.yml.'
[[ -f "$COMPOSE_DIR/.env" ]] || die 'Thiếu deploy/vps/.env trên VPS.'
[[ -z "$(git -C "$IDOSI_ROOT" status --porcelain)" ]] || die 'Working tree trên VPS không sạch; dừng rollback để tránh ghi đè thay đổi thủ công.'
mkdir -p "$BACKUP_DIR"

TARGET_STATUS="$(read_report_value STATUS)"
TARGET_BACKUP_FILE="$(read_report_value BACKUP_FILE)"
TARGET_BACKUP_SHA256="$(read_report_value BACKUP_SHA256)"
TARGET_IMAGE_TAG="$(read_report_value PREVIOUS_IMAGE_TAG)"
TARGET_RELEASE_SHA="$(read_report_value PREVIOUS_RELEASE_SHA)"
TARGET_GIT_SHA="$(read_report_value PREVIOUS_GIT_SHA)"

case "$TARGET_STATUS" in
  SUCCESS|LOCAL_READY|FAILED_AFTER_TRAFFIC) ;;
  *) die 'Chỉ rollback từ report đã mở traffic và có rollback point hợp lệ.' ;;
esac
[[ "$TARGET_BACKUP_FILE" == "$BACKUP_DIR/"* ]] || die 'Backup trong report phải nằm trong thư mục backup IDOSI.'
[[ -s "$TARGET_BACKUP_FILE" ]] || die 'Backup cần phục hồi không tồn tại hoặc rỗng.'
[[ "$TARGET_IMAGE_TAG" =~ ^[a-zA-Z0-9._:/-]+$ ]] || die 'Previous image tag trong report không hợp lệ.'
[[ "$TARGET_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Previous release SHA trong report không hợp lệ.'
[[ "$TARGET_GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Previous Git SHA trong report không hợp lệ.'
git -C "$IDOSI_ROOT" cat-file -e "$TARGET_GIT_SHA^{commit}" 2>/dev/null \
  || die 'Previous Git SHA trong report không tồn tại trên VPS.'
[[ "$TARGET_BACKUP_SHA256" =~ ^[0-9a-f]{64}$ ]] || die 'Backup checksum trong report không hợp lệ.'
ACTUAL_TARGET_SHA256="$(sha256sum "$TARGET_BACKUP_FILE" | awk '{print $1}')"
[[ "$ACTUAL_TARGET_SHA256" == "$TARGET_BACKUP_SHA256" ]] || die 'Checksum của backup cần phục hồi không khớp.'

docker image inspect "$TARGET_IMAGE_TAG" >/dev/null 2>&1 || die 'Không còn previous image tag trên VPS.'

exec 9>"$LOCK_FILE"
flock -n 9 || die 'Đang có deployment/rollback IDOSI khác chạy.'

compose() {
  (cd "$COMPOSE_DIR" && docker compose -f compose.yml "$@")
}

persist_release_config() {
  local image="$1"
  local release_sha="$2"
  local temp_file
  temp_file="$(mktemp "$COMPOSE_DIR/.env.rollback.XXXXXX")"
  awk -v image="$image" -v release_sha="$release_sha" '
    BEGIN { seen_image = 0; seen_release = 0 }
    /^IDOSI_IMAGE=/ {
      if (!seen_image) print "IDOSI_IMAGE=" image
      seen_image = 1
      next
    }
    /^IDOSI_RELEASE_SHA=/ {
      if (!seen_release) print "IDOSI_RELEASE_SHA=" release_sha
      seen_release = 1
      next
    }
    { print }
    END {
      if (!seen_image) print "IDOSI_IMAGE=" image
      if (!seen_release) print "IDOSI_RELEASE_SHA=" release_sha
    }
  ' "$COMPOSE_DIR/.env" >"$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" "$COMPOSE_DIR/.env"
}

wait_for_health() {
  local expected_release="${1:-}"
  local attempt
  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1)); do
    if compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      if ! compose exec -T app test -f server/vps/verify-release.mjs >/dev/null 2>&1 \
        || compose exec -T app node server/vps/verify-release.mjs \
          http://127.0.0.1:3000 "$expected_release" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep "$HEALTH_DELAY_SECONDS"
  done
  return 1
}

archive_volume() {
  local output_file="$1"
  local output_name
  output_name="$(basename "$output_file")"
  docker run --rm --network none \
    --mount "type=volume,source=$DATA_VOLUME,target=/data,readonly" \
    --mount "type=bind,source=$BACKUP_DIR,target=/backup" \
    --entrypoint /bin/sh "$BACKUP_HELPER_IMAGE" -c \
    "tar -czf '/backup/$output_name' -C /data . && tar -tzf '/backup/$output_name' >/dev/null"
}

restore_volume() {
  local input_file="$1"
  local input_name
  input_name="$(basename "$input_file")"
  docker run --rm --network none \
    --mount "type=volume,source=$DATA_VOLUME,target=/data" \
    --mount "type=bind,source=$BACKUP_DIR,target=/backup,readonly" \
    --entrypoint /bin/sh "$BACKUP_HELPER_IMAGE" -c \
    "find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} \\; && tar -xzf '/backup/$input_name' -C /data"
}

write_recovery_incident() {
  local reason="$1"
  compose logs --since=10m --tail=300 app caddy >"$RECOVERY_LOG_FILE" 2>&1 || true
  cat >"$RECOVERY_INCIDENT_FILE" <<INCIDENT
STATUS=RECOVERY_FAILED_CLOSED
REASON=$reason
CURRENT_RELEASE_SHA=$CURRENT_RELEASE_SHA
CURRENT_GIT_SHA=$CURRENT_GIT_SHA
CURRENT_IMAGE_TAG=$CURRENT_IMAGE_TAG
TARGET_RELEASE_SHA=$TARGET_RELEASE_SHA
TARGET_GIT_SHA=$TARGET_GIT_SHA
EMERGENCY_BACKUP_FILE=$EMERGENCY_BACKUP_FILE
TARGET_DATA_MAY_HAVE_CHANGED=$TARGET_DATA_MAY_HAVE_CHANGED
PUBLIC_TRAFFIC_RESUMED=0
RECORDED_AT_UTC=$TIMESTAMP
LOG_FILE=$RECOVERY_LOG_FILE
INCIDENT
  chmod 600 "$RECOVERY_INCIDENT_FILE" "$RECOVERY_LOG_FILE" 2>/dev/null || true
  log "Incident report: $RECOVERY_INCIDENT_FILE"
}

APP_CONTAINER_ID="$(compose ps -q app)"
CADDY_CONTAINER_ID="$(compose ps -q caddy)"
[[ -n "$APP_CONTAINER_ID" && -n "$CADDY_CONTAINER_ID" ]] || die 'Không tìm thấy stack IDOSI đang chạy.'
DATA_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$APP_CONTAINER_ID")"
BACKUP_HELPER_IMAGE="$(docker inspect --format '{{.Image}}' "$CADDY_CONTAINER_ID")"
CURRENT_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER_ID")"
[[ -n "$DATA_VOLUME" ]] || die 'Không xác định được volume dữ liệu /app/data.'
[[ -n "$BACKUP_HELPER_IMAGE" ]] || die 'Không xác định được image dùng để sao lưu.'
[[ -n "$CURRENT_IMAGE_ID" ]] || die 'Không xác định được image hiện tại.'
CURRENT_GIT_SHA="$(git -C "$IDOSI_ROOT" rev-parse HEAD)"
CURRENT_RELEASE_SHA="$(compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/release').then(r=>r.json()).then(v=>process.stdout.write(v?.data?.releaseSha||'')).catch(()=>process.exit(1))" 2>/dev/null || true)"
[[ "$CURRENT_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || CURRENT_RELEASE_SHA="$CURRENT_GIT_SHA"
CURRENT_IMAGE_TAG="idosi-app:pre-rollback-$TIMESTAMP-${CURRENT_RELEASE_SHA:0:12}"
docker image tag "$CURRENT_IMAGE_ID" "$CURRENT_IMAGE_TAG"

EMERGENCY_BACKUP_FILE="$BACKUP_DIR/idosi-data-$TIMESTAMP-before-manual-rollback.tar.gz"
ROLLBACK_STARTED=0
TARGET_DATA_MAY_HAVE_CHANGED=0

recover_current_release() {
  local original_code="$1"
  local reason=''
  trap - ERR
  set +e
  log 'Rollback thất bại; thử phục hồi release đang chạy trước thao tác rollback.'
  compose stop -t 30 caddy app >/dev/null 2>&1 || true

  if [[ "$TARGET_DATA_MAY_HAVE_CHANGED" == '1' ]]; then
    if [[ ! -s "$EMERGENCY_BACKUP_FILE" ]]; then
      reason='Emergency backup không tồn tại hoặc rỗng sau khi dữ liệu mục tiêu có thể đã thay đổi.'
      log "ERROR: $reason"
      write_recovery_incident "$reason"
      exit "$original_code"
    fi
    if ! restore_volume "$EMERGENCY_BACKUP_FILE"; then
      reason='Không thể phục hồi emergency backup; giữ Caddy/app dừng để tránh mở dữ liệu rỗng hoặc phục hồi dở.'
      log "ERROR: $reason"
      write_recovery_incident "$reason"
      exit "$original_code"
    fi
  fi

  export IDOSI_IMAGE="$CURRENT_IMAGE_TAG"
  export IDOSI_RELEASE_SHA="$CURRENT_RELEASE_SHA"
  if ! compose up -d --no-build app; then
    reason='Không thể khởi động lại current app image trong recovery.'
    log "ERROR: $reason"
    compose stop -t 30 caddy app >/dev/null 2>&1 || true
    write_recovery_incident "$reason"
    exit "$original_code"
  fi
  if ! wait_for_health "$CURRENT_RELEASE_SHA"; then
    reason='Current release không healthy sau recovery.'
    log "ERROR: $reason"
    compose stop -t 30 caddy app >/dev/null 2>&1 || true
    write_recovery_incident "$reason"
    exit "$original_code"
  fi
  if ! persist_release_config "$CURRENT_IMAGE_TAG" "$CURRENT_RELEASE_SHA"; then
    reason='Không thể lưu current release config sau recovery.'
    log "ERROR: $reason"
    compose stop -t 30 caddy app >/dev/null 2>&1 || true
    write_recovery_incident "$reason"
    exit "$original_code"
  fi
  if ! git -C "$IDOSI_ROOT" checkout --detach "$CURRENT_GIT_SHA" >/dev/null 2>&1; then
    reason='Không thể checkout current Git SHA sau recovery.'
    log "ERROR: $reason"
    compose stop -t 30 caddy app >/dev/null 2>&1 || true
    write_recovery_incident "$reason"
    exit "$original_code"
  fi
  if ! compose up -d --no-build caddy; then
    reason='Không thể mở lại Caddy sau recovery.'
    log "ERROR: $reason"
    compose stop -t 30 caddy app >/dev/null 2>&1 || true
    write_recovery_incident "$reason"
    exit "$original_code"
  fi
  log 'Current release đã được phục hồi; thao tác rollback vẫn được báo thất bại.'
  exit "$original_code"
}

on_error() {
  local code=$?
  if [[ "$ROLLBACK_STARTED" == '1' ]]; then
    recover_current_release "$code"
  fi
  exit "$code"
}
trap on_error ERR

log 'Dừng traffic và tạo emergency backup trước rollback.'
compose stop -t 30 caddy app
ROLLBACK_STARTED=1
archive_volume "$EMERGENCY_BACKUP_FILE"
[[ -s "$EMERGENCY_BACKUP_FILE" ]] || die 'Không tạo được emergency backup trước rollback.'

log "Phục hồi dữ liệu từ $TARGET_BACKUP_FILE"
TARGET_DATA_MAY_HAVE_CHANGED=1
restore_volume "$TARGET_BACKUP_FILE"
export IDOSI_IMAGE="$TARGET_IMAGE_TAG"
export IDOSI_RELEASE_SHA="$TARGET_RELEASE_SHA"
compose up -d --no-build app
if ! wait_for_health "$TARGET_RELEASE_SHA"; then
  compose logs --since=10m --tail=300 app >&2 || true
  die 'Release rollback không vượt qua health check.'
fi
persist_release_config "$TARGET_IMAGE_TAG" "$TARGET_RELEASE_SHA"
git -C "$IDOSI_ROOT" checkout --detach "$TARGET_GIT_SHA"
compose up -d --no-build caddy

ROLLBACK_STARTED=0
TARGET_DATA_MAY_HAVE_CHANGED=0
trap - ERR
log "SUCCESS: Đã rollback về $TARGET_RELEASE_SHA"
log "Emergency backup của release mới: $EMERGENCY_BACKUP_FILE"
