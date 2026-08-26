export const STORE_CHECKLIST_POLICY_VERSION = 1

export const STORE_CHECKLIST_CHECKOUT_CODE = Object.freeze({
  READY: 'CHECKLIST_COMPLETE',
  INCOMPLETE: 'CHECKLIST_INCOMPLETE',
  TEMPLATE_NOT_FOUND: 'CHECKLIST_TEMPLATE_NOT_FOUND',
  INVALID_CONFIGURATION: 'CHECKLIST_TASK_CONFIGURATION_INVALID',
})

const workbookTaskDescriptions = Object.freeze({
  morning: Object.freeze([
    'Bật đèn, quạt, mở nhạc',
    'Chào khách vào, tư vấn, cảm ơn',
    'Nhập đầy đủ thông tin đơn hàng',
    'Quét nhà, lau nhà',
    'Dọn dẹp nhà vệ sinh',
    'Gom quần áo/móc rơi dưới sàn',
    'Kiểm tra quần áo/ móc trên sào',
    'Gom móc trống trên sào',
    'Treo đồ lên sào',
    'Lọc đồ thành 3 loại: chạy sale, từ thiện, hủy',
    'Chụp hình gửi group zalo KH, tương tác với khách',
    'Phát thẻ tích điểm',
    'Add KH vào group zalo',
    'Cho KH đánh giá gg map',
    'Thanh toán đúng vị trí quy định',
    'Kiểm tra kỹ giao dịch chuyển khoản (màn hình phải hiện “Giao dịch thành công”)',
    'Nhắc khách chính sách “không đổi trả” khi thanh toán',
    'Trông coi xe cho khách',
    'Luôn mang tiền bên mình, phải nhắc khách bảo quản tư trang',
    'Tổng hợp doanh thu => nhập phần mềm => gửi báo cáo zalo => bấm kết ca',
  ]),
  afternoon: Object.freeze([
    'Bật đèn, quạt, mở nhạc',
    'Chào khách vào, tư vấn, cảm ơn',
    'Nhập đầy đủ thông tin đơn hàng',
    'Dọn dẹp nhà vệ sinh',
    'Gom quần áo/móc rơi dưới sàn',
    'Kiểm tra quần áo/ móc trên sào',
    'Gom móc trống trên sào',
    'Treo đồ lên sào',
    'Lọc đồ thành 3 loại: chạy sale, từ thiện, hủy',
    'Chụp hình gửi group zalo KH, tương tác với khách',
    'Phát thẻ tích điểm',
    'Add KH vào group zalo',
    'Cho KH đánh giá gg map',
    'Thanh toán đúng vị trí quy định',
    'Kiểm tra kỹ giao dịch chuyển khoản (màn hình phải hiện “Giao dịch thành công”)',
    'Nhắc khách chính sách “không đổi trả” khi thanh toán',
    'Trông coi xe cho khách',
    'Luôn mang tiền bên mình, phải nhắc khách bảo quản tư trang',
    'Tổng hợp doanh thu => nhập phần mềm => gửi báo cáo zalo => bấm kết ca',
  ]),
  night: Object.freeze([
    'Bật đèn, quạt, mở nhạc',
    'Chào khách vào, tư vấn, cảm ơn',
    'Nhập đầy đủ thông tin đơn hàng',
    'Dọn dẹp nhà vệ sinh',
    'Gom quần áo/móc rơi dưới sàn',
    'Kiểm tra quần áo/ móc trên sào',
    'Gom móc trống trên sào',
    'Treo đồ lên sào',
    'Lọc đồ thành 3 loại: chạy sale, từ thiện, hủy',
    'Phát thẻ tích điểm',
    'Add KH vào group zalo',
    'Cho KH đánh giá gg map',
    'Thanh toán đúng vị trí quy định',
    'Tổng hợp doanh thu => nhập phần mềm => gửi báo cáo zalo => bấm kết ca => đóng cửa',
    'Đổ rác',
    'Kiểm tra kỹ giao dịch chuyển khoản (màn hình phải hiện “Giao dịch thành công”)',
    'Nhắc khách chính sách “không đổi trả” khi thanh toán',
    'Trông coi xe cho khách',
    'Luôn mang tiền bên mình, phải nhắc khách bảo quản tư trang',
    'Tắt cầu dao/ loa/ nhạc/ điện/ nước => đóng cửa, bảo quản chìa khóa',
  ]),
})

