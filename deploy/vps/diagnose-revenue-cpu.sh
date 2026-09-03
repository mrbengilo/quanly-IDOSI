#!/usr/bin/env bash
set -Eeuo pipefail

export LC_ALL=C

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_FILE="${IDOSI_COMPOSE_FILE:-$IDOSI_ROOT/deploy/vps/compose.yml}"
LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"
PUBLIC_ORIGIN="${IDOSI_PUBLIC_ORIGIN:-https://idosi.io.vn}"

for command_name in docker curl flock date awk sed grep sort head ss; do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf 'ERROR missing_command=%s\n' "$command_name" >&2
    exit 1
  }
done

[[ -f "$COMPOSE_FILE" ]] || {
  printf 'ERROR compose_file_missing=true\n' >&2
  exit 1
}

exec 9>"$LOCK_FILE"
flock -n 9 || {
  printf 'ERROR production_deploy_or_rollback_active=true\n' >&2
  exit 1
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

section() {
  printf '\n### %s\n' "$1"
}

app_id="$(compose ps -q app)"
caddy_id="$(compose ps -q caddy)"
[[ -n "$app_id" ]] || {
  printf 'ERROR app_container_missing=true\n' >&2
  exit 1
}

section 'release_and_process_identity'
printf 'checked_at=%s\n' "$(TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%dT%H:%M:%S%z')"
printf 'app_container=%s\n' "$app_id"
printf 'caddy_container=%s\n' "${caddy_id:-missing}"
docker inspect --format 'app_image={{.Config.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}} started={{.State.StartedAt}}' "$app_id"
printf 'release_env=%s\n' "$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$app_id" | sed -n 's/^IDOSI_RELEASE_SHA=//p' | head -n 1)"
docker top "$app_id" -eo pid,ppid,pcpu,pmem,etime,nlwp,stat,args 2>/dev/null \
  || docker top "$app_id" aux

section 'container_cpu_samples'
for sample in $(seq 1 12); do
  printf 'sample=%s at=%s ' "$sample" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  docker stats --no-stream --format 'container={{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}} memory_percent={{.MemPerc}} net_io={{.NetIO}} pids={{.PIDs}}' "$app_id"
  sleep 1
done

section 'network_connections'
ss -s
printf 'app_established_connections=%s\n' "$(ss -ntH state established | grep -Ec '(:3000|:80|:443)([[:space:]]|$)' || true)"
printf 'https_established_connections=%s\n' "$(ss -ntH state established | grep -Ec ':443([[:space:]]|$)' || true)"

