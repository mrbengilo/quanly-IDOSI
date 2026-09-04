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

for command_name in git docker flock sha256sum sed head tail date awk basename mktemp mv chmod cat rm sleep; do
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
[[ "$TARGET_RELEASE_SHA" == "$TARGET_GIT_SHA" ]] \
  || die 'Previous Git SHA và release SHA trong report không khớp.'
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

static_volume_name() {
  printf 'idosi_static_%s\n' "$1"
}

image_has_static_release() {
  [[ "$(docker image inspect --format '{{ index .Config.Labels "io.idosi.static-topology" }}' "$1" 2>/dev/null)" \
    == 'sha-volume-v1' ]]
}

verify_static_volume() {
  local image="$1"
  local release_sha="$2"
  local allow_legacy="${3:-0}"
  local volume label image_revision
  if ! image_has_static_release "$image"; then
    [[ "$allow_legacy" == '1' ]] && return 0
    die "Image $image không có static release verifier."
    return 1
  fi
  image_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
  [[ "$image_revision" == "$release_sha" ]] || {
    die "Image $image có OCI revision không khớp $release_sha."
    return 1
  }
  volume="$(static_volume_name "$release_sha")"
  docker volume inspect "$volume" >/dev/null 2>&1 || {
    die "Không tìm thấy static volume $volume."
    return 1
  }
  label="$(docker volume inspect --format '{{ index .Labels "io.idosi.release-sha" }}' "$volume")"
  [[ "$label" == "$release_sha" ]] || {
    die "Static volume $volume có release label không khớp."
    return 1
  }
  docker run --rm --network none --read-only \
    --mount "type=volume,source=$volume,target=/static,readonly" \
    --entrypoint node "$image" server/vps/static-release.mjs verify \
    --target /static --sha "$release_sha"
}

verify_app_runtime_image() {
  local image="$1"
  local release_sha="$2"
  local allow_legacy="${3:-0}"
  local container_id expected_image_id actual_image_id configured_release
  container_id="$(compose ps -q app)" || return 1
  [[ -n "$container_id" ]] || {
    die 'Không tìm thấy app container đang chạy để xác minh image.'
    return 1
  }
  expected_image_id="$(docker image inspect --format '{{.Id}}' "$image")" || return 1
  actual_image_id="$(docker inspect --format '{{.Image}}' "$container_id")" || return 1
  [[ -n "$expected_image_id" && "$actual_image_id" == "$expected_image_id" ]] || {
    die "App container không chạy đúng image $image."
    return 1
  }
  if ! image_has_static_release "$image"; then
    [[ "$allow_legacy" == '1' ]] && return 0
    die "Image $image không có exact-release metadata bắt buộc."
    return 1
  fi
  verify_static_volume "$image" "$release_sha" || return 1
  configured_release="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
    | awk -F= '$1 == "IDOSI_RELEASE_SHA" { print $2 }' | tail -n 1)" || return 1
  [[ "$configured_release" == "$release_sha" ]] || {
    die 'App container release environment không khớp exact release SHA.'
    return 1
  }
}

validate_caddy_static_mount() {
  local container_id="$1"
  local image="$2"
  local release_sha="$3"
  local allow_legacy="${4:-0}"
  local expected_volume actual_volume configured_release
  if ! image_has_static_release "$image"; then
    [[ "$allow_legacy" == '1' ]] && return 0
    die "Image $image không hỗ trợ static release topology."
    return 1
  fi
  expected_volume="$(static_volume_name "$release_sha")"
  actual_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv/idosi"}}{{.Name}}{{end}}{{end}}' "$container_id")"
  [[ "$actual_volume" == "$expected_volume" ]] || {
    die "Caddy đang mount ${actual_volume:-không có static volume}, mong đợi $expected_volume."
    return 1
  }
  configured_release="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
    | awk -F= '$1 == "IDOSI_RELEASE_SHA" { print $2 }' | tail -n 1)"
  [[ "$configured_release" == "$release_sha" ]] || {
    die 'Caddy release environment không khớp exact release SHA.'
    return 1
  }
  verify_static_volume "$image" "$release_sha"
}

