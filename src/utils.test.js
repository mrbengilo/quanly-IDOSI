import { describe, expect, it } from 'vitest'
import {
  calculateEmployeeBasePay,
  getMonthlySalary,
  getPayBasis,
  resolveStoreEmployeeSalaryPolicy,
  salaryBasisLabel,
  usesMonthlyHoursFormula,
} from './utils'

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
    expect(calculateEmployeeBasePay({ unit: 'office', employmentType: 'Full-Time', monthlySalary: 8_000_000 }, { hours: 10 })).toBe(8_000_000)
    expect(calculateEmployeeBasePay({ employmentType: 'Part-Time', hourlyRate: 30_000 }, { hours: 12 })).toBe(360_000)
    expect(calculateEmployeeBasePay({ unit: 'store', employmentType: 'Thử Việc', hourlyRate: 25_000 }, { hours: 12 })).toBe(300_000)
  })

  it('calculates store Full-Time tiered hourly pay without changing legacy monthly payroll', () => {
    const employee = { employmentType: 'Full-Time', payBasis: 'tiered-hourly', payFormula: 'STORE_FULL_TIME_TIERED' }
    const store = { id: 'DOSII-01', name: 'Dosii TNV', status: 'Đang hoạt động' }
    expect(getPayBasis(employee)).toBe('tiered-hourly')
    expect(salaryBasisLabel(employee)).toBe('Theo giờ lũy tiến')
    expect(calculateEmployeeBasePay(employee, { hours: 208, store })).toBe(6_032_000)
    expect(calculateEmployeeBasePay(employee, { hours: 209, store })).toBe(6_057_000)
    expect(calculateEmployeeBasePay(employee, {
      hours: 209,
      store,
      salaryConfig: { thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000 },
    })).toBe(6_267_000)
    expect(calculateEmployeeBasePay(employee, { hours: 209 })).toBe(0)
  })

  it('uses the effective employee configuration and SM TNV defaults for store Full-Time payroll', () => {
    const employee = { id: 'ST-01', unit: 'store', employmentType: 'Full-Time', monthlySalary: 99_000_000 }
    const dosii = { id: 'DOSII-01', name: 'Dosii KVC', status: 'Đang hoạt động' }
    const smTnv = { id: 'SM-TNV', name: 'SM TNV', status: 'Đang hoạt động' }
    const salaryConfigs = [{
      id: 'CFG-01',
      employeeId: employee.id,
      storeId: dosii.id,
      effectiveFrom: '2026-08',
      thresholdHours: 208,
      standardHourlyRateVnd: 30_000,
      excessHourlyRateVnd: 27_000,
      active: true,
    }]

    const policy = resolveStoreEmployeeSalaryPolicy(employee, {
      store: dosii,
      salaryConfigs,
      period: '2026-08',
    })
    expect(policy).toMatchObject({ standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000 })
    expect(calculateEmployeeBasePay(employee, { hours: 208, store: dosii, salaryConfigs, period: '2026-08' })).toBe(6_240_000)
    expect(calculateEmployeeBasePay(employee, { hours: 209, store: dosii, salaryConfigs, period: '2026-08' })).toBe(6_267_000)
    expect(calculateEmployeeBasePay(employee, { hours: 209, store: smTnv, period: '2026-08' })).toBe(6_058_000)
  })
})
