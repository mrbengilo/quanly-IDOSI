import { supportTransferBounds } from '../../domain/supportTransferTime'
import { displayScheduleRecordShifts } from '../../domain/scheduleResolution'

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

const identity = (value) => String(value || '')
const transferIsVisible = (transfer = {}) => !transfer.deletedAt && !['Đã xóa', 'Đã hủy'].includes(String(transfer.status || ''))

export function employeeScheduleRows({ schedule = [], shiftDefinitions = [], supportTransfers = [], stores = [], employee = {}, range = {} } = {}) {
  const employeeId = identity(employee.id || employee.code || employee.employeeId)
  const storesById = new Map(stores.map((store) => [identity(store.id), store]))
  const regularRows = (Array.isArray(schedule) ? schedule : []).flatMap((record) => {
    if (identity(record.employeeId || record.employeeCode) !== employeeId) return []
    const date = String(record.date || record.workDate || '').slice(0, 10)
    if (!date || (range.from && date < range.from) || (range.to && date > range.to)) return []
    const selectedStoreId = identity(record.storeId || employee.storeId)
    return displayScheduleRecordShifts({
      record, shiftDefinitions, selectedStoreId, employeeStoreId: identity(employee.storeId),
    }).map((shift, index) => {
      const shiftId = identity(shift.id)
      const storeId = identity(record.storeId || shift.storeId || employee.storeId)
      return {
        id: `${record.id || `${employeeId}-${date}`}:${shiftId || index}`,
        kind: 'schedule',
        date,
        storeId,
        storeName: storesById.get(storeId)?.name || record.storeName || storeId || 'Cửa hàng chính',
        shiftName: shift.unresolved ? 'Ca không xác định' : shift.name || record.shiftName || shiftId || 'Ca làm việc',
        start: shift.start || record.shiftStart || '',
        end: shift.end || record.shiftEnd || '',
        unresolved: Boolean(shift.unresolved),
        resolutionNote: shift.unresolved ? 'Thiếu dữ liệu ca' : '',
        note: record.note || '',
      }
    })
  })
  const transferRows = (Array.isArray(supportTransfers) ? supportTransfers : []).flatMap((transfer) => {
    if (!transferIsVisible(transfer) || identity(transfer.employeeId) !== employeeId) return []
    const bounds = supportTransferBounds(transfer)
    if (!bounds) return []
    const from = bounds.startLocal.slice(0, 10)
    const to = bounds.endLocal.slice(0, 10)
    if ((range.from && to < range.from) || (range.to && from > range.to)) return []
    const storeId = identity(transfer.toStoreId)
    return [{
      id: `transfer:${transfer.id}`,
      kind: 'support',
      date: from,
      storeId,
      storeName: storesById.get(storeId)?.name || transfer.supportStoreName || storeId || 'Cửa hàng hỗ trợ',
      shiftName: 'Ca hỗ trợ',
      start: bounds.startLocal.slice(11),
      end: bounds.endLocal.slice(11),
      startAt: bounds.startLocal,
      endAt: bounds.endLocal,
      hourlyRate: Number(transfer.hourlySupportRate || transfer.hourlyRate || 0),
      allowance: Number(transfer.allowance || 0),
      note: transfer.note || '',
      status: transfer.status || 'Đã duyệt',
    }]
  })
  return [...regularRows, ...transferRows].sort((left, right) => (
    String(left.date).localeCompare(String(right.date))
    || String(left.start).localeCompare(String(right.start))
    || String(left.id).localeCompare(String(right.id))
  ))
}

export const employeeScheduleDate = dateValue
