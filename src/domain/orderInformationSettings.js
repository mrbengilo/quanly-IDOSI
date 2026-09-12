import {
  DEFAULT_ORDER_INFORMATION_OPTIONS,
  ORDER_CUSTOM_FIELD_TYPE,
  ORDER_CUSTOM_FIELD_TYPES,
  ORDER_INFORMATION_KIND,
} from './orderInformationDefaults'

export {
  DEFAULT_OCCUPATION_LABELS,
  DEFAULT_ORDER_INFORMATION_OPTIONS,
  DEFAULT_PRODUCT_LABELS,
  ORDER_CUSTOM_FIELD_TYPE,
  ORDER_CUSTOM_FIELD_TYPES,
  ORDER_INFORMATION_KIND,
  ORDER_PAYMENT_METHODS,
} from './orderInformationDefaults'

const normalizeText = (value = '') => String(value)
  .normalize('NFC')
  .trim()
  .replace(/\s+/gu, ' ')

export const normalizeOrderInformationLabel = (value = '') => normalizeText(value)
  .toLocaleLowerCase('vi-VN')

const stableOccupationCode = (index) => `OCC-${String(index + 1).padStart(3, '0')}`
const stableProductCode = (index) => `PRD-${String(index + 1).padStart(3, '0')}`

const normalizedOption = (option = {}, index = 0) => {
  const label = normalizeText(option.label)
  if (!label) return null
  const kind = String(option.kind || ORDER_INFORMATION_KIND.OCCUPATION).trim()
  if (![ORDER_INFORMATION_KIND.OCCUPATION, ORDER_INFORMATION_KIND.PRODUCT, ORDER_INFORMATION_KIND.CUSTOM_FIELD].includes(kind)) return null
  const fallback = DEFAULT_ORDER_INFORMATION_OPTIONS.filter((candidate) => candidate.kind === kind)[index]
  const kindPrefix = kind === ORDER_INFORMATION_KIND.PRODUCT
    ? 'product'
    : kind === ORDER_INFORMATION_KIND.CUSTOM_FIELD ? 'custom-field' : 'occupation'
  const fallbackCode = kind === ORDER_INFORMATION_KIND.PRODUCT
    ? stableProductCode(index)
    : kind === ORDER_INFORMATION_KIND.CUSTOM_FIELD ? `ATTR-${String(index + 1).padStart(3, '0')}` : stableOccupationCode(index)
  const fieldType = ORDER_CUSTOM_FIELD_TYPES.includes(String(option.fieldType))
    ? String(option.fieldType)
    : ORDER_CUSTOM_FIELD_TYPE.TEXT
  const choices = [...new Set((Array.isArray(option.choices) ? option.choices : [])
    .map(normalizeText)
    .filter(Boolean))]
  return {
    ...option,
    id: String(option.id || fallback?.id || `order-${kindPrefix}-${index + 1}`),
    kind,
    code: String(option.code || fallback?.code || fallbackCode).trim().toUpperCase(),
    label,
    normalizedLabel: normalizeOrderInformationLabel(label),
    active: option.active !== false && !option.deletedAt,
    sortOrder: Number.isFinite(Number(option.sortOrder)) ? Number(option.sortOrder) : (index + 1) * 100,
    system: Boolean(option.system),
    ...(kind === ORDER_INFORMATION_KIND.CUSTOM_FIELD ? {
      fieldType,
      required: option.required === true,
      choices: fieldType === ORDER_CUSTOM_FIELD_TYPE.SELECT ? choices : [],
    } : {}),
    deletedAt: option.deletedAt || null,
    deletedBy: option.deletedBy || null,
  }
}

export const normalizeOrderInformationOptions = (options) => {
  const source = Array.isArray(options) && options.length ? options : DEFAULT_ORDER_INFORMATION_OPTIONS
  return source
    .map(normalizedOption)
    .filter(Boolean)
    .sort((left, right) => (
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      || left.label.localeCompare(right.label, 'vi')
      || left.id.localeCompare(right.id)
    ))
}

export const occupationOptions = (options, { includeInactive = false } = {}) => normalizeOrderInformationOptions(options)
  .filter((option) => option.kind === ORDER_INFORMATION_KIND.OCCUPATION && (includeInactive || option.active))

