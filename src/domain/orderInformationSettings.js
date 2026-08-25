const normalizeText = (value = '') => String(value)
  .normalize('NFC')
  .trim()
  .replace(/\s+/gu, ' ')

export const normalizeOrderInformationLabel = (value = '') => normalizeText(value)
  .toLocaleLowerCase('vi-VN')

export const ORDER_INFORMATION_KIND = Object.freeze({
  OCCUPATION: 'occupation',
})

export const ORDER_PAYMENT_METHODS = Object.freeze(['Tiền mặt', 'Chuyển khoản'])

export const DEFAULT_OCCUPATION_LABELS = Object.freeze([
  'Nhân viên VP',
  'Kỹ sư',
  'Bác sĩ',
  'Giáo viên',
  'Học sinh/Sinh viên',
  'Lao động',
  'Nội trợ',
  'Buôn bán/kinh doanh',
  'Tài xế',
  'Giám đốc',
  'Ca sỉ',
  'Lao công',
  'Bảo vệ',
  'Công nhân',
  'Khác',
])

const stableOccupationCode = (index) => `OCC-${String(index + 1).padStart(3, '0')}`

export const DEFAULT_ORDER_INFORMATION_OPTIONS = Object.freeze(DEFAULT_OCCUPATION_LABELS.map((label, index) => Object.freeze({
  id: `order-occupation-${String(index + 1).padStart(3, '0')}`,
  kind: ORDER_INFORMATION_KIND.OCCUPATION,
  code: stableOccupationCode(index),
  label,
  normalizedLabel: normalizeOrderInformationLabel(label),
  active: true,
  sortOrder: (index + 1) * 100,
  system: false,
  createdAt: '2026-08-25T00:00:00+07:00',
  createdBy: 'SYSTEM',
  updatedAt: '2026-08-25T00:00:00+07:00',
  updatedBy: 'SYSTEM',
  deletedAt: null,
  deletedBy: null,
})))

const normalizedOption = (option = {}, index = 0) => {
  const label = normalizeText(option.label)
  if (!label) return null
  const kind = String(option.kind || ORDER_INFORMATION_KIND.OCCUPATION).trim()
  if (kind !== ORDER_INFORMATION_KIND.OCCUPATION) return null
  const fallback = DEFAULT_ORDER_INFORMATION_OPTIONS[index]
  return {
    ...option,
    id: String(option.id || fallback?.id || `order-occupation-${index + 1}`),
    kind,
    code: String(option.code || fallback?.code || stableOccupationCode(index)).trim().toUpperCase(),
    label,
    normalizedLabel: normalizeOrderInformationLabel(label),
    active: option.active !== false && !option.deletedAt,
    sortOrder: Number.isFinite(Number(option.sortOrder)) ? Number(option.sortOrder) : (index + 1) * 100,
    system: Boolean(option.system),
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

export const activeOccupationLabels = (options) => occupationOptions(options).map((option) => option.label)

export const findOccupationOption = (options, label, { includeInactive = true } = {}) => {
  const normalizedLabel = normalizeOrderInformationLabel(label)
  if (!normalizedLabel) return null
  return occupationOptions(options, { includeInactive })
    .find((option) => option.normalizedLabel === normalizedLabel) || null
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
  if (!label) return 'Tên hiển thị là bắt buộc.'
  if (label.length > 120) return 'Tên hiển thị không được vượt quá 120 ký tự.'
  if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/u.test(code)) return 'Mã phải có 2–40 ký tự chữ in hoa, số, gạch ngang hoặc gạch dưới.'
  const normalizedLabel = normalizeOrderInformationLabel(label)
  const duplicate = normalizeOrderInformationOptions(options).find((option) => (
    String(option.id) !== String(currentId)
    && (option.normalizedLabel === normalizedLabel || option.code === code)
  ))
  if (duplicate) return 'Tên hiển thị hoặc mã đã tồn tại trong danh mục nghề nghiệp.'
  return ''
}

export const orderInformationHelpers = Object.freeze({
  normalizeText,
  normalizedOption,
})
