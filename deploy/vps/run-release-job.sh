#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

log() {
  printf '[idosi-job] %s\n' "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

RELEASE_SHA="${1:-}"
OPERATION_ID="${2:-}"
DEPLOY_SCRIPT="${3:-}"

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Release SHA không hợp lệ.'
[[ "$OPERATION_ID" =~ ^[A-Za-z0-9._-]{1,120}$ ]] || die 'Operation ID không hợp lệ.'
[[ -f "$DEPLOY_SCRIPT" && -r "$DEPLOY_SCRIPT" ]] || die 'Không đọc được deploy script đã upload.'

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
JOB_DIR="${IDOSI_DEPLOY_JOB_DIR:-$IDOSI_ROOT/deploy/vps/backups/jobs}"
STATUS_FILE="$JOB_DIR/$OPERATION_ID.status"
LOG_FILE="$JOB_DIR/$OPERATION_ID.log"
PID_FILE="$JOB_DIR/$OPERATION_ID.pid"
STARTED_AT="$(date -u +%Y%m%dT%H%M%SZ)"

for command_name in setsid nohup date mktemp mv chmod mkdir bash kill sed head cat; do
  command -v "$command_name" >/dev/null 2>&1 || die "Thiếu lệnh bắt buộc: $command_name"
done
mkdir -p "$JOB_DIR"
chmod 700 "$JOB_DIR"

if [[ -f "$STATUS_FILE" ]]; then
  existing_release="$(sed -n 's/^RELEASE_SHA=//p' "$STATUS_FILE" | head -n 1)"
  [[ "$existing_release" == "$RELEASE_SHA" ]] || die 'Operation ID đã được dùng cho release khác.'
  log "Operation đã tồn tại: $STATUS_FILE"
  cat "$STATUS_FILE"
  exit 0
fi

status_temp="$(mktemp "$JOB_DIR/.status.XXXXXX")"
cat >"$status_temp" <<STATUS
STATE=RUNNING
EXIT_CODE=
RELEASE_SHA=$RELEASE_SHA
OPERATION_ID=$OPERATION_ID
STARTED_AT_UTC=$STARTED_AT
FINISHED_AT_UTC=
LOG_FILE=$LOG_FILE
STATUS
chmod 600 "$status_temp"
mv "$status_temp" "$STATUS_FILE"
: >"$LOG_FILE"
chmod 600 "$LOG_FILE"

setsid nohup bash -c '
  set +e
  deploy_script="$1"
  release_sha="$2"
  operation_id="$3"
  started_at="$4"
  status_file="$5"
  log_file="$6"
  job_dir="$7"

  bash "$deploy_script" "$release_sha" >>"$log_file" 2>&1
  exit_code=$?
  finished_at="$(date -u +%Y%m%dT%H%M%SZ)"
  status_temp="$(mktemp "$job_dir/.status-complete.XXXXXX")"
  cat >"$status_temp" <<STATUS
STATE=COMPLETED
EXIT_CODE=$exit_code
RELEASE_SHA=$release_sha
OPERATION_ID=$operation_id
STARTED_AT_UTC=$started_at
FINISHED_AT_UTC=$finished_at
LOG_FILE=$log_file
STATUS
  chmod 600 "$status_temp"
  mv "$status_temp" "$status_file"
  exit 0
' _ "$DEPLOY_SCRIPT" "$RELEASE_SHA" "$OPERATION_ID" "$STARTED_AT" "$STATUS_FILE" "$LOG_FILE" "$JOB_DIR" \
  </dev/null >/dev/null 2>&1 &
runner_pid=$!
printf '%s\n' "$runner_pid" >"$PID_FILE"
chmod 600 "$PID_FILE"
if ! kill -0 "$runner_pid" 2>/dev/null; then
  if [[ ! -f "$STATUS_FILE" ]] || [[ "$(sed -n 's/^STATE=//p' "$STATUS_FILE" | head -n 1)" != 'COMPLETED' ]]; then
    die 'Không thể khởi động durable deployment process.'
  fi
fi

log "Durable deployment đã bắt đầu với PID $runner_pid."
printf 'STATUS_FILE=%s\nLOG_FILE=%s\nPID_FILE=%s\n' "$STATUS_FILE" "$LOG_FILE" "$PID_FILE"
