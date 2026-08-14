const MAX_SEQUENCE = 99999

const integerCounter = (value, field = 'counter') => {
  const number = Number(value ?? 0)
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_SEQUENCE) {
    throw new TypeError(`${field} must be an integer from 0 to ${MAX_SEQUENCE}.`)
  }
  return number
}

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value))

const comparable = (value) => {
  if (value === undefined) return '__undefined__'
  return JSON.stringify(value)
}

const visitDiff = (before, after, path, changes, ignored) => {
  if (ignored.has(path)) return
  if (comparable(before) === comparable(after)) return
  const beforeObject = before && typeof before === 'object' && !Array.isArray(before)
  const afterObject = after && typeof after === 'object' && !Array.isArray(after)
  if (beforeObject || afterObject) {
    const left = beforeObject ? before : {}
    const right = afterObject ? after : {}
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) visitDiff(left[key], right[key], path ? `${path}.${key}` : key, changes, ignored)
    return
  }
  changes.push({ field: path || '$', before: clone(before), after: clone(after) })
}

const dateParts = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    }
  }
  const source = String(value ?? '').trim()
  const iso = source.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
  const local = source.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (local) return { year: Number(local[3]), month: Number(local[2]), day: Number(local[1]) }
  return null
}

const validDateParts = (parts) => {
  if (!parts) return false
  const date = new Date(parts.year, parts.month - 1, parts.day)
  return date.getFullYear() === parts.year && date.getMonth() === parts.month - 1 && date.getDate() === parts.day
}

export function normalizeStoreCode(value) {
  const prefix = String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (!prefix) throw new TypeError('storeCode must contain at least one letter or digit.')
  return prefix
}

export function reserveNextSequence(currentCounter, { expectedCounter, max = MAX_SEQUENCE } = {}) {
  const current = integerCounter(currentCounter)
  const limit = integerCounter(max, 'max')
  if (expectedCounter != null && integerCounter(expectedCounter, 'expectedCounter') !== current) {
    throw new Error('SEQUENCE_CONFLICT')
  }
  if (current >= limit) throw new RangeError('SEQUENCE_EXHAUSTED')
  return current + 1
}

export function allocateOrderCode({ storeCode, counters = {}, expectedCounter } = {}) {
  const prefix = normalizeStoreCode(storeCode)
  const current = integerCounter(counters[prefix] ?? 0, `counters.${prefix}`)
  const sequence = reserveNextSequence(current, { expectedCounter })
  return {
    code: `${prefix}-${String(sequence).padStart(5, '0')}`,
    sequence,
    storeCode: prefix,
    counters: { ...counters, [prefix]: sequence },
  }
}

export function allocateImportCode({ date, counter = 0, expectedCounter } = {}) {
  const parts = dateParts(date)
  if (!validDateParts(parts)) throw new TypeError('date must be a valid calendar date.')
  const sequence = reserveNextSequence(counter, { expectedCounter })
  const day = String(parts.day).padStart(2, '0')
  const month = String(parts.month).padStart(2, '0')
  return {
    code: `PN-${day}${month}${parts.year}-${String(sequence).padStart(5, '0')}`,
    sequence,
    counter: sequence,
  }
}

export function deriveOrderCounter(codes = [], storeCode) {
  const prefix = normalizeStoreCode(storeCode)
  const expression = new RegExp(`^${prefix}-(\\d{5})$`)
  return codes.reduce((maximum, item) => {
    const code = typeof item === 'string' ? item : item?.code || item?.orderCode || ''
    const match = String(code).toUpperCase().match(expression)
    return match ? Math.max(maximum, Number(match[1])) : maximum
  }, 0)
}

export function deriveImportCounter(codes = []) {
  return codes.reduce((maximum, item) => {
    const code = typeof item === 'string' ? item : item?.code || item?.voucherCode || ''
    const match = String(code).toUpperCase().match(/^PN-\d{8}-(\d{5})$/)
    return match ? Math.max(maximum, Number(match[1])) : maximum
  }, 0)
}

export function diffRecords(before, after, { ignoreFields = [] } = {}) {
  const changes = []
  visitDiff(before, after, '', changes, new Set(ignoreFields))
  return changes.sort((left, right) => left.field.localeCompare(right.field))
}

export function createAuditRecord({
  id,
  entityType,
  entityId,
  action,
  before = null,
  after = null,
  actor,
  occurredAt,
  reason = '',
  ignoreFields = [],
  metadata = {},
} = {}) {
  if (!id || !entityType || !entityId || !action) throw new TypeError('id, entityType, entityId, and action are required.')
  if (!actor?.id && !actor?.name) throw new TypeError('actor identity is required.')
  if (!actor?.role) throw new TypeError('actor.role is required.')
  if (!occurredAt) throw new TypeError('occurredAt must come from the caller/server.')
  const changes = diffRecords(before, after, { ignoreFields })
  return {
    id: String(id),
    entityType: String(entityType),
    entityId: String(entityId),
    action: String(action),
    actor: clone(actor),
    occurredAt,
    reason: String(reason || '').trim(),
    before: clone(before),
    after: clone(after),
    changedFields: changes.map((change) => change.field),
    changes,
    metadata: clone(metadata),
  }
}

export const sequenceLimits = Object.freeze({ MAX_SEQUENCE })
