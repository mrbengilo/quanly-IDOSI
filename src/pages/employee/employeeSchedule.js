import { shiftWindow } from '../../domain/supportScheduling'
import { supportTransferBounds, supportTransferIsCancelled } from '../../domain/supportTransferTime'

const dateValue = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

const moveDays = (value, amount) => {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + amount)
  return dateValue(date)
}

export const employeeScheduleRange = (anchorDate, mode = 'day') => {
  const anchor = dateValue(anchorDate) || dateValue()
  if (mode === 'month') {
    const [year, month] = anchor.split('-').map(Number)
    const end = new Date(year, month, 0)
    return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: dateValue(end) }
  }
  if (mode === 'week') {
    const date = new Date(`${anchor}T00:00:00`)
    const day = date.getDay() || 7
    const from = moveDays(anchor, 1 - day)
    return { from, to: moveDays(from, 6) }
  }
  return { from: anchor, to: anchor }
}

const identity = (value) => String(value || '').trim()
const identityKey = (value) => identity(value).toLocaleLowerCase('vi-VN')
const sameIdentifier = (left, right) => Boolean(identityKey(left)) && identityKey(left) === identityKey(right)
const values = (value) => Array.isArray(value) ? value : []
const nonEmpty = (...candidates) => candidates.find((value) => value !== undefined && value !== null && identity(value) !== '')
const transferIsVisible = (transfer = {}) => !supportTransferIsCancelled(transfer)
const assignmentIsVisible = (record = {}) => !record.deletedAt && !record.cancelledAt
  && !['Đã xóa', 'Đã hủy'].includes(identity(record.status))

const employeeReferences = (employee = {}) => new Set([
  employee.id,
  employee.code,
  employee.employeeId,
  employee.employeeCode,
].map(identityKey).filter(Boolean))

const recordMatchesEmployee = (record = {}, references = new Set()) => (
  [record.employeeId, record.employeeCode].some((reference) => references.has(identityKey(reference)))
)

const shiftIdsOf = (record = {}) => {
  const shiftIds = values(record.shiftIds).length ? record.shiftIds : record.shiftId ? [record.shiftId] : []
  const unique = new Map()
  shiftIds.forEach((shiftId) => {
    const key = identityKey(shiftId)
    if (key && !unique.has(key)) unique.set(key, identity(shiftId))
  })
  return [...unique.values()]
}

const uniqueShiftSnapshot = (record, shiftId) => {
  const matches = values(record.shiftSnapshots).filter((snapshot) => sameIdentifier(snapshot?.id, shiftId))
  return matches.length === 1 ? matches[0] : null
}

const uniqueShiftDefinition = (shiftDefinitions, shiftId, storeId) => {
  const candidates = values(shiftDefinitions).filter((definition) => sameIdentifier(definition?.id, shiftId))
  const exactStore = identity(storeId)
    ? candidates.filter((definition) => sameIdentifier(definition?.storeId, storeId))
    : []
  if (exactStore.length) return exactStore.length === 1 ? exactStore[0] : null

  const global = candidates.filter((definition) => !identity(definition?.storeId))
  if (global.length) return global.length === 1 ? global[0] : null
  return !identity(storeId) && candidates.length === 1 ? candidates[0] : null
}

const resolveScheduledShift = (record, shiftId, shiftDefinitions) => {
  const snapshot = uniqueShiftSnapshot(record, shiftId)
  const candidateStoreId = identity(record.storeId || snapshot?.storeId)
  const definition = uniqueShiftDefinition(shiftDefinitions, shiftId, candidateStoreId)
  const storeId = identity(record.storeId || snapshot?.storeId || definition?.storeId)
  const ids = shiftIdsOf(record)
  const legacyApplies = ids.length <= 1 || sameIdentifier(record.shiftId, shiftId)
  const legacyName = legacyApplies ? nonEmpty(record.shiftName, record.name) : undefined
  const legacyStart = legacyApplies ? nonEmpty(record.shiftStart, record.start) : undefined
  const legacyEnd = legacyApplies ? nonEmpty(record.shiftEnd, record.end) : undefined

  return {
    id: identity(shiftId),
    storeId,
    name: nonEmpty(snapshot?.name, definition?.name, legacyName) || identity(shiftId) || 'Ca làm việc',
    start: nonEmpty(snapshot?.start, definition?.start, legacyStart) || '',
    end: nonEmpty(snapshot?.end, definition?.end, legacyEnd) || '',
    supportTransferId: nonEmpty(snapshot?.supportTransferId, definition?.supportTransferId, record.supportTransferId) || '',
  }
}

