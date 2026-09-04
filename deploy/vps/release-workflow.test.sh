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
mkdir -p "$BACKUP_DIR"
VERIFIED_AT="$(date -u +%Y%m%dT%H%M%SZ)"
VERIFIED_ORIGIN='https://idosi.example'
VERIFY_RUN_ID='123456789'
VERIFY_RUN_ATTEMPT='1'

assert_finalization_rejected() {
  local case_name="$1"
  local deployed_at="$2"
  local verified_at="$3"
  local verified_origin="$4"
  local verified_sha="$5"
  local report_file="$BACKUP_DIR/deploy-$case_name-${SHA:0:12}.env"

  cat >"$report_file" <<REPORT
STATUS=LOCAL_READY
RELEASE_SHA=$SHA
PUBLIC_TRAFFIC_RESUMED=1
PUBLIC_URL=$VERIFIED_ORIGIN
DEPLOYED_AT_UTC=$deployed_at
EXTERNAL_VERIFIED_AT_UTC=
REPORT
  printf '%s\n' "$report_file" >"$POINTER_FILE"
  if IDOSI_ROOT="$FINALIZE_ROOT" IDOSI_BACKUP_DIR="$BACKUP_DIR" \
    IDOSI_DEPLOY_LOCK="$TEMP_ROOT/finalize-$case_name.lock" \
    "$SCRIPT_DIR/finalize-release.sh" \
      "$SHA" "$verified_at" "$verified_origin" "$VERIFY_RUN_ID" "$VERIFY_RUN_ATTEMPT" \
      "$verified_sha" >/dev/null 2>&1; then
    fail "finalizer unexpectedly passed rejected attestation case: $case_name"
  fi
  [[ "$(report_value STATUS "$report_file")" == 'LOCAL_READY' ]] \
    || fail "$case_name changed report status"
  [[ -f "$POINTER_FILE" ]] || fail "$case_name removed pending pointer"
}

REPORT_FILE="$BACKUP_DIR/deploy-test-${SHA:0:12}.env"
POINTER_FILE="$BACKUP_DIR/pending-$SHA.report"
cat >"$REPORT_FILE" <<REPORT
STATUS=LOCAL_READY
RELEASE_SHA=$SHA
PUBLIC_TRAFFIC_RESUMED=1
PUBLIC_URL=https://idosi.example
DEPLOYED_AT_UTC=$VERIFIED_AT
EXTERNAL_VERIFIED_AT_UTC=
REPORT
printf '%s\n' "$REPORT_FILE" >"$POINTER_FILE"

IDOSI_ROOT="$FINALIZE_ROOT" IDOSI_BACKUP_DIR="$BACKUP_DIR" \
  IDOSI_DEPLOY_LOCK="$TEMP_ROOT/finalize.lock" \
  "$SCRIPT_DIR/finalize-release.sh" \
    "$SHA" "$VERIFIED_AT" "$VERIFIED_ORIGIN" "$VERIFY_RUN_ID" "$VERIFY_RUN_ATTEMPT" "$SHA" >/dev/null
[[ "$(report_value STATUS "$REPORT_FILE")" == 'SUCCESS' ]] || fail 'finalizer did not mark SUCCESS'
[[ "$(report_value EXTERNAL_VERIFIED_AT_UTC "$REPORT_FILE")" == "$VERIFIED_AT" ]] \
  || fail 'finalizer did not persist the external verification attestation'
[[ "$(report_value EXTERNAL_VERIFIED_ORIGIN "$REPORT_FILE")" == "$VERIFIED_ORIGIN" ]] \
  || fail 'finalizer did not persist the externally verified origin'
[[ "$(report_value EXTERNAL_VERIFIED_SHA "$REPORT_FILE")" == "$SHA" ]] \
  || fail 'finalizer did not persist the externally verified release SHA'
[[ "$(report_value EXTERNAL_VERIFY_RUN_ID "$REPORT_FILE")" == "$VERIFY_RUN_ID" ]] \
  || fail 'finalizer did not persist the external verification run ID'
[[ "$(report_value EXTERNAL_VERIFY_RUN_ATTEMPT "$REPORT_FILE")" == "$VERIFY_RUN_ATTEMPT" ]] \
  || fail 'finalizer did not persist the external verification run attempt'
[[ ! -e "$POINTER_FILE" ]] || fail 'finalizer pointer was not removed'

MISSING_ATTESTATION_REPORT="$BACKUP_DIR/deploy-missing-attestation-${SHA:0:12}.env"
cat >"$MISSING_ATTESTATION_REPORT" <<REPORT
STATUS=LOCAL_READY
RELEASE_SHA=$SHA
PUBLIC_TRAFFIC_RESUMED=1
PUBLIC_URL=https://idosi.example
DEPLOYED_AT_UTC=$VERIFIED_AT
EXTERNAL_VERIFIED_AT_UTC=
REPORT
printf '%s\n' "$MISSING_ATTESTATION_REPORT" >"$POINTER_FILE"
if IDOSI_ROOT="$FINALIZE_ROOT" IDOSI_BACKUP_DIR="$BACKUP_DIR" \
  IDOSI_DEPLOY_LOCK="$TEMP_ROOT/finalize-missing-attestation.lock" \
  "$SCRIPT_DIR/finalize-release.sh" "$SHA" >/dev/null 2>&1; then
  fail 'finalizer unexpectedly passed without external verification attestation'
