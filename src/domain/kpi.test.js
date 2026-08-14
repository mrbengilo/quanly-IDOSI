import { describe, expect, it } from 'vitest'
import { calculateKpiBonuses, selectEmployeeKpiTier } from './kpi'

const tiers = [
  { threshold: 30_000, ratePercent: 5 },
  { threshold: 15_000, ratePercent: 3 },
  { threshold: 7_000, ratePercent: 1 },
]

const people = [
  { id: 'NV001', role: 'employee', hours: 130 },
  { id: 'NV002', role: 'employee', hours: 120 },
  { id: 'NV003', role: 'employee', hours: 100 },
]

describe('KPI calculation', () => {
  it('uses only employee hours, selects the 30k tier, and floors each award', () => {
    const result = calculateKpiBonuses({
      profit: 15_000_000,
      participants: people,
      employeeTiers: tiers,
      policyId: 'POLICY-2026-08',
    })
    expect(result.totalHours).toBe(350)
    expect(result.profitPerHour).toBeCloseTo(42_857.142857143)
    expect(result.employeeTier).toEqual({ threshold: 30_000, ratePercent: 5 })
    expect(Object.fromEntries(result.results.map((row) => [row.id, row.amount]))).toEqual({
      NV001: 278_571,
      NV002: 257_142,
      NV003: 214_285,
    })
    expect(result.policySnapshot.policyId).toBe('POLICY-2026-08')
  })

  it('does not round hours or profit per hour before choosing a tier', () => {
    expect(selectEmployeeKpiTier(29_999.999, tiers)).toEqual({ threshold: 15_000, ratePercent: 3 })
    expect(selectEmployeeKpiTier(30_000, tiers)).toEqual({ threshold: 30_000, ratePercent: 5 })
  })

  it.each([0, -1])('returns zero awards for non-positive profit %s', (profit) => {
    const result = calculateKpiBonuses({ profit, participants: people, employeeTiers: tiers })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('NON_POSITIVE_PROFIT')
    expect(result.totalBonus).toBe(0)
    expect(result.results.every((row) => row.amount === 0)).toBe(true)
  })

  it('does not divide by zero when nobody has worked', () => {
    const result = calculateKpiBonuses({
      profit: 15_000_000,
      participants: [{ id: 'NV001', role: 'employee', hours: 0 }],
      employeeTiers: tiers,
    })
    expect(result.reason).toBe('NO_WORKED_HOURS')
    expect(result.profitPerHour).toBe(0)
    expect(result.totalBonus).toBe(0)
  })

  it('rejects duplicate participants so hours cannot be counted twice', () => {
    expect(() => calculateKpiBonuses({
      profit: 1_000_000,
      participants: [{ id: 'NV001', hours: 10 }, { id: 'NV001', hours: 10 }],
      employeeTiers: tiers,
    })).toThrow(/Duplicate KPI participant/)
  })

  it('rejects manager hours because IDOSI only has admin and employee roles', () => {
    expect(() => calculateKpiBonuses({
      profit: 1_000_000,
      participants: [{ id: 'QL001', role: 'manager', hours: 140 }],
      employeeTiers: tiers,
    })).toThrow(/role must be employee/)
  })
})
