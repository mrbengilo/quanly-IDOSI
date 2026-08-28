import { createFinanceTransaction, selectFinanceSummary } from './finance'
import { isNonNegativeSafeIntegerAmount } from './recordCompatibility'

export function financeTransactionsFromState(state = {}) {
  const orderTransactions = (state.orders || [])
    .filter((order) => !order.deletedAt && order.status !== 'Đã xóa' && isNonNegativeSafeIntegerAmount(order.amount))
    .map((order) => createFinanceTransaction({
      id: `order:${order.id}`,
      storeId: order.storeId,
      direction: 'in',
      type: 'Doanh thu đơn hàng',
      category: 'orders',
      amount: Number(order.amount),
      status: 'completed',
      occurredAt: order.createdAt,
      sourceType: 'order',
      sourceId: order.id,
      employeeId: order.employeeId,
      shiftId: order.shiftId,
      paymentMethod: order.paymentMethod,
    }))

  const expenseTransactions = (state.expenseEntries || [])
    .filter((entry) => entry.recognized !== false && !entry.deletedAt && isNonNegativeSafeIntegerAmount(entry.amount))
    .map((entry) => createFinanceTransaction({
      id: `expense:${entry.id}`,
      storeId: entry.storeId,
      direction: 'out',
      type: entry.type || entry.category || 'Chi phí khác',
      category: entry.category || 'other',
      amount: Number(entry.amount),
      status: 'confirmed',
      occurredAt: entry.occurredAt || entry.createdAt,
      sourceType: entry.sourceType || 'expense-entry',
      sourceId: entry.sourceId || entry.id,
      employeeId: entry.employeeId,
      shiftId: entry.shiftId,
    }))

  return [...orderTransactions, ...expenseTransactions]
}

export function financeSummaryFromState(state = {}, filters = {}) {
  return selectFinanceSummary(financeTransactionsFromState(state), filters)
}
