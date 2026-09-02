import { createFinanceTransaction, selectFinanceSummary } from './finance'

const validInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0

export function financeTransactionsFromState(state = {}) {
  const orderTransactions = (state.orders || [])
    .filter((order) => !order.deletedAt && order.status !== 'Đã xóa' && validInteger(order.amount))
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
    .filter((entry) => entry.recognized !== false && !entry.deletedAt && validInteger(entry.amount))
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

  const violationRefundTransactions = (state.violationRefunds || [])
    .filter((refund) => (
      refund.recognized === true
      && String(refund.status || '').toUpperCase() === 'RECOGNIZED'
      && !refund.deletedAt
      && !refund.voidedAt
      && validInteger(refund.amountVnd ?? refund.amount)
    ))
    .map((refund) => createFinanceTransaction({
      id: `violation-refund:${refund.id}`,
      storeId: refund.storeId || refund.supportStoreId,
      direction: 'in',
      type: 'Hoàn trả vi phạm',
      category: 'violation-refund',
      amount: Number(refund.amountVnd ?? refund.amount),
      status: 'confirmed',
      // The credit belongs to the violation's business period even when the
      // payroll that establishes the actually collected amount closes later.
      occurredAt: refund.occurredOn || refund.recognizedAt || refund.createdAt,
      sourceType: refund.sourceType || 'support-violation-refund',
      sourceId: refund.sourceId || refund.violationId || refund.id,
      employeeId: refund.employeeId,
      shiftId: refund.shiftId,
    }))

  return [...orderTransactions, ...violationRefundTransactions, ...expenseTransactions]
}

export function financeSummaryFromState(state = {}, filters = {}) {
  return selectFinanceSummary(financeTransactionsFromState(state), filters)
}