summarize_requests() {
  local window="$1"
  section "api_request_summary_${window}"
  docker logs --since "$window" "$app_id" 2>&1 \
    | docker exec -i -e DIAGNOSTIC_WINDOW="$window" "$app_id" node -e "$(cat <<'NODE'
const readline = require('node:readline')

const routes = new Map()
const minutes = new Map()
const releases = new Map()
const slowest = []
let requestCount = 0
let parseErrors = 0
let nonRequestLines = 0

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const percentile = (values, fraction) => {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of reader) {
  const start = line.indexOf('{')
  if (start < 0) {
    nonRequestLines += 1
    continue
  }
  let entry
  try {
    entry = JSON.parse(line.slice(start))
  } catch {
    parseErrors += 1
    continue
  }
  if (entry?.event !== 'idosi.api.request') {
    nonRequestLines += 1
    continue
  }

  requestCount += 1
  const path = String(entry.path || 'unknown')
  const duration = number(entry.durationMs)
  const handler = number(entry.timingMs?.handler)
  const databaseMs = number(entry.database?.totalMs)
  const statements = number(entry.database?.statements)
  const current = routes.get(path) || {
    count: 0,
    durationTotal: 0,
    handlerTotal: 0,
    databaseTotal: 0,
    statementsTotal: 0,
    maxDuration: 0,
    slow: 0,
    aborted: 0,
    durations: [],
    statuses: new Map(),
  }
  current.count += 1
  current.durationTotal += duration
  current.handlerTotal += handler
  current.databaseTotal += databaseMs
  current.statementsTotal += statements
  current.maxDuration = Math.max(current.maxDuration, duration)
  current.slow += entry.slow ? 1 : 0
  current.aborted += entry.aborted ? 1 : 0
  current.durations.push(duration)
  const status = String(entry.status || 'unknown')
  current.statuses.set(status, (current.statuses.get(status) || 0) + 1)
  routes.set(path, current)

  const minute = String(entry.timestamp || '').slice(0, 16)
  if (minute) minutes.set(minute, (minutes.get(minute) || 0) + 1)
  const release = String(entry.releaseSha || 'unknown')
  releases.set(release, (releases.get(release) || 0) + 1)

  slowest.push({
    timestamp: entry.timestamp,
    path,
    status,
    duration,
    handler,
    databaseMs,
    statements,
    slow: Boolean(entry.slow),
    aborted: Boolean(entry.aborted),
  })
}

const routeRows = [...routes.entries()].map(([path, value]) => ({
  path,
  ...value,
  p50: percentile(value.durations, 0.5),
  p95: percentile(value.durations, 0.95),
  p99: percentile(value.durations, 0.99),
})).sort((left, right) => (
  right.handlerTotal - left.handlerTotal
  || right.durationTotal - left.durationTotal
  || right.count - left.count
))

console.log(`window=${process.env.DIAGNOSTIC_WINDOW || ''} request_count=${requestCount} route_count=${routeRows.length} parse_errors=${parseErrors} non_request_lines=${nonRequestLines}`)
console.log(`release_distribution=${[...releases].map(([release, count]) => `${release}:${count}`).join(',') || 'none'}`)
for (const row of routeRows.slice(0, 40)) {
  const statuses = [...row.statuses].sort().map(([status, count]) => `${status}:${count}`).join(',')
  console.log([
    `route=${row.path}`,
    `count=${row.count}`,
    `status=${statuses || 'none'}`,
    `duration_total_ms=${row.durationTotal.toFixed(1)}`,
    `duration_avg_ms=${(row.durationTotal / row.count).toFixed(1)}`,
    `duration_p50_ms=${row.p50.toFixed(1)}`,
    `duration_p95_ms=${row.p95.toFixed(1)}`,
    `duration_p99_ms=${row.p99.toFixed(1)}`,
    `duration_max_ms=${row.maxDuration.toFixed(1)}`,
    `handler_total_ms=${row.handlerTotal.toFixed(1)}`,
    `handler_avg_ms=${(row.handlerTotal / row.count).toFixed(1)}`,
    `database_total_ms=${row.databaseTotal.toFixed(1)}`,
    `database_avg_ms=${(row.databaseTotal / row.count).toFixed(1)}`,
    `statements_total=${row.statementsTotal}`,
    `statements_avg=${(row.statementsTotal / row.count).toFixed(1)}`,
    `slow=${row.slow}`,
    `aborted=${row.aborted}`,
  ].join(' '))
}

console.log('request_count_by_minute:')
for (const [minute, count] of [...minutes].sort((left, right) => left[0].localeCompare(right[0])).slice(-60)) {
  console.log(`minute=${minute} count=${count}`)
}

console.log('slowest_requests:')
for (const row of slowest
  .sort((left, right) => right.duration - left.duration)
  .slice(0, 30)) {
  console.log([
    `timestamp=${row.timestamp || ''}`,
    `route=${row.path}`,
    `status=${row.status}`,
    `duration_ms=${row.duration.toFixed(1)}`,
    `handler_ms=${row.handler.toFixed(1)}`,
    `database_ms=${row.databaseMs.toFixed(1)}`,
    `statements=${row.statements}`,
    `slow=${row.slow}`,
    `aborted=${row.aborted}`,
  ].join(' '))
}
NODE
)"
}

summarize_requests '5m'
summarize_requests '30m'

section 'recent_health_latency'
for round in $(seq 1 6); do
  for route in /api/health /api/release; do
    curl -sS --max-time 20 -o /dev/null \
      -w "round=$round route=$route code=%{http_code} connect=%{time_connect} ttfb=%{time_starttransfer} total=%{time_total}\n" \
      "$PUBLIC_ORIGIN$route" || true
  done
done

section 'diagnostic_complete'
printf 'mutations=none deploy=not_run rollback=not_run\n'
