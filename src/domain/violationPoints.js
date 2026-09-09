// Points are stored in tenths while adding, so decimal thresholds are exact.
// Historical monetary violations deliberately have no inferred point value.
const text = (value) => String(value ?? '').trim()
const key = (value) => text(value).toLocaleLowerCase('en-US')
const activeStatuses = new Set(['ACTIVE', 'APPROVED', 'CONFIRMED', 'ĐÃ DUYỆT', 'ĐANG ÁP DỤNG'])

export const VIOLATION_POINT_MILESTONES = Object.freeze([
  Object.freeze({ points: 3, level: 'reminder', label: 'Nhắc nhở', description: 'Từ 3 điểm: thông báo nhắc nhở.', tone: 'orange' }),
  Object.freeze({ points: 5, level: 'bonus_blocked', label: 'Không nhận thưởng', description: 'Từ 5 điểm: thưởng doanh thu và thưởng công việc trong kỳ đều bằng 0.', tone: 'red' }),
  Object.freeze({ points: 6, level: 'suspended', label: 'Đình chỉ làm việc', description: 'Từ 6 điểm: cảnh báo “Đình chỉ làm việc”.', tone: 'red' }),
])

export function normalizeViolationPoints(value) {
  const source = typeof value === 'number' || typeof value === 'string' ? text(value) : ''
  if (!/^\d+(?:[.,]\d)?$/u.test(source)) throw new TypeError('Điểm vi phạm phải là số, tối đa một chữ số thập phân.')
  const points = Number(source.replace(',', '.'))
  if (!(points > 0 && points <= 10)) throw new RangeError('Điểm vi phạm phải lớn hơn 0 và không quá 10 điểm.')
  return Math.round(points * 10) / 10
}

export const isStoreViolation = (record = {}) => (
  key(record.targetUnit || record.targetGroup || record.catalogSnapshot?.targetGroup) === 'store'
)

export function violationPointsOf(record = {}) {
  if (!isStoreViolation(record)) return null
  const value = record.violationPoints ?? record.catalogSnapshot?.violationPoints
  return value == null ? null : normalizeViolationPoints(value)
}

export const isActivePointViolation = (record = {}) => (
  !record.deletedAt && !record.voidedAt && !record.rejectedAt
  && activeStatuses.has(text(record.status).toLocaleUpperCase('vi-VN'))
  && violationPointsOf(record) !== null
)

