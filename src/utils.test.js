import { describe, expect, it } from 'vitest'
import { calculateEmployeeBasePay, getMonthlySalary, usesMonthlyHoursFormula } from './utils'

describe('salary helpers', () => {
  it('calculates the SM234 monthly-hours formula without silently capping overtime', () => {
    const employee = {
      employmentType: 'Full-Time',
      payBasis: 'monthly',
      payFormula: 'monthly-hours',
      baseSalary: 9_000_000,
      requiredMonthlyHours: 180,
    }

    expect(getMonthlySalary(employee)).toBe(9_000_000)
    expect(usesMonthlyHoursFormula(employee)).toBe(true)
    expect(calculateEmployeeBasePay(employee, { hours: 150 })).toBe(7_500_000)
    expect(calculateEmployeeBasePay(employee, { hours: 190 })).toBe(9_500_000)
  })

  it('keeps the existing monthly and hourly formulas for other employees', () => {
    expect(calculateEmployeeBasePay({ employmentType: 'Full-Time', monthlySalary: 8_000_000 }, { hours: 10 })).toBe(8_000_000)
    expect(calculateEmployeeBasePay({ employmentType: 'Part-Time', hourlyRate: 30_000 }, { hours: 12 })).toBe(360_000)
  })
})
