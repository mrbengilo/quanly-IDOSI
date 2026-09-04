#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

log() {
  printf '[idosi-recovery] %s\n' "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

is_pre_cutover_log() {
  local log_file="$1"
  [[ -f "$log_file" ]] || return 1
  grep -Fq '[idosi-deploy] Checkout đúng release SHA và build image bất biến theo SHA.' "$log_file" || return 1
  ! grep -Fq '[idosi-deploy] Dừng Caddy và app trong cửa sổ bảo trì ngắn để backup SQLite nhất quán.' "$log_file" \
    && ! grep -Fq '[idosi-deploy] Backup thành công:' "$log_file" \
    && ! grep -Fq '[idosi-deploy] Khởi động app mới;' "$log_file" \
    && ! grep -Fq '[idosi-deploy] Khởi động Caddy sau khi app mới đã healthy.' "$log_file"
}

normalize_utc_timestamp() {
  local value="$1"
  sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/\1-\2-\3T\4:\5:\6Z/' <<<"$value"
}

if [[ "${1:-}" == '--validate-log' ]]; then
  [[ $# -eq 2 ]] || die 'Cần đúng một file log để kiểm tra.'
  is_pre_cutover_log "$2" || die 'Log không chứng minh được deployment đang ở trước cutover.'
  log 'Log xác nhận deployment đang ở trước cutover.'
  exit 0
fi

OPERATION_ID="${1:-}"
EXPECTED_TARGET_SHA="${2:-}"
EXPECTED_ACTIVE_SHA="${3:-}"
CONFIRMATION="${4:-}"

[[ "$OPERATION_ID" =~ ^[A-Za-z0-9._-]{1,120}$ ]] || die 'Operation ID không hợp lệ.'
[[ "$EXPECTED_TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Target release SHA không hợp lệ.'
[[ "$EXPECTED_ACTIVE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Active release SHA không hợp lệ.'
[[ "$EXPECTED_TARGET_SHA" != "$EXPECTED_ACTIVE_SHA" ]] || die 'Target và active release không được trùng nhau.'
[[ "$CONFIRMATION" == 'RECOVER_STALE_PRE_CUTOVER' ]] || die 'Thiếu chuỗi xác nhận recovery.'

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_DIR="$IDOSI_ROOT/deploy/vps"
JOB_DIR="${IDOSI_DEPLOY_JOB_DIR:-$COMPOSE_DIR/backups/jobs}"
LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"
STATUS_FILE="$JOB_DIR/$OPERATION_ID.status"
PID_FILE="$JOB_DIR/$OPERATION_ID.pid"
EXPECTED_LOG_FILE="$JOB_DIR/$OPERATION_ID.log"
MINIMUM_AGE_SECONDS="${IDOSI_STALE_DEPLOY_MIN_AGE_SECONDS:-3600}"

for command_name in awk cat chmod curl date docker flock git grep head kill mktemp mv ps sed seq sleep tail tr; do
  command -v "$command_name" >/dev/null 2>&1 || die "Thiếu lệnh bắt buộc: $command_name"
done
docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin không hoạt động.'
[[ "$MINIMUM_AGE_SECONDS" =~ ^[1-9][0-9]*$ ]] || die 'Ngưỡng stale phải là số nguyên dương.'
[[ -d "$IDOSI_ROOT/.git" ]] || die 'Không tìm thấy Git repository trên VPS.'
[[ -f "$COMPOSE_DIR/compose.yml" ]] || die 'Không tìm thấy compose.yml.'
[[ -f "$COMPOSE_DIR/.env" ]] || die 'Không tìm thấy cấu hình runtime VPS.'
[[ -f "$STATUS_FILE" && -r "$STATUS_FILE" ]] || die 'Không đọc được status của deployment.'
[[ -f "$PID_FILE" && -r "$PID_FILE" ]] || die 'Không đọc được PID của deployment.'

status_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$STATUS_FILE" | head -n 1
}

compose() {
  (cd "$COMPOSE_DIR" && docker compose -f compose.yml "$@")
}

runtime_release() {
  compose exec -T app node -e \
    "fetch('http://127.0.0.1:3000/api/release').then(r=>r.json()).then(v=>process.stdout.write(v?.data?.releaseSha||'')).catch(()=>process.exit(1))"
}

assert_service_running() {
  local service="$1"
  local container_id running
  container_id="$(compose ps -q "$service")"
  [[ -n "$container_id" ]] || die "Không tìm thấy container $service đang chạy."
  running="$(docker inspect --format '{{.State.Running}}' "$container_id")"
  [[ "$running" == 'true' ]] || die "Container $service không ở trạng thái running."
}

state="$(status_value STATE)"
target_sha="$(status_value RELEASE_SHA)"
started_at="$(status_value STARTED_AT_UTC)"
log_file="$(status_value LOG_FILE)"
pid="$(head -n 1 "$PID_FILE")"

[[ "$state" == 'RUNNING' ]] || die "Deployment không còn RUNNING (state=${state:-missing})."
[[ "$target_sha" == "$EXPECTED_TARGET_SHA" ]] || die 'Release trong status không khớp target được xác nhận.'
[[ "$log_file" == "$EXPECTED_LOG_FILE" ]] || die 'Đường dẫn log trong status không đúng operation.'
[[ "$pid" =~ ^[1-9][0-9]*$ ]] || die 'PID trong status không hợp lệ.'
kill -0 "$pid" 2>/dev/null || die 'Tiến trình ghi trong PID file không còn tồn tại; cần điều tra thủ công.'

started_iso="$(normalize_utc_timestamp "$started_at")"
started_epoch="$(date -u -d "$started_iso" +%s 2>/dev/null || true)"
now_epoch="$(date -u +%s)"
[[ "$started_epoch" =~ ^[0-9]+$ ]] || die 'Không đọc được thời điểm bắt đầu deployment.'
age_seconds=$((now_epoch - started_epoch))
(( age_seconds >= MINIMUM_AGE_SECONDS )) || die "Deployment chưa đủ stale (${age_seconds}s)."

process_group="$(ps -o pgid= -p "$pid" | awk '{ print $1 }')"
[[ "$process_group" =~ ^[1-9][0-9]*$ ]] || die 'Không xác định được process group của deployment.'
[[ "$process_group" == "$pid" ]] || die 'PID không phải process-group leader; từ chối dừng để tránh tác động nhầm.'
command_line="$(tr '\0' ' ' <"/proc/$pid/cmdline")"
[[ "$command_line" == *"$OPERATION_ID"* && "$command_line" == *"$EXPECTED_TARGET_SHA"* ]] \
  || die 'Tiến trình không khớp operation/release được xác nhận.'

exec 8>"$LOCK_FILE"
if flock -n 8; then
  die 'Deployment lock không còn được giữ; từ chối recovery không cần thiết.'
fi

paused=0
resume_stale_job_on_abort() {
  if [[ "$paused" == '1' ]] && kill -0 -- "-$process_group" 2>/dev/null; then
    kill -CONT -- "-$process_group" 2>/dev/null || true
  fi
}
trap resume_stale_job_on_abort EXIT

# Freeze the verified process group before the final stage checks. This closes the
# race where a build could finish and enter the traffic-stop/backup phase between
# reading the log and terminating the stale job.
kill -STOP -- "-$process_group"
paused=1
sleep 1
[[ "$(status_value STATE)" == 'RUNNING' ]] || die 'Deployment state changed while preparing recovery.'
is_pre_cutover_log "$log_file" || {
  tail -n 80 "$log_file" >&2 || true
  die 'Không chứng minh được job treo trước cutover; từ chối dừng tự động.'
}
assert_service_running app
assert_service_running caddy
internal_release="$(runtime_release)"
[[ "$internal_release" == "$EXPECTED_ACTIVE_SHA" ]] || die 'App nội bộ không chạy đúng active release được xác nhận.'
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 'https://idosi.io.vn/api/health' >/dev/null
public_release_json="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 'https://idosi.io.vn/api/release')"
[[ "$public_release_json" == *"\"releaseSha\":\"$EXPECTED_ACTIVE_SHA\""* ]] \
  || die 'Public production không chạy đúng active release được xác nhận.'
[[ -z "$(git -C "$IDOSI_ROOT" status --porcelain)" ]] || die 'VPS working tree không sạch; từ chối recovery.'
git -C "$IDOSI_ROOT" cat-file -e "$EXPECTED_ACTIVE_SHA^{commit}" 2>/dev/null \
  || die 'Active release commit không tồn tại trong Git repository VPS.'

log "Dừng stale pre-cutover operation $OPERATION_ID (${age_seconds}s)."
kill -TERM -- "-$process_group"
kill -CONT -- "-$process_group"
paused=0
for _ in $(seq 1 20); do
  kill -0 -- "-$process_group" 2>/dev/null || break
  sleep 1
done
if kill -0 -- "-$process_group" 2>/dev/null; then
  log 'Process group không dừng sau SIGTERM; gửi SIGKILL.'
  kill -KILL -- "-$process_group"
fi

for _ in $(seq 1 30); do
  flock -n 8 && break
  sleep 1
done
flock -n 8 || die 'Deployment lock không được giải phóng sau khi dừng stale job.'

git -C "$IDOSI_ROOT" checkout --detach "$EXPECTED_ACTIVE_SHA" >/dev/null
assert_service_running app
assert_service_running caddy
[[ "$(runtime_release)" == "$EXPECTED_ACTIVE_SHA" ]] || die 'App release thay đổi trong lúc recovery.'

finished_at="$(date -u +%Y%m%dT%H%M%SZ)"
status_temp="$(mktemp "$JOB_DIR/.status-recovered.XXXXXX")"
cat >"$status_temp" <<STATUS
STATE=COMPLETED
EXIT_CODE=143
RELEASE_SHA=$EXPECTED_TARGET_SHA
OPERATION_ID=$OPERATION_ID
STARTED_AT_UTC=$started_at
FINISHED_AT_UTC=$finished_at
LOG_FILE=$log_file
RECOVERY=STALE_PRE_CUTOVER
ACTIVE_RELEASE_SHA=$EXPECTED_ACTIVE_SHA
STATUS
chmod 600 "$status_temp"
mv "$status_temp" "$STATUS_FILE"
printf '[idosi-recovery] RECOVERED_AT_UTC=%s ACTIVE_RELEASE_SHA=%s\n' \
  "$finished_at" "$EXPECTED_ACTIVE_SHA" >>"$log_file"

trap - EXIT
log "Recovery hoàn tất; production vẫn chạy $EXPECTED_ACTIVE_SHA và deployment lock đã được giải phóng."