export function violationPointPeriod(record = {}) {
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(text(record.period))) return text(record.period)
  const source = text(record.occurredOn || record.workDate || record.businessDate || record.date || record.occurredAt || record.createdAt)
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) return source.slice(0, 7)
  const date = new Date(source)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(date)
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}`
}

export function assessViolationPoints(points = 0) {
  const units = Math.round(Number(points) * 10)
  if (!Number.isSafeInteger(units) || units < 0) throw new TypeError('Tổng điểm vi phạm không hợp lệ.')
  const milestone = VIOLATION_POINT_MILESTONES.findLast((entry) => units >= entry.points * 10)
  return {
    points: units / 10,
    threshold: milestone?.points || 0,
    level: milestone?.level || 'normal',
    label: milestone?.label || 'Chưa đến mốc nhắc nhở',
    tone: milestone?.tone || 'green',
    revenueBonusBlocked: units >= 50,
    workBonusBlocked: units >= 50,
  }
}

export function storeViolationPointAssessment(entries = [], { employeeId = '', employeeIdentifiers = [employeeId], period = '' } = {}) {
  const identifiers = new Set(employeeIdentifiers.map(key).filter(Boolean))
  let units = 0
  let count = 0
  const seen = new Set()
  for (const entry of entries) {
    if (!identifiers.has(key(entry.employeeId || entry.employeeCode || entry.targetEmployeeId))
      || violationPointPeriod(entry) !== period || !isActivePointViolation(entry)) continue
    const identity = text(entry.id || entry.occurrenceKey)
    if (identity && seen.has(identity)) continue
    if (identity) seen.add(identity)
    units += Math.round(violationPointsOf(entry) * 10)
    if (!Number.isSafeInteger(units)) throw new RangeError('Tổng điểm vi phạm vượt giới hạn an toàn.')
    count += 1
  }
  return { employeeId, period, count, ...assessViolationPoints(units / 10) }
}

export function restorePointBonusRecord(record) {
  if (!record.revenueBonusBlocked && !record.workBonusBlocked) return record
  const restored = { ...record, amountVnd: record.preViolationAmountVnd, status: record.statusBeforeViolation }
  if (Object.hasOwn(record, 'amount')) restored.amount = record.preViolationAmountVnd
  if (Object.hasOwn(record, 'allocatedVnd')) restored.allocatedVnd = record.preViolationAmountVnd
  for (const field of ['preViolationAmountVnd', 'violationExcludedVnd', 'violationPoints', 'revenueBonusBlocked', 'workBonusBlocked', 'statusBeforeViolation']) delete restored[field]
  return restored
}

export function applyBonusAllocationPointPolicy(record, assessment, kind = 'REVENUE') {
  const originalRecord = restorePointBonusRecord(record)
  const status = text(originalRecord.status).toLocaleUpperCase('vi-VN')
  if (!assessment.revenueBonusBlocked || originalRecord.deletedAt || originalRecord.voidedAt || originalRecord.rejectedAt || originalRecord.supersededAt
    || ['VOID', 'VOIDED', 'REJECTED', 'PENDING', 'SUBMITTED', 'ADMIN_DELETED', 'ĐÃ HỦY', 'TỪ CHỐI'].includes(status)) return originalRecord
  const original = Number(originalRecord.amountVnd ?? originalRecord.amount ?? 0)
  if (!Number.isSafeInteger(original) || original < 0) throw new TypeError('Số tiền thưởng không hợp lệ.')
  return {
    ...originalRecord,
    preViolationAmountVnd: original,
    amountVnd: 0,
    ...(Object.hasOwn(originalRecord, 'amount') ? { amount: 0 } : {}),
    ...(Object.hasOwn(originalRecord, 'allocatedVnd') ? { allocatedVnd: 0 } : {}),
    violationExcludedVnd: original,
    violationPoints: assessment.points,
    [kind === 'WORK' ? 'workBonusBlocked' : 'revenueBonusBlocked']: true,
    statusBeforeViolation: originalRecord.status,
    status: 'VIOLATION_EXCLUDED',
  }
}

// A read projection is reversible and must never replace the persisted award.
export function restorePointRevenueSnapshot(snapshot) {
  if (!snapshot?.pointPolicySnapshot) return snapshot
  const restored = { ...snapshot, allocations: snapshot.allocations.map(restorePointBonusRecord) }
  for (const field of ['allocatedVnd', 'unallocatedVnd', 'violationExcludedVnd', 'violationExcludedCount']) {
    if (Object.hasOwn(snapshot.pointPolicySnapshot, field)) restored[field] = snapshot.pointPolicySnapshot[field]
    else delete restored[field]
  }
  delete restored.pointPolicySnapshot
  return restored
}

// Apply the month-wide consequence after normal allocation and admin overrides.
// Formula shares stay intact for audit and are never redistributed to colleagues.
export function applyRevenueSnapshotPointPolicy(snapshot, entries = [], employees = []) {
  snapshot = restorePointRevenueSnapshot(snapshot)
  if (!snapshot?.allocations?.length) return snapshot
  if (!entries.some(isActivePointViolation)) return snapshot
  const cache = new Map()
  const allocations = snapshot.allocations.map((record) => {
    const period = record.period || violationPointPeriod(record)
    const cacheKey = `${key(record.employeeId)}:${period}`
    if (!cache.has(cacheKey)) {
      const employee = employees.find((candidate) => [candidate.id, candidate.code, candidate.employeeId].some((id) => key(id) === key(record.employeeId)))
      cache.set(cacheKey, storeViolationPointAssessment(entries, {
        employeeId: record.employeeId,
        employeeIdentifiers: employee ? [employee.id, employee.code, employee.employeeId] : [record.employeeId],
        period,
      }))
    }
    return applyBonusAllocationPointPolicy(record, cache.get(cacheKey), record.type === 'WORK' ? 'WORK' : 'REVENUE')
  })
  if (allocations.every((row, index) => row === snapshot.allocations[index])) return snapshot
  const excludedVnd = allocations.reduce((sum, row) => sum + Number(row.violationExcludedVnd || 0), 0)
  return {
    ...snapshot,
    allocations,
    pointPolicySnapshot: Object.fromEntries(['allocatedVnd', 'unallocatedVnd', 'violationExcludedVnd', 'violationExcludedCount'].filter((field) => Object.hasOwn(snapshot, field)).map((field) => [field, snapshot[field]])),
    allocatedVnd: allocations.reduce((sum, row) => sum + Number(row.amountVnd || 0), 0),
    violationExcludedVnd: excludedVnd,
    unallocatedVnd: Number(snapshot.unallocatedVnd || 0) - Number(snapshot.violationExcludedVnd || 0) + excludedVnd,
    violationExcludedCount: allocations.filter((row) => row.revenueBonusBlocked).length,
  }
}

export const formatViolationPoints = (value) => `${Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} điểm`
