#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECOVERY_SCRIPT="$SCRIPT_DIR/recover-stale-release-job.sh"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

safe_log="$TEMP_DIR/safe.log"
printf '%s\n' \
  '[idosi-deploy] Pre-deploy checks cho abc' \
  '[idosi-deploy] Checkout đúng release SHA và build image bất biến theo SHA.' \
  '#12 RUN npm ci' >"$safe_log"
bash "$RECOVERY_SCRIPT" --validate-log "$safe_log" >/dev/null

if grep -Fq 'https://idosi.io.vn' "$RECOVERY_SCRIPT"; then
  printf 'Remote recovery must not depend on VPS hairpin access to the public hostname.\n' >&2
  exit 1
fi

normalized_timestamp="$(sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/\1-\2-\3T\4:\5:\6Z/' <<<'20260904T064300Z')"
[[ "$normalized_timestamp" == '2026-09-04T06:43:00Z' ]]

for unsafe_marker in \
  '[idosi-deploy] Dừng Caddy và app trong cửa sổ bảo trì ngắn để backup SQLite nhất quán.' \
  '[idosi-deploy] Backup thành công:' \
  '[idosi-deploy] Khởi động app mới;' \
  '[idosi-deploy] Khởi động Caddy sau khi app mới đã healthy.'
do
  unsafe_log="$TEMP_DIR/unsafe.log"
  cp "$safe_log" "$unsafe_log"
  printf '%s\n' "$unsafe_marker" >>"$unsafe_log"
  if bash "$RECOVERY_SCRIPT" --validate-log "$unsafe_log" >/dev/null 2>&1; then
    printf 'Unsafe marker unexpectedly passed: %s\n' "$unsafe_marker" >&2
    exit 1
  fi
done

missing_stage_log="$TEMP_DIR/missing-stage.log"
printf '%s\n' '[idosi-deploy] Pre-deploy checks cho abc' >"$missing_stage_log"
if bash "$RECOVERY_SCRIPT" --validate-log "$missing_stage_log" >/dev/null 2>&1; then
  printf 'Log without the build-stage marker unexpectedly passed.\n' >&2
  exit 1
fi

printf 'recover-stale-release-job tests passed\n'
