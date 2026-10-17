import { describe, expect, it } from 'vitest'
import { applyBonusAllocationPointPolicy, applyRevenueSnapshotPointPolicy, restorePointRevenueSnapshot, assessViolationPoints, normalizeViolationPointInput, normalizeViolationPoints, storeViolationPointAssessment, VIOLATION_POINT_OPTIONS, violationPointsOf } from './violationPoints'
import { normalizeWorkCatalogItem } from './workCatalog'

const violation = (overrides = {}) => ({ id: 'V1', employeeId: 'E1', targetUnit: 'store', status: 'ACTIVE', period: '2026-09', violationPoints: 0.5, amountVnd: 0, ...overrides })
const assess = (entries, period = '2026-09') => storeViolationPointAssessment(entries, { employeeId: 'E1', period })

describe('violation point contract', () => {
  it.each([['0', 0], ['0,5', 0.5], ['1', 1], [1.5, 1.5], [2, 2], ['10', 10], ['0.1', 0.1]])('reads stored %s points', (input, expected) => {
    expect(normalizeViolationPoints(input)).toBe(expected)
  })
  it.each(['', null, undefined, true, [], -1, 10.1, '1e0', '1,000', 0.55, Infinity, NaN])('rejects invalid points %s', (input) => {
    expect(() => normalizeViolationPoints(input)).toThrow()
  })
  it('accepts only 0,5-point steps from 0 to 10 for new configuration', () => {
    expect(VIOLATION_POINT_OPTIONS).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10])
    for (const value of VIOLATION_POINT_OPTIONS) expect(normalizeViolationPointInput(String(value).replace('.', ','))).toBe(value)
    for (const value of ['0.1', '0,3', 1.2, 10.5, -0.5, '']) expect(() => normalizeViolationPointInput(value)).toThrow()
  })
  it('keeps old money snapshots distinct and applies points to every unit', () => {
    expect(violationPointsOf({ targetUnit: 'store', amountVnd: 2000 })).toBeNull()
    expect(violationPointsOf({ targetUnit: 'office', amountVnd: 3000 })).toBeNull()
    expect(violationPointsOf({ targetUnit: 'office', violationPoints: 1.5, amountVnd: 0 })).toBe(1.5)
    expect(violationPointsOf({ targetUnit: 'business_support', catalogSnapshot: { violationPoints: 0.5 } })).toBe(0.5)
    const definition = { code: 'test', name: 'Đi trễ', targetGroup: 'store', kind: 'VIOLATION', violationPoints: '0,5', amountVnd: 2000 }
    expect(normalizeWorkCatalogItem(definition)).toMatchObject({ violationPoints: 0.5, amountVnd: 0 })
    expect(normalizeWorkCatalogItem({ ...definition, targetGroup: 'office' })).toMatchObject({ violationPoints: 0.5, amountVnd: 0 })
    expect(normalizeWorkCatalogItem({ ...definition, targetGroup: 'business_support', violationPoints: 0 })).toMatchObject({ violationPoints: 0, amountVnd: 0 })
    expect(() => normalizeWorkCatalogItem({ ...definition, kind: 'REWARD_TASK' })).toThrow()
  })
  it('totals office and business-support points with the same monthly milestones', () => {
    const entries = [violation({ targetUnit: 'office', violationPoints: 3 }), violation({ id: 'V2', targetUnit: 'business_support', violationPoints: 2 }), violation({ id: 'V3', targetUnit: 'office', violationPoints: 0 })]
    expect(assess(entries)).toMatchObject({ points: 5, count: 3, threshold: 5, revenueBonusBlocked: true, workBonusBlocked: true })
  })
  it('counts active monthly points across stores, deduplicates IDs and excludes old money', () => {
    const entries = [violation(), violation(), violation({ id: 'V2', storeId: 'SUPPORT', violationPoints: 2.5 }),
      violation({ id: 'void', violationPoints: 5, voidedAt: '2026-09-03' }),
      violation({ id: 'pending', status: 'PENDING', violationPoints: 5 }),
      violation({ id: 'other', employeeId: 'E2', violationPoints: 5 }),
      violation({ id: 'old', period: '2026-08', violationPoints: 5 }),
      { id: 'money', targetUnit: 'store', employeeId: 'E1', period: '2026-09', status: 'ACTIVE', amountVnd: 99999 }]
    expect(assess(entries)).toMatchObject({ points: 3, count: 2, threshold: 3, revenueBonusBlocked: false })
    expect(assess(entries, '2026-10')).toMatchObject({ points: 0, threshold: 0 })
  })
  it('sums decimal points exactly and uses Vietnam month boundaries', () => {
    expect(assess(Array.from({ length: 50 }, (_, index) => violation({ id: `V${index}`, violationPoints: 0.1 })))).toMatchObject({ points: 5, revenueBonusBlocked: true })
    expect(assess([violation({ period: '', occurredAt: '2026-08-31T18:00:00Z' })]).points).toBe(0.5)
  })
  it.each([[2.5, 0], [3, 3], [4.9, 3], [5, 5], [5.5, 5], [6, 6], [11, 6]])('evaluates %s points at threshold %s', (points, threshold) => {
    expect(assessViolationPoints(points).threshold).toBe(threshold)
  })
  it('excludes work rewards without losing the original award or changing void records', () => {
    const source = { employeeId: 'E1', amountVnd: 10000, status: 'APPROVED', type: 'WORK' }
    const blocked = applyBonusAllocationPointPolicy(source, assessViolationPoints(5), 'WORK')
    expect(blocked).toMatchObject({ amountVnd: 0, preViolationAmountVnd: 10000, workBonusBlocked: true })
    expect(applyBonusAllocationPointPolicy(blocked, assessViolationPoints(4.5), 'WORK')).toEqual(source)
    expect(applyBonusAllocationPointPolicy({ ...source, status: 'VOID' }, assessViolationPoints(6), 'WORK').status).toBe('VOID')
  })
  it('zeros all monthly revenue after overrides without reallocating or mutating audit shares', () => {
    const source = { allocatedVnd: 3000, unallocatedVnd: 0, allocations: [
      { employeeId: 'E1', period: '2026-09', amountVnd: 1000, automaticAmountVnd: 500, status: 'ADMIN_ADJUSTED' },
      { employeeId: 'E1', period: '2026-09', amountVnd: 1000, status: 'FINALIZED' },
      { employeeId: 'E2', period: '2026-09', amountVnd: 1000, status: 'FINALIZED' },
    ] }
    const entries = [violation({ violationPoints: 5 })]
    const result = applyRevenueSnapshotPointPolicy(source, entries)
    expect(result.allocations.map((row) => row.amountVnd)).toEqual([0, 0, 1000])
    expect(result).toMatchObject({ allocatedVnd: 1000, violationExcludedVnd: 2000, unallocatedVnd: 2000 })
    expect(result.allocations[0]).toMatchObject({ automaticAmountVnd: 500, preViolationAmountVnd: 1000, status: 'VIOLATION_EXCLUDED' })
    expect(applyRevenueSnapshotPointPolicy(result, entries)).toEqual(result)
    expect(source.allocations[0].amountVnd).toBe(1000)
    expect(restorePointRevenueSnapshot(result)).toEqual(source)
    expect(applyRevenueSnapshotPointPolicy(result, [])).toEqual(source)
    expect(applyRevenueSnapshotPointPolicy(source, [violation({ violationPoints: 5, status: 'VOID' })])).toBe(source)
  })
})
