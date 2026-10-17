import { describe, expect, it } from 'vitest'
import {
  calculateRevenueBonus,
  REVENUE_BONUS_PROGRAM_IDS,
  REVENUE_BONUS_PROGRAMS,
  selectRevenueBonusTier,
} from './compensationPolicies'
import {
  addCalendarDays,
  describeRevenueBonusTierRange,
  formatRatePercent,
  legacyRevenueBonusThresholds,
  minimumRevenueBonusEffectiveFrom,
  parseRatePercentInput,
  parseRevenueThresholdInput,
  resolveRevenueBonusProgram,
  REVENUE_BONUS_CONFIG_INVALID,
  REVENUE_BONUS_CONFIG_SOURCE,
  REVENUE_BONUS_CONFIG_STORE_POLICY,
  revenueBonusConfigOverview,
  revenueBonusConfigSnapshot,
  revenueBonusStorePolicyForProgramId,
  revenueBonusTiersFromThresholds,
  validateRevenueBonusEffectiveFrom,
  validateRevenueBonusTierRows,
  vietnamBusinessDate,
} from './revenueBonusConfig'

const { DOSII, SM_TNV } = REVENUE_BONUS_CONFIG_STORE_POLICY
const DOSII_PROGRAM = REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY
const SM_PROGRAM = REVENUE_BONUS_PROGRAM_IDS.SM_DAILY

// Test-only fixtures. They prove the tables are no longer hard-coded and are
// intentionally different from both legacy tables; never seed them.
const config = (overrides = {}) => ({
  id: 'rbc-dosii-1',
  storePolicy: DOSII,
  programId: DOSII_PROGRAM,
  effectiveFrom: '2026-10-20',
  version: 1,
  status: 'ACTIVE',
  tiers: [
    { thresholdVnd: 1_000_000, rateBasisPoints: 125 },
    { thresholdVnd: 3_000_000, rateBasisPoints: 250 },
  ],
  ...overrides,
})
const smConfig = (overrides = {}) => config({
  id: 'rbc-sm-1',
  storePolicy: SM_TNV,
  programId: SM_PROGRAM,
  tiers: [
    { thresholdVnd: 2_000_000, rateBasisPoints: 300 },
    { thresholdVnd: 5_000_000, rateBasisPoints: 450 },
  ],
  ...overrides,
})

const bonusFor = ({ programId, businessDate, configs, revenueVnd }) => {
  const resolution = resolveRevenueBonusProgram({ programId, businessDate, configs })
  return calculateRevenueBonus({ programId, revenueVnd, tiers: resolution.tiers })
}

describe('revenue bonus configuration inputs', () => {
  it.each([
    ['1500000', 1_500_000],
    ['1.500.000', 1_500_000],
    [' 2000000 ', 2_000_000],
    [12_000_000, 12_000_000],
  ])('parses threshold %j as integer VND', (input, value) => {
    expect(parseRevenueThresholdInput(input)).toEqual({ ok: true, value })
  })

  it.each([
    '', '0', '-1', '1,5', '1.50.000', '12abc', '1e6', 'NaN', 'Infinity', '9007199254740992',
    0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1,
  ])('rejects threshold %j without partial parsing', (input) => {
    expect(parseRevenueThresholdInput(input).ok).toBe(false)
  })

  it.each([
    ['0', 0], ['1', 100], ['1,25', 125], ['1.25', 125], ['2,5', 250], ['100', 10_000], ['4,5%', 450],
    [1.25, 125], [7, 700], [0, 0],
  ])('normalizes rate %j to %i basis points', (input, basisPoints) => {
    expect(parseRatePercentInput(input)).toEqual({ ok: true, basisPoints })
  })

  it.each([
    '', '-1', '100,01', '101', '1,255', 'abc', '1,2,3', '1e2', 'Infinity',
    Number.NaN, Number.POSITIVE_INFINITY, -1, 0.1 + 0.2, 1.255,
  ])('rejects rate %j', (input) => {
    expect(parseRatePercentInput(input).ok).toBe(false)
  })

  it('formats basis points with the Vietnamese decimal comma', () => {
    expect(formatRatePercent(125)).toBe('1,25%')
    expect(formatRatePercent(450)).toBe('4,5%')
    expect(formatRatePercent(10_000)).toBe('100%')
    expect(formatRatePercent(0)).toBe('0%')
  })
})

