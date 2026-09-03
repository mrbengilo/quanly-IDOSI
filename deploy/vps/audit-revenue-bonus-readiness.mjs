import { DatabaseSync } from 'node:sqlite'
import {
  REVENUE_BONUS_DAILY_CLOSE_RULE_EFFECTIVE_DATE,
  revenueBonusEligibility,
} from '/app/src/domain/revenueBonusEligibility.js'
import {
  classifyStorePayrollPolicy,
  STORE_PAYROLL_POLICY,
} from '/app/src/domain/storeTieredPayroll.js'

const database = new DatabaseSync(process.env.IDOSI_DB_PATH || '/app/data/idosi.sqlite', {
  readOnly: true,
})
database.exec('PRAGMA query_only = ON')

const collection = (key) => database.prepare(`
  SELECT value_json
  FROM state_entities
  WHERE scope_key = 'global' AND collection_key = ?
  ORDER BY entity_order, entity_key
`).all(key).map((row) => JSON.parse(row.value_json))

const normalized = (value) => String(value ?? '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/[đĐ]/gu, 'd')
  .toLocaleLowerCase('en-US')
const recordDate = (record = {}) => String(
  record.businessDate || record.workDate || record.date || record.attendanceDate
  || record.occurredOn || record.occurredAt || record.createdAt || '',
).slice(0, 10)
const sameIdentifier = (left, right) => normalized(left) === normalized(right)
const active = (record) => record && !record.deletedAt && !record.archivedAt
const supported = (store) => [STORE_PAYROLL_POLICY.DOSII, STORE_PAYROLL_POLICY.SM_TNV]
  .includes(classifyStorePayrollPolicy(store))
const effectiveDaily = (record) => active(record)
  && !record.voidedAt
  && !record.supersededAt
  && !['VOID', 'VOIDED', 'SUPERSEDED', 'CANCELLED']
    .includes(String(record.status || '').trim().toUpperCase())

const vietnamDate = (date = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

const datesBetween = (from, to) => {
  const dates = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (!Number.isNaN(cursor.getTime()) && cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

const stores = collection('stores').filter((store) => active(store) && supported(store))
const employees = collection('employees').filter(active)
const orders = collection('orders').filter((record) => active(record) && record.source !== 'legacy-opening-balance')
const attendance = collection('attendance').filter(active)
const schedule = collection('schedule').filter(active)
const shiftDefinitions = collection('shiftDefinitions').filter(active)
const dailyRecords = collection('revenueBonusDaily').filter(effectiveDaily)
const today = vietnamDate()
const dates = datesBetween(REVENUE_BONUS_DAILY_CLOSE_RULE_EFFECTIVE_DATE, today)
const nowMs = Date.now()

const rows = []
for (const store of stores) {
  const storeId = String(store.id || store.code || '').trim()
  if (!storeId) continue
  for (const businessDate of dates) {
    const hasActivity = orders.some((record) => sameIdentifier(record.storeId, storeId) && recordDate(record) === businessDate)
      || attendance.some((record) => sameIdentifier(record.storeId, storeId) && recordDate(record) === businessDate)
      || schedule.some((record) => sameIdentifier(record.storeId, storeId) && recordDate(record) === businessDate)
      || dailyRecords.some((record) => sameIdentifier(record.storeId, storeId) && recordDate(record) === businessDate)
    if (!hasActivity) continue

    const eligibility = revenueBonusEligibility({
      storeId,
      businessDate,
      schedule,
      shiftDefinitions,
      attendance,
      employees,
      dailyRecords,
      nowMs,
    })
    rows.push({
      storeId,
      storeName: String(store.name || store.short || store.code || storeId),
      businessDate,
      code: eligibility.code,
      ready: eligibility.code === 'READY',
      calculated: eligibility.code === 'ALREADY_CALCULATED',
      attendanceCount: Number(eligibility.attendanceCount || 0),
      openAttendanceCount: Number(eligibility.openAttendanceCount || 0),
      finalShiftAttendanceCount: Number(eligibility.finalShiftAttendanceCount || 0),
      ruleCode: eligibility.ruleCode || '',
    })
  }
}

const counts = rows.reduce((summary, row) => {
  summary[row.code] = (summary[row.code] || 0) + 1
  return summary
}, {})
const regressions = rows.filter((row) => (
  row.businessDate >= REVENUE_BONUS_DAILY_CLOSE_RULE_EFFECTIVE_DATE
  && !row.calculated
  && row.code !== 'DATA_COLLISION'
  && row.attendanceCount > 0
  && row.openAttendanceCount === 0
  && !row.ready
))
const collisions = rows.filter((row) => row.code === 'DATA_COLLISION')
const target = rows.find((row) => (
  row.businessDate === '2026-09-02'
  && normalized(`${row.storeId} ${row.storeName}`).includes('dosii')
  && normalized(`${row.storeId} ${row.storeName}`).includes('di an')
))

console.log(`AUDIT checked_at=${new Date(nowMs).toISOString()} vietnam_date=${today} effective_from=${REVENUE_BONUS_DAILY_CLOSE_RULE_EFFECTIVE_DATE}`)
console.log(`SUMMARY supported_stores=${stores.length} active_store_days=${rows.length} ready=${counts.READY || 0} already_calculated=${counts.ALREADY_CALCULATED || 0} open_attendance=${counts.ATTENDANCE_OPEN || 0} no_attendance_or_legacy_block=${(counts.FINAL_SHIFT_NOT_ATTENDED || 0) + (counts.FINAL_SHIFT_UNRESOLVED || 0)} collisions=${counts.DATA_COLLISION || 0}`)
for (const row of rows) {
  console.log([
    'STORE_DAY',
    `store_id=${JSON.stringify(row.storeId)}`,
    `store_name=${JSON.stringify(row.storeName)}`,
    `date=${row.businessDate}`,
    `status=${row.code}`,
    `attendance=${row.attendanceCount}`,
    `open=${row.openAttendanceCount}`,
    `final_shift_attendance=${row.finalShiftAttendanceCount}`,
    `rule=${row.ruleCode}`,
  ].join(' '))
}
console.log(target
  ? `TARGET_DOSII_DI_AN_2026_09_02 status=${target.code} attendance=${target.attendanceCount} open=${target.openAttendanceCount}`
  : 'TARGET_DOSII_DI_AN_2026_09_02 status=NOT_FOUND')

if (regressions.length > 0) {
  console.error(`ERROR closed_uncalculated_store_days_not_ready=${regressions.length}`)
  process.exitCode = 1
}
if (collisions.length > 0) {
  console.error(`ERROR revenue_bonus_daily_collisions=${collisions.length}`)
  process.exitCode = 1
}
if (!target) {
  console.error('ERROR Dosii Dĩ An 02/09 activity was not found in the audited production projection.')
  process.exitCode = 1
}
