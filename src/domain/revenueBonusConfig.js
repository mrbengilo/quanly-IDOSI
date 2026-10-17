import {
  REVENUE_BONUS_PROGRAM_IDS,
  REVENUE_BONUS_PROGRAMS,
} from './compensationPolicies.js'

// Effective-dated, per-store-group configuration of the daily revenue bonus
// percentage table. Admin enters ascending thresholds; the boundary rule is the
// one the legacy table already used, so a configuration equal to the legacy
// thresholds pays exactly the same amount at every revenue value:
//   - first threshold: "Từ" (revenue >= threshold),
//   - every later threshold: "Trên" (revenue > threshold),
//   - each range ends at, and includes, the next threshold.
// One rate applies to the whole valid daily revenue (no progressive slices).

export const REVENUE_BONUS_CONFIG_STORE_POLICY = Object.freeze({
  DOSII: 'DOSII',
  SM_TNV: 'SM_TNV',
})

export const REVENUE_BONUS_CONFIG_STORE_POLICIES = Object.freeze([
  REVENUE_BONUS_CONFIG_STORE_POLICY.DOSII,
  REVENUE_BONUS_CONFIG_STORE_POLICY.SM_TNV,
])

export const REVENUE_BONUS_CONFIG_SOURCE = Object.freeze({
  LEGACY: 'LEGACY',
  ADMIN: 'ADMIN_CONFIG',
})

export const REVENUE_BONUS_CONFIG_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
})

export const REVENUE_BONUS_CONFIG_INVALID = 'REVENUE_BONUS_CONFIG_INVALID'
export const REVENUE_BONUS_CONFIG_MAX_TIERS = 20
export const REVENUE_BONUS_MAX_RATE_BASIS_POINTS = 10_000

const BASIS_POINTS_PER_PERCENT = 100
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

export class RevenueBonusConfigError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'RevenueBonusConfigError'
    this.code = REVENUE_BONUS_CONFIG_INVALID
    this.details = details
  }
}

const PROGRAM_BY_POLICY = Object.freeze({
  [REVENUE_BONUS_CONFIG_STORE_POLICY.DOSII]: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
  [REVENUE_BONUS_CONFIG_STORE_POLICY.SM_TNV]: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
})

const POLICY_BY_PROGRAM = Object.freeze(Object.fromEntries(
  Object.entries(PROGRAM_BY_POLICY).map(([policy, programId]) => [programId, policy]),
))

const POLICY_LABELS = Object.freeze({
  [REVENUE_BONUS_CONFIG_STORE_POLICY.DOSII]: 'Dosii',
  [REVENUE_BONUS_CONFIG_STORE_POLICY.SM_TNV]: 'SM TNV',
})

export const isRevenueBonusConfigStorePolicy = (value) => Object.hasOwn(PROGRAM_BY_POLICY, String(value ?? ''))

export const revenueBonusProgramIdForStorePolicy = (storePolicy) => {
  const programId = PROGRAM_BY_POLICY[String(storePolicy ?? '')]
  if (!programId) throw new RangeError(`Unsupported revenue bonus store policy: ${storePolicy}`)
  return programId
}

export const revenueBonusStorePolicyForProgramId = (programId) => {
  const storePolicy = POLICY_BY_PROGRAM[String(programId ?? '')]
  if (!storePolicy) throw new RangeError(`Unknown revenue bonus program: ${programId}`)
  return storePolicy
}

export const revenueBonusStorePolicyLabel = (storePolicy) => POLICY_LABELS[storePolicy] || String(storePolicy || '')

const VALID_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export const isValidBusinessDate = (value) => {
  const text = String(value ?? '')
  if (!VALID_DATE_PATTERN.test(text)) return false
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
}