start_caddy_for_release() {
  local image="$1"
  local release_sha="$2"
  local allow_legacy="${3:-0}"
  local container_id running
  # Recreate only Caddy. The app has already passed its exact-release health
  # check and must not be restarted as a Compose dependency at this stage.
  compose up --no-deps --no-start --force-recreate caddy || return 1
  container_id="$(compose ps -q --all caddy)" || return 1
  [[ -n "$container_id" ]] || {
    die 'Không tạo được Caddy container để xác minh topology.'
    return 1
  }
  validate_caddy_static_mount "$container_id" "$image" "$release_sha" "$allow_legacy" || return 1
  compose start caddy || return 1
  sleep 1 || return 1
  running="$(docker inspect --format '{{.State.Running}}' "$container_id")" || return 1
  [[ "$running" == 'true' ]] || {
    die 'Caddy container không duy trì trạng thái running sau khi start.'
    return 1
  }
}

assert_stack_stopped() {
  local service container_id running
  for service in app caddy; do
    container_id="$(compose ps -q --all "$service" 2>/dev/null)" || return 1
    [[ -n "$container_id" ]] || return 1
    running="$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null)" || return 1
    [[ "$running" == 'false' ]] || return 1
  done
}

persist_release_config() {
  local image="$1"
  local release_sha="$2"
  local temp_file
  temp_file="$(mktemp "$COMPOSE_DIR/.env.rollback.XXXXXX")" || return 1
  if ! awk -v image="$image" -v release_sha="$release_sha" '
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
  ' "$COMPOSE_DIR/.env" >"$temp_file"; then
    rm -f "$temp_file"
    return 1
  fi
  chmod 600 "$temp_file" || {
    rm -f "$temp_file"
    return 1
  }
  mv "$temp_file" "$COMPOSE_DIR/.env" || {
    rm -f "$temp_file"
    return 1
  }
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
CURRENT_STATIC_VOLUME=$CURRENT_STATIC_VOLUME
TARGET_RELEASE_SHA=$TARGET_RELEASE_SHA
TARGET_GIT_SHA=$TARGET_GIT_SHA
TARGET_STATIC_VOLUME=$TARGET_STATIC_VOLUME
EMERGENCY_BACKUP_FILE=$EMERGENCY_BACKUP_FILE
TARGET_DATA_MAY_HAVE_CHANGED=$TARGET_DATA_MAY_HAVE_CHANGED
PUBLIC_TRAFFIC_RESUMED=0
RECORDED_AT_UTC=$TIMESTAMP
LOG_FILE=$RECOVERY_LOG_FILE
INCIDENT
  chmod 600 "$RECOVERY_INCIDENT_FILE" "$RECOVERY_LOG_FILE" 2>/dev/null || true
  log "Incident report: $RECOVERY_INCIDENT_FILE"
}

APP_CONTAINER_ID="$(compose ps -q --all app)"
CADDY_CONTAINER_ID="$(compose ps -q --all caddy)"
[[ -n "$APP_CONTAINER_ID" && -n "$CADDY_CONTAINER_ID" ]] \
  || die 'Không tìm thấy app/Caddy container hiện tại để rollback.'
