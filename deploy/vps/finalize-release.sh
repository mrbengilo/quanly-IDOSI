#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

log() {
  printf '[idosi-finalize] %s\n' "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

read_report_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$REPORT_FILE" | head -n 1
}

timestamp_epoch() {
  local value="$1"
  [[ "$value" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || return 1
  date -u -d "${value:0:4}-${value:4:2}-${value:6:2}T${value:9:2}:${value:11:2}:${value:13:2}Z" +%s 2>/dev/null
}

RELEASE_SHA="${1:-}"
EXTERNAL_VERIFIED_AT_UTC="${2:-}"
EXTERNAL_VERIFIED_ORIGIN="${3:-}"
EXTERNAL_VERIFY_RUN_ID="${4:-}"
EXTERNAL_VERIFY_RUN_ATTEMPT="${5:-}"
EXTERNAL_VERIFIED_SHA="${6:-}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Release SHA phải gồm đúng 40 ký tự hex viết thường.'
[[ "$EXTERNAL_VERIFIED_AT_UTC" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] \
  || die 'Thiếu attestation thời gian external verification hợp lệ.'
[[ "$EXTERNAL_VERIFIED_ORIGIN" == https://* ]] || die 'Thiếu origin external verification hợp lệ.'
[[ "$EXTERNAL_VERIFY_RUN_ID" =~ ^[1-9][0-9]*$ ]] || die 'GitHub external verification run ID không hợp lệ.'
[[ "$EXTERNAL_VERIFY_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]] || die 'GitHub external verification run attempt không hợp lệ.'
[[ "$EXTERNAL_VERIFIED_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'External verification release SHA không hợp lệ.'
[[ "$EXTERNAL_VERIFIED_SHA" == "$RELEASE_SHA" ]] || die 'External verification không thuộc release đang finalize.'

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_DIR="$IDOSI_ROOT/deploy/vps"
BACKUP_DIR="${IDOSI_BACKUP_DIR:-$COMPOSE_DIR/backups}"
LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"
POINTER_FILE="$BACKUP_DIR/pending-$RELEASE_SHA.report"

for command_name in flock sed head awk date mktemp mv chmod rm; do
  command -v "$command_name" >/dev/null 2>&1 || die "Thiếu lệnh bắt buộc: $command_name"
done
[[ -d "$BACKUP_DIR" ]] || die 'Không tìm thấy thư mục backup IDOSI.'
[[ -f "$POINTER_FILE" ]] || die 'Không tìm thấy pending deployment report cho release này.'

exec 9>"$LOCK_FILE"
flock -n 9 || die 'Deployment/rollback IDOSI vẫn đang chạy; chưa thể finalize.'

REPORT_FILE="$(head -n 1 "$POINTER_FILE")"
[[ "$REPORT_FILE" == "$BACKUP_DIR/"* ]] || die 'Pending report trỏ ra ngoài thư mục backup.'
[[ -f "$REPORT_FILE" ]] || die 'Pending deployment report không tồn tại.'

STATUS="$(read_report_value STATUS)"
REPORT_RELEASE_SHA="$(read_report_value RELEASE_SHA)"
PUBLIC_TRAFFIC_RESUMED="$(read_report_value PUBLIC_TRAFFIC_RESUMED)"
PUBLIC_URL="$(read_report_value PUBLIC_URL)"
DEPLOYED_AT_UTC="$(read_report_value DEPLOYED_AT_UTC)"

[[ "$REPORT_RELEASE_SHA" == "$RELEASE_SHA" ]] || die 'Release SHA trong report không khớp.'
[[ "$PUBLIC_TRAFFIC_RESUMED" == '1' ]] || die 'Report chưa xác nhận public traffic đã mở.'
[[ "$PUBLIC_URL" == https://* ]] || die 'PUBLIC_URL trong report không hợp lệ.'
[[ "${EXTERNAL_VERIFIED_ORIGIN%/}" == "${PUBLIC_URL%/}" ]] \
  || die 'Origin external verification không khớp PUBLIC_URL trong report.'

if [[ "$STATUS" == 'SUCCESS' ]]; then
  rm -f "$POINTER_FILE"
  log "Release $RELEASE_SHA đã được finalize trước đó."
  exit 0
fi
[[ "$STATUS" == 'LOCAL_READY' ]] || die "Chỉ finalize report có STATUS=LOCAL_READY, hiện tại là $STATUS."

EXTERNAL_VERIFIED_EPOCH="$(timestamp_epoch "$EXTERNAL_VERIFIED_AT_UTC")" \
  || die 'Không đọc được thời gian external verification.'
DEPLOYED_EPOCH="$(timestamp_epoch "$DEPLOYED_AT_UTC")" \
  || die 'Không đọc được thời gian deployment trong report.'
NOW_EPOCH="$(date -u +%s)"
(( EXTERNAL_VERIFIED_EPOCH >= DEPLOYED_EPOCH )) \
  || die 'External verification xảy ra trước deployment hiện tại.'
(( EXTERNAL_VERIFIED_EPOCH <= NOW_EPOCH + 120 )) \
  || die 'Thời gian external verification nằm quá xa trong tương lai.'
(( NOW_EPOCH - EXTERNAL_VERIFIED_EPOCH <= 1800 )) \
  || die 'External verification attestation đã quá hạn.'

REPORT_TEMP="$(mktemp "$BACKUP_DIR/.finalized-report.XXXXXX")"
awk \
  -v verified_at="$EXTERNAL_VERIFIED_AT_UTC" \
  -v verified_origin="${EXTERNAL_VERIFIED_ORIGIN%/}" \
  -v verified_sha="$EXTERNAL_VERIFIED_SHA" \
  -v verify_run_id="$EXTERNAL_VERIFY_RUN_ID" \
  -v verify_run_attempt="$EXTERNAL_VERIFY_RUN_ATTEMPT" '
  BEGIN {
    seen_status = 0
    seen_verified = 0
    seen_origin = 0
    seen_sha = 0
    seen_run_id = 0
    seen_run_attempt = 0
  }
  /^STATUS=/ {
    print "STATUS=SUCCESS"
    seen_status = 1
    next
  }
  /^EXTERNAL_VERIFIED_AT_UTC=/ {
    print "EXTERNAL_VERIFIED_AT_UTC=" verified_at
    seen_verified = 1
    next
  }
  /^EXTERNAL_VERIFIED_ORIGIN=/ {
    print "EXTERNAL_VERIFIED_ORIGIN=" verified_origin
    seen_origin = 1
    next
  }
  /^EXTERNAL_VERIFIED_SHA=/ {
    print "EXTERNAL_VERIFIED_SHA=" verified_sha
    seen_sha = 1
    next
  }
  /^EXTERNAL_VERIFY_RUN_ID=/ {
    print "EXTERNAL_VERIFY_RUN_ID=" verify_run_id
    seen_run_id = 1
    next
  }
  /^EXTERNAL_VERIFY_RUN_ATTEMPT=/ {
    print "EXTERNAL_VERIFY_RUN_ATTEMPT=" verify_run_attempt
    seen_run_attempt = 1
    next
  }
  { print }
  END {
    if (!seen_status) exit 42
    if (!seen_verified) print "EXTERNAL_VERIFIED_AT_UTC=" verified_at
    if (!seen_origin) print "EXTERNAL_VERIFIED_ORIGIN=" verified_origin
    if (!seen_sha) print "EXTERNAL_VERIFIED_SHA=" verified_sha
    if (!seen_run_id) print "EXTERNAL_VERIFY_RUN_ID=" verify_run_id
    if (!seen_run_attempt) print "EXTERNAL_VERIFY_RUN_ATTEMPT=" verify_run_attempt
  }
' "$REPORT_FILE" >"$REPORT_TEMP" || {
  rm -f "$REPORT_TEMP"
  die 'Không thể cập nhật deployment report.'
}
chmod 600 "$REPORT_TEMP"
mv "$REPORT_TEMP" "$REPORT_FILE"
rm -f "$POINTER_FILE"
log "SUCCESS: external verification attestation đã được xác thực cho $RELEASE_SHA."
log "Deployment report: $REPORT_FILE"
