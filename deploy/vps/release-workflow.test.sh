#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

fail() {
  printf '[release-workflow-test] FAIL: %s\n' "$*" >&2
  exit 1
}

report_value() {
  local key="$1"
  local file="$2"
  sed -n "s/^${key}=//p" "$file" | head -n 1
}

wait_for_job() {
  local status_file="$1"
  local attempt
  for attempt in $(seq 1 100); do
    if [[ -f "$status_file" ]] && [[ "$(report_value STATE "$status_file")" == 'COMPLETED' ]]; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

SHA='0123456789abcdef0123456789abcdef01234567'
JOB_ROOT="$TEMP_ROOT/job-root"
JOB_DIR="$JOB_ROOT/deploy/vps/backups/jobs"
mkdir -p "$JOB_DIR"

cat >"$TEMP_ROOT/deploy-success.sh" <<'SUCCESS'
#!/usr/bin/env bash
printf 'dummy deploy success for %s\n' "$1"
exit 0
SUCCESS
chmod +x "$TEMP_ROOT/deploy-success.sh"

IDOSI_ROOT="$JOB_ROOT" IDOSI_DEPLOY_JOB_DIR="$JOB_DIR" \
  "$SCRIPT_DIR/run-release-job.sh" "$SHA" success-job "$TEMP_ROOT/deploy-success.sh" >/dev/null
SUCCESS_STATUS="$JOB_DIR/success-job.status"
wait_for_job "$SUCCESS_STATUS" || fail 'durable success job did not complete'
[[ "$(report_value EXIT_CODE "$SUCCESS_STATUS")" == '0' ]] || fail 'durable success job exit code mismatch'
grep -q 'dummy deploy success' "$JOB_DIR/success-job.log" || fail 'durable success log missing'

cat >"$TEMP_ROOT/deploy-failure.sh" <<'FAILURE'
#!/usr/bin/env bash
printf 'dummy deploy failure for %s\n' "$1"
exit 7
FAILURE
chmod +x "$TEMP_ROOT/deploy-failure.sh"

IDOSI_ROOT="$JOB_ROOT" IDOSI_DEPLOY_JOB_DIR="$JOB_DIR" \
  "$SCRIPT_DIR/run-release-job.sh" "$SHA" failure-job "$TEMP_ROOT/deploy-failure.sh" >/dev/null
FAILURE_STATUS="$JOB_DIR/failure-job.status"
wait_for_job "$FAILURE_STATUS" || fail 'durable failure job did not complete'
[[ "$(report_value EXIT_CODE "$FAILURE_STATUS")" == '7' ]] || fail 'durable failure exit code mismatch'

FINALIZE_ROOT="$TEMP_ROOT/finalize-root"
BACKUP_DIR="$FINALIZE_ROOT/deploy/vps/backups"
FAKE_BIN="$TEMP_ROOT/fake-bin"
mkdir -p "$BACKUP_DIR" "$FAKE_BIN"

cat >"$FAKE_BIN/curl" <<'CURL'
#!/usr/bin/env bash
[[ "${FAKE_CURL_FAIL:-0}" == '0' ]] || exit 1
last_argument="${!#}"
if [[ "$last_argument" == */api/release ]]; then
  printf '{"data":{"releaseSha":"%s"}}\n' "${FAKE_RELEASE_SHA:?}"
fi
CURL
chmod +x "$FAKE_BIN/curl"

REPORT_FILE="$BACKUP_DIR/deploy-test-${SHA:0:12}.env"
POINTER_FILE="$BACKUP_DIR/pending-$SHA.report"
cat >"$REPORT_FILE" <<REPORT
STATUS=LOCAL_READY
RELEASE_SHA=$SHA
PUBLIC_TRAFFIC_RESUMED=1
PUBLIC_URL=https://idosi.example
EXTERNAL_VERIFIED_AT_UTC=
REPORT
printf '%s\n' "$REPORT_FILE" >"$POINTER_FILE"

PATH="$FAKE_BIN:$PATH" FAKE_RELEASE_SHA="$SHA" IDOSI_ROOT="$FINALIZE_ROOT" IDOSI_BACKUP_DIR="$BACKUP_DIR" \
  IDOSI_DEPLOY_LOCK="$TEMP_ROOT/finalize.lock" \
  "$SCRIPT_DIR/finalize-release.sh" "$SHA" >/dev/null
[[ "$(report_value STATUS "$REPORT_FILE")" == 'SUCCESS' ]] || fail 'finalizer did not mark SUCCESS'
[[ -n "$(report_value EXTERNAL_VERIFIED_AT_UTC "$REPORT_FILE")" ]] || fail 'finalizer timestamp missing'
[[ ! -e "$POINTER_FILE" ]] || fail 'finalizer pointer was not removed'

FAILED_REPORT="$BACKUP_DIR/deploy-failed-${SHA:0:12}.env"
cat >"$FAILED_REPORT" <<REPORT
STATUS=LOCAL_READY
RELEASE_SHA=$SHA
PUBLIC_TRAFFIC_RESUMED=1
PUBLIC_URL=https://idosi.example
EXTERNAL_VERIFIED_AT_UTC=
REPORT
printf '%s\n' "$FAILED_REPORT" >"$POINTER_FILE"
if PATH="$FAKE_BIN:$PATH" FAKE_RELEASE_SHA="$SHA" FAKE_CURL_FAIL=1 IDOSI_ROOT="$FINALIZE_ROOT" IDOSI_BACKUP_DIR="$BACKUP_DIR" \
  IDOSI_DEPLOY_LOCK="$TEMP_ROOT/finalize-fail.lock" \
  "$SCRIPT_DIR/finalize-release.sh" "$SHA" >/dev/null 2>&1; then
  fail 'finalizer unexpectedly passed failed external verification'
fi
[[ "$(report_value STATUS "$FAILED_REPORT")" == 'LOCAL_READY' ]] || fail 'failed finalization changed report status'
[[ -f "$POINTER_FILE" ]] || fail 'failed finalization removed pending pointer'

printf '[release-workflow-test] PASS\n'
