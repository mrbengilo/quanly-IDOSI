import { allocateByLargestRemainder } from './compensationAllocation.js'
import {
  calculateRevenueBonus,
  calculateTeamMilestoneReward,
} from './compensationPolicies.js'
import { supportTransferBounds } from './supportTransferTime.js'

export const AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE = '2026-09-01'
export const AUTOMATIC_REVENUE_BONUS_CUTOFF_HOUR = 22
export const REVENUE_BONUS_OVERRIDE_MODE = Object.freeze({
  AMOUNT: 'AMOUNT',
  DELETED: 'DELETED',
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
const vietnamBusinessDate = (value) => {
  const instant = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(instant.getTime())) throw new TypeError('nowMs must be a valid timestamp.')
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
const sameIdentifier = (left, right) => {
  const leftKey = identifierKey(left)
  const rightKey = identifierKey(right)
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}

const activeRecord = (record = {}) => (
  !record.deletedAt
  && !record.voidedAt
  && !record.supersededAt
  && !['VOID', 'VOIDED', 'SUPERSEDED', 'CANCELLED', 'DELETED', 'INACTIVE', 'ĐÃ HỦY', 'ĐÃ XÓA']
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

const employeeHomeStoreId = (employee = {}) => String(
  employee.storeId || employee.homeStoreId || employee.assignedStoreId || '',
).trim()

const supportTransferIdentifier = (record = {}) => String(
  record.id || record.transferId || record.supportTransferId || '',
).trim()

const attendanceSupportTransferIdentifier = (record = {}) => String(
  record.supportTransferId || record.transferId || record.activeTransferId || '',
).trim()

const supportTransferEmployeeId = (record = {}) => String(
  record.employeeId || record.employeeCode || record.staffId || '',
).trim()

const supportTransferDestinationStoreId = (record = {}) => String(
  record.toStoreId
  || record.destinationStoreId
  || record.targetStoreId
  || record.supportStoreId
  || '',
).trim()

const nextCalendarDate = (date) => {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return ''
  parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString().slice(0, 10)
}

const supportTransferOverlapsBusinessDate = (record, businessDate) => {
  const bounds = supportTransferBounds(record)
  const nextDate = nextCalendarDate(businessDate)
  const dayStart = Date.parse(`${businessDate}T00:00:00+07:00`)
  const dayEnd = nextDate ? Date.parse(`${nextDate}T00:00:00+07:00`) : Number.NaN
  return Boolean(bounds
    && Number.isFinite(dayStart)
    && Number.isFinite(dayEnd)
    && bounds.startMs < dayEnd
    && bounds.endMs > dayStart)
}

const supportTransferContext = ({
  attendance,
  employee,
  employeeId,
  storeId,
  businessDate,
  supportTransfers,
}) => {
  const transfers = Array.isArray(supportTransfers) ? supportTransfers : []
  const explicitTransferId = attendanceSupportTransferIdentifier(attendance)
  if (explicitTransferId) {
    const matched = transfers.find((transfer) => (
      sameIdentifier(supportTransferIdentifier(transfer), explicitTransferId)
    ))
    return {
      supportTransferred: true,
      supportTransferId: supportTransferIdentifier(matched) || explicitTransferId,
    }
  }
  const homeStoreId = employeeHomeStoreId(employee)
  if (!homeStoreId || sameIdentifier(homeStoreId, storeId)) return null
  const matched = transfers.find((transfer) => (
    activeRecord(transfer)
    && sameIdentifier(supportTransferEmployeeId(transfer), employeeId)
    && sameIdentifier(supportTransferDestinationStoreId(transfer), storeId)
    && supportTransferOverlapsBusinessDate(transfer, businessDate)
  ))
  return matched ? {
    supportTransferred: true,
    supportTransferId: supportTransferIdentifier(matched),
  } : null
}

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

const allocateComponentWithinFormulaTotals = (poolVnd, formulaAllocation) => {
  const formulaRows = Array.isArray(formulaAllocation?.allocations)
    ? formulaAllocation.allocations
    : []
  const totalWeightUnits = Number(formulaAllocation?.totalWeightUnits || 0)
  if (!formulaRows.length || totalWeightUnits <= 0) {
    return {
      poolVnd,
      totalWeightUnits: 0,
      allocatedVnd: 0,
      unallocatedVnd: poolVnd,
      allocations: [],
    }
  }

  const totalWeight = BigInt(totalWeightUnits)
  const pool = BigInt(poolVnd)
  const provisional = formulaRows.map((row) => {
    const numerator = pool * BigInt(row.weightUnits)
    const formulaAmountVnd = Number(row.amountVnd || 0)
    return {
      id: row.id,
      weightUnits: row.weightUnits,
      formulaAmountVnd,
      amountVnd: Math.min(Number(numerator / totalWeight), formulaAmountVnd),
      remainder: numerator % totalWeight,
    }
  })
  let remainingVnd = poolVnd - provisional.reduce((sum, row) => sum + row.amountVnd, 0)
  const remainderOrder = [...provisional].sort((left, right) => {
    if (left.remainder > right.remainder) return -1
    if (left.remainder < right.remainder) return 1
    return String(left.id).localeCompare(String(right.id), 'en-US')
  })

  while (remainingVnd > 0) {
    let advanced = false
    for (const row of remainderOrder) {
      if (row.amountVnd >= row.formulaAmountVnd) continue
      row.amountVnd += 1
      remainingVnd -= 1
      advanced = true
      if (remainingVnd === 0) break
    }
    if (!advanced) {
      throw new RangeError('Unable to reconcile revenue bonus component allocations.')
    }
  }

  const allocations = provisional.map(({ id, weightUnits, amountVnd }) => ({
    id,
    weightUnits,
    amountVnd,
  }))
  const allocatedVnd = allocations.reduce((sum, row) => sum + row.amountVnd, 0)
  return {
    poolVnd,
    totalWeightUnits,
    allocatedVnd,
    unallocatedVnd: poolVnd - allocatedVnd,
    allocations,
  }
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
  supportTransfers = [],
  overrides = [],
  nowMs = Date.now(),
} = {}) {
  const normalizedStoreId = String(storeId || '').trim()
  const normalizedNowMs = nowMs instanceof Date ? nowMs.getTime() : Number(nowMs)
  if (!normalizedStoreId || !validBusinessDate(businessDate) || !programId || !milestoneProgramId) {
    throw new TypeError('storeId, businessDate, programId and milestoneProgramId are required.')
  }
  if (!Number.isFinite(normalizedNowMs)) throw new TypeError('nowMs must be a valid timestamp.')
  const finalizedOnly = businessDate >= AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE

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

  const resolveEmployee = employeeResolver(employees)
  const employeeById = new Map()
  const supportContextByEmployee = new Map()
  const attendanceRows = []
  const openEmployeeIds = new Set()
  for (const record of Array.isArray(attendance) ? attendance : []) {
    if (!activeRecord(record)
      || !sameIdentifier(record?.storeId, normalizedStoreId)
      || recordDate(record) !== businessDate) continue
    const requestedEmployeeId = String(record.employeeId || record.employeeCode || '').trim()
    const employee = resolveEmployee(requestedEmployeeId)
    const employeeId = employeeCanonicalId(employee, requestedEmployeeId)
    if (!employeeId || ((Array.isArray(employees) && employees.length > 0) && !employee)) continue
    const employeeKey = identifierKey(employeeId)
    employeeById.set(employeeKey, employee)
    const supportContext = supportTransferContext({
      attendance: record,
      employee,
      employeeId,
      storeId: normalizedStoreId,
      businessDate,
      supportTransfers,
    })
    if (supportContext) {
      const current = supportContextByEmployee.get(employeeKey) || {
        supportTransferred: true,
        supportTransferIds: new Set(),
      }
      if (supportContext.supportTransferId) current.supportTransferIds.add(supportContext.supportTransferId)
      supportContextByEmployee.set(employeeKey, current)
    }
    const open = !record.checkOutAt && !record.checkOut && !record.checkOutTime
    if (open) openEmployeeIds.add(employeeId)
    attendanceRows.push({ record, employeeId, open })
  }

  const activeOverrides = activeRevenueBonusOverrides({
    overrides,
    storeId: normalizedStoreId,
    businessDate,
  })
  const cutoffMs = Date.parse(`${businessDate}T${String(AUTOMATIC_REVENUE_BONUS_CUTOFF_HOUR).padStart(2, '0')}:00:00+07:00`)
  const cutoffAt = Number.isFinite(cutoffMs) ? new Date(cutoffMs).toISOString() : null
  const pendingSnapshot = (status, code, message) => ({
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
    tierId: null,
    rateBasisPoints: 0,
    ratePercent: 0,
    milestoneProgramId,
    milestoneId: null,
    percentagePoolVnd: 0,
    milestonePoolVnd: 0,
    totalPoolVnd: 0,
    formulaAllocatedVnd: 0,
    automaticAllocatedVnd: 0,
    allocatedVnd: 0,
    unallocatedVnd: 0,
    excludedSupportShareVnd: 0,
    adminAdjustmentVnd: 0,
    totalWorkedSeconds: 0,
    attendanceCount: attendanceRows.length,
    openAttendanceCount: openEmployeeIds.size,
    activeEmployeeCount: openEmployeeIds.size,
    participantCount: 0,
    eligibleParticipantCount: 0,
    supportExcludedCount: 0,
    overrideCount: 0,
    overrideCollisions: [],
    status,
    calculationEligibility: {
      allowed: false,
      code,
      message,
      cutoffAt,
      attendanceCount: attendanceRows.length,
      openAttendanceCount: openEmployeeIds.size,
    },
    allocations: [],
  })

  if (finalizedOnly && (!Number.isFinite(cutoffMs) || normalizedNowMs < cutoffMs)) {
    return pendingSnapshot(
      'WAITING_CUTOFF',
      'WAITING_CUTOFF',
      'Hệ thống sẽ tự động chốt doanh thu và giờ làm sau 22:00 giờ Việt Nam.',
    )
  }
  if (finalizedOnly && openEmployeeIds.size > 0) {
    return pendingSnapshot(
      'WAITING_SHIFT_CLOSE',
      'WAITING_SHIFT_CLOSE',
      'Đã qua 22:00 nhưng vẫn còn ca đang làm việc. Hệ thống sẽ tự động tính ngay sau khi tất cả nhân viên kết ca.',
    )
  }
  if (finalizedOnly && !attendanceRows.length && activeOverrides.records.size === 0) {
    return pendingSnapshot(
      'NO_ATTENDANCE',
      'NO_ATTENDANCE',
      'Ngày này chưa có dữ liệu chấm công nên hệ thống chưa thể tính thưởng doanh thu.',
    )
  }

  const projectOpenAttendance = !finalizedOnly && businessDate === vietnamBusinessDate(normalizedNowMs)
  const weights = new Map()
  for (const { record, employeeId } of attendanceRows) {
    const seconds = liveWorkedSeconds(record, normalizedNowMs, projectOpenAttendance)
    if (seconds > 0) weights.set(employeeId, (weights.get(employeeId) || 0) + seconds)
  }
  const participants = [...weights].map(([id, weightUnits]) => ({ id, weightUnits }))
  const percentage = calculateRevenueBonus({ programId, revenueVnd })
  const milestone = calculateTeamMilestoneReward({
    programId: milestoneProgramId,
    achievedUnits: revenueVnd,
  })
  const totalPoolVnd = percentage.bonusVnd + milestone.amountVnd
  const formulaAllocation = safeAllocation(totalPoolVnd, participants)
  const percentageAllocation = allocateComponentWithinFormulaTotals(
    percentage.bonusVnd,
    formulaAllocation,
  )
  const percentageByEmployeeId = new Map(
    percentageAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
  const milestoneAllocations = formulaAllocation.allocations.map((record) => ({
    id: record.id,
    weightUnits: record.weightUnits,
    amountVnd: record.amountVnd - (percentageByEmployeeId.get(identifierKey(record.id)) || 0),
  }))
  const milestoneAllocatedVnd = milestoneAllocations.reduce(
    (sum, record) => sum + record.amountVnd,
    0,
  )
  const milestoneAllocation = {
    poolVnd: milestone.amountVnd,
    totalWeightUnits: formulaAllocation.totalWeightUnits,
    allocatedVnd: milestoneAllocatedVnd,
    unallocatedVnd: milestone.amountVnd - milestoneAllocatedVnd,
    allocations: milestoneAllocations,
  }
  const formulaPercentageByEmployee = new Map(
    percentageAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
  const formulaMilestoneByEmployee = new Map(
    milestoneAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
  const weightByEmployee = new Map(participants.map((record) => [identifierKey(record.id), record.weightUnits]))
  const canonicalIdByKey = new Map(participants.map((record) => [identifierKey(record.id), record.id]))
  for (const override of activeOverrides.records.values()) {
    const key = identifierKey(override.employeeId)
    if (!canonicalIdByKey.has(key)) canonicalIdByKey.set(key, override.employeeId)
  }

  const totalWeightUnits = formulaAllocation.totalWeightUnits
  const allocations = [...canonicalIdByKey].map(([employeeKey, employeeId]) => {
    const weightUnits = weightByEmployee.get(employeeKey) || 0
    const formulaPercentagePoolVnd = formulaPercentageByEmployee.get(employeeKey) || 0
    const formulaMilestonePoolVnd = formulaMilestoneByEmployee.get(employeeKey) || 0
    const formulaShareVnd = formulaPercentagePoolVnd + formulaMilestonePoolVnd
    const supportContext = supportContextByEmployee.get(employeeKey) || null
    const supportTransferred = Boolean(supportContext)
    const percentagePoolVnd = supportTransferred ? 0 : formulaPercentagePoolVnd
    const milestonePoolVnd = supportTransferred ? 0 : formulaMilestonePoolVnd
    const automaticAmountVnd = percentagePoolVnd + milestonePoolVnd
    const excludedSupportShareVnd = supportTransferred ? formulaShareVnd : 0
    const override = activeOverrides.records.get(employeeKey) || null
    const effectiveAmountVnd = override
      ? override.mode === REVENUE_BONUS_OVERRIDE_MODE.DELETED ? 0 : override.amountVnd
      : automaticAmountVnd
    const employee = employeeById.get(employeeKey) || resolveEmployee(employeeId)
    const status = override?.mode === REVENUE_BONUS_OVERRIDE_MODE.DELETED
      ? 'ADMIN_DELETED'
      : override
        ? 'ADMIN_ADJUSTED'
        : supportTransferred ? 'SUPPORT_EXCLUDED' : finalizedOnly ? 'FINALIZED' : 'LIVE'
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
      formulaPercentagePoolVnd,
      formulaMilestonePoolVnd,
      formulaShareVnd,
      percentagePoolVnd,
      milestonePoolVnd,
      automaticAmountVnd,
      excludedSupportShareVnd,
      supportTransferred,
      supportTransferIds: supportContext ? [...supportContext.supportTransferIds].toSorted() : [],
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

  const formulaAllocatedVnd = allocations.reduce((sum, record) => sum + record.formulaShareVnd, 0)
  const excludedSupportShareVnd = allocations.reduce((sum, record) => sum + record.excludedSupportShareVnd, 0)
  const automaticAllocatedVnd = allocations.reduce((sum, record) => sum + record.automaticAmountVnd, 0)
  const allocatedVnd = allocations.reduce((sum, record) => sum + record.amountVnd, 0)
  const unallocatedVnd = formulaAllocation.unallocatedVnd + excludedSupportShareVnd
  return {
    id: `automatic-revenue-day:${normalizedStoreId}:${businessDate}`,
    sourceType: 'automatic-revenue-bonus',
    automatic: true,
    storeId: normalizedStoreId,
    businessDate,
    period: businessDate.slice(0, 7),
    projectedAt: new Date(normalizedNowMs).toISOString(),
    ...(finalizedOnly ? { finalizedAt: new Date(normalizedNowMs).toISOString() } : {}),
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
    totalPoolVnd,
    formulaAllocatedVnd,
    automaticAllocatedVnd,
    allocatedVnd,
    unallocatedVnd,
    excludedSupportShareVnd,
    adminAdjustmentVnd: allocatedVnd - automaticAllocatedVnd,
    totalWorkedSeconds: totalWeightUnits,
    attendanceCount: attendanceRows.length,
    openAttendanceCount: finalizedOnly ? 0 : openEmployeeIds.size,
    activeEmployeeCount: finalizedOnly ? 0 : openEmployeeIds.size,
    participantCount: participants.length,
    eligibleParticipantCount: allocations.filter((record) => !record.supportTransferred).length,
    supportExcludedCount: allocations.filter((record) => record.supportTransferred).length,
    overrideCount: activeOverrides.records.size,
    overrideCollisions: activeOverrides.collisions,
    status: finalizedOnly ? 'FINALIZED' : 'LIVE',
    ...(finalizedOnly ? {
      calculationEligibility: {
        allowed: true,
        code: 'FINALIZED',
        message: 'Hệ thống đã tự động chốt doanh thu và giờ làm sau 22:00 khi toàn bộ ca đã kết thúc.',
        cutoffAt,
        attendanceCount: attendanceRows.length,
        openAttendanceCount: 0,
      },
    } : {}),
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
  supportTransfers = [],
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
      supportTransfers,
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
    automaticAllocatedVnd: days.reduce((sum, day) => sum + day.automaticAllocatedVnd, 0),
    allocatedVnd: days.reduce((sum, day) => sum + day.allocatedVnd, 0),
    unallocatedVnd: days.reduce((sum, day) => sum + day.unallocatedVnd, 0),
    excludedSupportShareVnd: days.reduce((sum, day) => sum + day.excludedSupportShareVnd, 0),
    adminAdjustmentVnd: days.reduce((sum, day) => sum + day.adminAdjustmentVnd, 0),
  }
}
