import { describe, expect, it } from 'vitest'
import {
  MANAGER_REVENUE_BONUS_FORMULA_VERSION,
  MANAGER_REVENUE_BONUS_RATE_PERCENT,
  assertExactlyOneActiveStoreManager,
  calculateManagerMonthlyRevenueBonus,
  managerRevenueBonusIdempotencyKey,
  resolveExactlyOneActiveStoreManager,
} from './managerRevenueBonus.js'

describe('manager monthly revenue bonus', () => {
  it('calculates exactly 2% of final profit with integer-VND floor rounding', () => {
    expect(calculateManagerMonthlyRevenueBonus({ profitBeforeManagerBonusVnd: 1_020_000 })).toEqual({
      formulaVersion: MANAGER_REVENUE_BONUS_FORMULA_VERSION,
      ratePercent: MANAGER_REVENUE_BONUS_RATE_PERCENT,
      profitBeforeManagerBonusVnd: 1_020_000,
      bonusVnd: 20_000,
      finalProfitVnd: 1_000_000,
    })
  })

  it('floors fractional VND and never creates a negative bonus', () => {
    expect(calculateManagerMonthlyRevenueBonus({ profitBeforeManagerBonusVnd: 101 })).toMatchObject({
      bonusVnd: 1,
      finalProfitVnd: 100,
    })
    expect(calculateManagerMonthlyRevenueBonus({ profitBeforeManagerBonusVnd: 0 })).toMatchObject({
      bonusVnd: 0,
      finalProfitVnd: 0,
    })
    expect(calculateManagerMonthlyRevenueBonus({ profitBeforeManagerBonusVnd: -500_000 })).toMatchObject({
      bonusVnd: 0,
      finalProfitVnd: -500_000,
    })
  })

  it('rejects decimal or non-numeric VND inputs instead of rounding silently', () => {
    expect(() => calculateManagerMonthlyRevenueBonus({ profitBeforeManagerBonusVnd: 100.5 }))
      .toThrow('profitBeforeManagerBonusVnd must be an integer amount in VND.')
    expect(() => calculateManagerMonthlyRevenueBonus({ profitBeforeManagerBonusVnd: 'abc' }))
      .toThrow('profitBeforeManagerBonusVnd must be an integer amount in VND.')
  })
})

describe('single active store manager resolution', () => {
  const activeManager = {
    id: 'QLCH-001',
    linkedEmployeeId: 'NV-001',
    unit: 'store_manager',
    storeId: 'CH001',
    status: 'Đang làm việc',
  }

  it('resolves exactly one active manager in the requested store', () => {
    const result = resolveExactlyOneActiveStoreManager({
      storeId: 'CH001',
      managers: [
        activeManager,
        { ...activeManager, id: 'AUTH-001', employeeId: 'NV-001', linkedEmployeeId: undefined, role: 'store_manager' },
        { id: 'QLCH-OLD', unit: 'store_manager', storeId: 'CH001', status: 'Đã nghỉ việc' },
        { id: 'QLCH-OTHER', unit: 'store_manager', storeId: 'CH002', status: 'Đang làm việc' },
      ],
    })

    expect(result).toMatchObject({
      ok: true,
      code: 'STORE_MANAGER_RESOLVED',
      storeId: 'CH001',
      managerId: 'NV-001',
      manager: activeManager,
    })
    expect(result.matches).toHaveLength(1)

    expect(resolveExactlyOneActiveStoreManager({
      storeId: 'ch001',
      managers: [activeManager],
    })).toMatchObject({ ok: true, managerId: 'NV-001' })
  })

  it('returns a clear error when a store has no active manager', () => {
    expect(resolveExactlyOneActiveStoreManager({
      storeId: 'CH001',
      managers: [{ ...activeManager, deletedAt: '2026-08-26T00:00:00.000Z' }],
    })).toEqual({
      ok: false,
      code: 'STORE_MANAGER_REQUIRED',
      storeId: 'CH001',
      manager: null,
      managerId: null,
      matches: [],
    })
  })

  it('treats the legacy Tạm nghỉ status as inactive', () => {
    expect(resolveExactlyOneActiveStoreManager({
      storeId: 'CH001',
      managers: [{ ...activeManager, status: 'Tạm nghỉ' }],
    })).toMatchObject({
      ok: false,
      code: 'STORE_MANAGER_REQUIRED',
      matches: [],
    })
  })

  it('reports multiple active managers without deleting or choosing either record', () => {
    const secondManager = { ...activeManager, id: 'QLCH-002', linkedEmployeeId: 'NV-002' }
    const result = resolveExactlyOneActiveStoreManager({
      storeId: 'CH001',
      managers: [activeManager, secondManager],
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'STORE_MANAGER_MULTIPLE_ACTIVE',
      storeId: 'CH001',
      manager: null,
      managerId: null,
    })
    expect(result.matches).toEqual([activeManager, secondManager])
    let conflict
    try {
      assertExactlyOneActiveStoreManager({ storeId: 'CH001', managers: result.matches })
    } catch (error) {
      conflict = error
    }
    expect(conflict).toMatchObject({ code: 'STORE_MANAGER_MULTIPLE_ACTIVE' })
  })

  it('does not collapse case-colliding manager identities into one bonus owner', () => {
    const caseCollidingManager = {
      ...activeManager,
      id: 'QLCH-CASE-COLLISION',
      linkedEmployeeId: 'nv-001',
    }
    const result = resolveExactlyOneActiveStoreManager({
      storeId: 'CH001',
      managers: [activeManager, caseCollidingManager],
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'STORE_MANAGER_MULTIPLE_ACTIVE',
      manager: null,
      managerId: null,
    })
    expect(result.matches).toEqual([activeManager, caseCollidingManager])
  })

  it('uses an exact store scope and fails closed instead of grafting store-case collisions', () => {
    const lowerCaseStoreProfile = {
      ...activeManager,
      id: 'AUTH-LOWER-STORE',
      storeId: 'ch001',
    }

    expect(resolveExactlyOneActiveStoreManager({
      storeId: 'CH001',
      managers: [activeManager, lowerCaseStoreProfile],
    })).toMatchObject({
      ok: true,
      manager: activeManager,
      managerId: 'NV-001',
    })

    const ambiguous = resolveExactlyOneActiveStoreManager({
      storeId: 'Ch001',
      managers: [activeManager, lowerCaseStoreProfile],
    })
    expect(ambiguous).toMatchObject({
      ok: false,
      code: 'STORE_MANAGER_MULTIPLE_ACTIVE',
      manager: null,
      managerId: null,
    })
    expect(ambiguous.matches).toEqual([activeManager, lowerCaseStoreProfile])
  })
})

describe('manager revenue bonus idempotency key', () => {
  it('is deterministic for one store, month and manager', () => {
    expect(managerRevenueBonusIdempotencyKey({
      storeId: ' CH001 ',
      period: '2026-08',
      managerId: ' QLCH-001 ',
    })).toBe('manager-revenue-bonus:CH001:2026-08:QLCH-001')
  })

  it('rejects non-month periods', () => {
    expect(() => managerRevenueBonusIdempotencyKey({
      storeId: 'CH001', period: '26/08', managerId: 'QLCH-001',
    })).toThrow('period must use YYYY-MM format.')
  })
})
