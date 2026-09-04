#!/usr/bin/env bash
set -Eeuo pipefail

OPERATION_ID="${1:-}"
EXPECTED_RELEASE_SHA="${2:-}"

[[ "$OPERATION_ID" =~ ^[A-Za-z0-9._-]{1,120}$ ]] || {
  printf '[idosi-inspect] ERROR invalid operation id\n' >&2
  exit 1
}
[[ "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  printf '[idosi-inspect] ERROR invalid release sha\n' >&2
  exit 1
}

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
JOB_DIR="${IDOSI_DEPLOY_JOB_DIR:-$IDOSI_ROOT/deploy/vps/backups/jobs}"
STATUS_FILE="$JOB_DIR/$OPERATION_ID.status"
PID_FILE="$JOB_DIR/$OPERATION_ID.pid"
EXPECTED_LOG_FILE="$JOB_DIR/$OPERATION_ID.log"

for command_name in awk cat date grep head kill ps sed stat tail; do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf '[idosi-inspect] ERROR missing command: %s\n' "$command_name" >&2
    exit 1
  }
done

[[ -f "$STATUS_FILE" && -r "$STATUS_FILE" ]] || {
  printf '[idosi-inspect] ERROR unreadable status file\n' >&2
  exit 1
}
[[ -f "$PID_FILE" && -r "$PID_FILE" ]] || {
  printf '[idosi-inspect] ERROR unreadable pid file\n' >&2
  exit 1
}

status_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$STATUS_FILE" | head -n 1
}

state="$(status_value STATE)"
release_sha="$(status_value RELEASE_SHA)"
started_at="$(status_value STARTED_AT_UTC)"
log_file="$(status_value LOG_FILE)"
pid="$(head -n 1 "$PID_FILE")"

[[ "$release_sha" == "$EXPECTED_RELEASE_SHA" ]] || {
  printf '[idosi-inspect] ERROR status release does not match expected release\n' >&2
  exit 1
}
[[ "$log_file" == "$EXPECTED_LOG_FILE" ]] || {
  printf '[idosi-inspect] ERROR status log path does not match exact operation\n' >&2
  exit 1
}
[[ "$pid" =~ ^[1-9][0-9]*$ ]] || {
  printf '[idosi-inspect] ERROR invalid pid\n' >&2
  exit 1
}

printf '[idosi-inspect] operation=%s state=%s release=%s started_at=%s now=%s\n' \
  "$OPERATION_ID" "$state" "$release_sha" "$started_at" "$(date -u +%Y%m%dT%H%M%SZ)"
printf '[idosi-inspect] log_metadata='
stat --printf='size=%s modified=%y\n' "$log_file"

if ! kill -0 "$pid" 2>/dev/null; then
  printf '[idosi-inspect] process_alive=false\n'
  printf '[idosi-inspect] log_tail_begin\n'
  tail -n 200 "$log_file"
  printf '[idosi-inspect] log_tail_end\n'
  exit 0
fi

process_group="$(ps -o pgid= -p "$pid" | awk '{ print $1 }')"
[[ "$process_group" =~ ^[1-9][0-9]*$ ]] || {
  printf '[idosi-inspect] ERROR cannot resolve process group\n' >&2
  exit 1
}

printf '[idosi-inspect] process_alive=true pid=%s pgid=%s\n' "$pid" "$process_group"
printf '[idosi-inspect] process_tree_begin\n'
ps -eo pid=,ppid=,pgid=,stat=,etimes=,pcpu=,pmem=,args= \
  | awk -v pgid="$process_group" '$3 == pgid'
printf '[idosi-inspect] process_tree_end\n'

if [[ -r "/proc/$pid/wchan" ]]; then
  printf '[idosi-inspect] leader_wait_channel='
  cat "/proc/$pid/wchan"
  printf '\n'
fi
if [[ -r "/proc/$pid/status" ]]; then
  printf '[idosi-inspect] leader_status_begin\n'
  grep -E '^(Name|State|Pid|PPid|Threads|VmPeak|VmSize|VmRSS|voluntary_ctxt_switches|nonvoluntary_ctxt_switches):' \
    "/proc/$pid/status" || true
  printf '[idosi-inspect] leader_status_end\n'
fi

printf '[idosi-inspect] host_resources_begin\n'
command -v free >/dev/null 2>&1 && free -m || true
command -v df >/dev/null 2>&1 && df -h / /var/lib/docker 2>/dev/null || true
command -v docker >/dev/null 2>&1 && docker ps --format \
  'container={{.Names}} status={{.Status}} image={{.Image}}' || true
printf '[idosi-inspect] host_resources_end\n'

printf '[idosi-inspect] log_tail_begin\n'
tail -n 200 "$log_file"
printf '[idosi-inspect] log_tail_end\n'
