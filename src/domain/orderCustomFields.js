import {
  customFieldOptions,
  ORDER_CUSTOM_FIELD_TYPE,
} from './orderInformationSettings.js'

export const MAX_ORDER_CUSTOM_FIELDS = 100
export const MAX_ORDER_CUSTOM_FIELD_TEXT = 2_000

const cleanText = (value = '') => String(value)
  .normalize('NFC')
  .trim()
  .replace(/\s+/gu, ' ')

const fieldIdOf = (value = {}) => cleanText(value.fieldId || value.id)

export const normalizeOrderCustomFields = (values = []) => {
  if (!Array.isArray(values)) return []
  return values.map((entry) => {
    const fieldId = fieldIdOf(entry)
    const fieldCode = cleanText(entry.fieldCode || entry.code).toUpperCase()
    const fieldLabel = cleanText(entry.fieldLabel || entry.label)
    const fieldType = String(entry.fieldType || ORDER_CUSTOM_FIELD_TYPE.TEXT)
    if (!fieldId || !fieldLabel) return null
    let value = entry.value
    if (fieldType === ORDER_CUSTOM_FIELD_TYPE.NUMBER) {
      value = Number(value)
      if (!Number.isFinite(value)) return null
    } else if (fieldType === ORDER_CUSTOM_FIELD_TYPE.BOOLEAN) {
      if (value !== true && value !== false) return null
    } else {
      value = cleanText(value)
      if (!value) return null
    }
    return { fieldId, fieldCode, fieldLabel, fieldType, value }
  }).filter(Boolean)
}

const isBlank = (value) => value === undefined || value === null || String(value).trim() === ''

const isCalendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

const resolvedValue = (definition, rawValue) => {
  const fieldType = definition.fieldType || ORDER_CUSTOM_FIELD_TYPE.TEXT
  if (isBlank(rawValue)) return { empty: true, value: '' }
  if (fieldType === ORDER_CUSTOM_FIELD_TYPE.NUMBER) {
    const value = Number(rawValue)
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) {
      return { error: `${definition.label} phải là số hợp lệ.` }
    }
    return { value }
  }
  if (fieldType === ORDER_CUSTOM_FIELD_TYPE.BOOLEAN) {
    if (![true, false, 'true', 'false'].includes(rawValue)) {
      return { error: `${definition.label} phải là Có hoặc Không.` }
    }
    return { value: rawValue === true || rawValue === 'true' }
  }
  const value = cleanText(rawValue)
  if (value.length > MAX_ORDER_CUSTOM_FIELD_TEXT) {
    return { error: `${definition.label} không được vượt quá ${MAX_ORDER_CUSTOM_FIELD_TEXT.toLocaleString('vi-VN')} ký tự.` }
  }
  if (fieldType === ORDER_CUSTOM_FIELD_TYPE.DATE && !isCalendarDate(value)) {
    return { error: `${definition.label} phải là ngày hợp lệ.` }
  }
  if (fieldType === ORDER_CUSTOM_FIELD_TYPE.SELECT
    && !definition.choices.includes(value)) {
    return { error: `${definition.label} không thuộc danh sách đang cấu hình.` }
  }
  return { value }
}

export const resolveOrderCustomFields = ({
  values = [],
  options,
  previousValues = [],
  allowHistorical = false,
} = {}) => {
  if (!Array.isArray(values) || values.length > MAX_ORDER_CUSTOM_FIELDS) {
    return { values: [], error: `Đơn hàng chỉ được có tối đa ${MAX_ORDER_CUSTOM_FIELDS} thuộc tính tùy chỉnh.` }
  }
  const submitted = new Map()
  for (const entry of values) {
    const fieldId = fieldIdOf(entry)
    if (!fieldId || submitted.has(fieldId)) return { values: [], error: 'Thuộc tính đơn hàng bị trùng hoặc không hợp lệ.' }
    submitted.set(fieldId, entry.value)
  }

  const definitions = customFieldOptions(options, { includeInactive: true })
  const knownIds = new Set(definitions.map((definition) => String(definition.id)))
  if ([...submitted.keys()].some((fieldId) => !knownIds.has(fieldId))) {
    return { values: [], error: 'Thuộc tính đơn hàng không còn tồn tại trong cấu hình.' }
  }

  const historicalValues = normalizeOrderCustomFields(previousValues)
  const historicalIds = new Set(historicalValues.map((entry) => entry.fieldId))
  const resolved = []
  for (const definition of definitions.filter((candidate) => candidate.active)) {
    const result = resolvedValue(definition, submitted.get(String(definition.id)))
    if (result.error) return { values: [], error: result.error }
    if (result.empty) {
      const unchangedLegacyOmission = allowHistorical && !historicalIds.has(String(definition.id))
      if (definition.required && !unchangedLegacyOmission) return { values: [], error: `Vui lòng nhập ${definition.label}.` }
      continue
    }
    resolved.push({
      fieldId: String(definition.id),
      fieldCode: String(definition.code || '').trim().toUpperCase(),
      fieldLabel: definition.label,
      fieldType: definition.fieldType,
      value: result.value,
    })
  }

  if (allowHistorical) {
    const activeIds = new Set(resolved.map((entry) => entry.fieldId))
    historicalValues.forEach((entry) => {
      const definition = definitions.find((candidate) => String(candidate.id) === entry.fieldId)
      if ((!definition || !definition.active) && !activeIds.has(entry.fieldId)) resolved.push(entry)
    })
  }
  return { values: resolved, error: '' }
}

export const orderCustomFieldDisplayValue = (entry = {}) => {
  if (entry.fieldType === ORDER_CUSTOM_FIELD_TYPE.BOOLEAN) return entry.value ? 'Có' : 'Không'
  if (entry.fieldType === ORDER_CUSTOM_FIELD_TYPE.DATE && /^\d{4}-\d{2}-\d{2}$/u.test(String(entry.value))) {
    return String(entry.value).split('-').reverse().join('/')
  }
  return String(entry.value ?? '')
}
