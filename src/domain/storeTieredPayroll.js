const normalizeText = (value) => String(value ?? '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/[đĐ]/gu, 'd')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, ' ')
  .trim()

const identifier = (value) => String(value ?? '').trim()
const identifierKey = (value) => identifier(value).toLocaleLowerCase('en-US')

export const STORE_SALARY_CONFIG_IDENTIFIER_COLLISION = 'STORE_SALARY_CONFIG_IDENTIFIER_COLLISION'

export class StoreSalaryConfigIdentifierCollisionError extends RangeError {
  constructor(details = {}) {
    super(STORE_SALARY_CONFIG_IDENTIFIER_COLLISION)
    this.name = 'StoreSalaryConfigIdentifierCollisionError'
    this.code = STORE_SALARY_CONFIG_IDENTIFIER_COLLISION
    this.details = details
  }
}

const salaryConfigOwnerKey = (config) => JSON.stringify([
  identifier(config?.employeeId),
  identifier(config?.storeId),
])

const throwStoreSalaryConfigIdentifierCollision = (configs, {
  employeeId,
  storeId,
  period,
}) => {
  throw new StoreSalaryConfigIdentifierCollisionError({
    employeeId,
    storeId,
    period,
    conflictingConfigIds: configs.map((config) => identifier(config?.id)).filter(Boolean),
    conflictingEmployeeIds: [...new Set(configs.map((config) => identifier(config?.employeeId)).filter(Boolean))],
    conflictingStoreIds: [...new Set(configs.map((config) => identifier(config?.storeId)).filter(Boolean))],
  })
}

export const STORE_PAYROLL_POLICY = Object.freeze({
  DOSII: 'DOSII',
  SM_TNV: 'SM_TNV',
  UNSUPPORTED: 'UNSUPPORTED',
})

export const STORE_EMPLOYMENT_TYPE = Object.freeze({
  FULL_TIME: 'Full-Time',
  PART_TIME: 'Part-Time',
  PROBATION: 'Thử Việc',
})

export const STORE_PAYROLL_MODEL = Object.freeze({
  FULL_TIME_TIERED: 'STORE_FULL_TIME_TIERED',
  HOURLY: 'STORE_HOURLY',
})

export const STORE_FULL_TIME_THRESHOLD_HOURS = 208

const DEFAULT_TIERED_RATES = Object.freeze({
  [STORE_PAYROLL_POLICY.DOSII]: Object.freeze({
    thresholdHours: STORE_FULL_TIME_THRESHOLD_HOURS,
    standardHourlyRateVnd: 29_000,
    excessHourlyRateVnd: 25_000,
  }),
  [STORE_PAYROLL_POLICY.SM_TNV]: Object.freeze({
    thresholdHours: STORE_FULL_TIME_THRESHOLD_HOURS,
    standardHourlyRateVnd: 29_000,
    excessHourlyRateVnd: 26_000,
  }),
})

const NON_OPERATIONAL_STATUSES = new Set([
  'INACTIVE',
  'CLOSED',
  'DELETED',
  'ARCHIVED',
  'TAM NGUNG',
  'NGUNG HOAT DONG',
  'DA DONG',
  'DA XOA',
])

const INTERNAL_KINDS = new Set([
  'INTERNAL',
  'OFFICE',
  'HEAD OFFICE',
  'BACK OFFICE',
  'WAREHOUSE',
  'ADMIN',
  'NOI BO',
  'VAN PHONG',
  'KHO',
])

const positiveMoney = (value, field) => {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError(`${field} must be a positive integer amount in VND.`)
  }
  return amount
}

