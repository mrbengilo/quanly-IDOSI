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

RELEASE_SHA="${1:-}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Release SHA phải gồm đúng 40 ký tự hex viết thường.'

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_DIR="$IDOSI_ROOT/deploy/vps"
BACKUP_DIR="${IDOSI_BACKUP_DIR:-$COMPOSE_DIR/backups}"
LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"
POINTER_FILE="$BACKUP_DIR/pending-$RELEASE_SHA.report"

for command_name in flock sed head awk date mktemp mv chmod rm curl; do
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

[[ "$REPORT_RELEASE_SHA" == "$RELEASE_SHA" ]] || die 'Release SHA trong report không khớp.'
[[ "$PUBLIC_TRAFFIC_RESUMED" == '1' ]] || die 'Report chưa xác nhận public traffic đã mở.'
[[ "$PUBLIC_URL" == https://* ]] || die 'PUBLIC_URL trong report không hợp lệ.'

if [[ "$STATUS" == 'SUCCESS' ]]; then
  rm -f "$POINTER_FILE"
  log "Release $RELEASE_SHA đã được finalize trước đó."
  exit 0
fi
[[ "$STATUS" == 'LOCAL_READY' ]] || die "Chỉ finalize report có STATUS=LOCAL_READY, hiện tại là $STATUS."

PUBLIC_ORIGIN="${PUBLIC_URL%/}"
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$PUBLIC_ORIGIN/api/health" >/dev/null
PUBLIC_RELEASE="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  "$PUBLIC_ORIGIN/api/release")"
[[ "$PUBLIC_RELEASE" == *"\"releaseSha\":\"$RELEASE_SHA\""* ]] \
  || die 'Public release endpoint không xác nhận đúng release SHA.'
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$PUBLIC_ORIGIN/" >/dev/null

VERIFIED_AT="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_TEMP="$(mktemp "$BACKUP_DIR/.finalized-report.XXXXXX")"
awk -v verified_at="$VERIFIED_AT" '
  BEGIN { seen_status = 0; seen_verified = 0 }
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
  { print }
  END {
    if (!seen_status) exit 42
    if (!seen_verified) print "EXTERNAL_VERIFIED_AT_UTC=" verified_at
  }
' "$REPORT_FILE" >"$REPORT_TEMP" || {
  rm -f "$REPORT_TEMP"
  die 'Không thể cập nhật deployment report.'
}
chmod 600 "$REPORT_TEMP"
mv "$REPORT_TEMP" "$REPORT_FILE"
rm -f "$POINTER_FILE"
log "SUCCESS: external verification đã PASS cho $RELEASE_SHA."
log "Deployment report: $REPORT_FILE"
