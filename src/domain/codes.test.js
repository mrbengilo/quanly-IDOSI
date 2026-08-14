import { describe, expect, it } from 'vitest'
import {
  allocateImportCode,
  allocateOrderCode,
  createAuditRecord,
  deriveImportCounter,
  deriveOrderCounter,
  diffRecords,
  reserveNextSequence,
} from './codes'

describe('order and import sequences', () => {
  it('allocates independent five-digit order sequences per store without mutating counters', () => {
    const counters = { SM234: 4, TH: 9 }
    const sm = allocateOrderCode({ storeCode: 'SM234', counters })
    const th = allocateOrderCode({ storeCode: 'TH', counters: sm.counters })
    expect(sm.code).toBe('SM234-00005')
    expect(th.code).toBe('TH-00010')
    expect(counters).toEqual({ SM234: 4, TH: 9 })
  })

  it('derives the maximum sequence including deleted records so codes are never reused', () => {
    const records = [
      { code: 'SM234-00001' },
      { code: 'SM234-00008', deletedAt: '2026-08-13' },
      { code: 'TH-00099' },
    ]
    const current = deriveOrderCounter(records, 'SM234')
    expect(current).toBe(8)
    expect(allocateOrderCode({ storeCode: 'SM234', counters: { SM234: current } }).code).toBe('SM234-00009')
  })

  it('uses a global import counter that does not reset when the date changes', () => {
    const first = allocateImportCode({ date: '2026-08-13', counter: 0 })
    const second = allocateImportCode({ date: '14/08/2026', counter: first.counter })
    expect(first.code).toBe('PN-13082026-00001')
    expect(second.code).toBe('PN-14082026-00002')
    expect(deriveImportCounter([first.code, second.code])).toBe(2)
  })

  it('detects optimistic counter conflicts and exhaustion', () => {
    expect(() => reserveNextSequence(4, { expectedCounter: 3 })).toThrow('SEQUENCE_CONFLICT')
    expect(() => reserveNextSequence(99_999)).toThrow('SEQUENCE_EXHAUSTED')
  })
})

describe('audit helpers', () => {
  it('captures before, after, changed fields, actor, and revenue changes', () => {
    const before = { amount: 500_000, customer: { phone: '0901000001', name: 'An' }, status: 'Hoàn tất' }
    const after = { amount: 650_000, customer: { phone: '0901000002', name: 'An' }, status: 'Hoàn tất' }
    const audit = createAuditRecord({
      id: 'AUD-1',
      entityType: 'order',
      entityId: 'SM234-00001',
      action: 'update',
      before,
      after,
      actor: { id: 'QL001', name: 'Quản lý', role: 'store' },
      occurredAt: '2026-08-13T10:00:00+07:00',
      reason: 'Sửa số tiền theo hóa đơn',
      metadata: { revenueBefore: 500_000, revenueAfter: 650_000 },
    })
    expect(audit.changedFields).toEqual(['amount', 'customer.phone'])
    expect(audit.metadata).toEqual({ revenueBefore: 500_000, revenueAfter: 650_000 })
    before.amount = 0
    expect(audit.before.amount).toBe(500_000)
  })

  it('lists every removed field for a deletion snapshot', () => {
    expect(diffRecords({ id: 'A', amount: 10, nested: { value: 2 } }, null).map((change) => change.field)).toEqual([
      'amount',
      'id',
      'nested.value',
    ])
  })
})
