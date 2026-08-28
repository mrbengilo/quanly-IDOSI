export const WORK_CATALOG_KIND = Object.freeze({
  FIXED_TASK: 'FIXED_TASK',
  REWARD_TASK: 'REWARD_TASK',
  VIOLATION: 'VIOLATION',
})

export const WORK_CATALOG_TARGET = Object.freeze({
  STORE: 'store',
  OFFICE: 'office',
  BUSINESS_SUPPORT: 'business_support',
})

const WORK_CATALOG_KINDS = new Set(Object.values(WORK_CATALOG_KIND))
const WORK_CATALOG_TARGETS = new Set(Object.values(WORK_CATALOG_TARGET))
const STABLE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u

const text = (value) => String(value ?? '').trim()

const stableToken = (value, field) => {
  const normalized = text(value)
  if (!STABLE_TOKEN_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must be a stable identifier containing only letters, numbers, ., _, :, or -.`)
  }
  return normalized
}

const normalizeCode = (value) => stableToken(value, 'code').toLocaleLowerCase('en-US')

const normalizeKind = (value) => {
  const normalized = text(value).toLocaleUpperCase('en-US')
  if (!WORK_CATALOG_KINDS.has(normalized)) {
    throw new TypeError(`kind must be one of: ${[...WORK_CATALOG_KINDS].join(', ')}.`)
  }
  return normalized
}

const normalizeTargetGroup = (value) => {
  const source = text(value)
    .replace(/([a-z])([A-Z])/gu, '$1_$2')
    .replace(/[\s-]+/gu, '_')
    .toLocaleLowerCase('en-US')
  const normalized = source === 'businesssupport' || source === 'htkd'
    ? WORK_CATALOG_TARGET.BUSINESS_SUPPORT
    : source
  if (!WORK_CATALOG_TARGETS.has(normalized)) {
    throw new TypeError(`targetGroup must be one of: ${[...WORK_CATALOG_TARGETS].join(', ')}.`)
  }
  return normalized
}

const safeInteger = (value, field, { minimum = 0 } = {}) => {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw new TypeError(`${field} must be a safe integer greater than or equal to ${minimum}.`)
  }
  return normalized
}

const optionalStableToken = (value, field) => {
  const normalized = text(value)
  return normalized ? stableToken(normalized, field) : null
}

const isoTimestamp = (value, field, { optional = false } = {}) => {
  if ((value === undefined || value === null || value === '') && optional) return null
  const date = value instanceof Date ? value : new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid timestamp.`)
  return date.toISOString()
}

