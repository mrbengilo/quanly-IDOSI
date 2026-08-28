import { activeSupportTransferOverlapsDate, supportTransferOverlapsDate } from './supportTransferTime.js'
import { employeeIdentifierAliases } from './recordCompatibility.js'

const text = (value) => String(value || '').trim()

const transferMatchesEmployee = (transfer = {}, employee = {}) => {
  const aliases = new Set(employeeIdentifierAliases(employee))
  if (!aliases.size) return false
  const references = [transfer.employeeId, transfer.employeeCode].map(text).filter(Boolean)
  return references.length > 0 && references.every((reference) => aliases.has(reference))
}

export const activeSupportDestinationStoreIdsOnDate = (supportTransfers = [], employee = {}, date = '') => (
  [...new Set((Array.isArray(supportTransfers) ? supportTransfers : [])
    .filter((transfer) => (
      transferMatchesEmployee(transfer, employee)
      && text(transfer?.toStoreId)
      && activeSupportTransferOverlapsDate(transfer, date)
    ))
    .map((transfer) => text(transfer.toStoreId)))]
)

export const historicalSupportDestinationStoreIdsOnDate = (supportTransfers = [], employee = {}, date = '') => (
  [...new Set((Array.isArray(supportTransfers) ? supportTransfers : [])
    .filter((transfer) => (
      transferMatchesEmployee(transfer, employee)
      && text(transfer?.toStoreId)
      && supportTransferOverlapsDate(transfer, date)
    ))
    .map((transfer) => text(transfer.toStoreId)))]
)

export const employeeWorksAtStoreOnDate = ({ supportTransfers = [], employee = {}, storeId = '', date = '' } = {}) => {
  const selectedStoreId = text(storeId)
  if (!selectedStoreId || !employeeIdentifierAliases(employee).length) return false
  return text(employee.storeId) === selectedStoreId
    || activeSupportDestinationStoreIdsOnDate(supportTransfers, employee, date).includes(selectedStoreId)
}

export const employeeHistoricallyWorkedAtStoreOnDate = ({ supportTransfers = [], employee = {}, storeId = '', date = '' } = {}) => {
  const selectedStoreId = text(storeId)
  if (!selectedStoreId || !employeeIdentifierAliases(employee).length) return false
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
