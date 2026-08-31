import { describe, expect, it } from 'vitest'
import {
  calculateEmployeeBasePay,
  getMonthlySalary,
  getPayBasis,
  operationalIdentifierEntry,
  operationalIdentifierRecordMatch,
  operationalIdentifierReferenceKey,
  operationalIdentifierReferenceMatchesRecord,
  resolveStoreEmployeeSalaryPolicy,
  salaryBasisLabel,
  usesMonthlyHoursFormula,
} from './utils'

describe('operational identifier references', () => {
  it('resolves records with exact spelling first and a unique folded fallback', () => {
    const upper = { id: 'EMP-01', code: 'ST-01' }
    const lower = { id: 'emp-01', code: 'st-02' }
    const identifiers = (record) => [record.id, record.code]

    expect(operationalIdentifierRecordMatch([upper], 'emp-01', identifiers)).toMatchObject({
      record: upper,
      ambiguous: false,
    })
    expect(operationalIdentifierRecordMatch([upper, lower], 'emp-01', identifiers)).toMatchObject({
      record: lower,
      ambiguous: false,
    })
    expect(operationalIdentifierRecordMatch([upper, lower], 'EMP-01', identifiers)).toMatchObject({
      record: upper,
      ambiguous: false,
    })
    expect(operationalIdentifierRecordMatch([upper, lower], 'EmP-01', identifiers)).toMatchObject({
      record: null,
      ambiguous: true,
    })
  })

  it('resolves identifier-keyed values without selecting an ambiguous case alias', () => {
    expect(operationalIdentifierEntry({ 'EMP-01': true }, 'emp-01')).toMatchObject({
      found: true,
      ambiguous: false,
      value: true,
    })
    expect(operationalIdentifierEntry({ 'EMP-01': true, 'emp-01': false }, 'emp-01')).toMatchObject({
      found: true,
      ambiguous: false,
      key: 'emp-01',
      value: false,
    })
    expect(operationalIdentifierEntry({ 'EMP-01': true, 'emp-01': false }, 'EmP-01')).toMatchObject({
      found: false,
      ambiguous: true,
    })
  })

  it('keeps case-insensitive legacy references compatible when the target is unique', () => {
    const record = { id: 'ATT-01' }
    expect(operationalIdentifierReferenceMatchesRecord([record], record, 'att-01')).toBe(true)
    expect(operationalIdentifierReferenceKey([record], 'att-01')).toBe('folded:att-01')
  })

  it('requires exact spelling when two records differ only by case', () => {
    const upper = { id: 'ATT-X' }
    const lower = { id: 'att-x' }
    const records = [upper, lower]
    expect(operationalIdentifierReferenceMatchesRecord(records, upper, 'att-x')).toBe(false)
    expect(operationalIdentifierReferenceMatchesRecord(records, lower, 'att-x')).toBe(true)
    expect(operationalIdentifierReferenceKey(records, 'att-x')).toBe('exact:att-x')
  })
})

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

  it('blocks a salary preview instead of falling back when folded config ids collide', () => {
    const employee = { id: 'ST-01', unit: 'store', employmentType: 'Full-Time' }
    const store = { id: 'DOSII-01', name: 'Dosii KVC', status: 'Đang hoạt động' }
    const salaryConfigs = [{
      id: 'CFG-A', employeeId: 'ST-01', storeId: 'DOSII-01', effectiveFrom: '2026-08',
      thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000,
    }, {
      id: 'CFG-B', employeeId: 'st-01', storeId: 'dosii-01', effectiveFrom: '2026-08',
      thresholdHours: 208, standardHourlyRateVnd: 99_000, excessHourlyRateVnd: 98_000,
    }]

    expect(() => resolveStoreEmployeeSalaryPolicy(employee, {
      store,
      salaryConfigs,
      period: '2026-08',
    })).toThrow('STORE_SALARY_CONFIG_IDENTIFIER_COLLISION')
  })
})
