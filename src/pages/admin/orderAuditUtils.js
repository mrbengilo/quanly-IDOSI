const ORDER_FIELD_LABELS = Object.freeze({
  customerName: 'Tên khách hàng',
  customerPhone: 'Số điện thoại',
  customerAge: 'Tuổi',
  gender: 'Giới tính',
  occupation: 'Nghề nghiệp',
  acquisitionChannel: 'Kênh biết đến',
  amount: 'Số tiền',
  paymentMethod: 'Phương thức thanh toán',
  status: 'Trạng thái',
  deletedAt: 'Thời gian xóa',
  deletedBy: 'Người xóa',
})

const formatDateTime24 = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '—')
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date)
}

const formatActor = (value) => {
  if (!value || typeof value !== 'object') return String(value || '—')
  const name = value.name || value.displayName || value.username || value.id || '—'
  const role = value.role ? ` (${value.role})` : ''
  return `${name}${role}`
}

export const formatOrderAuditValue = (field, value) => {
  if (value == null || value === '') return '—'
  if (field === 'amount') return `${new Intl.NumberFormat('en-US').format(Number(value) || 0)} đ`
  if (field === 'deletedAt') return formatDateTime24(value)
  if (field === 'deletedBy') return formatActor(value)
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export const orderAuditChanges = (record = {}) => {
  const changedFields = Array.isArray(record.changedFields)
    ? record.changedFields
    : Array.isArray(record.metadata?.changedFields)
      ? record.metadata.changedFields
      : []
  return [...new Set(changedFields)].map((field) => ({
    field,
    label: ORDER_FIELD_LABELS[field] || field,
    before: formatOrderAuditValue(field, record.before?.[field]),
    after: formatOrderAuditValue(field, record.after?.[field]),
  }))
}