export const productOptions = (options, { includeInactive = false } = {}) => normalizeOrderInformationOptions(options)
  .filter((option) => option.kind === ORDER_INFORMATION_KIND.PRODUCT && (includeInactive || option.active))

export const customFieldOptions = (options, { includeInactive = false } = {}) => normalizeOrderInformationOptions(options)
  .filter((option) => option.kind === ORDER_INFORMATION_KIND.CUSTOM_FIELD && (includeInactive || option.active))

export const activeOccupationLabels = (options) => occupationOptions(options).map((option) => option.label)

export const findOccupationOption = (options, label, { includeInactive = true } = {}) => {
  const normalizedLabel = normalizeOrderInformationLabel(label)
  if (!normalizedLabel) return null
  return occupationOptions(options, { includeInactive })
    .find((option) => option.normalizedLabel === normalizedLabel) || null
}

export const findProductOption = (options, productId, { includeInactive = true } = {}) => {
  const requestedId = String(productId || '').trim()
  if (!requestedId) return null
  return productOptions(options, { includeInactive })
    .find((option) => String(option.id) === requestedId) || null
}

export const occupationValueAllowed = ({ options, value, previousValue = '', allowUnchangedInactive = false } = {}) => {
  const option = findOccupationOption(options, value, { includeInactive: true })
  const normalizedPreviousValue = normalizeOrderInformationLabel(previousValue)
  const unchangedHistoricalValue = Boolean(
    allowUnchangedInactive
    && normalizedPreviousValue
    && normalizeOrderInformationLabel(value) === normalizedPreviousValue,
  )
  if (!option) return unchangedHistoricalValue
  if (option.active) return true
  return unchangedHistoricalValue
}

export const validateOrderInformationOptionInput = (input = {}, options = [], { currentId = '' } = {}) => {
  const label = normalizeText(input.label)
  const code = String(input.code || '').trim().toUpperCase()
  const kind = String(input.kind || ORDER_INFORMATION_KIND.OCCUPATION).trim()
  if (![ORDER_INFORMATION_KIND.OCCUPATION, ORDER_INFORMATION_KIND.PRODUCT, ORDER_INFORMATION_KIND.CUSTOM_FIELD].includes(kind)) {
    return 'Loại danh mục không hợp lệ.'
  }
  if (!label) return 'Tên hiển thị là bắt buộc.'
  if (label.length > 120) return 'Tên hiển thị không được vượt quá 120 ký tự.'
  if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/u.test(code)) return 'Mã phải có 2–40 ký tự chữ in hoa, số, gạch ngang hoặc gạch dưới.'
  const normalizedLabel = normalizeOrderInformationLabel(label)
  const duplicate = normalizeOrderInformationOptions(options).find((option) => (
    String(option.id) !== String(currentId)
    && (
      (option.kind === kind && option.normalizedLabel === normalizedLabel)
      || option.code === code
    )
  ))
  if (duplicate) return 'Tên hiển thị đã tồn tại trong cùng danh mục hoặc mã đã được sử dụng.'
  if (kind === ORDER_INFORMATION_KIND.CUSTOM_FIELD) {
    const fieldType = String(input.fieldType || ORDER_CUSTOM_FIELD_TYPE.TEXT)
    if (!ORDER_CUSTOM_FIELD_TYPES.includes(fieldType)) return 'Kiểu dữ liệu của thuộc tính không hợp lệ.'
    const choices = [...new Set((Array.isArray(input.choices) ? input.choices : [])
      .map(normalizeText)
      .filter(Boolean))]
    if (choices.length > 50 || choices.some((choice) => choice.length > 120)) {
      return 'Danh sách lựa chọn chỉ được có tối đa 50 mục, mỗi mục không quá 120 ký tự.'
    }
    if (fieldType === ORDER_CUSTOM_FIELD_TYPE.SELECT && !choices.length) {
      return 'Thuộc tính dạng danh sách cần ít nhất một lựa chọn.'
    }
  }
  return ''
}

export const orderInformationHelpers = Object.freeze({
  normalizeText,
  normalizedOption,
})