export const vietnamBusinessDate = (now = Date.now()) => {
  const instant = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(instant.getTime())) throw new TypeError('now must be a valid timestamp.')
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const addCalendarDays = (date, days) => {
  if (!isValidBusinessDate(date)) throw new TypeError('date must use YYYY-MM-DD.')
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

/** The earliest date a new configuration may take effect: tomorrow in Vietnam. */
export const minimumRevenueBonusEffectiveFrom = (now = Date.now()) => addCalendarDays(vietnamBusinessDate(now), 1)

export function validateRevenueBonusEffectiveFrom(value, { now = Date.now() } = {}) {
  const effectiveFrom = String(value ?? '').trim()
  if (!effectiveFrom) return { ok: false, message: 'Cần chọn ngày bắt đầu áp dụng.' }
  if (!isValidBusinessDate(effectiveFrom)) {
    return { ok: false, message: 'Ngày bắt đầu áp dụng không hợp lệ.' }
  }
  const minimum = minimumRevenueBonusEffectiveFrom(now)
  if (effectiveFrom < minimum) {
    return {
      ok: false,
      message: `Cấu hình chỉ áp dụng từ ngày mai (${minimum.split('-').reverse().join('/')}) trở đi; không áp dụng hồi tố hoặc trong ngày.`,
    }
  }
  return { ok: true, value: effectiveFrom }
}

const formatVnd = (value) => `${Number(value).toLocaleString('vi-VN')} đ`

// Accepts what MoneyInput produces (plain digits) and the Vietnamese thousands
// format ("1.500.000"). Anything else is rejected instead of partially parsed.
export function parseRevenueThresholdInput(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0
      ? { ok: true, value }
      : { ok: false, message: 'Mốc doanh thu phải là số nguyên đồng lớn hơn 0.' }
  }
  const text = String(value ?? '').trim()
  if (!text) return { ok: false, message: 'Cần nhập mốc doanh thu.' }
  if (!/^\d+$/u.test(text) && !/^\d{1,3}(?:\.\d{3})+$/u.test(text)) {
    return { ok: false, message: 'Mốc doanh thu chỉ gồm chữ số (đơn vị đồng).' }
  }
  const digits = text.replaceAll('.', '')
  const parsed = Number(digits)
  if (!Number.isSafeInteger(parsed)) return { ok: false, message: 'Mốc doanh thu vượt giới hạn cho phép.' }
  if (parsed <= 0) return { ok: false, message: 'Mốc doanh thu phải lớn hơn 0 đồng.' }
  return { ok: true, value: parsed }
}

// Percent text such as "1,25" or "1.25" maps exactly to basis points (125).
// Numbers go through their shortest decimal text so 1.25 is accepted while a
// floating-point artifact such as 0.30000000000000004 is rejected.
export function parseRatePercentInput(value) {
  const text = typeof value === 'number'
    ? (Number.isFinite(value) ? String(value) : '')
    : String(value ?? '').trim().replace(/\s*%$/u, '')
  if (!text) return { ok: false, message: typeof value === 'number' ? 'Tỷ lệ thưởng không hợp lệ.' : 'Cần nhập tỷ lệ thưởng.' }
  const match = text.match(/^(\d{1,3})(?:[.,](\d{1,2}))?$/u)
  if (!match) {
    return /^\d+[.,]\d{3,}$/u.test(text)
      ? { ok: false, message: 'Tỷ lệ thưởng chỉ hỗ trợ tối đa 2 chữ số thập phân.' }
      : { ok: false, message: 'Tỷ lệ thưởng phải là số từ 0 đến 100, ví dụ 1,25.' }
  }
  const basisPoints = (Number(match[1]) * BASIS_POINTS_PER_PERCENT) + Number((match[2] || '').padEnd(2, '0'))
  if (basisPoints > REVENUE_BONUS_MAX_RATE_BASIS_POINTS) {
    return { ok: false, message: 'Tỷ lệ thưởng không được vượt quá 100%.' }
  }
  return { ok: true, basisPoints }
}