const templateDefinitions = Object.freeze([
  Object.freeze({
    id: 'STORE-CHECKLIST-MORNING',
    key: 'morning',
    name: 'Ca Sáng',
    start: '08:00',
    end: '12:00',
    aliases: Object.freeze(['morning', 'am', 'ca sang', 'ca 1', 'ca1', 'ca 01', 'ca01', 'shift morning', 'shift 1', 'shift 01']),
  }),
  Object.freeze({
    id: 'STORE-CHECKLIST-AFTERNOON',
    key: 'afternoon',
    name: 'Ca Chiều',
    start: '12:00',
    end: '17:00',
    aliases: Object.freeze(['afternoon', 'pm', 'ca chieu', 'ca 2', 'ca2', 'ca 02', 'ca02', 'shift afternoon', 'shift 2', 'shift 02']),
  }),
  Object.freeze({
    id: 'STORE-CHECKLIST-NIGHT',
    key: 'night',
    name: 'Ca Tối',
    start: '17:00',
    end: '21:00',
    aliases: Object.freeze(['night', 'evening', 'ca toi', 'ca 3', 'ca3', 'ca 03', 'ca03', 'shift night', 'shift 3', 'shift 03']),
  }),
])

const checklistTask = (template, description, index) => Object.freeze({
  id: `STORE-CHECKLIST-${template.key.toUpperCase()}-${String(index + 1).padStart(2, '0')}`,
  templateId: template.id,
  shiftKey: template.key,
  shiftName: template.name,
  shiftStart: template.start,
  shiftEnd: template.end,
  position: index + 1,
  description,
  required: true,
  active: true,
  version: STORE_CHECKLIST_POLICY_VERSION,
  deletedAt: null,
})

export const STORE_CHECKLIST_TEMPLATES = Object.freeze(templateDefinitions.map((definition) => Object.freeze({
  ...definition,
  active: true,
  version: STORE_CHECKLIST_POLICY_VERSION,
  deletedAt: null,
  tasks: Object.freeze(workbookTaskDescriptions[definition.key].map((description, index) => (
    checklistTask(definition, description, index)
  ))),
})))

export const DEFAULT_STORE_CHECKLIST_TASK_SEEDS = Object.freeze(
  STORE_CHECKLIST_TEMPLATES.flatMap((template) => template.tasks),
)

const normalizedText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/[đĐ]/gu, 'd')
  .toLocaleLowerCase('vi-VN')
  .replace(/[^a-z0-9]+/gu, ' ')
  .trim()

const normalizedClock = (value) => {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/u)
  if (!match) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const shiftInterval = (shift) => {
  if (shift && typeof shift === 'object') {
    const start = normalizedClock(shift.start || shift.shiftStart || shift.startTime)
    const end = normalizedClock(shift.end || shift.shiftEnd || shift.endTime)
    if (start && end) return { start, end }
  }
  const source = typeof shift === 'string'
    ? shift
    : String(shift?.time || shift?.shiftTime || shift?.timeLabel || '')
  const match = source.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/u)
  if (!match) return null
  const start = normalizedClock(match[1])
  const end = normalizedClock(match[2])
  return start && end ? { start, end } : null
}

const shiftNames = (shift) => {
  if (typeof shift === 'string') return [normalizedText(shift)]
  if (!shift || typeof shift !== 'object') return []
  return [shift.id, shift.shiftId, shift.key, shift.templateKey, shift.name, shift.shiftName]
    .map(normalizedText)
    .filter(Boolean)
}

const recordVersion = (record) => {
  const version = Number(record?.version)
  return Number.isSafeInteger(version) && version > 0 ? version : 1
}

const latestRecords = (records, keyOf) => {
  const latest = new Map()
  records.forEach((record, index) => {
    if (!record || typeof record !== 'object') return
    const key = keyOf(record, index)
    if (!key) return
    const previous = latest.get(key)
    if (!previous || recordVersion(record) >= recordVersion(previous)) latest.set(key, record)
  })
  return [...latest.values()]
}

const activeTemplates = (templates) => latestRecords(
  Array.isArray(templates) ? templates : [],
  (template) => String(template.id || template.key || ''),
).filter((template) => template.active !== false && !template.deletedAt)

export const resolveStoreChecklistTemplate = (shift, templates = STORE_CHECKLIST_TEMPLATES) => {
  const available = activeTemplates(templates)
  const interval = shiftInterval(shift)
  if (interval) {
    const intervalMatch = available.find((template) => (
      normalizedClock(template.start) === interval.start
      && normalizedClock(template.end) === interval.end
    ))
    if (intervalMatch) return intervalMatch
  }

  const names = new Set(shiftNames(shift))
  if (!names.size) return null
  return available.find((template) => {
    const aliases = [template.id, template.key, template.name, ...(template.aliases || [])]
      .map(normalizedText)
      .filter(Boolean)
    return aliases.some((alias) => names.has(alias))
  }) || null
}

const belongsToTemplate = (task, template) => {
  const references = [task.templateId, task.checklistTemplateId, task.shiftKey, task.templateKey]
    .map(normalizedText)
    .filter(Boolean)
  return references.includes(normalizedText(template.id)) || references.includes(normalizedText(template.key))
}

const taskRecordsForTemplate = (template, taskRecords) => (
  (Array.isArray(taskRecords) ? taskRecords : []).filter((task) => belongsToTemplate(task, template))
)