DATA_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$APP_CONTAINER_ID")"
BACKUP_HELPER_IMAGE="$(docker inspect --format '{{.Image}}' "$CADDY_CONTAINER_ID")"
CURRENT_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER_ID")"
[[ -n "$DATA_VOLUME" ]] || die 'Không xác định được volume dữ liệu /app/data.'
[[ -n "$BACKUP_HELPER_IMAGE" ]] || die 'Không xác định được image dùng để sao lưu.'
[[ -n "$CURRENT_IMAGE_ID" ]] || die 'Không xác định được image hiện tại.'
CURRENT_GIT_SHA="$(git -C "$IDOSI_ROOT" rev-parse HEAD)"
CURRENT_RELEASE_SHA="$(compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/release').then(r=>r.json()).then(v=>process.stdout.write(v?.data?.releaseSha||'')).catch(()=>process.exit(1))" 2>/dev/null || true)"
[[ "$CURRENT_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || CURRENT_RELEASE_SHA="$CURRENT_GIT_SHA"
[[ "$CURRENT_RELEASE_SHA" == "$CURRENT_GIT_SHA" ]] \
  || die 'Git HEAD hiện tại không khớp release SHA của stack cần rollback.'
CURRENT_IMAGE_TAG="idosi-app:pre-rollback-$TIMESTAMP-${CURRENT_RELEASE_SHA:0:12}"
docker image tag "$CURRENT_IMAGE_ID" "$CURRENT_IMAGE_TAG"
CURRENT_STATIC_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv/idosi"}}{{.Name}}{{end}}{{end}}' "$CADDY_CONTAINER_ID")"
TARGET_STATIC_VOLUME=''
if image_has_static_release "$CURRENT_IMAGE_TAG"; then
  validate_caddy_static_mount "$CADDY_CONTAINER_ID" "$CURRENT_IMAGE_TAG" "$CURRENT_RELEASE_SHA"
fi
if image_has_static_release "$TARGET_IMAGE_TAG"; then
  TARGET_STATIC_VOLUME="$(static_volume_name "$TARGET_RELEASE_SHA")"
fi
verify_static_volume "$CURRENT_IMAGE_TAG" "$CURRENT_RELEASE_SHA" 1
verify_static_volume "$TARGET_IMAGE_TAG" "$TARGET_RELEASE_SHA" 1

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
  if ! assert_stack_stopped; then
    reason='Không chứng minh được app/Caddy đã dừng; không restore emergency backup lên SQLite đang có thể còn được ghi.'
    log "ERROR: $reason"
    write_recovery_incident "$reason"
    exit "$original_code"
  fi

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
  if ! git -C "$IDOSI_ROOT" checkout --detach "$CURRENT_GIT_SHA" >/dev/null 2>&1; then
    reason='Không thể checkout current Git SHA trước khi khởi động recovery topology.'
    log "ERROR: $reason"
    compose stop -t 30 caddy app >/dev/null 2>&1 || true
    write_recovery_incident "$reason"
    exit "$original_code"
  fi
  if ! verify_static_volume "$CURRENT_IMAGE_TAG" "$CURRENT_RELEASE_SHA" 1; then
    reason='Static volume của current release không hợp lệ trong recovery.'
    log "ERROR: $reason"
    compose stop -t 30 caddy app >/dev/null 2>&1 || true
    write_recovery_incident "$reason"
    exit "$original_code"
  fi
  if ! compose up -d --no-build app; then
    reason='Không thể khởi động lại current app image trong recovery.'
    log "ERROR: $reason"
    compose stop -t 30 caddy app >/dev/null 2>&1 || true
    write_recovery_incident "$reason"
    exit "$original_code"
  fi
  if ! verify_app_runtime_image "$CURRENT_IMAGE_TAG" "$CURRENT_RELEASE_SHA" 1; then
    reason='Current app container không chạy đúng image recovery.'
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
  if ! start_caddy_for_release "$CURRENT_IMAGE_TAG" "$CURRENT_RELEASE_SHA" 1; then
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
ROLLBACK_STARTED=1
compose stop -t 30 caddy app
assert_stack_stopped || die 'Không chứng minh được app/Caddy đã dừng trước emergency backup.'
archive_volume "$EMERGENCY_BACKUP_FILE"
[[ -s "$EMERGENCY_BACKUP_FILE" ]] || die 'Không tạo được emergency backup trước rollback.'

log "Phục hồi dữ liệu từ $TARGET_BACKUP_FILE"
TARGET_DATA_MAY_HAVE_CHANGED=1
restore_volume "$TARGET_BACKUP_FILE"
export IDOSI_IMAGE="$TARGET_IMAGE_TAG"
export IDOSI_RELEASE_SHA="$TARGET_RELEASE_SHA"
git -C "$IDOSI_ROOT" checkout --detach "$TARGET_GIT_SHA"
verify_static_volume "$TARGET_IMAGE_TAG" "$TARGET_RELEASE_SHA" 1
compose up -d --no-build app
verify_app_runtime_image "$TARGET_IMAGE_TAG" "$TARGET_RELEASE_SHA" 1
if ! wait_for_health "$TARGET_RELEASE_SHA"; then
  compose logs --since=10m --tail=300 app >&2 || true
  die 'Release rollback không vượt qua health check.'
fi
persist_release_config "$TARGET_IMAGE_TAG" "$TARGET_RELEASE_SHA"
start_caddy_for_release "$TARGET_IMAGE_TAG" "$TARGET_RELEASE_SHA" 1

ROLLBACK_STARTED=0
TARGET_DATA_MAY_HAVE_CHANGED=0
trap - ERR
log "SUCCESS: Đã rollback về $TARGET_RELEASE_SHA"
log "Emergency backup của release mới: $EMERGENCY_BACKUP_FILE"
