import { activeSupportTransferOverlapsDate, supportTransferOverlapsDate } from './supportTransferTime.js'

const text = (value) => String(value || '').trim()
const employeeId = (employee = {}) => text(employee.id || employee.code || employee.employeeId)

export const activeSupportDestinationStoreIdsOnDate = (supportTransfers = [], employee = {}, date = '') => (
  [...new Set((Array.isArray(supportTransfers) ? supportTransfers : [])
    .filter((transfer) => (
      text(transfer?.employeeId) === employeeId(employee)
      && text(transfer?.toStoreId)
      && activeSupportTransferOverlapsDate(transfer, date)
    ))
    .map((transfer) => text(transfer.toStoreId)))]
)

export const historicalSupportDestinationStoreIdsOnDate = (supportTransfers = [], employee = {}, date = '') => (
  [...new Set((Array.isArray(supportTransfers) ? supportTransfers : [])
    .filter((transfer) => (
      text(transfer?.employeeId) === employeeId(employee)
      && text(transfer?.toStoreId)
      && supportTransferOverlapsDate(transfer, date)
    ))
    .map((transfer) => text(transfer.toStoreId)))]
)

export const employeeWorksAtStoreOnDate = ({ supportTransfers = [], employee = {}, storeId = '', date = '' } = {}) => {
  const selectedStoreId = text(storeId)
  if (!selectedStoreId || !employeeId(employee)) return false
  return text(employee.storeId) === selectedStoreId
    || activeSupportDestinationStoreIdsOnDate(supportTransfers, employee, date).includes(selectedStoreId)
}

export const employeeHistoricallyWorkedAtStoreOnDate = ({ supportTransfers = [], employee = {}, storeId = '', date = '' } = {}) => {
  const selectedStoreId = text(storeId)
  if (!selectedStoreId || !employeeId(employee)) return false
  return text(employee.storeId) === selectedStoreId
    || historicalSupportDestinationStoreIdsOnDate(supportTransfers, employee, date).includes(selectedStoreId)
}

// Storeless historical rows need one provable owner. A recorded destination
// assignment takes precedence over the employee's home store; competing
// destinations are intentionally ambiguous and therefore return no store.
export const effectiveEmployeeStoreOnDate = ({ supportTransfers = [], employee = {}, date = '' } = {}) => {
  const destinations = historicalSupportDestinationStoreIdsOnDate(supportTransfers, employee, date)
  if (destinations.length === 1) return destinations[0]
  if (destinations.length > 1) return ''
  return text(employee.storeId)
}
