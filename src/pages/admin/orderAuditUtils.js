const AUDITED_FIELDS = Object.freeze({
  customerName: 'Khách hàng',
  customerPhone: 'Số điện thoại',
  customerAge: 'Tuổi',
  gender: 'Giới tính',
  occupation: 'Nghề nghiệp',
  acquisitionChannel: 'Kênh biết đến',
  amount: 'Giá trị',
  paymentMethod: 'Thanh toán',
  status: 'Trạng thái',
  deletedAt: 'Thời gian xóa',
  deletedBy: 'Người xóa',
  deleteReason: 'Lý do xóa',
})

const ROLE_LABELS = Object.freeze({
  admin: 'Admin',
  business_support: 'Hỗ trợ kinh doanh',
  manager: 'Hỗ trợ kinh doanh',
  store_manager: 'Quản lý cửa hàng',
  employee: 'Nhân viên',
  office: 'Nhân viên văn phòng',
})

const isPlainRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

const ORDER_KEYS = Object.freeze([
  'id', 'code', 'orderCode', 'storeId', 'employeeId', 'attendanceId',
  'customerName', 'customerPhone', 'amount', 'paymentMethod', 'status',
])

const orderSnapshot = (record = {}, side) => {
  const direct = isPlainRecord(record?.[side]) ? record[side] : null
  const metadataValue = isPlainRecord(record?.metadata?.[side]) ? record.metadata[side] : null
  const candidate = direct || metadataValue
  if (!candidate) return {}
  if (ORDER_KEYS.some((key) => Object.hasOwn(candidate, key))) return candidate
  for (const key of ['order', 'record', 'data']) {
    if (isPlainRecord(candidate[key])) return candidate[key]
  }
  return candidate
}

export const orderAuditTimestamp = (record = {}) => firstText(
  record.createdAt,
  record.serverTimestamp,
  record.updatedAt,
  record.recordedAt,
  record.occurredAt,
  record.date,
)

export const orderAuditStoreId = (record = {}) => {
  const before = orderSnapshot(record, 'before')
  const after = orderSnapshot(record, 'after')
  return firstText(record.storeId, record.metadata?.storeId, after.storeId, before.storeId)
}

export const orderAuditOrderCode = (record = {}) => {
  const before = orderSnapshot(record, 'before')
  const after = orderSnapshot(record, 'after')
  return firstText(
    record.orderCode,
    record.metadata?.orderCode,
    record.metadata?.code,
    after.code,
    after.orderCode,
    before.code,
    before.orderCode,
    record.orderId,
    record.entityId,
  ) || '—'
}

export const orderAuditAction = (record = {}) => {
  const source = firstText(record.action, record.metadata?.action).toLocaleLowerCase('vi-VN')
  if (!source) return 'Cập nhật'
  if (source === 'xóa' || source.includes('delete') || source.includes('remove')) return 'Xóa'
  if (source === 'sửa' || source.includes('update') || source.includes('edit')) return 'Sửa'
  return firstText(record.action, record.metadata?.action) || 'Cập nhật'
}

const actorNameFrom = (actor) => {
  if (typeof actor === 'string') return actor.trim()
  if (!isPlainRecord(actor)) return ''
  return firstText(actor.name, actor.displayName, actor.fullName, actor.username, actor.email)
}

const actorIdFrom = (actor) => {
  if (!isPlainRecord(actor)) return ''
  return firstText(actor.id, actor.userId, actor.user_id, actor.employeeId, actor.employee_id)
}

export const orderAuditActor = (record = {}) => {
  const actorSources = [record.actor, record.updatedBy, record.createdBy]
  const explicitName = firstText(
    ...actorSources.map(actorNameFrom),
    record.actorName,
    record.updatedByName,
    record.createdByName,
  )
  if (explicitName) return explicitName

  const role = firstText(
    ...actorSources.filter(isPlainRecord).map((actor) => actor.role),
    record.actorRole,
    record.actor_role,
    record.metadata?.actorRole,
  )
  const roleLabel = ROLE_LABELS[role] || role
  const actorId = firstText(
    ...actorSources.map(actorIdFrom),
    record.actorId,
    record.actor_id,
    record.metadata?.actorId,
  )
  if (actorId && roleLabel) return `${actorId} · ${roleLabel}`
  if (actorId) return actorId
  if (roleLabel) return roleLabel
  return 'Hệ thống'
}

const changedFieldNames = (record = {}) => {
  const before = orderSnapshot(record, 'before')
  const after = orderSnapshot(record, 'after')
  const declared = Array.isArray(record.changedFields)
    ? record.changedFields
    : Array.isArray(record.metadata?.changedFields)
      ? record.metadata.changedFields
      : []
  const inferred = Object.keys(before).length && Object.keys(after).length
    ? [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    : []
  return [...new Set([...declared, ...inferred].map(String))]
    .filter((field) => Object.hasOwn(AUDITED_FIELDS, field))
}

const formatActorValue = (value) => {
  if (!isPlainRecord(value)) return String(value)
  return firstText(value.name, value.displayName, value.fullName, value.username, value.id) || JSON.stringify(value)
}

const formatValue = (field, value) => {
  if (value == null || value === '') return '—'
  if (field === 'amount') {
    const amount = Number(value)
    return Number.isFinite(amount) ? `${Math.trunc(amount).toLocaleString('en-US')} đ` : String(value)
  }
  if (field === 'deletedAt') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
  }
  if (field === 'deletedBy') return formatActorValue(value)
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export const orderAuditChanges = (record = {}) => {
  const before = orderSnapshot(record, 'before')
  const after = orderSnapshot(record, 'after')
  return changedFieldNames(record).map((field) => ({
    field,
    label: AUDITED_FIELDS[field],
    before: formatValue(field, before[field]),
    after: formatValue(field, after[field]),
  }))
}