export const formatRateBasisPoints = (basisPoints) => {
  const value = Number(basisPoints)
  if (!Number.isSafeInteger(value) || value < 0) return ''
  const whole = Math.trunc(value / BASIS_POINTS_PER_PERCENT)
  const fraction = String(value % BASIS_POINTS_PER_PERCENT).padStart(2, '0').replace(/0+$/u, '')
  return fraction ? `${whole},${fraction}` : String(whole)
}

export const formatRatePercent = (basisPoints) => `${formatRateBasisPoints(basisPoints)}%`

/**
 * Validates canonical rows ({ thresholdVnd, rateBasisPoints }) and returns
 * per-row messages so the UI and API point at the exact offending row.
 */
export function validateRevenueBonusTierRows(rows) {
  const formErrors = []
  if (!Array.isArray(rows)) {
    return { valid: false, tiers: [], rowErrors: [], formErrors: ['Danh sách mốc thưởng không hợp lệ.'] }
  }
  if (!rows.length) formErrors.push('Cần ít nhất một mốc thưởng.')
  if (rows.length > REVENUE_BONUS_CONFIG_MAX_TIERS) {
    formErrors.push(`Chỉ được cấu hình tối đa ${REVENUE_BONUS_CONFIG_MAX_TIERS} mốc thưởng.`)
  }
  const rowErrors = rows.map(() => ({}))
  const tiers = rows.map((row, index) => {
    const isRecord = row && typeof row === 'object' && !Array.isArray(row)
    const thresholdVnd = isRecord ? row.thresholdVnd : undefined
    const rateBasisPoints = isRecord ? row.rateBasisPoints : undefined
    if (!Number.isSafeInteger(thresholdVnd) || thresholdVnd <= 0) {
      rowErrors[index].thresholdVnd = 'Mốc doanh thu phải là số nguyên đồng lớn hơn 0.'
    }
    if (!Number.isSafeInteger(rateBasisPoints)
      || rateBasisPoints < 0
      || rateBasisPoints > REVENUE_BONUS_MAX_RATE_BASIS_POINTS) {
      rowErrors[index].rateBasisPoints = 'Tỷ lệ thưởng phải từ 0% đến 100%, tối đa 2 chữ số thập phân.'
    }
    return { thresholdVnd, rateBasisPoints }
  })
  const seen = new Map()
  let previousIndex = -1
  tiers.forEach((tier, index) => {
    if (rowErrors[index].thresholdVnd) return
    if (seen.has(tier.thresholdVnd)) {
      rowErrors[index].thresholdVnd = `Mốc doanh thu trùng với dòng ${seen.get(tier.thresholdVnd) + 1}.`
      return
    }
    seen.set(tier.thresholdVnd, index)
    if (previousIndex >= 0 && tier.thresholdVnd < tiers[previousIndex].thresholdVnd) {
      rowErrors[index].thresholdVnd = `Mốc phải lớn hơn mốc ở dòng ${previousIndex + 1} (sắp xếp tăng dần).`
      return
    }
    previousIndex = index
  })
  const valid = !formErrors.length && rowErrors.every((error) => !Object.keys(error).length)
  return {
    valid,
    tiers: valid ? tiers.map(({ thresholdVnd, rateBasisPoints }) => ({ thresholdVnd, rateBasisPoints })) : [],
    rowErrors,
    formErrors,
  }
}

/** Converts ascending thresholds into the canonical program tier shape. */
export function revenueBonusTiersFromThresholds(thresholds, { idPrefix = 'revenue-bonus.tier' } = {}) {
  return thresholds.map((threshold, index) => {
    const next = thresholds[index + 1]
    return {
      id: `${idPrefix}.${index + 1}`,
      thresholdVnd: threshold.thresholdVnd,
      minimumRevenueVnd: threshold.thresholdVnd,
      minimumInclusive: index === 0,
      maximumRevenueVnd: next ? next.thresholdVnd : null,
      maximumInclusive: Boolean(next),
      rateBasisPoints: threshold.rateBasisPoints,
    }
  })
}