describe('revenue bonus configuration rows', () => {
  it('accepts one or many ascending tiers, including 0% and 100%', () => {
    expect(validateRevenueBonusTierRows([{ thresholdVnd: 1, rateBasisPoints: 10_000 }]).valid).toBe(true)
    const result = validateRevenueBonusTierRows([
      { thresholdVnd: 500_000, rateBasisPoints: 0 },
      { thresholdVnd: 1_000_000, rateBasisPoints: 125, ignored: true },
    ])
    expect(result).toMatchObject({ valid: true, formErrors: [] })
    expect(result.tiers).toEqual([
      { thresholdVnd: 500_000, rateBasisPoints: 0 },
      { thresholdVnd: 1_000_000, rateBasisPoints: 125 },
    ])
  })

  it('reports errors on the exact row and never treats an empty table as disabled', () => {
    expect(validateRevenueBonusTierRows([])).toMatchObject({ valid: false, formErrors: ['Cần ít nhất một mốc thưởng.'] })
    expect(validateRevenueBonusTierRows(null).valid).toBe(false)
    const result = validateRevenueBonusTierRows([
      { thresholdVnd: 2_000_000, rateBasisPoints: 100 },
      { thresholdVnd: 2_000_000, rateBasisPoints: 200 },
      { thresholdVnd: 1_000_000, rateBasisPoints: 10_001 },
      { thresholdVnd: '3000000', rateBasisPoints: 1.5 },
      { thresholdVnd: Number.MAX_SAFE_INTEGER + 1, rateBasisPoints: -1 },
      null,
    ])
    expect(result.valid).toBe(false)
    expect(result.rowErrors[0]).toEqual({})
    expect(result.rowErrors[1].thresholdVnd).toMatch(/trùng với dòng 1/u)
    expect(result.rowErrors[2].thresholdVnd).toMatch(/tăng dần/u)
    expect(result.rowErrors[2].rateBasisPoints).toBeTruthy()
    expect(result.rowErrors[3]).toMatchObject({ thresholdVnd: expect.any(String), rateBasisPoints: expect.any(String) })
    expect(result.rowErrors[4]).toMatchObject({ thresholdVnd: expect.any(String), rateBasisPoints: expect.any(String) })
    expect(result.rowErrors[5]).toMatchObject({ thresholdVnd: expect.any(String), rateBasisPoints: expect.any(String) })
  })

  it('rejects more than the maximum number of tiers', () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ thresholdVnd: (index + 1) * 1_000, rateBasisPoints: 100 }))
    expect(validateRevenueBonusTierRows(rows).formErrors[0]).toMatch(/tối đa 20/u)
  })

  it('derives contiguous ranges with the legacy boundary rule and explains them in Vietnamese', () => {
    const tiers = revenueBonusTiersFromThresholds([
      { thresholdVnd: 1_000_000, rateBasisPoints: 125 },
      { thresholdVnd: 3_000_000, rateBasisPoints: 250 },
      { thresholdVnd: 6_000_000, rateBasisPoints: 300 },
    ])
    expect(tiers.map(describeRevenueBonusTierRange)).toEqual([
      'Từ 1.000.000 đ đến 3.000.000 đ',
      'Trên 3.000.000 đ đến 6.000.000 đ',
      'Trên 6.000.000 đ',
    ])
    expect(describeRevenueBonusTierRange(revenueBonusTiersFromThresholds([{ thresholdVnd: 1_000_000, rateBasisPoints: 1 }])[0]))
      .toBe('Từ 1.000.000 đ trở lên')
  })

  it('reproduces every legacy tier exactly from its thresholds', () => {
    for (const policy of [DOSII, SM_TNV]) {
      const programId = policy === DOSII ? DOSII_PROGRAM : SM_PROGRAM
      const rebuilt = revenueBonusTiersFromThresholds(legacyRevenueBonusThresholds(policy))
      const legacy = REVENUE_BONUS_PROGRAMS[programId].tiers
      expect(rebuilt.map(({ id: _id, thresholdVnd: _threshold, ...tier }) => tier))
        .toEqual(legacy.map(({ id: _id, ...tier }) => tier))
    }
  })
})