export const activeStoreChecklistTasks = (templateOrShift, taskRecords = DEFAULT_STORE_CHECKLIST_TASK_SEEDS) => {
  const template = resolveStoreChecklistTemplate(templateOrShift)
  if (!template) return []
  return latestRecords(
    taskRecordsForTemplate(template, taskRecords),
    (task) => String(task.id || ''),
  )
    .filter((task) => task.active !== false && !task.deletedAt)
    .toSorted((left, right) => (
      (Number(left.position) || Number.MAX_SAFE_INTEGER) - (Number(right.position) || Number.MAX_SAFE_INTEGER)
      || String(left.id).localeCompare(String(right.id))
    ))
}

const checkedState = (record) => {
  if (!record || typeof record !== 'object') return false
  if (record.checked === true || record.completed === true || record.done === true || record.isCompleted === true) return true
  return ['completed', 'complete', 'done', 'hoan thanh'].includes(normalizedText(record.status))
}

const checkedIdSet = ({ checkedTaskIds, completedTaskIds, completionRecords, activeTasks }) => {
  const checked = new Set()
  const addIds = (values) => {
    if (!(Array.isArray(values) || values instanceof Set)) return
    values.forEach((value) => {
      const id = value && typeof value === 'object'
        ? value.taskId || value.checklistTaskId || value.id
        : value
      if (id != null && String(id).trim()) checked.add(String(id))
    })
  }
  addIds(checkedTaskIds)
  addIds(completedTaskIds)
  ;(Array.isArray(completionRecords) ? completionRecords : []).forEach((record) => {
    if (!checkedState(record)) return
    const id = record.taskId || record.checklistTaskId || record.id
    if (id != null && String(id).trim()) checked.add(String(id))
  })
  activeTasks.forEach((task) => {
    if (checkedState(task)) checked.add(String(task.id))
  })
  return checked
}

const checkoutResult = ({ allowed, code, template = null, activeTasks = [], missingTasks = [] }) => Object.freeze({
  allowed,
  canCheckout: allowed,
  code,
  templateId: template?.id || null,
  shiftKey: template?.key || null,
  activeTaskCount: activeTasks.length,
  completedTaskCount: activeTasks.length - missingTasks.length,
  missingTaskIds: Object.freeze(missingTasks.map((task) => String(task.id || ''))),
  missingTasks: Object.freeze([...missingTasks]),
})

export const validateStoreChecklistCheckout = ({
  shift,
  template,
  taskRecords,
  tasks,
  checkedTaskIds = [],
  completedTaskIds = [],
  completionRecords = [],
} = {}) => {
  const resolvedTemplate = resolveStoreChecklistTemplate(template || shift)
  if (!resolvedTemplate) {
    return checkoutResult({ allowed: false, code: STORE_CHECKLIST_CHECKOUT_CODE.TEMPLATE_NOT_FOUND })
  }

  const configuredTasks = taskRecords !== undefined
    ? taskRecords
    : tasks !== undefined
      ? tasks
      : DEFAULT_STORE_CHECKLIST_TASK_SEEDS
  if (!Array.isArray(configuredTasks)) {
    return checkoutResult({
      allowed: false,
      code: STORE_CHECKLIST_CHECKOUT_CODE.INVALID_CONFIGURATION,
      template: resolvedTemplate,
    })
  }
  const relevantTasks = taskRecordsForTemplate(resolvedTemplate, configuredTasks)
  const invalidActiveTask = relevantTasks.some((task) => (
    task?.active !== false && !task?.deletedAt && !String(task?.id || '').trim()
  ))
  if (invalidActiveTask) {
    return checkoutResult({
      allowed: false,
      code: STORE_CHECKLIST_CHECKOUT_CODE.INVALID_CONFIGURATION,
      template: resolvedTemplate,
    })
  }

  const activeTasks = activeStoreChecklistTasks(resolvedTemplate, configuredTasks)
  const checked = checkedIdSet({ checkedTaskIds, completedTaskIds, completionRecords, activeTasks })
  const missingTasks = activeTasks.filter((task) => !checked.has(String(task.id)))
  return checkoutResult({
    allowed: missingTasks.length === 0,
    code: missingTasks.length
      ? STORE_CHECKLIST_CHECKOUT_CODE.INCOMPLETE
      : STORE_CHECKLIST_CHECKOUT_CODE.READY,
    template: resolvedTemplate,
    activeTasks,
    missingTasks,
  })
}

export const canCheckoutStoreShift = (options) => validateStoreChecklistCheckout(options).allowed

const auditTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) throw new TypeError('at must be a valid audit timestamp.')
  return date.toISOString()
}

export const deactivateStoreChecklistTask = (task, { at, by, reason } = {}) => {
  if (!task || typeof task !== 'object' || !String(task.id || '').trim()) {
    throw new TypeError('A checklist task with an id is required.')
  }
  if (task.active === false || task.deletedAt) return task
  const next = {
    ...task,
    active: false,
    version: recordVersion(task) + 1,
    deletedAt: auditTimestamp(at),
  }
  if (by !== undefined && by !== null && by !== '') next.deletedBy = by
  if (String(reason || '').trim()) next.deleteReason = String(reason).trim()
  return next
}