export const legacyRevenueBonusThresholds = (storePolicy) => REVENUE_BONUS_PROGRAMS[
  revenueBonusProgramIdForStorePolicy(storePolicy)
].tiers.map((tier) => ({ thresholdVnd: tier.minimumRevenueVnd, rateBasisPoints: tier.rateBasisPoints }))

/** Human readable range, consistent with the selection rule above. */
export function describeRevenueBonusTierRange(tier) {
  const minimum = Number(tier?.minimumRevenueVnd ?? tier?.thresholdVnd)
  const start = `${tier?.minimumInclusive ? 'Từ' : 'Trên'} ${formatVnd(minimum)}`
  if (tier?.maximumRevenueVnd == null) return tier?.minimumInclusive ? `${start} trở lên` : start
  return `${start} đến ${formatVnd(tier.maximumRevenueVnd)}`
}

const configError = (message, details) => new RevenueBonusConfigError(message, details)

const normalizeStoredConfig = (record, index) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw configError('Cấu hình thưởng doanh thu đã lưu bị hỏng.', { index })
  }
  const id = String(record.id ?? '').trim()
  const storePolicy = String(record.storePolicy ?? '')
  const effectiveFrom = String(record.effectiveFrom ?? '')
  const version = record.version
  const status = record.status == null ? REVENUE_BONUS_CONFIG_STATUS.ACTIVE : String(record.status)
  const details = { index, configId: id || null, storePolicy }
  if (!id) throw configError('Cấu hình thưởng doanh thu đã lưu thiếu mã định danh.', details)
  if (!isRevenueBonusConfigStorePolicy(storePolicy)) {
    throw configError('Cấu hình thưởng doanh thu đã lưu có nhóm cửa hàng không hợp lệ.', details)
  }
  if (!isValidBusinessDate(effectiveFrom)) {
    throw configError('Cấu hình thưởng doanh thu đã lưu có ngày hiệu lực không hợp lệ.', details)
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw configError('Cấu hình thưởng doanh thu đã lưu có phiên bản không hợp lệ.', details)
  }
  if (!Object.values(REVENUE_BONUS_CONFIG_STATUS).includes(status)) {
    throw configError('Cấu hình thưởng doanh thu đã lưu có trạng thái không hợp lệ.', details)
  }
  const validation = validateRevenueBonusTierRows(record.tiers)
  if (!validation.valid) {
    throw configError('Cấu hình thưởng doanh thu đã lưu có mốc hoặc tỷ lệ không hợp lệ.', details)
  }
  return { ...record, id, storePolicy, effectiveFrom, version, status, tiers: validation.tiers }
}

/**
 * Validates every stored configuration of one store group. A missing collection
 * means "never configured" (legacy table); malformed data is an error so money
 * is never finalized from a silent fallback.
 */
export function revenueBonusConfigsForStorePolicy(configs, storePolicy) {
  if (configs == null) return []
  if (!Array.isArray(configs)) throw configError('Danh sách cấu hình thưởng doanh thu đã lưu bị hỏng.')
  const normalized = configs.map(normalizeStoredConfig)
    .filter((record) => record.storePolicy === storePolicy)
  const ids = new Set()
  const versions = new Set()
  const activeDates = new Set()
  for (const record of normalized) {
    const details = { configId: record.id, storePolicy, version: record.version }
    if (ids.has(record.id)) throw configError('Cấu hình thưởng doanh thu bị trùng mã định danh.', details)
    if (versions.has(record.version)) throw configError('Cấu hình thưởng doanh thu bị trùng phiên bản.', details)
    ids.add(record.id)
    versions.add(record.version)
    if (record.status !== REVENUE_BONUS_CONFIG_STATUS.ACTIVE) continue
    if (activeDates.has(record.effectiveFrom)) {
      throw configError('Có hai cấu hình thưởng doanh thu cùng ngày hiệu lực.', { ...details, effectiveFrom: record.effectiveFrom })
    }
    activeDates.add(record.effectiveFrom)
  }
  return normalized.toSorted((left, right) => left.version - right.version)
}

