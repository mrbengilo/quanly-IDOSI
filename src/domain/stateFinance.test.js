import { describe, expect, it } from 'vitest'
import { financeSummaryFromState, financeTransactionsFromState } from './stateFinance'

describe('violation refund finance projection', () => {
  const recognizedRefund = {
    id: 'violation-refund:v1:VIO-01',
    sourceType: 'support-violation-refund',
    sourceId: 'VIO-01',
    violationId: 'VIO-01',
    storeId: 'S02',
    employeeId: 'E01',
    shiftId: 'AM',
    amountVnd: 5_000,
    status: 'RECOGNIZED',
    recognized: true,
    occurredOn: '2026-08-31',
    recognizedAt: '2026-09-02T03:00:00.000Z',
  }

  it('adds only recognized active refunds to destination revenue without creating a cash transaction', () => {
    const state = {
      orders: [{
        id: 'ORD-01', storeId: 'S02', amount: 100_000, status: 'Hoàn tất',
        createdAt: '2026-08-31T09:00:00.000Z',
      }],
      violationRefunds: [
        recognizedRefund,
        { ...recognizedRefund, id: 'VRF-PENDING', sourceId: 'VIO-PENDING', status: 'PENDING_PAYROLL', recognized: false, amountVnd: 7_000 },
        { ...recognizedRefund, id: 'VRF-VOID', sourceId: 'VIO-VOID', status: 'VOID', voidedAt: '2026-09-02T04:00:00.000Z' },
      ],
      expenseEntries: [],
      cashTransactions: [],
    }

    const transactions = financeTransactionsFromState(state)
    const summary = financeSummaryFromState(state, {
      storeId: 'S02', from: '2026-08-01', to: '2026-08-31',
    })

    expect(transactions.filter((transaction) => transaction.category === 'violation-refund')).toEqual([
      expect.objectContaining({
        storeId: 'S02', direction: 'in', amount: 5_000,
        sourceType: 'support-violation-refund', sourceId: 'VIO-01',
      }),
    ])
    expect(summary.revenue).toBe(105_000)
    expect(state.cashTransactions).toEqual([])
  })

  it('keeps the refund in the violation work month even when payroll recognizes it later', () => {
    const state = { orders: [], expenseEntries: [], violationRefunds: [recognizedRefund] }

    expect(financeSummaryFromState(state, {
      storeId: 'S02', from: '2026-08-01', to: '2026-08-31',
    }).revenue).toBe(5_000)
    expect(financeSummaryFromState(state, {
      storeId: 'S02', from: '2026-09-01', to: '2026-09-30',
    }).revenue).toBe(0)
  })
})
