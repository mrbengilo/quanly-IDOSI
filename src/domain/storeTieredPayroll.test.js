import { describe, expect, it } from 'vitest'
import {
  STORE_EMPLOYMENT_TYPE,
  STORE_FULL_TIME_THRESHOLD_HOURS,
  STORE_PAYROLL_MODEL,
  STORE_PAYROLL_POLICY,
  calculateStoreEmployeeBasePay,
  calculateTieredHourlyPay,
  classifyStorePayrollPolicy,
  createStoreSalaryConfigSnapshot,
  defaultStoreTieredRates,
  effectiveStoreSalaryConfig,
  isHourlyStoreEmploymentType,
  normalizeStoreEmploymentType,
  normalizeStoreSalaryConfig,
  validateStoreSalaryConfig,
} from './storeTieredPayroll'

const dosiiStore = { id: 'DOSII-KVC', name: 'Dosii KVC', status: 'Đang hoạt động' }
const secondMallStore = { id: 'SM-TNV', name: 'SM TNV', status: 'Hoạt động' }

describe('store tiered payroll', () => {
  it('classifies only explicit operational Dosii and SM store identities', () => {
    expect(classifyStorePayrollPolicy(dosiiStore)).toBe(STORE_PAYROLL_POLICY.DOSII)
    expect(classifyStorePayrollPolicy({ id: 'NTL', name: 'Idosi NTL' })).toBe(STORE_PAYROLL_POLICY.DOSII)
    expect(classifyStorePayrollPolicy(secondMallStore)).toBe(STORE_PAYROLL_POLICY.SM_TNV)
    expect(classifyStorePayrollPolicy({ id: 'LEGACY', name: 'SecondMall SM234' })).toBe(STORE_PAYROLL_POLICY.SM_TNV)
    expect(classifyStorePayrollPolicy({ id: 'TNV', short: 'TNV' })).toBe(STORE_PAYROLL_POLICY.UNSUPPORTED)
    expect(classifyStorePayrollPolicy({ id: 'OFFICE', name: 'Dosii nội bộ', type: 'internal' })).toBe(STORE_PAYROLL_POLICY.UNSUPPORTED)
    expect(classifyStorePayrollPolicy({ id: 'CLOSED', name: 'Dosii cũ', status: 'Tạm ngưng' })).toBe(STORE_PAYROLL_POLICY.UNSUPPORTED)
    expect(classifyStorePayrollPolicy({ id: 'DELETED', name: 'Dosii cũ', status: 'Đã xóa' })).toBe(STORE_PAYROLL_POLICY.UNSUPPORTED)
  })

  it('provides the requested defaults for Dosii and SM TNV', () => {
    expect(STORE_FULL_TIME_THRESHOLD_HOURS).toBe(208)
    expect(defaultStoreTieredRates(dosiiStore)).toEqual({
      storePolicy: STORE_PAYROLL_POLICY.DOSII,
      thresholdHours: 208,
      standardHourlyRateVnd: 29_000,
      excessHourlyRateVnd: 25_000,
    })
    expect(defaultStoreTieredRates(secondMallStore)).toEqual({
      storePolicy: STORE_PAYROLL_POLICY.SM_TNV,
      thresholdHours: 208,
      standardHourlyRateVnd: 29_000,
      excessHourlyRateVnd: 26_000,
    })
  })

  it('normalizes and snapshots a per-employee Full-Time salary configuration', () => {
    const config = normalizeStoreSalaryConfig({
      employeeId: 'NV-01',
      storeId: dosiiStore.id,
      standardHourlyRateVnd: 30_000,
      excessHourlyRateVnd: 24_000,
      effectiveFrom: '2026-09',
      version: 2,
    }, { store: dosiiStore })
    expect(config).toMatchObject({
      employeeId: 'NV-01',
      storeId: dosiiStore.id,
      storePolicy: STORE_PAYROLL_POLICY.DOSII,
      employmentType: STORE_EMPLOYMENT_TYPE.FULL_TIME,
      thresholdHours: 208,
      thresholdSeconds: 748_800,
      standardHourlyRateVnd: 30_000,
      excessHourlyRateVnd: 24_000,
      currency: 'VND',
      effectiveFrom: '2026-09',
      version: 2,
    })
    expect(createStoreSalaryConfigSnapshot(config, { store: dosiiStore })).toEqual({
      schemaVersion: 1,
      model: STORE_PAYROLL_MODEL.FULL_TIME_TIERED,
      ...config,
    })
  })

  it('rejects invalid or cross-store salary configuration', () => {
    expect(validateStoreSalaryConfig({
      employeeId: 'NV-01',
      storeId: dosiiStore.id,
      standardHourlyRateVnd: 29_000.5,
    }, { store: dosiiStore }).valid).toBe(false)
    expect(() => normalizeStoreSalaryConfig({
      employeeId: 'NV-01',
      storeId: 'OTHER',
    }, { store: dosiiStore })).toThrow('STORE_ID_MISMATCH')
    expect(() => normalizeStoreSalaryConfig({
      employeeId: 'NV-01',
      storeId: dosiiStore.id,
      storePolicy: 'SM_TNV',
    }, { store: dosiiStore })).toThrow('STORE_PAYROLL_POLICY_MISMATCH')
  })

  it('matches operational employee and store ids without letter-case sensitivity', () => {
    const store = { id: 'S01', name: 'Dosii S01', status: 'Đang hoạt động' }
    const config = effectiveStoreSalaryConfig([{
      id: 'CFG-CASE', employeeId: 'e01', storeId: 's01', effectiveFrom: '2026-08',
      employmentType: 'Full-Time', standardHourlyRateVnd: 29_000, excessHourlyRateVnd: 25_000,
      thresholdHours: 208,
    }], { employeeId: 'E01', storeId: 'S01', period: '2026-08', store })

    expect(config).toMatchObject({ employeeId: 'E01', storeId: 'S01', standardHourlyRateVnd: 29_000 })
  })

  it('fails closed when folded employee/store ids resolve to conflicting configs for one effective period', () => {
    const configs = [{
      id: 'CFG-CASE-A', employeeId: 'E01', storeId: 'S01', effectiveFrom: '2026-08',
      standardHourlyRateVnd: 29_000, excessHourlyRateVnd: 25_000, thresholdHours: 208,
    }, {
      id: 'CFG-CASE-B', employeeId: 'e01', storeId: 's01', effectiveFrom: '2026-08',
      standardHourlyRateVnd: 99_000, excessHourlyRateVnd: 98_000, thresholdHours: 208,
    }]

    expect(() => effectiveStoreSalaryConfig(configs, {
      employeeId: 'E01', storeId: 'S01', period: '2026-08',
      store: { id: 'S01', name: 'Dosii S01', status: 'Đang hoạt động' },
    })).toThrow('STORE_SALARY_CONFIG_IDENTIFIER_COLLISION')
  })

  it('selects an exact salary-config owner before a newer case-colliding owner', () => {
    const configs = [{
      id: 'CFG-EXACT-OWNER', employeeId: 'EMP-01', storeId: 'STORE-01', effectiveFrom: '2026-08',
      standardHourlyRateVnd: 29_000, excessHourlyRateVnd: 25_000, thresholdHours: 208,
    }, {
      id: 'CFG-CASE-OWNER', employeeId: 'emp-01', storeId: 'store-01', effectiveFrom: '2026-09',
      standardHourlyRateVnd: 99_000, excessHourlyRateVnd: 98_000, thresholdHours: 208,
    }]

    expect(effectiveStoreSalaryConfig(configs, {
      employeeId: 'EMP-01', storeId: 'STORE-01', period: '2026-09',
    })).toMatchObject({ id: 'CFG-EXACT-OWNER', standardHourlyRateVnd: 29_000 })
    expect(effectiveStoreSalaryConfig(configs, {
      employeeId: 'emp-01', storeId: 'store-01', period: '2026-09',
    })).toMatchObject({ id: 'CFG-CASE-OWNER', standardHourlyRateVnd: 99_000 })
  })

  it('fails closed for a non-exact owner scope with case collisions across effective dates', () => {
    const configs = [{
      id: 'CFG-UPPER-OWNER', employeeId: 'EMP-01', storeId: 'STORE-01', effectiveFrom: '2026-08',
    }, {
      id: 'CFG-LOWER-OWNER', employeeId: 'emp-01', storeId: 'store-01', effectiveFrom: '2026-09',
    }]

    let collision
    try {
      effectiveStoreSalaryConfig(configs, {
        employeeId: 'Emp-01', storeId: 'Store-01', period: '2026-09',
      })
    } catch (error) {
      collision = error
    }
    expect(collision).toMatchObject({
      code: 'STORE_SALARY_CONFIG_IDENTIFIER_COLLISION',
      details: {
        employeeId: 'Emp-01',
        storeId: 'Store-01',
        conflictingConfigIds: ['CFG-UPPER-OWNER', 'CFG-LOWER-OWNER'],
      },
    })
  })

  it('selects the latest effective per-employee configuration for a payroll period', () => {
    const configs = [
      { employeeId: 'NV-01', storeId: dosiiStore.id, effectiveFrom: '2026-08', version: 1, standardHourlyRateVnd: 29_000, excessHourlyRateVnd: 25_000 },
      { employeeId: 'NV-01', storeId: dosiiStore.id, effectiveFrom: '2026-09', version: 2, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 24_000 },
      { employeeId: 'NV-02', storeId: dosiiStore.id, effectiveFrom: '2026-08', version: 1 },
    ]
    expect(effectiveStoreSalaryConfig(configs, {
      employeeId: 'NV-01',
      storeId: dosiiStore.id,
      period: '2026-08',
    })).toMatchObject({ effectiveFrom: '2026-08', version: 1 })
    expect(effectiveStoreSalaryConfig(configs, {
      employeeId: 'NV-01',
      storeId: dosiiStore.id,
      period: '2026-09',
      store: dosiiStore,
    })).toMatchObject({ effectiveFrom: '2026-09', version: 2, storePolicy: STORE_PAYROLL_POLICY.DOSII })
  })

  it.each([
    [0, 0],
    [208, 6_032_000],
    [209, 6_057_000],
    [208.5, 6_044_500],
  ])('calculates Dosii Full-Time %s hours with the 208-hour tier', (workedHours, amountVnd) => {
    expect(calculateStoreEmployeeBasePay({
      store: dosiiStore,
      employeeId: 'NV-01',
      employmentType: 'Full-Time',
      workedHours,
    }).amountVnd).toBe(amountVnd)
  })

  it('uses the SM TNV excess rate and keeps the store policy in the snapshot', () => {
    const result = calculateStoreEmployeeBasePay({
      store: secondMallStore,
      employeeId: 'NV-02',
      employmentType: 'Full-Time',
      workedHours: 209,
    })
    expect(result).toMatchObject({
      amountVnd: 6_058_000,
      standardHours: 208,
      excessHours: 1,
      storePolicy: STORE_PAYROLL_POLICY.SM_TNV,
      payBasis: 'tiered-hourly',
    })
    expect(result.salaryConfigSnapshot).toMatchObject({
      model: STORE_PAYROLL_MODEL.FULL_TIME_TIERED,
      standardHourlyRateVnd: 29_000,
      excessHourlyRateVnd: 26_000,
    })
  })

  it('uses integer seconds and floors the combined VND amount once', () => {
    const result = calculateStoreEmployeeBasePay({
      store: dosiiStore,
      employeeId: 'NV-03',
      employmentType: 'Full-Time',
      workedSeconds: (208 * 3600) + 30,
    })
    expect(result.workedHours).toBeCloseTo(208 + (30 / 3600))
    expect(result.excessSeconds).toBe(30)
    expect(result.amountVnd).toBe(6_032_208)
  })

  it('exposes the lower-level tier calculation for server and UI parity', () => {
    expect(calculateTieredHourlyPay({
      workedHours: 208.5,
      thresholdHours: 208,
      standardHourlyRateVnd: 29_000,
      excessHourlyRateVnd: 25_000,
    })).toMatchObject({
      amountVnd: 6_044_500,
      standardHours: 208,
      excessHours: 0.5,
    })
  })

  it.each([
    ['Part-Time', 1.5, 25_000, 37_500, STORE_EMPLOYMENT_TYPE.PART_TIME],
    ['Thử Việc', 1.5, 27_000, 40_500, STORE_EMPLOYMENT_TYPE.PROBATION],
  ])('keeps %s employees on a single hourly rate', (employmentType, workedHours, hourlyRateVnd, amountVnd, normalizedType) => {
    const result = calculateStoreEmployeeBasePay({
      store: dosiiStore,
      employeeId: 'NV-HOURLY',
      employmentType,
      workedHours,
      hourlyRateVnd,
    })
    expect(result).toMatchObject({
      amountVnd,
      payBasis: 'hourly',
      employmentType: normalizedType,
      excessSeconds: 0,
    })
    expect(result.salaryConfigSnapshot).toMatchObject({
      model: STORE_PAYROLL_MODEL.HOURLY,
      hourlyRateVnd,
    })
  })

  it('normalizes employment types without treating unknown values as hourly', () => {
    expect(normalizeStoreEmploymentType('thử việc')).toBe(STORE_EMPLOYMENT_TYPE.PROBATION)
    expect(isHourlyStoreEmploymentType('Part-Time')).toBe(true)
    expect(isHourlyStoreEmploymentType('Thử Việc')).toBe(true)
    expect(isHourlyStoreEmploymentType('Full-Time')).toBe(false)
    expect(normalizeStoreEmploymentType('Thực Tập Sinh')).toBeNull()
  })
})
