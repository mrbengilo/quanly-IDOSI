export const ORDER_INFORMATION_KIND = Object.freeze({
  OCCUPATION: 'occupation',
  PRODUCT: 'product',
  CUSTOM_FIELD: 'custom_field',
})

export const ORDER_CUSTOM_FIELD_TYPE = Object.freeze({
  TEXT: 'text',
  NUMBER: 'number',
  SELECT: 'select',
  BOOLEAN: 'boolean',
  DATE: 'date',
})

export const ORDER_CUSTOM_FIELD_TYPES = Object.freeze(Object.values(ORDER_CUSTOM_FIELD_TYPE))
export const ORDER_PAYMENT_METHODS = Object.freeze(['Tiền mặt', 'Chuyển khoản'])

export const DEFAULT_OCCUPATION_LABELS = Object.freeze([
  'Nhân viên VP', 'Kỹ sư', 'Bác sĩ', 'Giáo viên', 'Học sinh/Sinh viên',
  'Lao động', 'Nội trợ', 'Buôn bán/kinh doanh', 'Tài xế', 'Giám đốc',
  'Ca sỉ', 'Lao công', 'Bảo vệ', 'Công nhân', 'Khác',
])

export const DEFAULT_PRODUCT_LABELS = Object.freeze(['Đồ nam', 'Đầm', 'Áo nữ', 'Đồ nữ', 'Đồ bộ'])

const seedOption = (kind, label, index) => {
  const product = kind === ORDER_INFORMATION_KIND.PRODUCT
  const sequence = String(index + 1).padStart(3, '0')
  return Object.freeze({
    id: `order-${product ? 'product' : 'occupation'}-${sequence}`,
    kind,
    code: `${product ? 'PRD' : 'OCC'}-${sequence}`,
    label,
    normalizedLabel: label.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('vi-VN'),
    active: true,
    sortOrder: product ? 2000 + (index * 100) : (index + 1) * 100,
    system: false,
    createdAt: '2026-08-25T00:00:00+07:00',
    createdBy: 'SYSTEM',
    updatedAt: '2026-08-25T00:00:00+07:00',
    updatedBy: 'SYSTEM',
    deletedAt: null,
    deletedBy: null,
  })
}

export const DEFAULT_ORDER_INFORMATION_OPTIONS = Object.freeze([
  ...DEFAULT_OCCUPATION_LABELS.map((label, index) => seedOption(ORDER_INFORMATION_KIND.OCCUPATION, label, index)),
  ...DEFAULT_PRODUCT_LABELS.map((label, index) => seedOption(ORDER_INFORMATION_KIND.PRODUCT, label, index)),
])
