import { businessDate } from '../../utils'

const normalize = (value) => String(value || '').trim().toLocaleLowerCase('vi-VN')

export const cashflowTransactionDate = (transaction = {}) => businessDate(
  transaction.occurredAt || transaction.createdAt || transaction.updatedAt || transaction.date || '',
)

export const cashflowSourceDates = (transactions = [], currentDate) => {
  const previousDates = [...new Set((Array.isArray(transactions) ? transactions : [])
    .map(cashflowTransactionDate)
    .filter((date) => date && date <= currentDate && date !== currentDate))]
    .sort((left, right) => right.localeCompare(left))
  return [currentDate, ...previousDates]
}

export const cashflowSourceRowsForDate = (transactions = [], date) => {
  const groups = new Map()
  for (const transaction of Array.isArray(transactions) ? transactions : []) {
    if (cashflowTransactionDate(transaction) !== date) continue
    const sourceType = normalize(transaction.sourceType)
    const direction = normalize(transaction.direction) === 'out' ? 'out' : 'in'
    const storeId = String(transaction.storeId || '').trim()
    const orderRevenue = sourceType === 'order' && direction === 'in'
    const source = orderRevenue
      ? 'Tổng doanh thu đơn hàng'
      : String(transaction.source || transaction.type || transaction.sourceType || 'Giao dịch').trim()
    const category = orderRevenue
      ? 'Đơn hàng trong ngày'
      : String(transaction.category || transaction.type || 'Khác').trim()
    const key = orderRevenue
      ? `${date}:${storeId}:order-revenue`
      : `${date}:${storeId}:${direction}:${sourceType}:${normalize(source)}:${normalize(category)}`
    const current = groups.get(key) || {
      id: key,
      date,
      storeId,
      direction,
      sourceType: orderRevenue ? 'order' : sourceType,
      source,
      category,
      count: 0,
      amount: 0,
    }
    current.count += 1
    current.amount += Number(transaction.amount || 0)
    groups.set(key, current)
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      detail: row.sourceType === 'order'
        ? `${row.count.toLocaleString('vi-VN')} đơn hàng`
        : row.count > 1
          ? `${row.category} · ${row.count.toLocaleString('vi-VN')} giao dịch`
          : row.category,
    }))
    .sort((left, right) => (
      Number(right.sourceType === 'order') - Number(left.sourceType === 'order')
      || left.direction.localeCompare(right.direction)
      || left.source.localeCompare(right.source, 'vi-VN')
      || left.storeId.localeCompare(right.storeId, 'vi-VN')
    ))
}