fi
[[ "$(report_value STATUS "$MISSING_ATTESTATION_REPORT")" == 'LOCAL_READY' ]] \
  || fail 'missing attestation changed report status'
[[ -f "$POINTER_FILE" ]] || fail 'missing attestation removed pending pointer'

assert_finalization_rejected \
  'origin-mismatch' "$VERIFIED_AT" "$VERIFIED_AT" 'https://wrong.example' "$SHA"
assert_finalization_rejected \
  'sha-mismatch' "$VERIFIED_AT" "$VERIFIED_AT" "$VERIFIED_ORIGIN" \
  '1123456789abcdef0123456789abcdef01234567'

STALE_DEPLOYED_AT="$(date -u -d '32 minutes ago' +%Y%m%dT%H%M%SZ)"
STALE_VERIFIED_AT="$(date -u -d '31 minutes ago' +%Y%m%dT%H%M%SZ)"
assert_finalization_rejected \
  'stale' "$STALE_DEPLOYED_AT" "$STALE_VERIFIED_AT" "$VERIFIED_ORIGIN" "$SHA"

FUTURE_VERIFIED_AT="$(date -u -d '+3 minutes' +%Y%m%dT%H%M%SZ)"
assert_finalization_rejected \
  'future' "$VERIFIED_AT" "$FUTURE_VERIFIED_AT" "$VERIFIED_ORIGIN" "$SHA"

BEFORE_DEPLOYED_AT="$(date -u -d '1 minute ago' +%Y%m%dT%H%M%SZ)"
assert_finalization_rejected \
  'before-deployment' "$VERIFIED_AT" "$BEFORE_DEPLOYED_AT" "$VERIFIED_ORIGIN" "$SHA"

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
grep -Fq 'attempt % 20 == 0' "$SCRIPT_DIR/../../.github/workflows/deploy-vps.yml" \
  || fail 'production workflow does not emit periodic durable deployment logs'
grep -Fq 'IDOSI_BUILD_TIMEOUT_SECONDS:-900' "$SCRIPT_DIR/deploy-release.sh" \
  || fail 'production image build has no bounded timeout'
grep -Fq 'timeout --foreground --signal=TERM --kill-after=30s' "$SCRIPT_DIR/deploy-release.sh" \
  || fail 'production image build timeout cannot terminate a stalled build client'
grep -Fq 'BUILDKIT_PROGRESS=plain' "$SCRIPT_DIR/deploy-release.sh" \
  || fail 'production image build does not emit inspectable plain progress'
grep -Fq 'id=idosi-npm-cache,target=/root/.npm,sharing=locked' "$SCRIPT_DIR/Dockerfile" \
  || fail 'production image build does not persist a concurrency-safe npm download cache'
grep -Fq 'npm ci --prefer-offline --no-audit --no-fund' "$SCRIPT_DIR/Dockerfile" \
  || fail 'production image build does not prefer the persistent npm download cache'
grep -Fq -- '--fetch-retries=2' "$SCRIPT_DIR/Dockerfile" \
  || fail 'production npm install does not bound registry retries'
grep -Fq -- '--fetch-timeout=120000' "$SCRIPT_DIR/Dockerfile" \
  || fail 'production npm install has no bounded fetch timeout'
grep -Fq 'ENV NODE_OPTIONS=--dns-result-order=ipv4first' "$SCRIPT_DIR/Dockerfile" \
  || fail 'production build does not prefer reachable IPv4 registry endpoints'
grep -Fq 'network: host' "$SCRIPT_DIR/compose.yml" \
  || fail 'production build does not use the verified VPS host network path'
grep -Fq 'attempt<=PUBLIC_VERIFY_ATTEMPTS' "$SCRIPT_DIR/../../.github/workflows/deploy-vps.yml" \
  || fail 'production workflow does not retry public verification during bounded cutover convergence'
grep -Fq 'sleep "$PUBLIC_VERIFY_DELAY_SECONDS"' "$SCRIPT_DIR/../../.github/workflows/deploy-vps.yml" \
  || fail 'production workflow public verification retry has no bounded delay'
grep -Fq 'steps.external_verification.outputs.verified_at' "$SCRIPT_DIR/../../.github/workflows/deploy-vps.yml" \
  || fail 'production workflow does not pass an external verification attestation to the finalizer'
grep -Fq 'steps.external_verification.outputs.verified_origin' "$SCRIPT_DIR/../../.github/workflows/deploy-vps.yml" \
  || fail 'production workflow does not pass the externally verified origin to the finalizer'
grep -Fq 'steps.external_verification.outputs.verified_sha' "$SCRIPT_DIR/../../.github/workflows/deploy-vps.yml" \
  || fail 'production workflow does not bind the external verification attestation to the release SHA'
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
grep -Fq 'CADDY_CONTAINER_ID="$(compose ps -q --all caddy)"' \
  "$SCRIPT_DIR/deploy-release.sh" \
  || fail 'deploy script cannot recover when the existing Caddy container is stopped'
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
