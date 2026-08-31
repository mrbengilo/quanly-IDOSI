#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

fail() {
  printf '[release-workflow-test] FAIL: %s\n' "$*" >&2
  exit 1
}

assert_before() {
  local file="$1"
  local first_pattern="$2"
  local second_pattern="$3"
  local first_line second_line
  first_line="$(grep -nF "$first_pattern" "$file" | head -n 1)"
  second_line="$(grep -nF "$second_pattern" "$file" | head -n 1)"
  first_line="${first_line%%:*}"
  second_line="${second_line%%:*}"
  [[ "$first_line" =~ ^[0-9]+$ && "$second_line" =~ ^[0-9]+$ && "$first_line" -lt "$second_line" ]] \
    || fail "expected '$first_pattern' before '$second_pattern' in $file"
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

cat >"$FAKE_BIN/docker" <<'DOCKER'
#!/usr/bin/env bash
if [[ "$*" == 'compose version' ]]; then
  exit 0
fi
[[ "$*" == compose\ -f\ compose.yml\ exec\ -T\ app\ node\ server/vps/verify-public-release.mjs\ * ]] || exit 2
[[ "${FAKE_DOCKER_FAIL:-0}" == '0' ]] || exit 1
[[ "${!#}" == "${FAKE_RELEASE_SHA:?}" ]] || exit 3
DOCKER
chmod +x "$FAKE_BIN/docker"

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
if PATH="$FAKE_BIN:$PATH" FAKE_RELEASE_SHA="$SHA" FAKE_DOCKER_FAIL=1 IDOSI_ROOT="$FINALIZE_ROOT" IDOSI_BACKUP_DIR="$BACKUP_DIR" \
  IDOSI_DEPLOY_LOCK="$TEMP_ROOT/finalize-fail.lock" \
  "$SCRIPT_DIR/finalize-release.sh" "$SHA" >/dev/null 2>&1; then
  fail 'finalizer unexpectedly passed failed external verification'
fi
[[ "$(report_value STATUS "$FAILED_REPORT")" == 'LOCAL_READY' ]] || fail 'failed finalization changed report status'
[[ -f "$POINTER_FILE" ]] || fail 'failed finalization removed pending pointer'

DEPLOY_CUTOVER_BLOCK="$TEMP_ROOT/deploy-cutover-block.sh"
sed -n "/log 'Dừng Caddy và app trong cửa sổ bảo trì ngắn để backup SQLite nhất quán.'/,\$p" \
  "$SCRIPT_DIR/deploy-release.sh" >"$DEPLOY_CUTOVER_BLOCK"
assert_before "$DEPLOY_CUTOVER_BLOCK" \
  'ROLLBACK_REQUIRED=1' \
  'compose stop -t 30 caddy app'
assert_before "$DEPLOY_CUTOVER_BLOCK" \
  'compose stop -t 30 caddy app' \
  "assert_stack_stopped || die 'Không chứng minh được app/Caddy đã dừng trước backup nhất quán.'"
ROLLBACK_CUTOVER_BLOCK="$TEMP_ROOT/rollback-cutover-block.sh"
sed -n "/log 'Dừng traffic và tạo emergency backup trước rollback.'/,\$p" \
  "$SCRIPT_DIR/rollback-release.sh" >"$ROLLBACK_CUTOVER_BLOCK"
assert_before "$ROLLBACK_CUTOVER_BLOCK" \
  'ROLLBACK_STARTED=1' \
  'compose stop -t 30 caddy app'
assert_before "$ROLLBACK_CUTOVER_BLOCK" \
  'compose stop -t 30 caddy app' \
  "assert_stack_stopped || die 'Không chứng minh được app/Caddy đã dừng trước emergency backup.'"
assert_before "$SCRIPT_DIR/deploy-release.sh" \
  'checkout --detach "$PREVIOUS_GIT_SHA"' \
  'start_caddy_for_release "$PREVIOUS_IMAGE_TAG"'
TARGET_ROLLBACK_BLOCK="$TEMP_ROOT/target-rollback-block.sh"
sed -n '/export IDOSI_IMAGE="\$TARGET_IMAGE_TAG"/,$p' "$SCRIPT_DIR/rollback-release.sh" >"$TARGET_ROLLBACK_BLOCK"
assert_before "$TARGET_ROLLBACK_BLOCK" \
  'checkout --detach "$TARGET_GIT_SHA"' \
  'compose up -d --no-build app'
grep -Fq 'verify-public-release.mjs' "$SCRIPT_DIR/../../.github/workflows/deploy-vps.yml" \
  || fail 'production workflow does not verify public static assets'
grep -Fq 'Destination "/srv/idosi"' "$SCRIPT_DIR/deploy-release.sh" \
  || fail 'deploy script does not verify the Caddy static volume mount'
grep -Fq "org.opencontainers.image.revision" "$SCRIPT_DIR/rollback-release.sh" \
  || fail 'rollback script does not verify exact OCI image revision'
grep -Fq "actual_image_id" "$SCRIPT_DIR/deploy-release.sh" \
  || fail 'deploy script does not verify the running app image ID'
grep -Fq 'validate_caddy_static_mount "$container_id" "$image" "$release_sha" "$allow_legacy" || return 1' \
  "$SCRIPT_DIR/deploy-release.sh" \
  || fail 'deploy script can mask a failed Caddy topology validation'
grep -Fq 'compose create --force-recreate caddy || return 1' \
  "$SCRIPT_DIR/deploy-release.sh" \
  || fail 'deploy script does not recreate Caddy with Compose-compatible flags'
grep -Fq 'compose create --force-recreate caddy || return 1' \
  "$SCRIPT_DIR/rollback-release.sh" \
  || fail 'rollback script does not recreate Caddy with Compose-compatible flags'
if grep -Fq 'compose create --force-recreate --no-deps caddy' \
  "$SCRIPT_DIR/deploy-release.sh" "$SCRIPT_DIR/rollback-release.sh"; then
  fail 'Caddy recreation uses --no-deps, which docker compose create does not support'
fi
grep -Fq 'verify_static_volume "$image" "$release_sha" || return 1' \
  "$SCRIPT_DIR/rollback-release.sh" \
  || fail 'rollback script can mask a failed static volume validation'
grep -Fq "Caddy container không duy trì trạng thái running sau khi start." \
  "$SCRIPT_DIR/rollback-release.sh" \
  || fail 'rollback script does not verify Caddy remains running'

printf '[release-workflow-test] PASS\n'
