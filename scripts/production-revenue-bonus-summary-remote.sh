#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_FILE="${IDOSI_COMPOSE_FILE:-$ROOT/deploy/vps/compose.yml}"
LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"

exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'diagnostic_aborted=deployment_or_rollback_active'; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

app_id="$(compose ps -q app)"
[[ -n "$app_id" ]] || { echo 'app_container=missing'; exit 1; }

actual_sha="$(compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/release').then(r=>r.json()).then(v=>process.stdout.write(v.data?.releaseSha||v.releaseSha||''))")"
[[ "$actual_sha" == "$EXPECTED_RELEASE_SHA" ]] || {
  echo "release_mismatch expected=$EXPECTED_RELEASE_SHA actual=$actual_sha" >&2
  exit 1
}

compose exec -T -e AUDIT_END_DATE="$AUDIT_END_DATE" app node --input-type=module <<'NODE'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { revenueBonusEligibility } from 'file:///app/src/domain/revenueBonusEligibility.js'

const startDate = '2026-09-01'
const endDate = String(process.env.AUDIT_END_DATE || '')
const database = new DatabaseSync(process.env.IDOSI_DB_PATH || '/app/data/idosi.sqlite', { readOnly: true })
database.exec('PRAGMA query_only = ON')

const statement = database.prepare(`
  SELECT value_json
  FROM state_entities
  WHERE scope_key = 'global' AND collection_key = ?
  ORDER BY entity_order, entity_key
`)
const collection = (name) => statement.all(name).flatMap((row) => {
  try { return [JSON.parse(row.value_json)] } catch { return [] }
})
const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')
const normalizedText = (value) => normalize(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/đ/gu, 'd')
const recordDate = (record = {}) => String(
  record.businessDate || record.workDate || record.date || record.attendanceDate
  || record.createdAt || record.occurredAt || '',
).slice(0, 10)
const storeReference = (record = {}) => String(record.storeId || record.unitId || record.store?.id || '')
const activeDaily = (record = {}) => (
  !record.deletedAt && !record.voidedAt && !record.supersededAt
  && !['VOID', 'VOIDED', 'SUPERSEDED', 'CANCELLED'].includes(String(record.status || '').trim().toUpperCase())
)
const anonymize = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 12)

const dates = []
for (let cursor = new Date(`${startDate}T00:00:00Z`); cursor <= new Date(`${endDate}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  dates.push(cursor.toISOString().slice(0, 10))
}

const stores = collection('stores').filter((store) => !store.deletedAt && store.active !== false)
const attendance = collection('attendance')
const schedule = collection('schedule')
const shiftDefinitions = collection('shiftDefinitions')
const employees = collection('employees')
const dailyRecords = collection('revenueBonusDaily')
const nowMs = Date.now()
const counts = new Map()
const unexpected = []
let auditedStoreDays = 0
let diAn = null

for (const date of dates) {
  for (const store of stores) {
    const storeId = String(store.id || store.code || '')
    if (!storeId) continue
    auditedStoreDays += 1
    const sameStore = (record) => normalize(storeReference(record)) === normalize(storeId)
    const dayAttendance = attendance.filter((record) => !record.deletedAt && sameStore(record) && recordDate(record) === date)
    const openAttendance = dayAttendance.filter((record) => !record.checkOutAt && !record.checkOut)
    const dayDailyRecords = dailyRecords.filter((record) => sameStore(record) && recordDate(record) === date && activeDaily(record))
    const eligibility = revenueBonusEligibility({
      storeId,
      businessDate: date,
      schedule,
      shiftDefinitions,
      attendance,
      employees,
      dailyRecords,
      nowMs,
    })
    const expectedCode = dayDailyRecords.length > 1
      ? 'DATA_COLLISION'
      : dayDailyRecords.length === 1
        ? 'ALREADY_CALCULATED'
        : openAttendance.length
          ? 'ATTENDANCE_OPEN'
          : dayAttendance.length
            ? 'READY'
            : 'NO_ATTENDANCE'
    counts.set(eligibility.code, (counts.get(eligibility.code) || 0) + 1)
    if (eligibility.code !== expectedCode) {
      unexpected.push({ storeHash: anonymize(storeId), date, actual: eligibility.code, expected: expectedCode })
    }
    const searchableStore = normalizedText([store.name, store.code, store.short, store.id].filter(Boolean).join(' '))
    if (date === '2026-09-02' && searchableStore.includes('di an')) {
      diAn = {
        eligibility: eligibility.code,
        expected: expectedCode,
        attendanceCount: dayAttendance.length,
        openAttendanceCount: openAttendance.length,
        activeResultCount: dayDailyRecords.length,
      }
    }
  }
}

const summary = {
  releaseSha: process.env.EXPECTED_RELEASE_SHA || null,
  period: `${startDate}..${endDate}`,
  activeStoreCount: stores.length,
  auditedStoreDays,
  eligibilityCounts: Object.fromEntries([...counts].sort()),
  unexpectedBlockerCount: unexpected.length,
  dosiiDiAn20260902: diAn,
}
console.log('production_revenue_bonus_summary=' + JSON.stringify(summary))
if (unexpected.length) console.log('unexpected_blockers_anonymized=' + JSON.stringify(unexpected))
database.close()

if (!diAn) throw new Error('Không tìm thấy Dosii Dĩ An ngày 02/09/2026 trong dữ liệu production.')
if (diAn.eligibility !== diAn.expected) throw new Error('Dosii Dĩ An không khớp trạng thái dữ liệu thực tế.')
if (unexpected.length) throw new Error(`Phát hiện ${unexpected.length} cửa hàng-ngày bị chặn sai.`)
NODE