const legacyResolution = (programId, storePolicy) => ({
  source: REVENUE_BONUS_CONFIG_SOURCE.LEGACY,
  programId,
  storePolicy,
  configId: null,
  version: null,
  effectiveFrom: null,
  tiers: REVENUE_BONUS_PROGRAMS[programId].tiers.map((tier) => ({
    ...tier,
    thresholdVnd: tier.minimumRevenueVnd,
  })),
})

const configResolution = (programId, record) => ({
  source: REVENUE_BONUS_CONFIG_SOURCE.ADMIN,
  programId,
  storePolicy: record.storePolicy,
  configId: record.id,
  version: record.version,
  effectiveFrom: record.effectiveFrom,
  tiers: revenueBonusTiersFromThresholds(record.tiers, { idPrefix: `${record.id}.tier` }),
})

/** The active (non-superseded) configuration that governs businessDate. */
export function selectEffectiveRevenueBonusConfig(records, businessDate) {
  return records
    .filter((record) => (
      record.status === REVENUE_BONUS_CONFIG_STATUS.ACTIVE
      && record.effectiveFrom <= businessDate
    ))
    .toSorted((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0] || null
}

/**
 * Resolves the percentage table for one program on one business date. The
 * business date being calculated decides, never the clock of the caller, so a
 * late sweep of an old day still uses that day's configuration.
 */
export function resolveRevenueBonusProgram({ programId, businessDate, configs } = {}) {
  const normalizedProgramId = String(programId ?? '').trim()
  const storePolicy = revenueBonusStorePolicyForProgramId(normalizedProgramId)
  if (!isValidBusinessDate(businessDate)) throw new TypeError('businessDate must use YYYY-MM-DD.')
  const records = revenueBonusConfigsForStorePolicy(configs, storePolicy)
  const effective = selectEffectiveRevenueBonusConfig(records, businessDate)
  return effective
    ? configResolution(normalizedProgramId, effective)
    : legacyResolution(normalizedProgramId, storePolicy)
}

/** Self-contained JSON stored with a finalized day so it explains its amount. */
export const revenueBonusConfigSnapshot = (resolution) => ({
  source: resolution.source,
  configId: resolution.configId,
  version: resolution.version,
  storePolicy: resolution.storePolicy,
  programId: resolution.programId,
  effectiveFrom: resolution.effectiveFrom,
  tiers: resolution.tiers.map((tier) => ({
    id: tier.id,
    thresholdVnd: tier.thresholdVnd ?? tier.minimumRevenueVnd,
    minimumRevenueVnd: tier.minimumRevenueVnd,
    minimumInclusive: tier.minimumInclusive,
    maximumRevenueVnd: tier.maximumRevenueVnd,
    maximumInclusive: tier.maximumInclusive,
    rateBasisPoints: tier.rateBasisPoints,
  })),
})

/** Admin overview of one group: what applies today, what is scheduled, history. */
export function revenueBonusConfigOverview({ configs, storePolicy, today }) {
  const records = revenueBonusConfigsForStorePolicy(configs, storePolicy)
  const programId = revenueBonusProgramIdForStorePolicy(storePolicy)
  const effective = selectEffectiveRevenueBonusConfig(records, today)
  const pending = records
    .filter((record) => record.status === REVENUE_BONUS_CONFIG_STATUS.ACTIVE && record.effectiveFrom > today)
    .toSorted((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
  return {
    storePolicy,
    programId,
    headVersion: records.reduce((maximum, record) => Math.max(maximum, record.version), 0),
    current: effective ? configResolution(programId, effective) : legacyResolution(programId, storePolicy),
    currentRecord: effective,
    pending,
    history: records.toSorted((left, right) => right.version - left.version),
  }
}
