import { describe, expect, it } from 'vitest'
import {
  createFinanceTransaction,
  financeTransactionKey,
  selectFinanceSummary,
  selectFinanceTransactions,
  upsertFinanceTransaction,
} from './finance'

const transaction = (overrides = {}) => createFinanceTransaction({
  id: overrides.id || 'TX-1',
  storeId: 'CH001',
  direction: 'in',
  type: 'order_revenue',
  category: 'orders',
  amount: 1_000_000,
  status: 'confirmed',
  occurredAt: '2026-08-13T09:00:00+07:00',
  ...overrides,
})

describe('finance single-source ledger', () => {
  it('filters by store and inclusive period and ignores unrecognized or voided entries', () => {
    const rows = [
      transaction({ id: 'A', amount: 1_000_000 }),
      transaction({ id: 'B', storeId: 'CH002', amount: 9_000_000 }),
      transaction({ id: 'C', amount: 200_000, direction: 'out', type: 'fixed_expense', status: 'pending' }),
      transaction({ id: 'D', amount: 300_000, direction: 'out', type: 'fixed_expense', voidedAt: '2026-08-14' }),
      transaction({ id: 'E', amount: 100_000, direction: 'out', type: 'fixed_expense', occurredAt: '2026-07-31' }),
      transaction({ id: 'F', amount: 250_000, direction: 'out', type: 'fixed_expense', occurredAt: '2026-08-31' }),
    ]
    const selected = selectFinanceTransactions(rows, { storeId: 'CH001', from: '2026-08-01', to: '2026-08-31' })
    expect(selected.map((row) => row.id)).toEqual(['A', 'F'])
    expect(selectFinanceSummary(rows, { storeId: 'CH001', period: '01/08/2026 - 31/08/2026' })).toMatchObject({
      revenue: 1_000_000,
      expense: 250_000,
      profit: 750_000,
      marginPercent: 75,
    })
  })

  it('deduplicates retry records by idempotency key and uses the latest state', () => {
    const first = transaction({ id: 'A', idempotencyKey: 'order:SM234-00001', amount: 900_000 })
    const retried = transaction({ id: 'B', idempotencyKey: 'order:SM234-00001', amount: 1_000_000 })
    const summary = selectFinanceSummary([first, retried], { storeId: 'CH001' })
    expect(summary.transactions).toHaveLength(1)
    expect(summary.revenue).toBe(1_000_000)
  })

  it('keeps the same idempotency key separate across stores', () => {
    const firstStore = transaction({ id: 'A', storeId: 'CH001', idempotencyKey: 'order:ORDER-00001', amount: 800_000 })
    const secondStore = transaction({ id: 'B', storeId: 'CH002', idempotencyKey: 'order:ORDER-00001', amount: 900_000 })
    expect(financeTransactionKey(firstStore)).not.toBe(financeTransactionKey(secondStore))
    const inserted = upsertFinanceTransaction([firstStore], secondStore)
    expect(inserted.inserted).toBe(true)
    expect(inserted.transactions).toHaveLength(2)
  })

  it('upserts a logical source instead of creating duplicate finance rows', () => {
    const initial = transaction({ id: 'A', sourceType: 'order', sourceId: 'SM234-00001', amount: 800_000 })
    const result = upsertFinanceTransaction([initial], {
      ...initial,
      id: 'B',
      amount: 850_000,
    })
    expect(result.inserted).toBe(false)
    expect(result.updated).toBe(true)
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].amount).toBe(850_000)
  })

  it('keeps the same logical source separate across stores', () => {
    const firstStore = transaction({
      id: 'A', storeId: 'CH001', sourceType: 'order', sourceId: 'ORDER-00001', amount: 800_000,
    })
    const secondStore = transaction({
      id: 'B', storeId: 'CH002', sourceType: 'order', sourceId: 'ORDER-00001', amount: 900_000,
    })
    expect(financeTransactionKey(firstStore)).not.toBe(financeTransactionKey(secondStore))
    const inserted = upsertFinanceTransaction([firstStore], secondStore)
    expect(inserted.inserted).toBe(true)
    expect(inserted.transactions).toHaveLength(2)
    expect(selectFinanceSummary(inserted.transactions, { storeId: 'CH001' }).revenue).toBe(800_000)
    expect(selectFinanceSummary(inserted.transactions, { storeId: 'CH002' }).revenue).toBe(900_000)
  })

  it('keeps multiple legitimate fixed-expense records even when their type and date match', () => {
    const rows = [
      transaction({ id: 'ELEC-1', sourceType: 'fixedExpense', sourceId: 'ELEC-1', direction: 'out', type: 'electricity', amount: 300_000 }),
      transaction({ id: 'ELEC-2', sourceType: 'fixedExpense', sourceId: 'ELEC-2', direction: 'out', type: 'electricity', amount: 450_000 }),
    ]
    const summary = selectFinanceSummary(rows, { storeId: 'CH001' })
    expect(summary.transactions).toHaveLength(2)
    expect(summary.expense).toBe(750_000)
    expect(summary.expenseByType.electricity).toBe(750_000)
  })

  it('assigns UTC server timestamps to the correct Vietnam accounting month', () => {
    const boundary = transaction({ id: 'VN-MONTH', occurredAt: '2026-08-31T17:30:00.000Z' })
    expect(selectFinanceSummary([boundary], { storeId: 'CH001', from: '2026-08-01', to: '2026-08-31' }).revenue).toBe(0)
    expect(selectFinanceSummary([boundary], { storeId: 'CH001', from: '2026-09-01', to: '2026-09-30' }).revenue).toBe(1_000_000)
  })

  it('rejects fractional or negative VND values', () => {
    expect(() => transaction({ amount: -1 })).toThrow(TypeError)
    expect(() => transaction({ amount: 1.5 })).toThrow(TypeError)
  })
})
