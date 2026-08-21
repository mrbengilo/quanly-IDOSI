import { businessDate } from '../../utils'

const monthBefore = (period) => {
  const [year, month] = String(period).split('-').map(Number)
  if (!year || !month) return ''
  const date = new Date(Date.UTC(year, month - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const previousDay = (date) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

const growth = (current, previous) => {
  if (!previous && !current) return { percent: 0, label: 'Ổn định', tone: 'blue' }
  if (!previous) return { percent: 100, label: 'Tăng trưởng mới', tone: 'green' }
  const percent = ((current - previous) / Math.abs(previous)) * 100
  if (percent > 1) return { percent, label: 'Tăng trưởng', tone: 'green' }
  if (percent < -1) return { percent, label: 'Suy giảm', tone: 'red' }
  return { percent, label: 'Ổn định', tone: 'blue' }
}

const emptyRow = (key) => ({ key, orders: 0, revenue: 0, expense: 0, profit: 0, shifts: {}, expenses: {} })
const addAmount = (target, key, amount) => { target[key] = (target[key] || 0) + Number(amount || 0) }

export function storeDailyReportRows({ transactions = [], orders = [], storeId, period } = {}) {
  const rows = new Map()
  ;(Array.isArray(transactions) ? transactions : []).forEach((transaction) => {
    if (String(transaction.storeId || '') !== String(storeId || '')) return
    const date = businessDate(transaction.occurredAt || transaction.createdAt)
    if (!date || !date.startsWith(period)) return
    const row = rows.get(date) || emptyRow(date)
    if (transaction.direction === 'in') row.revenue += Number(transaction.amount || 0)
    if (transaction.direction === 'out') {
      row.expense += Number(transaction.amount || 0)
      addAmount(row.expenses, transaction.type || transaction.category || 'Chi phí khác', transaction.amount)
    }
    rows.set(date, row)
  })
  ;(Array.isArray(orders) ? orders : []).forEach((order) => {
    if (order.deletedAt || String(order.storeId || '') !== String(storeId || '')) return
    const date = businessDate(order.createdAt)
    if (!date || !date.startsWith(period)) return
    const row = rows.get(date) || emptyRow(date)
    row.orders += 1
    addAmount(row.shifts, order.shiftName || order.shiftId || 'Chưa gắn ca', order.amount)
    rows.set(date, row)
  })
  const values = [...rows.values()].map((row) => ({ ...row, profit: row.revenue - row.expense }))
  const byDate = new Map(values.map((row) => [row.key, row]))
  return values.map((row) => ({
    ...row,
    comparison: growth(row.profit, byDate.get(previousDay(row.key))?.profit || 0),
  })).sort((left, right) => right.key.localeCompare(left.key))
}

export function storeMonthlyReportRows({ transactions = [], orders = [], storeId, period } = {}) {
  const periods = [monthBefore(period), period].filter(Boolean)
  const rows = periods.map((month) => {
    const row = emptyRow(month)
    ;(Array.isArray(transactions) ? transactions : []).forEach((transaction) => {
      if (String(transaction.storeId || '') !== String(storeId || '') || !businessDate(transaction.occurredAt || transaction.createdAt).startsWith(month)) return
      if (transaction.direction === 'in') row.revenue += Number(transaction.amount || 0)
      if (transaction.direction === 'out') {
        row.expense += Number(transaction.amount || 0)
        addAmount(row.expenses, transaction.type || transaction.category || 'Chi phí khác', transaction.amount)
      }
    })
    ;(Array.isArray(orders) ? orders : []).forEach((order) => {
      if (order.deletedAt || String(order.storeId || '') !== String(storeId || '') || !businessDate(order.createdAt).startsWith(month)) return
      row.orders += 1
      addAmount(row.shifts, order.shiftName || order.shiftId || 'Chưa gắn ca', order.amount)
    })
    row.profit = row.revenue - row.expense
    return row
  })
  const previous = rows[0] || emptyRow('')
  const current = rows.at(-1) || emptyRow(period)
  return [{ ...current, comparison: growth(current.profit, previous.profit), previous }]
}

export const storeReportGrowth = growth
