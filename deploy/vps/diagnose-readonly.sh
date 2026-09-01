#!/usr/bin/env bash
set -Eeuo pipefail

export LC_ALL=C

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_FILE="${IDOSI_COMPOSE_FILE:-$IDOSI_ROOT/deploy/vps/compose.yml}"
LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"
PUBLIC_ORIGIN="${IDOSI_PUBLIC_ORIGIN:-https://idosi.io.vn}"

for command_name in docker curl flock awk sed grep date free vmstat df ss getent; do
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

measure_http() {
  local label="$1"
  local url="$2"
  shift 2
  local output=''
  local exit_code=0
  output="$(curl -sS --max-time 35 "$@" -o /dev/null \
    -w "label=$label code=%{http_code} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download}" \
    "$url")" || exit_code=$?
  printf '%s curl_exit=%s\n' "$output" "$exit_code"
}

section 'identity'
printf 'checked_at=%s\n' "$(TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%dT%H:%M:%S%z')"
printf 'kernel=%s\n' "$(uname -srvmo)"
printf 'vcpus=%s\n' "$(getconf _NPROCESSORS_ONLN)"
printf 'cpu_model=%s\n' "$(awk -F: '/model name/ { sub(/^[[:space:]]+/, "", $2); print $2; exit }' /proc/cpuinfo)"
printf 'loadavg=%s\n' "$(tr ' ' ',' </proc/loadavg)"

section 'memory_and_disk'
free -h
df -hT / "$IDOSI_ROOT" | awk 'NR == 1 || !seen[$1]++'

section 'cpu_io_samples'
vmstat 1 5

section 'network_summary'
ss -s
awk 'NR > 2 {
  rx_bytes += $2; rx_errors += $4; rx_drops += $5;
  tx_bytes += $10; tx_errors += $12; tx_drops += $13
} END {
  printf "rx_bytes=%d rx_errors=%d rx_drops=%d tx_bytes=%d tx_errors=%d tx_drops=%d\n",
    rx_bytes, rx_errors, rx_drops, tx_bytes, tx_errors, tx_drops
}' /proc/net/dev
printf 'listening_ports='
ss -lntH | awk '{ count=split($4, parts, ":"); port=parts[count]; if (port == "80" || port == "443" || port == "3000") print port }' \
  | sort -nu | paste -sd, -
if ping_output="$(ping -q -c 3 -W 2 idosi.io.vn 2>/dev/null | tail -n 2)"; then
  printf 'public_ping=%s\n' "$(tr '\n' ';' <<<"$ping_output")"
else
  printf 'public_ping=unavailable_or_blocked\n'
fi

section 'dns_and_proxy'
dns_v4="$(getent ahostsv4 idosi.io.vn | awk '{ print $1 }' | sort -u || true)"
dns_v6="$(getent ahostsv6 idosi.io.vn | awk '{ print $1 }' | sort -u || true)"
printf 'dns_ipv4_count=%s\n' "$(grep -c . <<<"$dns_v4" || true)"
printf 'dns_ipv6_count=%s\n' "$(grep -c . <<<"$dns_v6" || true)"
direct_origin=false
local_ips=" $(hostname -I 2>/dev/null || true) "
while IFS= read -r address; do
  [[ -n "$address" ]] || continue
  if [[ "$local_ips" == *" $address "* ]]; then
    direct_origin=true
  fi
done <<<"$dns_v4"
printf 'dns_points_to_local_interface=%s\n' "$direct_origin"
public_headers="$(curl -sS -I --max-time 35 "$PUBLIC_ORIGIN/" 2>/dev/null || true)"
for header_name in server via cf-ray x-cache x-served-by alt-svc; do
  header_value="$(grep -i "^$header_name:" <<<"$public_headers" | head -n 1 | tr -d '\r' || true)"
  if [[ -n "$header_value" ]]; then
    printf 'proxy_header_%s=%s\n' "$header_name" "${header_value#*: }"
  fi