const matchingSupportTransfer = ({ supportTransfers, employeeIds, shift, date }) => {
  const window = shiftWindow(date, shift)
  if (!window || !identity(shift.storeId)) return null

  const candidates = values(supportTransfers).flatMap((transfer) => {
    if (!transferIsVisible(transfer)
      || !recordMatchesEmployee(transfer, employeeIds)
      || !sameIdentifier(transfer.toStoreId, shift.storeId)
      || (shift.supportTransferId && !sameIdentifier(transfer.id, shift.supportTransferId))) return []
    const bounds = supportTransferBounds(transfer)
    return bounds && bounds.startMs <= window.startMs && window.endMs <= bounds.endMs
      ? [{ transfer, bounds }]
      : []
  })

  return candidates.length === 1 ? candidates[0] : null
}

export function employeeScheduleRows({ schedule = [], shiftDefinitions = [], supportTransfers = [], stores = [], employee = {}, range = {} } = {}) {
  const employeeIds = employeeReferences(employee)
  if (!employeeIds.size) return []
  const homeStoreId = identity(employee.storeId)
  const storesById = new Map(values(stores).map((store) => [identityKey(store.id), store]))

  return values(schedule).flatMap((record) => {
    if (!assignmentIsVisible(record) || !recordMatchesEmployee(record, employeeIds)) return []
    const date = identity(record.date || record.workDate).slice(0, 10)
    if (!date || (range.from && date < range.from) || (range.to && date > range.to)) return []

    return shiftIdsOf(record).map((shiftId, index) => {
      const shift = resolveScheduledShift(record, shiftId, shiftDefinitions)
      // The recorded transfer wins over the employee's current home store.
      // This keeps a completed support shift historical even if the employee is
      // later moved permanently to either the former source or destination.
      const support = matchingSupportTransfer({ supportTransfers, employeeIds, shift, date })
      const isHome = !support && sameIdentifier(shift.storeId, homeStoreId)
      const kind = isHome ? 'home' : support ? 'support' : 'other'
      const transfer = support?.transfer
      const store = storesById.get(identityKey(shift.storeId))
      const storeFallback = kind === 'home'
        ? 'Cửa hàng chính'
        : kind === 'support' ? 'Cửa hàng hỗ trợ' : 'Cửa hàng chưa xác định'

      return {
        id: `${record.id || `${[...employeeIds][0]}-${date}`}:${shiftId || index}`,
        kind,
        date,
        storeId: shift.storeId,
        storeName: store?.name || record.storeName || shift.storeId || storeFallback,
        shiftName: shift.name,
        start: shift.start,
        end: shift.end,
        supportTransferId: transfer?.id || '',
        startAt: support?.bounds.startLocal,
        endAt: support?.bounds.endLocal,
        hourlyRate: support ? Number(transfer.hourlySupportRate ?? transfer.hourlyRate ?? 0) || 0 : undefined,
        allowance: support ? Number(transfer.allowance || 0) || 0 : undefined,
        note: record.note || transfer?.note || '',
        status: transfer?.status,
      }
    })
  }).sort((left, right) => (
    String(left.date).localeCompare(String(right.date))
    || String(left.start).localeCompare(String(right.start))
    || String(left.id).localeCompare(String(right.id))
  ))
}

export const employeeScheduleDate = dateValue
