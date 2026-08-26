import { describe, expect, it } from 'vitest'
import { applyAdvanceToNetPay, applyViolationWaterfall } from './compensationSettlement'

describe('violation waterfall', () => {
  it('applies a violation to bonus before allowance and salary', () => {
    expect(applyViolationWaterfall({
      violationVnd: 80_000,
      bonusVnd: 100_000,
      allowanceVnd: 50_000,
      salaryVnd: 1_000_000,
    })).toEqual({
      grossPayVnd: 1_150_000,
      violationVnd: 80_000,
      appliedToBonusVnd: 80_000,
      appliedToAllowanceVnd: 0,
      appliedToSalaryVnd: 0,
      appliedViolationVnd: 80_000,
      remainingBonusVnd: 20_000,
      remainingAllowanceVnd: 50_000,
      remainingSalaryVnd: 1_000_000,
      netPayVnd: 1_070_000,
      remainingReceivableVnd: 0,
    })
  })

  it('flows through bonus, allowance, then salary', () => {
    expect(applyViolationWaterfall({
      violationVnd: 225_000,
      bonusVnd: 100_000,
      allowanceVnd: 50_000,
      salaryVnd: 1_000_000,
    })).toMatchObject({
      appliedToBonusVnd: 100_000,
      appliedToAllowanceVnd: 50_000,
      appliedToSalaryVnd: 75_000,
      remainingSalaryVnd: 925_000,
      netPayVnd: 925_000,
      remainingReceivableVnd: 0,
    })
  })

  it('never makes net pay negative and carries excess as a receivable', () => {
    expect(applyViolationWaterfall({
      violationVnd: 1_500_000,
      bonusVnd: 100_000,
      allowanceVnd: 50_000,
      salaryVnd: 1_000_000,
    })).toMatchObject({
      appliedViolationVnd: 1_150_000,
      netPayVnd: 0,
      remainingReceivableVnd: 350_000,
    })
  })

  it('handles zero components and zero violation', () => {
    expect(applyViolationWaterfall()).toMatchObject({
      grossPayVnd: 0,
      appliedViolationVnd: 0,
      netPayVnd: 0,
      remainingReceivableVnd: 0,
    })
    expect(applyViolationWaterfall({ salaryVnd: 5_000_000 })).toMatchObject({
      grossPayVnd: 5_000_000,
      netPayVnd: 5_000_000,
    })
  })

  it('applies confirmed advances separately after the violation result', () => {
    const waterfall = applyViolationWaterfall({
      violationVnd: 200_000,
      bonusVnd: 100_000,
      allowanceVnd: 100_000,
      salaryVnd: 1_000_000,
    })
    expect(applyAdvanceToNetPay({ netPayVnd: waterfall.netPayVnd, advanceVnd: 300_000 })).toEqual({
      netPayBeforeAdvanceVnd: 1_000_000,
      advanceVnd: 300_000,
      appliedAdvanceVnd: 300_000,
      netPayVnd: 700_000,
      unappliedAdvanceVnd: 0,
    })
    expect(waterfall).toMatchObject({ appliedViolationVnd: 200_000, remainingReceivableVnd: 0 })
  })

  it('reports an over-advance separately without a negative net', () => {
    expect(applyAdvanceToNetPay({ netPayVnd: 100_000, advanceVnd: 150_000 })).toEqual({
      netPayBeforeAdvanceVnd: 100_000,
      advanceVnd: 150_000,
      appliedAdvanceVnd: 100_000,
      netPayVnd: 0,
      unappliedAdvanceVnd: 50_000,
    })
  })

  it.each([
    [{ violationVnd: -1 }],
    [{ bonusVnd: 1.5 }],
    [{ allowanceVnd: Number.POSITIVE_INFINITY }],
  ])('rejects invalid VND waterfall input', (input) => {
    expect(() => applyViolationWaterfall(input)).toThrow(TypeError)
  })

  it('rejects component totals outside the safe integer VND range', () => {
    expect(() => applyViolationWaterfall({
      bonusVnd: Number.MAX_SAFE_INTEGER,
      salaryVnd: 1,
    })).toThrow(RangeError)
  })
})