done

section 'firewall_summary'
if command -v ufw >/dev/null 2>&1; then
  ufw_status="$(sudo -n ufw status 2>/dev/null | head -n 1 || ufw status 2>/dev/null | head -n 1 || true)"
  printf 'ufw=%s\n' "${ufw_status:-unavailable}"
else
  printf 'ufw=not_installed\n'
fi
if command -v nft >/dev/null 2>&1; then
  nft_lines="$(sudo -n nft list ruleset 2>/dev/null | wc -l || true)"
  printf 'nft_ruleset_lines=%s\n' "${nft_lines:-unavailable}"
else
  printf 'nft=not_installed\n'
fi
if command -v iptables >/dev/null 2>&1; then
  iptables_rules="$(sudo -n iptables -S 2>/dev/null | wc -l || true)"
  printf 'iptables_rule_count=%s\n' "${iptables_rules:-unavailable}"
else
  printf 'iptables=not_installed\n'
fi

section 'container_state'
compose ps
for service in app caddy; do
  container_id="$(compose ps -q --all "$service")"
  if [[ -z "$container_id" ]]; then
    printf 'service=%s container=missing\n' "$service"
    continue
  fi
  docker inspect --format \
    "service=$service status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}} started={{.State.StartedAt}}" \
    "$container_id"
