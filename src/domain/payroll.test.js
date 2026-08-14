import { describe, expect, it } from 'vitest'
import { selectFinanceSummary } from './finance'
import {
  calculateAvailableSalary,
  calculateRemainingPayroll,
  confirmPayrollPayment,
  confirmSalaryAdvance,
  createSalaryAdvance,
  validateSalaryAdvance,
} from './payroll'

describe('payroll and salary advances', () => {
  it('calculates available salary from confirmed values only', () => {
    const result = calculateAvailableSalary({
      basePay: 8_000_000,
      kpiBonus: 500_000,
      otherBonus: 200_000,
      tiktokAllowance: 300_000,
      otherAllowance: 100_000,
      confirmedAdvances: [
        { amount: 1_000_000, status: 'Đã chi' },
        { amount: 2_000_000, status: 'Mới tạo' },
      ],
      confirmedDeductions: [{ amount: 100_000, status: 'confirmed' }],
    })
    expect(result.grossPay).toBe(9_100_000)
    expect(result.confirmedAdvances).toBe(1_000_000)
    expect(result.availableSalary).toBe(8_000_000)
  })

  it.each([
    [0, 1_000_000, false],
    [1_000_000, 1_000_000, false],
    [1_000_001, 1_000_000, false],
    [999_999, 1_000_000, true],
  ])('validates strict advance amount %s against available %s', (amount, availableSalary, valid) => {
    expect(validateSalaryAdvance({ amount, availableSalary }).valid).toBe(valid)
  })

  it('confirms an advance once and creates exactly one expense transaction', () => {
    const advance = createSalaryAdvance({
      id: 'ADV-1',
      storeId: 'CH001',
      employeeId: 'NV001',
      amount: 3_000_000,
      availableSalary: 10_000_000,
      createdAt: '2026-08-13T09:00:00+07:00',
      createdBy: 'QL001',
    })
    const first = confirmSalaryAdvance({
      advances: [advance],
      transactions: [],
      advanceId: 'ADV-1',
      currentAvailableSalary: 10_000_000,
      confirmedAt: '2026-08-13T10:00:00+07:00',
      confirmedBy: 'QL001',
    })
    expect(first.changed).toBe(true)
    expect(first.advance.status).toBe('Đã chi')
    expect(first.transactions).toHaveLength(1)
    expect(first.transactions[0].amount).toBe(3_000_000)

    const replay = confirmSalaryAdvance({
      advances: first.advances,
      transactions: first.transactions,
      advanceId: 'ADV-1',
      currentAvailableSalary: 7_000_000,
      confirmedAt: '2026-08-13T10:01:00+07:00',
      confirmedBy: 'QL001',
    })
    expect(replay.changed).toBe(false)
    expect(replay.alreadyConfirmed).toBe(true)
    expect(replay.transactions).toHaveLength(1)
  })

  it('pays only the remainder after confirmed advance so salary expense is not doubled', () => {
    const paidAdvance = { id: 'ADV-1', amount: 3_000_000, status: 'Đã chi' }
    const remaining = calculateRemainingPayroll({ grossPay: 10_000_000, confirmedAdvances: [paidAdvance] })
    expect(remaining.remainingPayable).toBe(7_000_000)

    const advanceResult = confirmSalaryAdvance({
      advances: [{ ...paidAdvance, status: 'Mới tạo', storeId: 'CH001', employeeId: 'NV001' }],
      transactions: [],
      advanceId: 'ADV-1',
      currentAvailableSalary: 10_000_000,
      confirmedAt: '2026-08-10T10:00:00+07:00',
      confirmedBy: 'QL001',
    })
    const payrollResult = confirmPayrollPayment({
      periods: [{ id: 'PAY-2026-08-NV001', storeId: 'CH001', grossPay: 10_000_000, advances: [advanceResult.advance] }],
      transactions: advanceResult.transactions,
      periodId: 'PAY-2026-08-NV001',
      confirmedAt: '2026-08-31T17:00:00+07:00',
      confirmedBy: 'QL001',
    })
    expect(payrollResult.transaction.amount).toBe(7_000_000)
    expect(selectFinanceSummary(payrollResult.transactions, { storeId: 'CH001' }).expense).toBe(10_000_000)

    const replay = confirmPayrollPayment({
      periods: payrollResult.periods,
      transactions: payrollResult.transactions,
      periodId: 'PAY-2026-08-NV001',
      confirmedAt: '2026-08-31T17:01:00+07:00',
      confirmedBy: 'QL001',
    })
    expect(replay.changed).toBe(false)
    expect(replay.transactions).toHaveLength(2)
  })
})
