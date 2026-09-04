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
    day: '2-digit', month: '2-digit', year: '2-digit',
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
  const declaredFields = Array.isArray(record.changedFields)
    ? record.changedFields
    : Array.isArray(record.metadata?.changedFields)
      ? record.metadata.changedFields
      : []
  const inferredFields = [...new Set([
    ...Object.keys(record.before && typeof record.before === 'object' ? record.before : {}),
    ...Object.keys(record.after && typeof record.after === 'object' ? record.after : {}),
  ])].filter((field) => {
    const before = record.before?.[field]
    const after = record.after?.[field]
    try {
      return JSON.stringify(before) !== JSON.stringify(after)
    } catch {
      return String(before) !== String(after)
    }
  })
  const changedFields = declaredFields.length ? declaredFields : inferredFields
  return [...new Set(changedFields)]
    .filter((field) => !['updatedAt', 'updatedBy'].includes(String(field)))
    .map((field) => ({
      field,
      label: ORDER_FIELD_LABELS[field] || field,
      before: formatOrderAuditValue(field, record.before?.[field]),
      after: formatOrderAuditValue(field, record.after?.[field]),
    }))
}