const positiveInteger = (value, field, fallback) => {
  const number = value == null || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${field} must be a positive safe integer.`)
  }
  return number
}

const requiredId = (value, field) => {
  const id = String(value ?? '').trim()
  if (!id) throw new TypeError(`${field} is required.`)
  return id
}

const normalizePolicy = (value) => {
  const key = normalizeText(value).replace(/\s+/gu, '_')
  if (key === 'DOSII' || key === 'IDOSI') return STORE_PAYROLL_POLICY.DOSII
  if (key === 'SM_TNV' || key === 'SM234' || key === 'SECOND_MALL') return STORE_PAYROLL_POLICY.SM_TNV
  return null
}

export function normalizeStoreEmploymentType(value) {
  const type = normalizeText(value).replace(/\s+/gu, '-')
  if (type === 'FULL-TIME' || type === 'FULLTIME') return STORE_EMPLOYMENT_TYPE.FULL_TIME
  if (type === 'PART-TIME' || type === 'PARTTIME') return STORE_EMPLOYMENT_TYPE.PART_TIME
  if (type === 'THU-VIEC' || type === 'PROBATION' || type === 'TRIAL') return STORE_EMPLOYMENT_TYPE.PROBATION
  return null
}

export const isHourlyStoreEmploymentType = (value) => {
  const type = normalizeStoreEmploymentType(value)
  return type === STORE_EMPLOYMENT_TYPE.PART_TIME || type === STORE_EMPLOYMENT_TYPE.PROBATION
}

const storeIsOperational = (store = {}) => {
  if (!store || typeof store !== 'object') return false
  if (store.deletedAt || store.archivedAt) return false
  if (store.isOperational === false || store.operational === false || store.isActive === false || store.active === false) return false
  if (store.isInternal === true || store.internal === true) return false

  const status = normalizeText(store.status)
  if (NON_OPERATIONAL_STATUSES.has(status)) return false

  const kind = normalizeText(store.kind || store.type || store.unitType || store.unit)
  if (INTERNAL_KINDS.has(kind)) return false
  return true
}

export function classifyStorePayrollPolicy(store = {}) {
  if (!storeIsOperational(store)) return STORE_PAYROLL_POLICY.UNSUPPORTED

  const explicitPolicy = normalizePolicy(store.payrollPolicy || store.salaryPolicy || store.storeGroup || store.brand)
  if (explicitPolicy) return explicitPolicy

  const identity = [store.id, store.code, store.short, store.name, store.employeePrefix, store.slug]
    .map(normalizeText)
    .filter(Boolean)
    .join(' | ')

  if (/(^|\s)(SM\s+TNV|SM234|SECOND\s*MALL)(\s|$)/u.test(identity)) {
    return STORE_PAYROLL_POLICY.SM_TNV
  }
  if (/(^|\s)(DOSII|IDOSI)(\s|$)/u.test(identity)) return STORE_PAYROLL_POLICY.DOSII
  return STORE_PAYROLL_POLICY.UNSUPPORTED
}

export function defaultStoreTieredRates(store) {
  const policy = classifyStorePayrollPolicy(store)
  const rates = DEFAULT_TIERED_RATES[policy]
  if (!rates) throw new RangeError('UNSUPPORTED_STORE_PAYROLL_POLICY')
  return { storePolicy: policy, ...rates }
}

export const defaultStoreFullTimeSalaryPolicy = defaultStoreTieredRates

const periodKey = (value) => {
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})/u)
  return match ? `${match[1]}-${match[2]}` : ''
}

export function effectiveStoreSalaryConfig(configs, {
  employeeId,
  storeId,
  period,
  store,
  canonicalOwnerAliases = false,
} = {}) {
  const normalizedEmployeeId = requiredId(employeeId, 'employeeId')
  const normalizedStoreId = requiredId(storeId || store?.id, 'storeId')
  const targetPeriod = periodKey(period)
  if (!targetPeriod) throw new TypeError('period must use YYYY-MM format.')

  const ownerMatches = (Array.isArray(configs) ? configs : [])
    .filter((config) => config && !config.deletedAt && config.active !== false && config.isActive !== false)
    .filter((config) => identifierKey(config.employeeId) === identifierKey(normalizedEmployeeId))
    .filter((config) => identifierKey(config.storeId) === identifierKey(normalizedStoreId))

  const foldedApplicable = ownerMatches
    .filter((config) => {
      const from = periodKey(config.effectiveFrom)
      const to = periodKey(config.effectiveTo)
      return (!from || from <= targetPeriod) && (!to || to >= targetPeriod)
    })

  const configCountByEffectivePeriod = new Map()
  for (const config of foldedApplicable) {
    const key = periodKey(config.effectiveFrom)
    configCountByEffectivePeriod.set(key, (configCountByEffectivePeriod.get(key) || 0) + 1)
  }
  if ([...configCountByEffectivePeriod.values()].some((count) => count > 1)) {
    throwStoreSalaryConfigIdentifierCollision(foldedApplicable, {
      employeeId: normalizedEmployeeId,
      storeId: normalizedStoreId,
      period: targetPeriod,
    })
  }

  // Salary configurations are versioned records for one exact employee/store
  // owner. Case-insensitive fallback is safe only while the folded scope has one
  // raw owner; otherwise records from a different owner could become effective in
  // a later period and silently replace the requested employee's configuration.
  const exactOwnerMatches = ownerMatches.filter((config) => (
    identifier(config.employeeId) === normalizedEmployeeId
    && identifier(config.storeId) === normalizedStoreId
  ))
  // Callers that have already resolved one canonical employee and store may
  // safely treat historical casing variants as versions of the same owner.
  // Same-period duplicates remain blocked by the collision check above.
  let ownerScopedMatches = canonicalOwnerAliases ? ownerMatches : exactOwnerMatches
  if (!canonicalOwnerAliases && ownerScopedMatches.length === 0 && ownerMatches.length > 0) {
    const ownerKeys = new Set(ownerMatches.map(salaryConfigOwnerKey))
    if (ownerKeys.size > 1) {
      throwStoreSalaryConfigIdentifierCollision(ownerMatches, {
        employeeId: normalizedEmployeeId,
        storeId: normalizedStoreId,
        period: targetPeriod,
      })
    }
    ownerScopedMatches = ownerMatches
  }

  const applicable = ownerScopedMatches.filter((config) => {
    const from = periodKey(config.effectiveFrom)
    const to = periodKey(config.effectiveTo)
    return (!from || from <= targetPeriod) && (!to || to >= targetPeriod)
  })

  const selected = applicable
    .sort((left, right) => {
      const effectiveOrder = periodKey(right.effectiveFrom).localeCompare(periodKey(left.effectiveFrom))
      if (effectiveOrder) return effectiveOrder
      const versionOrder = Number(right.version || 0) - Number(left.version || 0)
      if (versionOrder) return versionOrder
      return String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''))
    })[0]

  if (!selected) return null
  return store
    ? normalizeStoreSalaryConfig({
      ...selected,
      employeeId: normalizedEmployeeId,
      storeId: normalizedStoreId,
    }, {
      store,
      employeeId: normalizedEmployeeId,
      storeId: normalizedStoreId,
    })
    : { ...selected }
}

export function normalizeStoreSalaryConfig(input = {}, {
  store,
  employeeId,
  storeId,
  effectiveFrom,
} = {}) {
  const defaults = defaultStoreTieredRates(store)
  const configuredPolicy = normalizePolicy(input.storePolicy || input.policy)
  if (configuredPolicy && configuredPolicy !== defaults.storePolicy) {
    throw new RangeError('STORE_PAYROLL_POLICY_MISMATCH')
  }

  const normalizedEmployeeId = requiredId(input.employeeId || employeeId, 'employeeId')
  const normalizedStoreId = requiredId(input.storeId || storeId || store?.id, 'storeId')
  if (store?.id && identifierKey(store.id) !== identifierKey(normalizedStoreId)) throw new RangeError('STORE_ID_MISMATCH')

  const employmentType = normalizeStoreEmploymentType(input.employmentType || STORE_EMPLOYMENT_TYPE.FULL_TIME)
  if (employmentType !== STORE_EMPLOYMENT_TYPE.FULL_TIME) {
    throw new RangeError('TIERED_SALARY_CONFIG_REQUIRES_FULL_TIME')
  }

  const thresholdHours = positiveInteger(
    input.thresholdHours ?? input.monthlyThresholdHours ?? input.standardHoursLimit,
    'thresholdHours',
    defaults.thresholdHours,
  )
  const thresholdSeconds = thresholdHours * 3600
  if (!Number.isSafeInteger(thresholdSeconds)) throw new RangeError('thresholdSeconds exceeds the safe integer range.')

  return {
    employeeId: normalizedEmployeeId,
    storeId: normalizedStoreId,
    storePolicy: defaults.storePolicy,
    employmentType,
    thresholdHours,
    thresholdSeconds,
    standardHourlyRateVnd: positiveMoney(
      input.standardHourlyRateVnd ?? input.baseHourlyRateVnd ?? defaults.standardHourlyRateVnd,
      'standardHourlyRateVnd',
    ),
    excessHourlyRateVnd: positiveMoney(
      input.excessHourlyRateVnd ?? input.overtimeHourlyRateVnd ?? defaults.excessHourlyRateVnd,
      'excessHourlyRateVnd',
    ),
    currency: 'VND',
    effectiveFrom: String(input.effectiveFrom ?? effectiveFrom ?? '').trim() || null,
    version: positiveInteger(input.version, 'version', 1),
  }
}

export function validateStoreSalaryConfig(input, context) {
  try {
    return { valid: true, errors: [], value: normalizeStoreSalaryConfig(input, context) }
  } catch (error) {
    return { valid: false, errors: [String(error?.message || error)], value: null }
  }
}

export function createStoreSalaryConfigSnapshot(input, context) {
  const config = normalizeStoreSalaryConfig(input, context)
  return Object.freeze({
    schemaVersion: 1,
    model: STORE_PAYROLL_MODEL.FULL_TIME_TIERED,
    employeeId: config.employeeId,
    storeId: config.storeId,
    storePolicy: config.storePolicy,
    employmentType: config.employmentType,
    thresholdHours: config.thresholdHours,
    thresholdSeconds: config.thresholdSeconds,
    standardHourlyRateVnd: config.standardHourlyRateVnd,
    excessHourlyRateVnd: config.excessHourlyRateVnd,
    currency: config.currency,
    effectiveFrom: config.effectiveFrom,
    version: config.version,
  })
}

const normalizeWorkedSeconds = ({ workedSeconds, workedHours }) => {
  if (workedSeconds != null && workedSeconds !== '') {
    const seconds = Number(workedSeconds)
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new TypeError('workedSeconds must be a non-negative safe integer.')
    return seconds
  }
  const hours = Number(workedHours ?? 0)
  if (!Number.isFinite(hours) || hours < 0) throw new TypeError('workedHours must be a non-negative finite number.')
  const seconds = Math.round(hours * 3600)
  if (!Number.isSafeInteger(seconds)) throw new RangeError('workedHours exceeds the safe integer range.')
  return seconds
}

const vndFromSeconds = (segments) => {
  const numerator = segments.reduce(
    (total, { seconds, hourlyRateVnd }) => total + (BigInt(seconds) * BigInt(hourlyRateVnd)),
    0n,
  )
  const amount = numerator / 3600n
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Payroll amount exceeds the safe integer range.')
  return Number(amount)
}

export function calculateTieredHourlyPay({
  workedSeconds,
  workedHours,
  thresholdHours = STORE_FULL_TIME_THRESHOLD_HOURS,
  standardHourlyRateVnd,
  excessHourlyRateVnd,
} = {}) {
  const seconds = normalizeWorkedSeconds({ workedSeconds, workedHours })
  const normalizedThresholdHours = positiveInteger(thresholdHours, 'thresholdHours', STORE_FULL_TIME_THRESHOLD_HOURS)
  const thresholdSeconds = normalizedThresholdHours * 3600
  if (!Number.isSafeInteger(thresholdSeconds)) throw new RangeError('thresholdSeconds exceeds the safe integer range.')
  const standardRate = positiveMoney(standardHourlyRateVnd, 'standardHourlyRateVnd')
  const excessRate = positiveMoney(excessHourlyRateVnd, 'excessHourlyRateVnd')
  const standardSeconds = Math.min(seconds, thresholdSeconds)
  const excessSeconds = Math.max(0, seconds - thresholdSeconds)
  const amountVnd = vndFromSeconds([
    { seconds: standardSeconds, hourlyRateVnd: standardRate },
    { seconds: excessSeconds, hourlyRateVnd: excessRate },
  ])
  return {
    amountVnd,
    workedSeconds: seconds,
    workedHours: seconds / 3600,
    thresholdHours: normalizedThresholdHours,
    thresholdSeconds,
    standardSeconds,
    standardHours: standardSeconds / 3600,
    excessSeconds,
    excessHours: excessSeconds / 3600,
    standardHourlyRateVnd: standardRate,
    excessHourlyRateVnd: excessRate,
  }
}

export function calculateStoreEmployeeBasePay({
  store,
  employeeId,
  employmentType,
  workedSeconds,
  workedHours,
  hourlyRateVnd,
  salaryConfig,
} = {}) {
  const normalizedType = normalizeStoreEmploymentType(employmentType)
  if (!normalizedType) throw new RangeError('UNSUPPORTED_STORE_EMPLOYMENT_TYPE')
  const storePolicy = classifyStorePayrollPolicy(store)
  if (storePolicy === STORE_PAYROLL_POLICY.UNSUPPORTED) throw new RangeError('UNSUPPORTED_STORE_PAYROLL_POLICY')

  const seconds = normalizeWorkedSeconds({ workedSeconds, workedHours })
  const normalizedEmployeeId = requiredId(employeeId || salaryConfig?.employeeId, 'employeeId')
  const storeId = requiredId(store?.id || salaryConfig?.storeId, 'storeId')

  if (normalizedType === STORE_EMPLOYMENT_TYPE.FULL_TIME) {
    const salaryConfigSnapshot = createStoreSalaryConfigSnapshot(salaryConfig, {
      store,
      employeeId: normalizedEmployeeId,
      storeId,
    })
    const tieredPay = calculateTieredHourlyPay({
      workedSeconds: seconds,
      thresholdHours: salaryConfigSnapshot.thresholdHours,
      standardHourlyRateVnd: salaryConfigSnapshot.standardHourlyRateVnd,
      excessHourlyRateVnd: salaryConfigSnapshot.excessHourlyRateVnd,
    })
    return {
      ...tieredPay,
      baseSalaryVnd: tieredPay.amountVnd,
      payBasis: 'tiered-hourly',
      storePolicy,
      employmentType: normalizedType,
      salaryConfigSnapshot,
    }
  }

  const rate = positiveMoney(hourlyRateVnd ?? salaryConfig?.hourlyRateVnd, 'hourlyRateVnd')
  const amountVnd = vndFromSeconds([{ seconds, hourlyRateVnd: rate }])
  const salaryConfigSnapshot = Object.freeze({
    schemaVersion: 1,
    model: STORE_PAYROLL_MODEL.HOURLY,
    employeeId: normalizedEmployeeId,
    storeId,
    storePolicy,
    employmentType: normalizedType,
    hourlyRateVnd: rate,
    currency: 'VND',
    version: positiveInteger(salaryConfig?.version, 'version', 1),
  })
  return {
    amountVnd,
    baseSalaryVnd: amountVnd,
    workedSeconds: seconds,
    workedHours: seconds / 3600,
    standardSeconds: seconds,
    standardHours: seconds / 3600,
    excessSeconds: 0,
    excessHours: 0,
    payBasis: 'hourly',
    storePolicy,
    employmentType: normalizedType,
    salaryConfigSnapshot,
  }
}