describe('effective dates in Vietnam time', () => {
  it('starts no earlier than tomorrow in Asia/Ho_Chi_Minh, across midnight and month ends', () => {
    expect(vietnamBusinessDate(Date.parse('2026-10-31T16:59:59.000Z'))).toBe('2026-10-31')
    expect(vietnamBusinessDate(Date.parse('2026-10-31T17:00:00.000Z'))).toBe('2026-11-01')
    expect(minimumRevenueBonusEffectiveFrom(Date.parse('2026-10-31T16:59:59.000Z'))).toBe('2026-11-01')
    expect(minimumRevenueBonusEffectiveFrom(Date.parse('2026-12-31T17:00:00.000Z'))).toBe('2027-01-02')
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('rejects today, past and malformed dates and accepts future dates', () => {
    const now = Date.parse('2026-10-13T08:00:00+07:00')
    expect(validateRevenueBonusEffectiveFrom('2026-10-13', { now }).ok).toBe(false)
    expect(validateRevenueBonusEffectiveFrom('2026-09-01', { now }).ok).toBe(false)
    expect(validateRevenueBonusEffectiveFrom('2026-02-30', { now }).ok).toBe(false)
    expect(validateRevenueBonusEffectiveFrom('', { now }).ok).toBe(false)
    expect(validateRevenueBonusEffectiveFrom('2026-10-14', { now })).toEqual({ ok: true, value: '2026-10-14' })
    expect(validateRevenueBonusEffectiveFrom('2027-01-01', { now }).ok).toBe(true)
  })
})

describe('resolving the table for a store group and business date', () => {
  it('keeps the legacy result when nothing was ever configured', () => {
    for (const configs of [undefined, null, []]) {
      const resolution = resolveRevenueBonusProgram({ programId: DOSII_PROGRAM, businessDate: '2026-10-25', configs })
      expect(resolution).toMatchObject({ source: REVENUE_BONUS_CONFIG_SOURCE.LEGACY, configId: null, version: null })
      expect(calculateRevenueBonus({ programId: DOSII_PROGRAM, revenueVnd: 2_000_000, tiers: resolution.tiers }))
        .toEqual(calculateRevenueBonus({ programId: DOSII_PROGRAM, revenueVnd: 2_000_000 }))
    }
  })

  it.each([
    [999_999, 0, 0],
    [1_000_000, 125, 12_500],
    [1_000_001, 125, 12_500],
    [2_999_999, 125, 37_499],
    [3_000_000, 125, 37_500],
    [3_000_001, 250, 75_000],
    [10_000_003, 250, 250_000],
  ])('applies the configured Dosii boundary at %s VND', (revenueVnd, rateBasisPoints, bonusVnd) => {
    expect(bonusFor({ programId: DOSII_PROGRAM, businessDate: '2026-10-20', configs: [config()], revenueVnd }))
      .toMatchObject({ rateBasisPoints, bonusVnd })
  })

  it.each([
    [1_999_999, 0, 0],
    [2_000_000, 300, 60_000],
    [5_000_000, 300, 150_000],
    [5_000_001, 450, 225_000],
  ])('applies the configured SM TNV boundary at %s VND independently from Dosii', (revenueVnd, rateBasisPoints, bonusVnd) => {
    const configs = [config(), smConfig()]
    expect(bonusFor({ programId: SM_PROGRAM, businessDate: '2026-10-20', configs, revenueVnd }))
      .toMatchObject({ rateBasisPoints, bonusVnd })
  })

  it('pays one rate on the whole revenue, never progressive or cumulative', () => {
    const result = bonusFor({ programId: DOSII_PROGRAM, businessDate: '2026-10-20', configs: [config()], revenueVnd: 4_000_000 })
    expect(result.bonusVnd).toBe(100_000)
    expect(result.bonusVnd).not.toBe(25_000 + 25_000)
  })

  it('handles 0% and 100% tiers', () => {
    const configs = [config({ tiers: [{ thresholdVnd: 1_000, rateBasisPoints: 0 }, { thresholdVnd: 5_000, rateBasisPoints: 10_000 }] })]
    expect(bonusFor({ programId: DOSII_PROGRAM, businessDate: '2026-10-20', configs, revenueVnd: 5_000 }).bonusVnd).toBe(0)
    expect(bonusFor({ programId: DOSII_PROGRAM, businessDate: '2026-10-20', configs, revenueVnd: 5_001 }).bonusVnd).toBe(5_001)
  })

  it('selects the version effective on the business date, including several versions in one month', () => {
    const configs = [
      config(),
      config({ id: 'rbc-dosii-2', version: 2, effectiveFrom: '2026-11-01', tiers: [{ thresholdVnd: 1_000_000, rateBasisPoints: 500 }] }),
      config({ id: 'rbc-dosii-3', version: 3, effectiveFrom: '2026-11-15', status: 'SUPERSEDED', tiers: [{ thresholdVnd: 1, rateBasisPoints: 9_999 }] }),
    ]
    const resolve = (businessDate) => resolveRevenueBonusProgram({ programId: DOSII_PROGRAM, businessDate, configs })
    expect(resolve('2026-10-19')).toMatchObject({ source: 'LEGACY' })
    expect(resolve('2026-10-20')).toMatchObject({ source: 'ADMIN_CONFIG', configId: 'rbc-dosii-1', version: 1 })
    expect(resolve('2026-10-31')).toMatchObject({ configId: 'rbc-dosii-1' })
    expect(resolve('2026-11-01')).toMatchObject({ configId: 'rbc-dosii-2', version: 2 })
    expect(resolve('2026-11-20')).toMatchObject({ configId: 'rbc-dosii-2' })
    expect(resolveRevenueBonusProgram({ programId: SM_PROGRAM, businessDate: '2026-11-20', configs }).source).toBe('LEGACY')
  })

  it('fails closed on corrupted configuration instead of silently using the legacy table', () => {
    const cases = [
      'not-an-array',
      [null],
      [config({ id: '' })],
      [config({ storePolicy: 'OTHER' })],
      [config({ effectiveFrom: '2026-02-30' })],
      [config({ version: 0 })],
      [config({ status: 'UNKNOWN' })],
      [config({ tiers: [] })],
      [config({ tiers: [{ thresholdVnd: 2_000, rateBasisPoints: 100 }, { thresholdVnd: 1_000, rateBasisPoints: 100 }] })],
      [config(), config({ id: 'rbc-dosii-1', version: 2, effectiveFrom: '2026-11-01' })],
      [config(), config({ id: 'rbc-dosii-2' })],
      [config(), config({ id: 'rbc-dosii-2', version: 2 })],
    ]
    for (const configs of cases) {
      expect(() => resolveRevenueBonusProgram({ programId: DOSII_PROGRAM, businessDate: '2026-10-25', configs }))
        .toThrow(expect.objectContaining({ code: REVENUE_BONUS_CONFIG_INVALID }))
    }
  })

  it('creates a self-contained snapshot that explains the amount without the live configuration', () => {
    const configs = [config()]
    const snapshot = revenueBonusConfigSnapshot(resolveRevenueBonusProgram({ programId: DOSII_PROGRAM, businessDate: '2026-10-21', configs }))
    configs[0].tiers[0].rateBasisPoints = 9_000
    expect(snapshot).toEqual({
      source: 'ADMIN_CONFIG',
      configId: 'rbc-dosii-1',
      version: 1,
      storePolicy: DOSII,
      programId: DOSII_PROGRAM,
      effectiveFrom: '2026-10-20',
      tiers: [
        { id: 'rbc-dosii-1.tier.1', thresholdVnd: 1_000_000, minimumRevenueVnd: 1_000_000, minimumInclusive: true, maximumRevenueVnd: 3_000_000, maximumInclusive: true, rateBasisPoints: 125 },
        { id: 'rbc-dosii-1.tier.2', thresholdVnd: 3_000_000, minimumRevenueVnd: 3_000_000, minimumInclusive: false, maximumRevenueVnd: null, maximumInclusive: false, rateBasisPoints: 250 },
      ],
    })
    expect(selectRevenueBonusTier({ programId: DOSII_PROGRAM, revenueVnd: 3_000_000, tiers: snapshot.tiers }).id).toBe('rbc-dosii-1.tier.1')
  })

  it('maps program ids to store groups and rejects unknown programs', () => {
    expect(revenueBonusStorePolicyForProgramId(DOSII_PROGRAM)).toBe(DOSII)
    expect(revenueBonusStorePolicyForProgramId(SM_PROGRAM)).toBe(SM_TNV)
    expect(() => resolveRevenueBonusProgram({ programId: 'other', businessDate: '2026-10-20' })).toThrow(RangeError)
    expect(() => resolveRevenueBonusProgram({ programId: DOSII_PROGRAM, businessDate: '2026-13-01' })).toThrow(TypeError)
  })

  it('summarizes the current, scheduled and historical configurations of one group', () => {
    const configs = [
      config(),
      config({ id: 'rbc-dosii-2', version: 2, effectiveFrom: '2026-12-01' }),
      config({ id: 'rbc-dosii-3', version: 3, effectiveFrom: '2026-11-01', status: 'SUPERSEDED' }),
      smConfig(),
    ]
    const overview = revenueBonusConfigOverview({ configs, storePolicy: DOSII, today: '2026-10-25' })
    expect(overview.headVersion).toBe(3)
    expect(overview.current).toMatchObject({ configId: 'rbc-dosii-1' })
    expect(overview.pending.map((record) => record.id)).toEqual(['rbc-dosii-2'])
    expect(overview.history.map((record) => record.version)).toEqual([3, 2, 1])
    expect(revenueBonusConfigOverview({ configs: [], storePolicy: SM_TNV, today: '2026-10-25' }))
      .toMatchObject({ headVersion: 0, currentRecord: null, pending: [], current: { source: 'LEGACY' } })
  })
})
