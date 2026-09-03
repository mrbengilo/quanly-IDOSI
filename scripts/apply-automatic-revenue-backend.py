from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, content):
    Path(path).write_text(content, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    print(f'apply: {label}')
    return text.replace(old, new, 1)


def replace_all(text, old, new, label, minimum=1):
    count = text.count(old)
    if count < minimum:
        raise SystemExit(f'{label}: expected at least {minimum} matches, found {count}')
    print(f'apply: {label} ({count} matches)')
    return text.replace(old, new)


def replace_section(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker not found')
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        raise SystemExit(f'{label}: end marker not found')
    print(f'apply: {label}')
    return text[:start] + replacement + text[end:]


worker_path = 'server/worker.js'
worker = read(worker_path)
worker = replace_once(
    worker,
    "import { allocateByLargestRemainder } from '../src/domain/compensationAllocation.js'\n",
    """import { allocateByLargestRemainder } from '../src/domain/compensationAllocation.js'
import {
  AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE,
  REVENUE_BONUS_OVERRIDE_MODE,
  calculateAutomaticRevenueBonusDay,
  calculateAutomaticRevenueBonusPeriod,
} from '../src/domain/automaticRevenueBonus.js'
""",
    'worker automatic revenue imports',
)
worker = replace_all(
    worker,
    "'revenueBonusDaily', 'revenueBonusAllocations',",
    "'revenueBonusDaily', 'revenueBonusAllocations', 'revenueBonusOverrides',",
    'worker revenue override projections',
    minimum=3,
)
worker = replace_once(
    worker,
    "  'revenueBonusAllocations',\n  'teamRewardClaims',\n",
    "  'revenueBonusAllocations',\n  'revenueBonusOverrides',\n  'teamRewardClaims',\n",
    'worker normalized compensation collection',
)

live_replacement = """export const revenueBonusLiveSnapshot = ({ state, store, businessDate, now = new Date().toISOString() } = {}) => {
  const storeId = String(store?.id || '')
  const nowMs = Date.parse(now)
  if (!storeId || !Number.isFinite(nowMs)) throw new TypeError('store and a valid now timestamp are required.')
  assertNoCaseCollidingOperationalIdentifiers(state)
  const { programId, milestoneProgramId } = revenueBonusProgramForStore(store)
  return {
    ...calculateAutomaticRevenueBonusDay({
      storeId,
      businessDate,
      programId,
      milestoneProgramId,
      orders: Array.isArray(state?.orders) ? state.orders : [],
      attendance: Array.isArray(state?.attendance) ? state.attendance : [],
      employees: Array.isArray(state?.employees) ? state.employees : [],
      overrides: Array.isArray(state?.revenueBonusOverrides) ? state.revenueBonusOverrides : [],
      nowMs,
    }),
    calculationMode: 'AUTOMATIC',
    editableByAdminOnly: true,
  }
}

"""
worker = replace_section(
    worker,
    'export const revenueBonusLiveSnapshot =',
    'const revenueBonusMilestoneDecision =',
    live_replacement,
    'worker live projection',
)

period_helper = """const automaticRevenueBonusPeriodCache = new WeakMap()

const automaticRevenueBonusPeriodFor = (state, storeId, period) => {
  if (!isPlainRecord(state)) return { days: [], allocations: [] }
  const stores = Array.isArray(state.stores) ? state.stores : []
  const matches = stores.filter((store) => !store?.deletedAt && sameIdentifier(store?.id, storeId))
  if (matches.length !== 1) return { days: [], allocations: [] }
  let cache = automaticRevenueBonusPeriodCache.get(state)
  if (!cache) {
    cache = new Map()
    automaticRevenueBonusPeriodCache.set(state, cache)
  }
  const key = `${normalizeIdentifierKey(storeId)}:${period}`
  if (cache.has(key)) return cache.get(key)
  const { programId, milestoneProgramId } = revenueBonusProgramForStore(matches[0])
  const result = calculateAutomaticRevenueBonusPeriod({
    storeId: String(matches[0].id || storeId),
    period,
    programId,
    milestoneProgramId,
    orders: Array.isArray(state.orders) ? state.orders : [],
    attendance: Array.isArray(state.attendance) ? state.attendance : [],
    employees: Array.isArray(state.employees) ? state.employees : [],
    overrides: Array.isArray(state.revenueBonusOverrides) ? state.revenueBonusOverrides : [],
    nowMs: Date.now(),
  })
  cache.set(key, result)
  return result
}

"""
worker = replace_once(
    worker,
    'const compensationAmountTotalsFor = (\n',
    period_helper + 'const compensationAmountTotalsFor = (\n',
    'worker automatic payroll period helper',
)
old_payroll_loop = """  for (const record of Array.isArray(state.revenueBonusAllocations) ? state.revenueBonusAllocations : []) {
    if (!compensationRecordActiveForPayroll(record, employeeId, period)
      || !compensationRecordBelongsToStore(state, record, storeId, employeeHomeStoreId)) continue
    add('revenue', record.amountVnd ?? record.amount ?? 0, 'Tổng thưởng doanh thu')
  }
"""
new_payroll_loop = """  for (const record of Array.isArray(state.revenueBonusAllocations) ? state.revenueBonusAllocations : []) {
    if (dateFromRecord(record) >= AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE
      || !compensationRecordActiveForPayroll(record, employeeId, period)
      || !compensationRecordBelongsToStore(state, record, storeId, employeeHomeStoreId)) continue
    add('revenue', record.amountVnd ?? record.amount ?? 0, 'Tổng thưởng doanh thu lịch sử')
  }
  const automaticPeriod = automaticRevenueBonusPeriodFor(state, storeId, period)
  for (const record of automaticPeriod.allocations) {
    if (!belongsToEmployee(record, employeeId)
      || !compensationRecordBelongsToStore(state, record, storeId, employeeHomeStoreId)) continue
    add('revenue', record.amountVnd ?? 0, 'Tổng thưởng doanh thu tự động')
  }
"""
worker = replace_once(
    worker,
    old_payroll_loop,
    new_payroll_loop,
    'worker payroll automatic allocations',
)

override_command = """const activeRevenueBonusOverrideRecords = (state, storeId, businessDate, employeeId) => (
  Array.isArray(state.revenueBonusOverrides) ? state.revenueBonusOverrides : []
).filter((record) => (
  !record?.deletedAt
  && !record?.voidedAt
  && !record?.supersededAt
  && !['VOID', 'VOIDED', 'SUPERSEDED', 'CANCELLED', 'DELETED', 'INACTIVE']
    .includes(String(record?.status || '').trim().toUpperCase())
  && sameIdentifier(record.storeId, storeId)
  && dateFromRecord(record) === businessDate
  && sameIdentifier(record.employeeId, employeeId)
))

const revenueBonusOverrideCommand = async (db, actor, body, commandContext, current, state, payload) => {
  assertAdmin(actor, 'Chỉ Admin được sửa, xóa hoặc khôi phục thưởng doanh thu tự động của nhân viên.')
  const operation = body.type.split('.').at(-1)
  if (!['override_employee', 'delete_employee', 'restore_employee'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh điều chỉnh thưởng doanh thu tự động không được hỗ trợ.')
  }
  const requestedStoreId = String(payload.storeId || '').trim()
  const store = requireActivePhysicalStore(state, requestedStoreId)
  const storeId = String(store.id || requestedStoreId).trim()
  const businessDate = compensationDate(payload.businessDate, 'Ngày thưởng doanh thu')
  if (businessDate < AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE) {
    throw new ApiError(
      409,
      'AUTOMATIC_REVENUE_BONUS_NOT_EFFECTIVE',
      `Thưởng doanh thu tự động chỉ áp dụng từ ngày ${AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE}.`,
    )
  }
  const period = businessDate.slice(0, 7)
  assertPayrollNotPaidOrLocked(state, storeId, period)
  const requestedEmployeeId = String(payload.employeeId || '').trim()
  const employee = uniqueEmployeeIdentifierRecordMatch({
    records: Array.isArray(state.employees) ? state.employees : [],
    identifier: requestedEmployeeId,
    predicate: (record) => !record?.deletedAt,
    collisionCode: 'REVENUE_BONUS_EMPLOYEE_IDENTIFIER_COLLISION',
    collisionMessage: 'Mã nhân viên đang trùng; không thể điều chỉnh thưởng doanh thu an toàn.',
  })?.record || null
  if (!employee) throw new ApiError(404, 'REVENUE_BONUS_EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên được điều chỉnh thưởng.')
  const employeeId = String(employee.id || employee.code || employee.employeeId || requestedEmployeeId).trim()
  const reason = String(payload.reason || payload.note || '').trim()
  if (reason.length < 3 || reason.length > 500) {
    throw new ApiError(400, 'REVENUE_BONUS_OVERRIDE_REASON_REQUIRED', 'Lý do điều chỉnh phải từ 3 đến 500 ký tự.')
  }
  const currentOverrides = activeRevenueBonusOverrideRecords(state, storeId, businessDate, employeeId)
  if (currentOverrides.length > 1) {
    throw new ApiError(409, 'REVENUE_BONUS_OVERRIDE_COLLISION', 'Nhân viên đang có nhiều điều chỉnh thưởng hiệu lực; Admin cần xử lý dữ liệu trùng.', {
      overrideIds: currentOverrides.map((record) => String(record.id || '')).filter(Boolean),
    })
  }
  const previous = currentOverrides[0] || null
  if (previous) expectedEntityVersion({
    expectedVersion: payload.expectedVersion ?? payload.overrideVersion,
  }, previous)
  const live = revenueBonusLiveSnapshot({ state, store, businessDate, now: commandContext.now })
  const automaticAllocation = live.allocations.find((record) => sameIdentifier(record.employeeId, employeeId)) || null
  if (!automaticAllocation && !previous) {
    throw new ApiError(404, 'REVENUE_BONUS_ALLOCATION_NOT_FOUND', 'Nhân viên chưa có thời gian làm việc để hệ thống tính thưởng trong ngày này.')
  }
  const actorSnapshot = serverActorSnapshot(actor)
  let next
  if (operation === 'restore_employee') {
    if (!previous) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        override: null,
        existing: true,
      }, 200, commandContext)
    }
    next = {
      ...previous,
      status: 'VOID',
      voidedAt: commandContext.now,
      voidedBy: actorSnapshot,
      voidReason: reason,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
      version: Number(previous.version || 1) + 1,
    }
  } else {
    const mode = operation === 'delete_employee'
      ? REVENUE_BONUS_OVERRIDE_MODE.DELETED
      : REVENUE_BONUS_OVERRIDE_MODE.AMOUNT
    const amountVnd = mode === REVENUE_BONUS_OVERRIDE_MODE.DELETED ? 0 : Number(payload.amountVnd)
    if (!Number.isSafeInteger(amountVnd) || amountVnd < 0 || amountVnd > MAX_MONEY_VND) {
      throw new ApiError(400, 'REVENUE_BONUS_OVERRIDE_AMOUNT_INVALID', 'Số tiền thưởng phải là số nguyên VND hợp lệ và không âm.')
    }
    next = {
      ...(previous || {}),
      id: previous?.id || `rbo_${crypto.randomUUID()}`,
      storeId,
      storeName: String(store.name || storeId),
      businessDate,
      period,
      employeeId,
      employeeName: String(employee.name || employee.displayName || employeeId),
      mode,
      amountVnd,
      automaticAmountVndSnapshot: Number(automaticAllocation?.automaticAmountVnd || 0),
      reason,
      status: 'ACTIVE',
      createdAt: previous?.createdAt || commandContext.now,
      createdBy: previous?.createdBy || actorSnapshot,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
      version: Number(previous?.version || 0) + 1,
      supersededAt: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: '',
      deletedAt: null,
    }
  }
  const records = Array.isArray(state.revenueBonusOverrides) ? state.revenueBonusOverrides : []
  const nextRecords = previous
    ? records.map((record) => record === previous ? next : record)
    : [next, ...records]
  const nextState = {
    ...state,
    revenueBonusOverrides: nextRecords,
    payrollPeriods: invalidateClosedPayrollPeriods(state, { storeId, period }, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'revenue-bonus-override',
    entityId: String(next.id || `${storeId}:${businessDate}:${employeeId}`),
    before: previous,
    after: next,
    metadata: {
      storeId,
      businessDate,
      employeeId,
      mode: next.mode || null,
      amountVnd: Number(next.amountVnd || 0),
      automaticAmountVnd: Number(automaticAllocation?.automaticAmountVnd || 0),
    },
    response: {
      command: body.type,
      override: next,
      automaticAllocation,
    },
  }, commandContext)
}

"""
worker = replace_once(
    worker,
    'const revenueBonusMilestoneDecision = async',
    override_command + 'const revenueBonusMilestoneDecision = async',
    'worker admin override command',
)

worker = replace_once(
    worker,
    """const revenueBonusCommand = async (db, actor, body, commandContext) => {
  if (!['revenue_bonus.calculate_day', 'revenue_bonus.approve_milestone', 'revenue_bonus.reject_milestone'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh thưởng doanh thu không được hỗ trợ.')
  }
""",
    """const revenueBonusCommand = async (db, actor, body, commandContext) => {
  const supported = [
    'revenue_bonus.calculate_day',
    'revenue_bonus.approve_milestone',
    'revenue_bonus.reject_milestone',
    'revenue_bonus.override_employee',
    'revenue_bonus.delete_employee',
    'revenue_bonus.restore_employee',
  ]
  if (!supported.includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh thưởng doanh thu không được hỗ trợ.')
  }
""",
    'worker revenue command types',
)
worker = replace_once(
    worker,
    """  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body, actor)
  if (body.type !== 'revenue_bonus.calculate_day') {
    return revenueBonusMilestoneDecision(db, actor, body, commandContext, current, state, payload)
  }
""",
    """  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body, actor)
  if (['revenue_bonus.override_employee', 'revenue_bonus.delete_employee', 'revenue_bonus.restore_employee'].includes(body.type)) {
    return revenueBonusOverrideCommand(db, actor, body, commandContext, current, state, payload)
  }
  if (body.type !== 'revenue_bonus.calculate_day') {
    return revenueBonusMilestoneDecision(db, actor, body, commandContext, current, state, payload)
  }
""",
    'worker route admin override command',
)
worker = replace_once(
    worker,
    """  const businessDate = compensationDate(payload.businessDate, 'Ngày tính thưởng')
  const period = businessDate.slice(0, 7)
""",
    """  const businessDate = compensationDate(payload.businessDate, 'Ngày tính thưởng')
  if (businessDate >= AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE) {
    throw new ApiError(
      410,
      'REVENUE_BONUS_CALCULATION_AUTOMATED',
      'Thưởng doanh thu ngày đã được hệ thống tự động tính theo thời gian thực; không còn thao tác tính thủ công.',
    )
  }
  const period = businessDate.slice(0, 7)
""",
    'worker retire manual calculation after cutover',
)
write(worker_path, worker)


context_path = 'src/state/AppContext.jsx'
context = read(context_path)
context = replace_all(
    context,
    "'revenueBonusDaily', 'revenueBonusAllocations',",
    "'revenueBonusDaily', 'revenueBonusAllocations', 'revenueBonusOverrides',",
    'AppContext revenue override hydration',
    minimum=1,
)
context = replace_once(
    context,
    """  if (type.startsWith('revenue_bonus.')) {
    add('revenueBonusDaily', result.daily || result.bonus || result.bonuses)
    add('revenueBonusAllocations', result.allocation || result.allocations)
    add('salaryAdjustments', result.adjustment || result.adjustments)
  }
""",
    """  if (type.startsWith('revenue_bonus.')) {
    add('revenueBonusDaily', result.daily || result.bonus || result.bonuses)
    add('revenueBonusAllocations', result.allocation || result.allocations)
    add('revenueBonusOverrides', result.override || result.overrides)
    add('salaryAdjustments', result.adjustment || result.adjustments)
  }
""",
    'AppContext command override merge',
)
admin_methods = """  const requireRevenueBonusAdmin = () => {
    if (normalizeAuthRole(state.session?.role) !== 'admin') {
      throw new Error('Chỉ Admin được sửa, xóa hoặc khôi phục thưởng doanh thu tự động của nhân viên.')
    }
    if (!apiRef.current.enabled) {
      throw new Error('Cần kết nối máy chủ để điều chỉnh thưởng doanh thu an toàn.')
    }
  }

  const setRevenueBonusOverride = async (payload = {}) => {
    requireRevenueBonusAdmin()
    return runRemoteDomainCommand(
      'revenue_bonus.override_employee',
      payload,
      payload.idempotencyKey || `revenue-bonus-override:${crypto.randomUUID()}`,
    )
  }

  const deleteRevenueBonusOverride = async (payload = {}) => {
    requireRevenueBonusAdmin()
    return runRemoteDomainCommand(
      'revenue_bonus.delete_employee',
      payload,
      payload.idempotencyKey || `revenue-bonus-delete:${crypto.randomUUID()}`,
    )
  }

  const restoreRevenueBonusOverride = async (payload = {}) => {
    requireRevenueBonusAdmin()
    return runRemoteDomainCommand(
      'revenue_bonus.restore_employee',
      payload,
      payload.idempotencyKey || `revenue-bonus-restore:${crypto.randomUUID()}`,
    )
  }

"""
context = replace_once(
    context,
    '  const calculateRevenueBonusDay = async (payload = {}) => {\n',
    admin_methods + '  const calculateRevenueBonusDay = async (payload = {}) => {\n',
    'AppContext admin override actions',
)
context = replace_once(
    context,
    """    calculateRevenueBonusDay,
    approveRevenueBonusMilestone,
    rejectRevenueBonusMilestone,
""",
    """    setRevenueBonusOverride,
    deleteRevenueBonusOverride,
    restoreRevenueBonusOverride,
    calculateRevenueBonusDay,
    approveRevenueBonusMilestone,
    rejectRevenueBonusMilestone,
""",
    'AppContext expose admin override actions',
)
write(context_path, context)

print('Automatic revenue backend and state integration applied.')