const calendarDate = (value, field, { optional = false } = {}) => {
  if ((value === undefined || value === null || value === '') && optional) return null
  const source = text(value)
  const dateOnly = source.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (dateOnly) {
    const parsed = new Date(`${source}T00:00:00.000Z`)
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === source) return source
    throw new TypeError(`${field} must be a valid YYYY-MM-DD date.`)
  }
  const date = value instanceof Date ? value : new Date(source)
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid date.`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type) => parts.find((entry) => entry.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

const normalizedName = (value) => {
  const normalized = text(value)
  if (!normalized) throw new TypeError('name is required.')
  if (normalized.length > 300) throw new TypeError('name must not exceed 300 characters.')
  return normalized
}

const effectiveRange = (item) => {
  const effectiveFrom = calendarDate(item.effectiveFrom, 'effectiveFrom', { optional: true })
  const effectiveTo = calendarDate(item.effectiveTo, 'effectiveTo', { optional: true })
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
    throw new RangeError('effectiveFrom must not be after effectiveTo.')
  }
  return { effectiveFrom, effectiveTo }
}

const normalizeAmount = (value, kind) => {
  const amountVnd = safeInteger(value ?? 0, 'amountVnd')
  if (kind !== WORK_CATALOG_KIND.FIXED_TASK && amountVnd === 0) {
    throw new TypeError('Reward tasks and violations require a positive integer amountVnd.')
  }
  return amountVnd
}

const recordVersion = (value) => {
  const version = Number(value)
  return Number.isSafeInteger(version) && version > 0 ? version : 1
}

export const createWorkCatalogItemId = ({ targetGroup, kind, code } = {}) => [
  'work-catalog',
  normalizeTargetGroup(targetGroup),
  normalizeKind(kind).toLocaleLowerCase('en-US'),
  normalizeCode(code),
].join(':')

export const normalizeWorkCatalogItem = (item = {}) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new TypeError('A work catalog item object is required.')
  }
  const kind = normalizeKind(item.kind)
  const targetGroup = normalizeTargetGroup(item.targetGroup)
  const code = normalizeCode(item.code)
  const id = stableToken(item.id || createWorkCatalogItemId({ targetGroup, kind, code }), 'id')
  const { effectiveFrom, effectiveTo } = effectiveRange(item)
  const storeId = optionalStableToken(item.storeId, 'storeId')
  if (targetGroup !== WORK_CATALOG_TARGET.STORE && storeId) {
    throw new TypeError('storeId is only valid for store catalog items.')
  }
  const normalized = {
    ...item,
    id,
    code,
    kind,
    targetGroup,
    storeId,
    shiftId: optionalStableToken(item.shiftId, 'shiftId'),
    shiftName: text(item.shiftName) || null,
    name: normalizedName(item.name),
    amountVnd: normalizeAmount(item.amountVnd, kind),
    required: kind === WORK_CATALOG_KIND.FIXED_TASK,
    active: item.active !== false && !item.deletedAt,
    sortOrder: safeInteger(item.sortOrder ?? 0, 'sortOrder'),
    effectiveFrom,
    effectiveTo,
    version: recordVersion(item.version),
    deletedAt: isoTimestamp(item.deletedAt, 'deletedAt', { optional: true }),
  }
  if (item.createdAt !== undefined) normalized.createdAt = isoTimestamp(item.createdAt, 'createdAt')
  if (item.updatedAt !== undefined) normalized.updatedAt = isoTimestamp(item.updatedAt, 'updatedAt')
  return Object.freeze(normalized)
}

export const validateWorkCatalogItem = (item) => {
  normalizeWorkCatalogItem(item)
  return true
}

const latestCatalogItems = (items) => {
  const latest = new Map()
  ;(Array.isArray(items) ? items : []).forEach((source) => {
    const item = normalizeWorkCatalogItem(source)
    const identity = item.id || item.code
    const previous = latest.get(identity)
    if (!previous || item.version > previous.version) {
      latest.set(identity, item)
      return
    }
    if (item.version === previous.version) {
      const currentTime = Date.parse(item.updatedAt || item.createdAt || '') || 0
      const previousTime = Date.parse(previous.updatedAt || previous.createdAt || '') || 0
      if (currentTime > previousTime) latest.set(identity, item)
    }
  })
  return [...latest.values()]
}

const normalizedComparisonText = (value) => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/[đĐ]/gu, 'd')
  .replace(/[^A-Za-z0-9]+/gu, ' ')
  .trim()
  .toLocaleLowerCase('vi-VN')

const itemMatchesShift = (item, { shiftId, shiftName }) => {
  if (!item.shiftId && !item.shiftName) return true
  if (item.shiftId) return Boolean(shiftId) && item.shiftId === text(shiftId)
  if (item.shiftName && shiftName) {
    return normalizedComparisonText(item.shiftName) === normalizedComparisonText(shiftName)
  }
  return false
}

const compareCatalogItems = (left, right) => (
  left.sortOrder - right.sortOrder
  || left.name.localeCompare(right.name, 'vi-VN', { sensitivity: 'base' })
  || left.code.localeCompare(right.code)
  || left.id.localeCompare(right.id)
)

export const activeWorkCatalogItems = (items, {
  targetGroup,
  storeId = null,
  shiftId = null,
  shiftName = null,
  date = new Date(),
  kinds = null,
} = {}) => {
  const normalizedTarget = normalizeTargetGroup(targetGroup)
  const normalizedDate = calendarDate(date, 'date')
  const requestedKinds = kinds == null
    ? null
    : new Set((Array.isArray(kinds) ? kinds : [kinds]).map(normalizeKind))
  const requestedStoreId = text(storeId) || null
  return latestCatalogItems(items)
    .filter((item) => item.active && !item.deletedAt)
    .filter((item) => item.targetGroup === normalizedTarget)
    .filter((item) => !requestedKinds || requestedKinds.has(item.kind))
    .filter((item) => item.targetGroup !== WORK_CATALOG_TARGET.STORE
      || !item.storeId
      || item.storeId === requestedStoreId)
    .filter((item) => !item.effectiveFrom || item.effectiveFrom <= normalizedDate)
    .filter((item) => !item.effectiveTo || item.effectiveTo >= normalizedDate)
    .filter((item) => itemMatchesShift(item, { shiftId, shiftName }))
    .toSorted(compareCatalogItems)
}

export const softDeleteWorkCatalogItem = (item, { at, by, reason } = {}) => {
  const normalized = normalizeWorkCatalogItem(item)
  if (normalized.deletedAt) return normalized
  const deletedAt = isoTimestamp(at, 'at')
  return Object.freeze({
    ...normalized,
    active: false,
    version: normalized.version + 1,
    deletedAt,
    deletedBy: by ?? null,
    deleteReason: text(reason) || null,
    updatedAt: deletedAt,
  })
}

const snapshotFromDefinition = (item, { effectiveDate }) => Object.freeze({
  catalogItemId: item.id,
  catalogCode: item.code,
  catalogVersion: item.version,
  kind: item.kind,
  targetGroup: item.targetGroup,
  storeId: item.storeId,
  shiftId: item.shiftId,
  shiftName: item.shiftName,
  name: item.name,
  amountVnd: item.amountVnd,
  required: item.kind === WORK_CATALOG_KIND.FIXED_TASK,
  optional: item.kind !== WORK_CATALOG_KIND.FIXED_TASK,
  sortOrder: item.sortOrder,
  effectiveDate,
  checked: false,
  completed: false,
})

export const snapshotActiveWorkCatalogItems = ({
  items,
  targetGroup,
  storeId = null,
  shiftId = null,
  shiftName = null,
  date = new Date(),
} = {}) => {
  const effectiveDate = calendarDate(date, 'date')
  return Object.freeze(activeWorkCatalogItems(items, {
    targetGroup,
    storeId,
    shiftId,
    shiftName,
    date: effectiveDate,
    kinds: [WORK_CATALOG_KIND.FIXED_TASK, WORK_CATALOG_KIND.REWARD_TASK],
  }).map((item) => snapshotFromDefinition(item, { effectiveDate })))
}

const legacyInteger = (value) => {
  const normalized = Number(value)
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : 0
}

const legacyHash = (value) => {
  let hash = 2166136261
  for (const character of String(value)) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const legacyKind = (value, fallback) => {
  try {
    return normalizeKind(value || fallback)
  } catch {
    return WORK_CATALOG_KIND.FIXED_TASK
  }
}

const legacyTarget = (value, fallback) => {
  try {
    return normalizeTargetGroup(value || fallback)
  } catch {
    return WORK_CATALOG_TARGET.STORE
  }
}

const parseLegacyValue = (value) => {
  if (typeof value !== 'string') return value
  const source = value.trim()
  if (!source.startsWith('{') && !source.startsWith('[')) return value
  try {
    return JSON.parse(source)
  } catch {
    return value
  }
}

export const decodeWorkCatalogSnapshot = (value, {
  kind = WORK_CATALOG_KIND.FIXED_TASK,
  targetGroup = WORK_CATALOG_TARGET.STORE,
} = {}) => {
  const parsed = parseLegacyValue(value)
  if (Array.isArray(parsed)) {
    throw new TypeError('decodeWorkCatalogSnapshot accepts one historical item; use decodeWorkCatalogSnapshots for arrays.')
  }
  const source = parsed && typeof parsed === 'object' ? parsed : { name: parsed }
  const name = text(source.name || source.label || source.title || source.description || source.task || source.code)
    || 'Công việc lịch sử'
  const resolvedKind = legacyKind(source.kind || source.type, kind)
  const resolvedTarget = legacyTarget(source.targetGroup || source.group || source.unitType, targetGroup)
  const sourceId = text(source.catalogItemId || source.itemId || source.taskId || source.checklistTaskId || source.id)
  const sourceCode = text(source.catalogCode || source.code || source.value)
  const fingerprint = legacyHash(`${resolvedTarget}|${resolvedKind}|${sourceId}|${sourceCode}|${name}`)
  const id = STABLE_TOKEN_PATTERN.test(sourceId) ? sourceId : `legacy-work-item:${fingerprint}`
  const code = STABLE_TOKEN_PATTERN.test(sourceCode)
    ? sourceCode.toLocaleLowerCase('en-US')
    : `legacy.${fingerprint}`
  const amountVnd = legacyInteger(
    source.amountVnd ?? source.rewardAmountVnd ?? source.deductionAmountVnd ?? source.amount ?? source.valueVnd,
  )
  const required = source.required === undefined
    ? resolvedKind === WORK_CATALOG_KIND.FIXED_TASK
    : source.required === true
  return Object.freeze({
    catalogItemId: id,
    catalogCode: code,
    catalogVersion: recordVersion(source.catalogVersion ?? source.version),
    kind: resolvedKind,
    targetGroup: resolvedTarget,
    storeId: text(source.storeId) || null,
    shiftId: text(source.shiftId || source.checklistTemplateId || source.templateId) || null,
    shiftName: text(source.shiftName) || null,
    name,
    amountVnd,
    required,
    optional: !required,
    sortOrder: legacyInteger(source.sortOrder ?? source.position),
    effectiveDate: calendarDate(source.effectiveDate || source.workDate, 'effectiveDate', { optional: true }),
    checked: source.checked === true || source.completed === true || source.done === true,
    completed: source.completed === true || source.checked === true || source.done === true,
    legacy: !source.catalogItemId || !source.catalogCode,
  })
}

export const decodeWorkCatalogSnapshots = (value, defaults) => {
  const parsed = parseLegacyValue(value)
  const records = Array.isArray(parsed) ? parsed : parsed == null || parsed === '' ? [] : [parsed]
  return Object.freeze(records.map((record) => decodeWorkCatalogSnapshot(record, defaults)))
}

const keySegment = (value, field) => encodeURIComponent(stableToken(value, field))

export const workCatalogProgressKey = ({
  employeeId,
  workDate,
  shiftRef,
  storeId,
  shiftId,
  catalogItemId,
} = {}) => {
  const stableShiftOccurrence = storeId !== undefined || shiftId !== undefined
  return [
    stableShiftOccurrence ? 'work-catalog-progress:v2' : 'work-catalog-progress:v1',
    keySegment(employeeId, 'employeeId'),
    calendarDate(workDate, 'workDate'),
    ...(stableShiftOccurrence ? [
      keySegment(storeId, 'storeId'),
      keySegment(shiftId || 'UNSPECIFIED', 'shiftId'),
    ] : [keySegment(shiftRef, 'shiftRef')]),
    keySegment(catalogItemId, 'catalogItemId'),
  ].join(':')
}

export const workCatalogClaimKey = (input) => `work-catalog-claim:v1:${workCatalogProgressKey(input)}`
