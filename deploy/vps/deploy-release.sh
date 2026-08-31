#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

log() {
  printf '[idosi-deploy] %s\n' "$*"
}

die() {
  log "ERROR: $*" >&2
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Thiếu lệnh bắt buộc: $1"
}

RELEASE_SHA="${1:-}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Release SHA phải gồm đúng 40 ký tự hex viết thường.'

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_DIR="$IDOSI_ROOT/deploy/vps"
BACKUP_DIR="${IDOSI_BACKUP_DIR:-$COMPOSE_DIR/backups}"
PUBLIC_URL="${IDOSI_PUBLIC_URL:-https://idosi.io.vn}"
[[ "$PUBLIC_URL" == https://* ]] || die 'IDOSI_PUBLIC_URL phải dùng HTTPS.'
HEALTH_RETRIES="${IDOSI_HEALTH_RETRIES:-18}"
HEALTH_DELAY_SECONDS="${IDOSI_HEALTH_DELAY_SECONDS:-5}"
[[ "$HEALTH_RETRIES" =~ ^[1-9][0-9]*$ ]] || die 'IDOSI_HEALTH_RETRIES phải là số nguyên dương.'
[[ "$HEALTH_DELAY_SECONDS" =~ ^[1-9][0-9]*$ ]] || die 'IDOSI_HEALTH_DELAY_SECONDS phải là số nguyên dương.'
LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SHORT_RELEASE="${RELEASE_SHA:0:12}"
REPORT_FILE="$BACKUP_DIR/deploy-$TIMESTAMP-$SHORT_RELEASE.env"
PENDING_REPORT_POINTER="$BACKUP_DIR/pending-$RELEASE_SHA.report"

for command_name in git docker curl flock sha256sum awk date mktemp mv chmod tee basename cat rm head tail mkdir sleep; do
  require_command "$command_name"
done
docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin không hoạt động.'
[[ -d "$IDOSI_ROOT/.git" ]] || die "Không tìm thấy Git repository tại $IDOSI_ROOT."
[[ -f "$COMPOSE_DIR/compose.yml" ]] || die 'Không tìm thấy deploy/vps/compose.yml.'
[[ -f "$COMPOSE_DIR/.env" ]] || die 'Thiếu deploy/vps/.env trên VPS.'
mkdir -p "$BACKUP_DIR"

exec 9>"$LOCK_FILE"
flock -n 9 || die 'Đang có một deployment IDOSI khác chạy.'

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

prepare_static_volume() {
  local image="$1"
  local release_sha="$2"
  local volume label
  volume="$(static_volume_name "$release_sha")"
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    label="$(docker volume inspect --format '{{ index .Labels "io.idosi.release-sha" }}' "$volume")"
    [[ "$label" == "$release_sha" ]] || die "Static volume $volume đã tồn tại với release label khác."
  else
    docker volume create \
      --label 'io.idosi.managed=true' \
      --label "io.idosi.release-sha=$release_sha" \
      "$volume" >/dev/null
  fi
  docker run --rm --network none --read-only --user 0:0 \
    --mount "type=volume,source=$volume,target=/static" \
    --entrypoint node "$image" server/vps/static-release.mjs prepare \
    --source /app/dist/client --target /static --sha "$release_sha"
  verify_static_volume "$image" "$release_sha"
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
  compose create --force-recreate caddy || return 1
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
  temp_file="$(mktemp "$COMPOSE_DIR/.env.deploy.XXXXXX")" || return 1
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

wait_for_app_health() {
  local expected_release="${1:-}"
  local allow_legacy_without_release_endpoint="${2:-0}"
  local attempt
  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1)); do
    if compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      if [[ -z "$expected_release" ]]; then
        return 0
      fi
      if compose exec -T app test -f server/vps/verify-release.mjs >/dev/null 2>&1; then
        if compose exec -T app node server/vps/verify-release.mjs \
          http://127.0.0.1:3000 "$expected_release" >/dev/null 2>&1; then
          return 0
        fi
      elif [[ "$allow_legacy_without_release_endpoint" == '1' ]]; then
        return 0
      fi
    fi
    sleep "$HEALTH_DELAY_SECONDS"
  done
  return 1
}

restore_backup() {
  local backup_file="$1"
  local backup_name
  backup_name="$(basename "$backup_file")"
  [[ -s "$backup_file" ]] || return 1
  docker run --rm --network none \
    --mount "type=volume,source=$DATA_VOLUME,target=/data" \
    --mount "type=bind,source=$BACKUP_DIR,target=/backup,readonly" \
    --entrypoint /bin/sh "$BACKUP_HELPER_IMAGE" -c \
    "find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} \\; && tar -xzf '/backup/$backup_name' -C /data"
}

write_report() {
  local status="$1"
  local report_temp pointer_temp current_pointer
  report_temp="$(mktemp "$BACKUP_DIR/.deploy-report.XXXXXX")"
  cat >"$report_temp" <<REPORT
STATUS=$status
RELEASE_SHA=$RELEASE_SHA
PREVIOUS_GIT_SHA=$PREVIOUS_GIT_SHA
PREVIOUS_RELEASE_SHA=$PREVIOUS_RELEASE_SHA
PREVIOUS_IMAGE_TAG=$PREVIOUS_IMAGE_TAG
PREVIOUS_STATIC_VOLUME=$PREVIOUS_STATIC_VOLUME
PREVIOUS_STATIC_MODE=$PREVIOUS_STATIC_MODE
BACKUP_FILE=$BACKUP_FILE
BACKUP_SHA256=$BACKUP_SHA256
NEW_IMAGE=${IDOSI_IMAGE:-}
STATIC_VOLUME=$STATIC_VOLUME
DATA_VOLUME=$DATA_VOLUME
PUBLIC_TRAFFIC_RESUMED=$PUBLIC_TRAFFIC_RESUMED
PUBLIC_URL=$PUBLIC_URL
DEPLOYED_AT_UTC=$TIMESTAMP
EXTERNAL_VERIFIED_AT_UTC=
REPORT
  chmod 600 "$report_temp"
  mv "$report_temp" "$REPORT_FILE"

  if [[ "$status" == 'LOCAL_READY' ]]; then
    pointer_temp="$(mktemp "$BACKUP_DIR/.pending-report.XXXXXX")"
    printf '%s\n' "$REPORT_FILE" >"$pointer_temp"
    chmod 600 "$pointer_temp"
    mv "$pointer_temp" "$PENDING_REPORT_POINTER"
  elif [[ -f "$PENDING_REPORT_POINTER" ]]; then
    current_pointer="$(head -n 1 "$PENDING_REPORT_POINTER" 2>/dev/null || true)"
    if [[ "$current_pointer" == "$REPORT_FILE" ]]; then
      rm -f "$PENDING_REPORT_POINTER"
    fi
  fi
  log "Deployment report: $REPORT_FILE"
}

PREVIOUS_GIT_SHA=''
PREVIOUS_RELEASE_SHA=''
PREVIOUS_IMAGE_TAG=''
PREVIOUS_STATIC_VOLUME=''
PREVIOUS_STATIC_MODE='legacy-node'
BACKUP_FILE=''
BACKUP_SHA256=''
BACKUP_READY=0
DATA_MAY_HAVE_CHANGED=0
PUBLIC_TRAFFIC_RESUMED=0
DATA_VOLUME=''
STATIC_VOLUME="$(static_volume_name "$RELEASE_SHA")"
BACKUP_HELPER_IMAGE=''
ROLLBACK_REQUIRED=0

rollback_failed_deployment() {
  local original_code="$1"
  local incident_log="$BACKUP_DIR/deploy-$TIMESTAMP-$SHORT_RELEASE.log"
  trap - ERR
  set +e
  if [[ "$PUBLIC_TRAFFIC_RESUMED" == '1' ]]; then
    log 'ERROR: Lỗi xảy ra sau khi public traffic đã mở lại; không tự restore snapshot để tránh mất dữ liệu mới.'
    compose ps >&2 || true
    compose logs --since=10m --tail=300 app caddy 2>&1 | tee "$incident_log" >&2 || true
    write_report 'FAILED_AFTER_TRAFFIC'
    exit "$original_code"
  fi

  log 'Deployment lỗi trước khi public traffic mở lại; bắt đầu rollback release và dữ liệu.'
  compose stop -t 30 caddy app >/dev/null 2>&1 || true
  if ! assert_stack_stopped; then
    log 'ERROR: Không chứng minh được app/Caddy đã dừng; tuyệt đối không restore SQLite đang có thể còn được ghi.'
    write_report 'ROLLBACK_FAILED'
    exit "$original_code"
  fi
  if [[ "$DATA_MAY_HAVE_CHANGED" == '1' ]]; then
    if [[ "$BACKUP_READY" != '1' ]] || ! restore_backup "$BACKUP_FILE"; then
      log 'ERROR: Không thể phục hồi backup; giữ public traffic dừng để tránh chạy code cũ trên dữ liệu không tương thích.'
      compose logs --since=10m --tail=300 app caddy >"$incident_log" 2>&1 || true
      write_report 'ROLLBACK_FAILED'
      exit "$original_code"
    fi
  fi

  if [[ -z "$PREVIOUS_IMAGE_TAG" ]]; then
    log 'ERROR: Không có previous image để rollback.'
    write_report 'ROLLBACK_FAILED'
    exit "$original_code"
  fi

  export IDOSI_IMAGE="$PREVIOUS_IMAGE_TAG"
  export IDOSI_RELEASE_SHA="$PREVIOUS_RELEASE_SHA"
  if [[ -z "$PREVIOUS_GIT_SHA" ]] \
    || ! git -C "$IDOSI_ROOT" checkout --detach "$PREVIOUS_GIT_SHA" >/dev/null 2>&1; then
    log 'ERROR: Không thể checkout previous Git SHA trước khi khởi động rollback topology.'
    write_report 'ROLLBACK_FAILED'
    exit "$original_code"
  fi
  if ! verify_static_volume "$PREVIOUS_IMAGE_TAG" "$PREVIOUS_RELEASE_SHA" 1; then
    log 'ERROR: Static release trước không hợp lệ sau rollback.'
    write_report 'ROLLBACK_FAILED'
    exit "$original_code"
  fi
  if ! compose up -d --no-build app; then
    log 'ERROR: Không thể khởi động previous app image.'
    write_report 'ROLLBACK_FAILED'
    exit "$original_code"
  fi
  if ! verify_app_runtime_image "$PREVIOUS_IMAGE_TAG" "$PREVIOUS_RELEASE_SHA" 1; then
    log 'ERROR: Previous app container không chạy đúng image rollback.'
    write_report 'ROLLBACK_FAILED'
    exit "$original_code"
  fi
  if ! wait_for_app_health "$PREVIOUS_RELEASE_SHA" 1; then
    log 'ERROR: Release trước không vượt qua health check sau rollback.'
    compose logs --since=10m --tail=300 app >"$incident_log" 2>&1 || true
    write_report 'ROLLBACK_FAILED'
    exit "$original_code"
  fi
  if ! persist_release_config "$PREVIOUS_IMAGE_TAG" "$PREVIOUS_RELEASE_SHA"; then
    log 'ERROR: Rollback runtime đã lên nhưng không thể lưu release config vào .env.'
    write_report 'ROLLBACK_FAILED'
    exit "$original_code"
  fi
  if ! start_caddy_for_release "$PREVIOUS_IMAGE_TAG" "$PREVIOUS_RELEASE_SHA" 1; then
    log 'ERROR: Không thể mở lại Caddy sau rollback.'
    write_report 'ROLLBACK_FAILED'
    exit "$original_code"
  fi
  compose logs --since=10m --tail=300 app caddy >"$incident_log" 2>&1 || true
  write_report 'ROLLED_BACK'
  log 'Rollback đã khởi động lại release trước.'
  exit "$original_code"
}

on_error() {
  local code=$?
  if [[ "$ROLLBACK_REQUIRED" == '1' ]]; then
    rollback_failed_deployment "$code"
  fi
  if [[ -n "$PREVIOUS_GIT_SHA" ]]; then
    git -C "$IDOSI_ROOT" checkout --detach "$PREVIOUS_GIT_SHA" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap on_error ERR

log "Pre-deploy checks cho $RELEASE_SHA"
[[ -z "$(git -C "$IDOSI_ROOT" status --porcelain)" ]] || die 'Working tree trên VPS không sạch; dừng để tránh ghi đè thay đổi thủ công.'
git -C "$IDOSI_ROOT" fetch --prune origin main

git -C "$IDOSI_ROOT" cat-file -e "$RELEASE_SHA^{commit}" 2>/dev/null \
  || die 'Release SHA không tồn tại trong repository trên VPS.'
git -C "$IDOSI_ROOT" merge-base --is-ancestor "$RELEASE_SHA" origin/main \
  || die 'Release SHA không thuộc lịch sử origin/main.'

PREVIOUS_GIT_SHA="$(git -C "$IDOSI_ROOT" rev-parse HEAD)"
APP_CONTAINER_ID="$(compose ps -q app)"
CADDY_CONTAINER_ID="$(compose ps -q --all caddy)"
[[ -n "$APP_CONTAINER_ID" ]] || die 'Không tìm thấy app container hiện tại; dùng quy trình cài đặt lần đầu.'
[[ -n "$CADDY_CONTAINER_ID" ]] || die 'Không tìm thấy caddy container hiện tại; dùng quy trình cài đặt lần đầu.'

PREVIOUS_RELEASE_SHA="$(compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/release').then(r=>r.json()).then(v=>process.stdout.write(v?.data?.releaseSha||'')).catch(()=>process.exit(1))" 2>/dev/null || true)"
if [[ ! "$PREVIOUS_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  PREVIOUS_RELEASE_SHA="$PREVIOUS_GIT_SHA"
fi
[[ "$PREVIOUS_RELEASE_SHA" == "$PREVIOUS_GIT_SHA" ]] \
  || die 'Git HEAD hiện tại không khớp release SHA đang chạy; dừng trước cutover.'

PREVIOUS_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER_ID")"
PREVIOUS_IMAGE_TAG="idosi-app:rollback-$TIMESTAMP-${PREVIOUS_RELEASE_SHA:0:12}"
docker image tag "$PREVIOUS_IMAGE_ID" "$PREVIOUS_IMAGE_TAG"
PREVIOUS_STATIC_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv/idosi"}}{{.Name}}{{end}}{{end}}' "$CADDY_CONTAINER_ID")"
if image_has_static_release "$PREVIOUS_IMAGE_TAG"; then
  PREVIOUS_STATIC_MODE='caddy-volume'
  validate_caddy_static_mount "$CADDY_CONTAINER_ID" "$PREVIOUS_IMAGE_TAG" "$PREVIOUS_RELEASE_SHA"
fi

DATA_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$APP_CONTAINER_ID")"
[[ -n "$DATA_VOLUME" ]] || die 'Không xác định được volume dữ liệu /app/data.'
BACKUP_HELPER_IMAGE="$(docker inspect --format '{{.Image}}' "$CADDY_CONTAINER_ID")"
[[ -n "$BACKUP_HELPER_IMAGE" ]] || die 'Không xác định được image dùng để sao lưu.'

log 'Checkout đúng release SHA và build image bất biến theo SHA.'
git -C "$IDOSI_ROOT" checkout --detach "$RELEASE_SHA"
export IDOSI_IMAGE="idosi-app:$RELEASE_SHA"
export IDOSI_RELEASE_SHA="$RELEASE_SHA"
compose config --quiet
compose build --pull app
docker image inspect "$IDOSI_IMAGE" >/dev/null
IMAGE_RELEASE_SHA="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IDOSI_IMAGE")"
[[ "$IMAGE_RELEASE_SHA" == "$RELEASE_SHA" ]] || die 'OCI image revision không khớp exact release SHA.'
IMAGE_STATIC_TOPOLOGY="$(docker image inspect --format '{{ index .Config.Labels "io.idosi.static-topology" }}' "$IDOSI_IMAGE")"
[[ "$IMAGE_STATIC_TOPOLOGY" == 'sha-volume-v1' ]] || die 'OCI image thiếu static topology label bắt buộc.'

log 'Chuẩn bị static volume bất biến từ chính release image trước cửa sổ bảo trì.'
prepare_static_volume "$IDOSI_IMAGE" "$RELEASE_SHA"

log 'Dừng Caddy và app trong cửa sổ bảo trì ngắn để backup SQLite nhất quán.'
ROLLBACK_REQUIRED=1
compose stop -t 30 caddy app
assert_stack_stopped || die 'Không chứng minh được app/Caddy đã dừng trước backup nhất quán.'

BACKUP_NAME="idosi-data-$TIMESTAMP-before-$SHORT_RELEASE.tar.gz"
BACKUP_FILE="$BACKUP_DIR/$BACKUP_NAME"
docker run --rm --network none \
  --mount "type=volume,source=$DATA_VOLUME,target=/data,readonly" \
  --mount "type=bind,source=$BACKUP_DIR,target=/backup" \
  --entrypoint /bin/sh "$BACKUP_HELPER_IMAGE" -c \
  "tar -czf '/backup/$BACKUP_NAME' -C /data . && tar -tzf '/backup/$BACKUP_NAME' >/dev/null"
[[ -s "$BACKUP_FILE" ]] || die 'Backup không tồn tại hoặc rỗng.'
BACKUP_SHA256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
[[ "$BACKUP_SHA256" =~ ^[0-9a-f]{64}$ ]] || die 'Không tạo được checksum hợp lệ cho backup.'
BACKUP_READY=1
log "Backup thành công: $BACKUP_FILE ($BACKUP_SHA256)"

log 'Khởi động app mới; migration tự chạy trong transaction khi app mở SQLite.'
DATA_MAY_HAVE_CHANGED=1
compose up -d --no-build app
verify_app_runtime_image "$IDOSI_IMAGE" "$RELEASE_SHA"
if ! wait_for_app_health "$RELEASE_SHA"; then
  compose logs --since=10m --tail=300 app >&2 || true
  die 'App mới không vượt qua health/release check nội bộ.'
fi

persist_release_config "$IDOSI_IMAGE" "$RELEASE_SHA"
log 'Khởi động Caddy sau khi app mới đã healthy.'
start_caddy_for_release "$IDOSI_IMAGE" "$RELEASE_SHA"
PUBLIC_TRAFFIC_RESUMED=1

PUBLIC_ORIGIN="${PUBLIC_URL%/}"
PUBLIC_HOST="${PUBLIC_ORIGIN#*://}"
PUBLIC_HOST="${PUBLIC_HOST%%/*}"
PUBLIC_HOST="${PUBLIC_HOST%%:*}"
PUBLIC_RELEASE=''
PUBLIC_STATIC_RELEASE=''
for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1)); do
  if curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
    --resolve "$PUBLIC_HOST:443:127.0.0.1" \
    "$PUBLIC_ORIGIN/api/health" >/dev/null 2>&1; then
    PUBLIC_RELEASE="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
      --resolve "$PUBLIC_HOST:443:127.0.0.1" \
      "$PUBLIC_ORIGIN/api/release" 2>/dev/null || true)"
    if [[ "$PUBLIC_RELEASE" == *"\"releaseSha\":\"$RELEASE_SHA\""* ]]; then
      PUBLIC_ROOT_HEADERS="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
        --resolve "$PUBLIC_HOST:443:127.0.0.1" \
        --dump-header - --output /dev/null "$PUBLIC_ORIGIN/" 2>/dev/null || true)"
      PUBLIC_STATIC_RELEASE="$(printf '%s\n' "$PUBLIC_ROOT_HEADERS" | awk '
        tolower($1) == "x-idosi-static-release:" { gsub("\\r", "", $2); print $2 }
      ' | tail -n 1)"
      [[ "$PUBLIC_STATIC_RELEASE" == "$RELEASE_SHA" ]] && break
    fi
  fi
  sleep "$HEALTH_DELAY_SECONDS"
done
[[ "$PUBLIC_RELEASE" == *"\"releaseSha\":\"$RELEASE_SHA\""* ]] \
  || die 'Caddy HTTPS local verification không xác nhận đúng release SHA.'
[[ "$PUBLIC_STATIC_RELEASE" == "$RELEASE_SHA" ]] \
  || die 'Caddy HTTPS local verification không xác nhận đúng static release SHA.'

compose ps
compose logs --since=10m --tail=300 app caddy >"$BACKUP_DIR/deploy-$TIMESTAMP-$SHORT_RELEASE.log" 2>&1 || true
write_report 'LOCAL_READY'
ROLLBACK_REQUIRED=0
trap - ERR
log "LOCAL_READY: IDOSI đang chạy release $RELEASE_SHA; chờ external verification trước khi ghi SUCCESS."
