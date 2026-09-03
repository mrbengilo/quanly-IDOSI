import { allocateByLargestRemainder } from './compensationAllocation.js'
import {
  calculateRevenueBonus,
  calculateTeamMilestoneReward,
} from './compensationPolicies.js'

export const AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE = '2026-09-03'
export const REVENUE_BONUS_OVERRIDE_MODE = Object.freeze({
  AMOUNT: 'AMOUNT',
  DELETED: 'DELETED',
})

const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const identifierKey = (value) => String(value ?? '').trim().toLocaleLowerCase('en-US')
const recordDate = (record = {}) => String(
  record.businessDate
  || record.workDate
  || record.attendanceDate
  || record.date
  || record.effectiveDate
  || record.occurredOn
  || record.occurredAt
  || record.createdAt
  || '',
).slice(0, 10)

const validBusinessDate = (value) => /^\d{4}-\d{2}-\d{2}$/u.test(String(value || ''))
const sameIdentifier = (left, right) => {
  const leftKey = identifierKey(left)
  const rightKey = identifierKey(right)
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}

const vietnamDate = (value) => {
  const instant = value instanceof Date ? value : new Date(value ?? Date.now())
  if (Number.isNaN(instant.getTime())) throw new TypeError('nowMs must be a valid timestamp.')
  const parts = Object.fromEntries(VIETNAM_DATE_FORMATTER.formatToParts(instant)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

const activeRecord = (record = {}) => (
  !record.deletedAt
  && !record.voidedAt
  && !record.supersededAt
  && !['VOID', 'VOIDED', 'SUPERSEDED', 'CANCELLED', 'DELETED', 'INACTIVE']
    .includes(String(record.status || '').trim().toUpperCase())
)

const employeeIdentifiers = (employee = {}) => [
  employee.id,
  employee.code,
  employee.employeeId,
  employee.employeeCode,
].map((value) => String(value || '').trim()).filter(Boolean)

const employeeResolver = (employees = []) => {
  const exact = new Map()
  const folded = new Map()
  for (const employee of Array.isArray(employees) ? employees : []) {
    for (const identifier of new Set(employeeIdentifiers(employee))) {
      exact.set(identifier, [...(exact.get(identifier) || []), employee])
      const key = identifierKey(identifier)
      folded.set(key, [...(folded.get(key) || []), employee])
    }
  }
  return (reference) => {
    const requested = String(reference || '').trim()
    if (!requested) return null
    const exactMatches = exact.get(requested) || []
    if (exactMatches.length) return exactMatches.length === 1 ? exactMatches[0] : null
    const foldedMatches = folded.get(identifierKey(requested)) || []
    return foldedMatches.length === 1 ? foldedMatches[0] : null
  }
}

const employeeCanonicalId = (employee, fallback = '') => String(
  employee?.id || employee?.code || employee?.employeeId || employee?.employeeCode || fallback || '',
).trim()

const liveWorkedSeconds = (record, nowMs, projectOpen) => {
  const storedSource = record?.approvedSalesSeconds
    ?? record?.workedSeconds
    ?? (record?.hours == null ? 0 : Number(record.hours) * 3_600)
  const parsedStored = Number(storedSource)
  const storedSeconds = Number.isFinite(parsedStored) && parsedStored >= 0 ? parsedStored : 0
  if (record?.checkOutAt || record?.checkOut || record?.checkOutTime || !projectOpen) {
    return Math.max(0, Math.trunc(storedSeconds))
  }
  const checkInMs = Date.parse(record?.checkInAt || record?.checkIn || '')
  if (!Number.isFinite(checkInMs) || nowMs <= checkInMs) return Math.max(0, Math.trunc(storedSeconds))
  const elapsedSeconds = Math.floor((nowMs - checkInMs) / 1_000)
  return Math.max(Math.trunc(storedSeconds), Math.min(elapsedSeconds, 24 * 60 * 60))
}

const safeAllocation = (poolVnd, participants) => participants.length
  ? allocateByLargestRemainder({ poolVnd, participants })
  : {
      poolVnd,
      totalWeightUnits: 0,
      allocatedVnd: 0,
      unallocatedVnd: poolVnd,
      allocations: [],
    }

const overrideSortKey = (record = {}) => {
  const timestamp = Date.parse(record.updatedAt || record.createdAt || '')
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0
  return [safeTimestamp, Number(record.version || 0), String(record.id || '')]
}

const compareOverrideLatestFirst = (left, right) => {
  const leftKey = overrideSortKey(left)
  const rightKey = overrideSortKey(right)
  if (leftKey[0] !== rightKey[0]) return rightKey[0] - leftKey[0]
  if (leftKey[1] !== rightKey[1]) return rightKey[1] - leftKey[1]
  return rightKey[2].localeCompare(leftKey[2], 'en-US')
}

export const activeRevenueBonusOverrides = ({
  overrides = [],
  storeId,
  businessDate,
} = {}) => {
  const grouped = new Map()
  for (const record of Array.isArray(overrides) ? overrides : []) {
    if (!activeRecord(record)
      || !sameIdentifier(record.storeId, storeId)
      || recordDate(record) !== businessDate) continue
    const employeeId = String(record.employeeId || '').trim()
    const employeeKey = identifierKey(employeeId)
    const mode = String(record.mode || record.overrideMode || '').trim().toUpperCase()
    const amountVnd = Number(record.amountVnd ?? record.amount)
    if (!employeeKey
      || !Object.values(REVENUE_BONUS_OVERRIDE_MODE).includes(mode)
      || (mode === REVENUE_BONUS_OVERRIDE_MODE.AMOUNT
        && (!Number.isSafeInteger(amountVnd) || amountVnd < 0))) continue
    grouped.set(employeeKey, [...(grouped.get(employeeKey) || []), {
      ...record,
      employeeId,
      mode,
      amountVnd: mode === REVENUE_BONUS_OVERRIDE_MODE.DELETED ? 0 : amountVnd,
    }])
  }
  const records = new Map()
  const collisions = []
  for (const [employeeKey, matches] of grouped) {
    const sorted = matches.toSorted(compareOverrideLatestFirst)
    records.set(employeeKey, sorted[0])
    if (sorted.length > 1) {
      collisions.push({
        employeeId: sorted[0].employeeId,
        overrideIds: sorted.map((record) => String(record.id || '')).filter(Boolean),
      })
    }
  }
  return { records, collisions }
}

export function calculateAutomaticRevenueBonusDay({
  storeId = '',
  businessDate = '',
  programId = '',
  milestoneProgramId = '',
  orders = [],
  attendance = [],
  employees = [],
  overrides = [],
  nowMs = Date.now(),
} = {}) {
  const normalizedStoreId = String(storeId || '').trim()
  const normalizedNowMs = nowMs instanceof Date ? nowMs.getTime() : Number(nowMs)
  if (!normalizedStoreId || !validBusinessDate(businessDate) || !programId || !milestoneProgramId) {
    throw new TypeError('storeId, businessDate, programId and milestoneProgramId are required.')
  }
  if (!Number.isFinite(normalizedNowMs)) throw new TypeError('nowMs must be a valid timestamp.')

  const scopedOrders = (Array.isArray(orders) ? orders : []).filter((order) => (
    sameIdentifier(order?.storeId, normalizedStoreId)
    && recordDate(order) === businessDate
    && activeRecord(order)
    && String(order.status || '') !== 'Đã xóa'
    && Number.isSafeInteger(Number(order.amount))
    && Number(order.amount) >= 0
  ))
  const revenueVnd = scopedOrders.reduce((sum, order) => sum + Number(order.amount), 0)
  if (!Number.isSafeInteger(revenueVnd)) throw new RangeError('Daily revenue exceeds the safe VND range.')

  const percentage = calculateRevenueBonus({ programId, revenueVnd })
  const milestone = calculateTeamMilestoneReward({
    programId: milestoneProgramId,
    achievedUnits: revenueVnd,
  })
  const resolveEmployee = employeeResolver(employees)
  const employeeById = new Map()
  const weights = new Map()
  const currentVietnamDate = vietnamDate(normalizedNowMs)
  const projectOpenAttendance = businessDate === currentVietnamDate
  let attendanceCount = 0
  let openAttendanceCount = 0
  const activeEmployeeIds = new Set()

  for (const record of Array.isArray(attendance) ? attendance : []) {
    if (!activeRecord(record)
      || !sameIdentifier(record?.storeId, normalizedStoreId)
      || recordDate(record) !== businessDate) continue
    const requestedEmployeeId = String(record.employeeId || record.employeeCode || '').trim()
    const employee = resolveEmployee(requestedEmployeeId)
    const employeeId = employeeCanonicalId(employee, requestedEmployeeId)
    if (!employeeId || ((Array.isArray(employees) && employees.length > 0) && !employee)) continue
    employeeById.set(identifierKey(employeeId), employee)
    attendanceCount += 1
    const open = !record.checkOutAt && !record.checkOut && !record.checkOutTime
    if (open) {
      openAttendanceCount += 1
      activeEmployeeIds.add(employeeId)
    }
    const seconds = liveWorkedSeconds(record, normalizedNowMs, projectOpenAttendance)
    if (seconds > 0) weights.set(employeeId, (weights.get(employeeId) || 0) + seconds)
  }

  const participants = [...weights].map(([id, weightUnits]) => ({ id, weightUnits }))
  const percentageAllocation = safeAllocation(percentage.bonusVnd, participants)
  const milestoneAllocation = safeAllocation(milestone.amountVnd, participants)
  const percentageByEmployee = new Map(
    percentageAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
  const milestoneByEmployee = new Map(
    milestoneAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
  const weightByEmployee = new Map(participants.map((record) => [identifierKey(record.id), record.weightUnits]))
  const canonicalIdByKey = new Map(participants.map((record) => [identifierKey(record.id), record.id]))
  const activeOverrides = activeRevenueBonusOverrides({
    overrides,
    storeId: normalizedStoreId,
    businessDate,
  })
  for (const override of activeOverrides.records.values()) {
    const key = identifierKey(override.employeeId)
    if (!canonicalIdByKey.has(key)) canonicalIdByKey.set(key, override.employeeId)
  }

  const totalWeightUnits = percentageAllocation.totalWeightUnits
  const allocations = [...canonicalIdByKey].map(([employeeKey, employeeId]) => {
    const weightUnits = weightByEmployee.get(employeeKey) || 0
    const percentagePoolVnd = percentageByEmployee.get(employeeKey) || 0
    const milestonePoolVnd = milestoneByEmployee.get(employeeKey) || 0
    const automaticAmountVnd = percentagePoolVnd + milestonePoolVnd
    const override = activeOverrides.records.get(employeeKey) || null
    const effectiveAmountVnd = override
      ? override.mode === REVENUE_BONUS_OVERRIDE_MODE.DELETED ? 0 : override.amountVnd
      : automaticAmountVnd
    const employee = employeeById.get(employeeKey) || resolveEmployee(employeeId)
    const status = override?.mode === REVENUE_BONUS_OVERRIDE_MODE.DELETED
      ? 'ADMIN_DELETED'
      : override ? 'ADMIN_ADJUSTED' : 'LIVE'
    return {
      id: `automatic-revenue:${normalizedStoreId}:${businessDate}:${employeeId}`,
      sourceType: 'automatic-revenue-bonus',
      automatic: true,
      storeId: normalizedStoreId,
      businessDate,
      period: businessDate.slice(0, 7),
      employeeId,
      employeeName: String(
        employee?.name || employee?.displayName || override?.employeeName || employeeId,
      ),
      weightUnits,
      workedSeconds: weightUnits,
      approvedSalesHours: weightUnits / 3_600,
      weightPercent: totalWeightUnits > 0 ? (weightUnits / totalWeightUnits) * 100 : 0,
      percentagePoolVnd,
      milestonePoolVnd,
      automaticAmountVnd,
      amountVnd: effectiveAmountVnd,
      allocatedVnd: effectiveAmountVnd,
      adminAdjustmentVnd: effectiveAmountVnd - automaticAmountVnd,
      overrideId: override?.id || null,
      overrideMode: override?.mode || null,
      overrideReason: override?.reason || override?.note || '',
      overrideVersion: override ? Number(override.version || 1) : null,
      status,
    }
  }).toSorted((left, right) => (
    right.weightUnits - left.weightUnits
    || left.employeeName.localeCompare(right.employeeName, 'vi-VN')
    || left.employeeId.localeCompare(right.employeeId, 'en-US')
  ))

  const automaticAllocatedVnd = allocations.reduce((sum, record) => sum + record.automaticAmountVnd, 0)
  const allocatedVnd = allocations.reduce((sum, record) => sum + record.amountVnd, 0)
  const unallocatedVnd = percentageAllocation.unallocatedVnd + milestoneAllocation.unallocatedVnd
  return {
    id: `automatic-revenue-day:${normalizedStoreId}:${businessDate}`,
    sourceType: 'automatic-revenue-bonus',
    automatic: true,
    storeId: normalizedStoreId,
    businessDate,
    period: businessDate.slice(0, 7),
    projectedAt: new Date(normalizedNowMs).toISOString(),
    revenueVnd,
    orderCount: scopedOrders.length,
    programId,
    tierId: percentage.tierId,
    rateBasisPoints: percentage.rateBasisPoints,
    ratePercent: percentage.ratePercent,
    milestoneProgramId,
    milestoneId: milestone.milestoneId,
    percentagePoolVnd: percentage.bonusVnd,
    milestonePoolVnd: milestone.amountVnd,
    totalPoolVnd: percentage.bonusVnd + milestone.amountVnd,
    automaticAllocatedVnd,
    allocatedVnd,
    unallocatedVnd,
    adminAdjustmentVnd: allocatedVnd - automaticAllocatedVnd,
    totalWorkedSeconds: totalWeightUnits,
    attendanceCount,
    openAttendanceCount,
    activeEmployeeCount: activeEmployeeIds.size,
    participantCount: participants.length,
    overrideCount: activeOverrides.records.size,
    overrideCollisions: activeOverrides.collisions,
    status: 'LIVE',
    allocations,
  }
}

const dateCandidatesForPeriod = ({ storeId, period, orders, attendance, overrides }) => {
  const dates = new Set()
  const collect = (records) => {
    for (const record of Array.isArray(records) ? records : []) {
      const date = recordDate(record)
      if (activeRecord(record)
        && sameIdentifier(record?.storeId, storeId)
        && date.startsWith(`${period}-`)
        && date >= AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE) dates.add(date)
    }
  }
  collect(orders)
  collect(attendance)
  collect(overrides)
  return [...dates].toSorted()
}

export function calculateAutomaticRevenueBonusPeriod({
  storeId = '',
  period = '',
  programId = '',
  milestoneProgramId = '',
  orders = [],
  attendance = [],
  employees = [],
  overrides = [],
  nowMs = Date.now(),
} = {}) {
  if (!/^\d{4}-\d{2}$/u.test(String(period || ''))) throw new TypeError('period must use YYYY-MM.')
  const days = dateCandidatesForPeriod({ storeId, period, orders, attendance, overrides }).map((businessDate) => (
    calculateAutomaticRevenueBonusDay({
      storeId,
      businessDate,
      programId,
      milestoneProgramId,
      orders,
      attendance,
      employees,
      overrides,
      nowMs,
    })
  ))
  return {
    storeId,
    period,
    days,
    allocations: days.flatMap((day) => day.allocations),
    totalPoolVnd: days.reduce((sum, day) => sum + day.totalPoolVnd, 0),
    allocatedVnd: days.reduce((sum, day) => sum + day.allocatedVnd, 0),
    adminAdjustmentVnd: days.reduce((sum, day) => sum + day.adminAdjustmentVnd, 0),
  }
}
