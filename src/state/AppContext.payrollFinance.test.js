import { describe, expect, it } from 'vitest'
import { buildLocalPayrollFinanceSnapshot } from './AppContext'

describe('buildLocalPayrollFinanceSnapshot', () => {
  it('recognizes earned payroll once and excludes advance/payment settlement rows', () => {
    const snapshot = buildLocalPayrollFinanceSnapshot({
      storeId: 'CH001',
      period: '2026-08',
      netPayrollExpense: 23_500_000,
      state: {
        orders: [{
          id: 'ORDER-1',
          storeId: 'CH001',
          amount: 100_000_000,
          status: 'Hoàn tất',
          createdAt: '2026-08-20T03:00:00.000Z',
        }],
        expenseEntries: [
          { id: 'NON-PAYROLL', storeId: 'CH001', amount: 50_000_000, recognized: true, occurredAt: '2026-08-20T03:00:00.000Z' },
          { id: 'ADVANCE', storeId: 'CH001', amount: 5_000_000, recognized: true, sourceType: 'salary-advance', occurredAt: '2026-08-20T03:00:00.000Z' },
          { id: 'PAYMENT', storeId: 'CH001', amount: 18_500_000, recognized: true, sourceType: 'payroll-payment', occurredAt: '2026-08-20T03:00:00.000Z' },
          { id: 'OLD-ACCRUAL', storeId: 'CH001', amount: 23_500_000, recognized: true, sourceType: 'payroll-accrual', occurredAt: '2026-08-20T03:00:00.000Z' },
        ],
      },
    })

    expect(snapshot).toMatchObject({
      revenue: 100_000_000,
      recognizedExpense: 50_000_000,
      nonPayrollExpense: 50_000_000,
      netPayrollExpense: 23_500_000,
      expense: 73_500_000,
      profit: 26_500_000,
    })
  })
})