done
mapfile -t container_ids < <(compose ps -q --all)
if (( ${#container_ids[@]} > 0 )); then
  docker stats --no-stream --format \
    'container={{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}} memory_percent={{.MemPerc}} net_io={{.NetIO}} block_io={{.BlockIO}} pids={{.PIDs}}' \
    "${container_ids[@]}"
fi

section 'app_loopback_measurements'
compose exec -T app node <<'NODE'
const routes = ['/api/health', '/api/release']
for (let round = 1; round <= 3; round += 1) {
  for (const route of routes) {
    const started = performance.now()
    try {
      const response = await fetch(`http://127.0.0.1:3000${route}`)
      const body = await response.json()
      const totalMs = performance.now() - started
      const healthOk = route === '/api/health' ? body?.ok === true : undefined
      const releaseSha = route === '/api/release' ? body?.data?.releaseSha || '' : ''
      console.log(`round=${round} route=${route} code=${response.status} total_ms=${totalMs.toFixed(3)} health_ok=${healthOk ?? ''} release_sha=${releaseSha}`)
    } catch (error) {
      const totalMs = performance.now() - started
      console.log(`round=${round} route=${route} code=ERROR total_ms=${totalMs.toFixed(3)} error=${error?.name || 'unknown'}`)
    }
  }
}
NODE

section 'caddy_loopback_measurements'
for round in 1 2 3; do
  for route in / /api/health /api/release; do
    measure_http "local_caddy_round_${round}_${route//\//_}" "$PUBLIC_ORIGIN$route" \
      --resolve 'idosi.io.vn:443:127.0.0.1'
  done
done

section 'public_from_vps_measurements'
for round in 1 2 3; do
  for route in / /api/health /api/release; do
    measure_http "public_round_${round}_${route//\//_}" "$PUBLIC_ORIGIN$route"
  done
done

section 'caddy_tls_and_logs'
compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null
if cert_summary="$(timeout 10 openssl s_client -connect 127.0.0.1:443 -servername idosi.io.vn </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -issuer -subject 2>/dev/null)"; then
  printf '%s\n' "$cert_summary"
else
  printf 'certificate_probe=failed\n'
fi
caddy_logs="$(compose logs --no-color --since=60m --tail=1000 caddy 2>&1 || true)"
for pattern in error tls handshake timeout refused reset unreachable certificate ocsp; do
  printf 'caddy_log_%s_count=%s\n' "$pattern" "$(grep -Eic "$pattern" <<<"$caddy_logs" || true)"
done

section 'payroll_collision_summary'
compose exec -T app node <<'NODE'
import { DatabaseSync } from 'node:sqlite'

const database = new DatabaseSync(process.env.IDOSI_DB_PATH || '/app/data/idosi.sqlite', {
  readOnly: true,
})
const collection = (key) => database.prepare(`
  SELECT value_json
  FROM state_entities
  WHERE scope_key = 'global' AND collection_key = ?
  ORDER BY entity_order, entity_key
`).all(key).map((row) => JSON.parse(row.value_json))
const folded = (value) => String(value ?? '').trim().toLocaleLowerCase('en-US')
const active = (record) => record && !record.deletedAt
const identifiers = (record = {}) => [
  record.id,
  record.code,
  record.employeeId,
  record.employeeCode,
].map((value) => String(value ?? '').trim()).filter(Boolean)
const collisionSummary = (records, keysOf) => {
  const ownersByKey = new Map()
  records.forEach((record, index) => {
    const keys = new Set(keysOf(record).map(folded).filter(Boolean))
    for (const key of keys) {
      if (!ownersByKey.has(key)) ownersByKey.set(key, new Set())
      ownersByKey.get(key).add(index)
    }
  })
  const groups = [...ownersByKey.values()].filter((owners) => owners.size > 1)
  return { groups: groups.length, records: new Set(groups.flatMap((owners) => [...owners])).size }
}
const scopedCollisionSummary = (records, scopeOf, keysOf) => collisionSummary(
  records,
  (record) => keysOf(record).map((key) => `${folded(scopeOf(record))}\u0000${folded(key)}`),
)
const uniqueMatch = (records, reference, valuesOf = identifiers) => {
  const requested = String(reference ?? '').trim()
  if (!requested) return { record: null, ambiguous: false }
  const matches = records.filter((record) => valuesOf(record).some((value) => folded(value) === folded(requested)))
  const exact = matches.filter((record) => valuesOf(record).map((value) => String(value ?? '').trim()).includes(requested))
  if (exact.length === 1) return { record: exact[0], ambiguous: false }
  if (exact.length > 1 || matches.length > 1) return { record: null, ambiguous: true }
  return { record: matches[0] || null, ambiguous: false }
}

const stores = collection('stores').filter(active)
const employees = collection('employees').filter(active)
const attendance = collection('attendance').filter(active)
const supportTransfers = collection('supportTransfers')
const payrollPeriods = collection('payrollPeriods').filter((record) => record && !record.supersededAt)
const salaryConfigs = collection('storeEmployeeSalaryConfigs')
  .filter((record) => active(record) && record.active !== false && record.isActive !== false)

const storeCollisions = collisionSummary(stores, (store) => [store.id])
const employeeCollisions = scopedCollisionSummary(
  employees,
  (employee) => employee.storeId,
  identifiers,
)
const payrollPeriodCollisions = collisionSummary(
  payrollPeriods,
  (record) => [`${folded(record.storeId)}\u0000${String(record.period || '').trim()}`],
)
const salaryConfigCollisions = collisionSummary(
  salaryConfigs,
  (record) => [
    `${folded(record.storeId)}\u0000${folded(record.employeeId)}\u0000${String(record.effectiveFrom || '').trim()}`,
  ],
)
const payrollRowCollisions = payrollPeriods.reduce((summary, period) => {
  const rows = Array.isArray(period.rows) ? period.rows : []
  const collisions = collisionSummary(rows, (row) => [row.employeeId, row.employeeCode])
  summary.groups += collisions.groups
  summary.records += collisions.records
  return summary
}, { groups: 0, records: 0 })

let attendanceMissingEmployee = 0
let attendanceAmbiguousEmployee = 0
let attendanceEmployeeOutOfStoreLinkedSupport = 0
let attendanceEmployeeOutOfStoreUnlinked = 0
const attendanceAffectedStores = new Set()
const attendanceUnlinkedByMonth = new Map()
const attendanceSupportLink = (record, employee) => {
  const canonical = record.supportCompensation || record.compensation?.support || {}
  const transferId = canonical.transferId || record.supportTransferId || record.transferId || ''
  const transferIdMatch = transferId
    ? uniqueMatch(supportTransfers, transferId, (transfer) => [transfer.id])
    : { record: null, ambiguous: false }
  const employeeReference = String(record.employeeId || record.employeeCode || '').trim()
  const storeReference = String(record.storeId || '').trim()
  const transferScopeReference = `${employeeReference}\u0000${storeReference}`
  const transferScopeMatch = !transferId && employeeReference && storeReference
    ? uniqueMatch(
        supportTransfers,
        transferScopeReference,
        (transfer) => [`${String(transfer.employeeId || transfer.employeeCode || '').trim()}\u0000${String(transfer.toStoreId || '').trim()}`],
      )
    : { record: null, ambiguous: false }
  if (transferIdMatch.ambiguous || transferScopeMatch.ambiguous) return false
  const transfer = transferIdMatch.record || transferScopeMatch.record
  const homeStoreId = canonical.homeStoreId || record.homeStoreId || transfer?.fromStoreId || employee.storeId || ''
  const supportStoreId = canonical.supportStoreId || record.supportStoreId || transfer?.toStoreId || record.storeId || ''
  return Boolean(transferId || canonical.supportStoreId || record.supportStoreId)
    || Boolean(homeStoreId && supportStoreId && folded(homeStoreId) !== folded(supportStoreId) && transfer)
}
for (const record of attendance) {
  const reference = record.employeeId || record.employeeCode
  const match = uniqueMatch(employees, reference)
  if (match.ambiguous) attendanceAmbiguousEmployee += 1
  else if (!match.record) attendanceMissingEmployee += 1
  else if (folded(match.record.storeId) !== folded(record.storeId)) {
    if (attendanceSupportLink(record, match.record)) attendanceEmployeeOutOfStoreLinkedSupport += 1
    else {
      attendanceEmployeeOutOfStoreUnlinked += 1
      const month = String(record.date || record.workDate || record.checkInAt || record.createdAt || '').slice(0, 7) || 'unknown'
      attendanceUnlinkedByMonth.set(month, (attendanceUnlinkedByMonth.get(month) || 0) + 1)
    }
  }
  else continue
  attendanceAffectedStores.add(folded(record.storeId))
}

const summary = {
  stores: stores.length,
  employees: employees.length,
  attendance: attendance.length,
  payroll_periods: payrollPeriods.length,
  salary_configs: salaryConfigs.length,
  support_transfers: supportTransfers.length,
  store_identifier_collision_groups: storeCollisions.groups,
  store_identifier_collision_records: storeCollisions.records,
  employee_identifier_collision_groups: employeeCollisions.groups,
  employee_identifier_collision_records: employeeCollisions.records,
  payroll_period_collision_groups: payrollPeriodCollisions.groups,
  payroll_period_collision_records: payrollPeriodCollisions.records,
  salary_config_collision_groups: salaryConfigCollisions.groups,
  salary_config_collision_records: salaryConfigCollisions.records,
  payroll_row_collision_groups: payrollRowCollisions.groups,
  payroll_row_collision_records: payrollRowCollisions.records,
  attendance_missing_employee: attendanceMissingEmployee,
  attendance_ambiguous_employee: attendanceAmbiguousEmployee,
  attendance_employee_out_of_store_linked_support: attendanceEmployeeOutOfStoreLinkedSupport,
  attendance_employee_out_of_store_unlinked: attendanceEmployeeOutOfStoreUnlinked,
  attendance_affected_store_count: attendanceAffectedStores.size,
}
for (const [key, value] of Object.entries(summary)) console.log(`${key}=${value}`)
console.log(`attendance_unlinked_by_month=${JSON.stringify(Object.fromEntries([...attendanceUnlinkedByMonth].sort()))}`)
database.close()
NODE

section 'diagnostic_complete'
printf 'mutations=none rollback=not_run deploy=not_run\n'
