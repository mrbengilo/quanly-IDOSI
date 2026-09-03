from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    print(f'apply: {label}')
    return text.replace(old, new, 1)


def replace_exact_count(text, old, new, expected, label):
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{label}: expected {expected} matches, found {count}')
    print(f'apply: {label} ({count})')
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


def insert_before_last(text, marker, addition, label):
    index = text.rfind(marker)
    if index < 0:
        raise SystemExit(f'{label}: marker not found')
    print(f'apply: {label}')
    return text[:index] + addition + text[index:]


# ---------------------------------------------------------------------------
# Server: trusted full-state period projection, support-transfer rule, scoping.
# ---------------------------------------------------------------------------
server_path = 'server/worker.js'
server = read(server_path)
server = replace_exact_count(
    server,
    "    'stores', 'employees', 'orders', 'attendance', 'schedule', 'shiftDefinitions',\n",
    "    'stores', 'employees', 'orders', 'attendance', 'schedule', 'shiftDefinitions', 'supportTransfers',\n",
    2,
    'load support transfers for revenue screens',
)
server = replace_once(
    server,
    """      revenueBonusAllocations: filterArray(state, 'revenueBonusAllocations', (record) => (
        sameIdentifier(record.storeId, storeId)
      )),
      teamRewardClaims: filterArray(state, 'teamRewardClaims', (record) => sameIdentifier(record.storeId, storeId)),
""",
    """      revenueBonusAllocations: filterArray(state, 'revenueBonusAllocations', (record) => (
        sameIdentifier(record.storeId, storeId)
      )),
      revenueBonusOverrides: filterArray(state, 'revenueBonusOverrides', (record) => (
        sameIdentifier(record.storeId, storeId)
      )),
      teamRewardClaims: filterArray(state, 'teamRewardClaims', (record) => sameIdentifier(record.storeId, storeId)),
""",
    'project store revenue overrides',
)
server = replace_once(
    server,
    """      revenueBonusAllocations: own('revenueBonusAllocations'),
      teamRewardClaims: filterArray(state, 'teamRewardClaims', (record) => (
""",
    """      revenueBonusAllocations: own('revenueBonusAllocations'),
      revenueBonusOverrides: own('revenueBonusOverrides'),
      teamRewardClaims: filterArray(state, 'teamRewardClaims', (record) => (
""",
    'project only own employee revenue overrides',
)
server = replace_once(
    server,
    """    employees: Array.isArray(state.employees) ? state.employees : [],
    overrides: Array.isArray(state.revenueBonusOverrides) ? state.revenueBonusOverrides : [],
    nowMs: Date.now(),
""",
    """    employees: Array.isArray(state.employees) ? state.employees : [],
    supportTransfers: Array.isArray(state.supportTransfers) ? state.supportTransfers : [],
    overrides: Array.isArray(state.revenueBonusOverrides) ? state.revenueBonusOverrides : [],
    nowMs: Date.now(),
""",
    'payroll automatic period support transfers',
)
server = replace_once(
    server,
    """      employees: Array.isArray(state?.employees) ? state.employees : [],
      overrides: Array.isArray(state?.revenueBonusOverrides) ? state.revenueBonusOverrides : [],
      nowMs,
""",
    """      employees: Array.isArray(state?.employees) ? state.employees : [],
      supportTransfers: Array.isArray(state?.supportTransfers) ? state.supportTransfers : [],
      overrides: Array.isArray(state?.revenueBonusOverrides) ? state.revenueBonusOverrides : [],
      nowMs,
""",
    'live automatic day support transfers',
)

revenue_read_block = r"""const revenueBonusViewerEmployeeIds = (state, user) => {
  const profile = ownEmployeeProfile(state, user)
  return [...new Set([
    String(user?.employee_id || user?.employeeId || '').trim(),
    ...employeeIdentifierValues(profile),
  ].map(normalizeIdentifierKey).filter(Boolean))]
}

const publicAutomaticRevenueBonusAllocation = (record, includeAdminDetails = false) => {
  if (includeAdminDetails) return record
  const safe = { ...record }
  delete safe.overrideId
  delete safe.overrideReason
  delete safe.overrideVersion
  delete safe.supportTransferIds
  return safe
}

const visibleAutomaticRevenueBonusAllocations = ({
  allocations = [],
  canViewAllAllocations = true,
  viewerEmployeeIds = [],
  includeAdminDetails = false,
} = {}) => {
  const visibleIds = new Set((Array.isArray(viewerEmployeeIds) ? viewerEmployeeIds : [])
    .map(normalizeIdentifierKey)
    .filter(Boolean))
  return (Array.isArray(allocations) ? allocations : [])
    .filter((record) => canViewAllAllocations || visibleIds.has(normalizeIdentifierKey(record.employeeId)))
    .map((record) => publicAutomaticRevenueBonusAllocation(record, includeAdminDetails))
}

export const revenueBonusPeriodSnapshot = ({
  state,
  store,
  period,
  now = new Date().toISOString(),
  canViewAllAllocations = true,
  viewerEmployeeIds = [],
  includeAdminDetails = false,
} = {}) => {
  const storeId = String(store?.id || '')
  const normalizedPeriod = String(period || '').trim()
  const nowMs = Date.parse(now)
  if (!storeId || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(normalizedPeriod) || !Number.isFinite(nowMs)) {
    throw new TypeError('store, period and a valid now timestamp are required.')
  }
  assertNoCaseCollidingOperationalIdentifiers(state)
  const { programId, milestoneProgramId } = revenueBonusProgramForStore(store)
  const calculated = calculateAutomaticRevenueBonusPeriod({
    storeId,
    period: normalizedPeriod,
    programId,
    milestoneProgramId,
    orders: Array.isArray(state?.orders) ? state.orders : [],
    attendance: Array.isArray(state?.attendance) ? state.attendance : [],
    employees: Array.isArray(state?.employees) ? state.employees : [],
    supportTransfers: Array.isArray(state?.supportTransfers) ? state.supportTransfers : [],
    overrides: Array.isArray(state?.revenueBonusOverrides) ? state.revenueBonusOverrides : [],
    nowMs,
  })
  const allocations = visibleAutomaticRevenueBonusAllocations({
    allocations: calculated.allocations,
    canViewAllAllocations,
    viewerEmployeeIds,
    includeAdminDetails,
  })
  return {
    ...calculated,
    projectedAt: new Date(nowMs).toISOString(),
    calculationMode: 'AUTOMATIC',
    editableByAdminOnly: true,
    dayCount: calculated.days.length,
    visibleAllocatedVnd: allocations.reduce((sum, record) => sum + Number(record.amountVnd || 0), 0),
    days: calculated.days.map((day) => ({
      businessDate: day.businessDate,
      projectedAt: day.projectedAt,
      revenueVnd: day.revenueVnd,
      totalPoolVnd: day.totalPoolVnd,
      automaticAllocatedVnd: day.automaticAllocatedVnd,
      allocatedVnd: day.allocatedVnd,
      unallocatedVnd: day.unallocatedVnd,
      excludedSupportShareVnd: day.excludedSupportShareVnd,
      adminAdjustmentVnd: day.adminAdjustmentVnd,
      totalWorkedSeconds: day.totalWorkedSeconds,
      participantCount: day.participantCount,
      eligibleParticipantCount: day.eligibleParticipantCount,
      supportExcludedCount: day.supportExcludedCount,
    })),
    allocations,
  }
}

const getRevenueBonusLive = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  if (!['admin', 'business_support', 'store_manager', 'employee'].includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền xem thưởng doanh thu cửa hàng.')
  }
  const storeId = String(url.searchParams.get('storeId') || '').trim()
  const actorStoreId = String(user.store_id || '').trim()
  if (['store_manager', 'employee'].includes(user.role) && (!storeId || !sameIdentifier(storeId, actorStoreId))) {
    throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Tài khoản chỉ được xem thưởng doanh thu đúng cửa hàng đang làm việc.')
  }
  assertOperationalStoreAccess(user, storeId)
  const businessDate = compensationDate(url.searchParams.get('businessDate'), 'Ngày kinh doanh')
  const row = user._globalStateRow || await loadState(db, 'global')
  const state = normalizeSharedStateForStorage(row ? parseStoredJson(row.value_json, {}) : {})
  const store = requireActivePhysicalStore(state, storeId)
  const live = revenueBonusLiveSnapshot({ state, store, businessDate, now: context.now })
  const canViewAllAllocations = ['admin', 'business_support', 'store_manager'].includes(user.role)
  const snapshot = {
    ...live,
    allocations: visibleAutomaticRevenueBonusAllocations({
      allocations: live.allocations,
      canViewAllAllocations,
      viewerEmployeeIds: revenueBonusViewerEmployeeIds(state, user),
      includeAdminDetails: user.role === 'admin',
    }),
  }
  if (user.role !== 'admin') delete snapshot.overrideCollisions
  return jsonResponse(apiPayload(context, { snapshot }))
}

const getRevenueBonusPeriod = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  if (!['admin', 'business_support', 'store_manager', 'employee'].includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền xem lịch sử thưởng doanh thu cửa hàng.')
  }
  const storeId = String(url.searchParams.get('storeId') || '').trim()
  const actorStoreId = String(user.store_id || '').trim()
  if (['store_manager', 'employee'].includes(user.role) && (!storeId || !sameIdentifier(storeId, actorStoreId))) {
    throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Tài khoản chỉ được xem lịch sử thưởng doanh thu đúng cửa hàng đang làm việc.')
  }
  assertOperationalStoreAccess(user, storeId)
  const period = String(url.searchParams.get('period') || '').trim()
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period)) {
    throw new ApiError(400, 'REVENUE_BONUS_PERIOD_INVALID', 'Tháng thưởng doanh thu phải có định dạng YYYY-MM.')
  }
  const row = user._globalStateRow || await loadState(db, 'global')
  const state = normalizeSharedStateForStorage(row ? parseStoredJson(row.value_json, {}) : {})
  const store = requireActivePhysicalStore(state, storeId)
  const canViewAllAllocations = ['admin', 'business_support', 'store_manager'].includes(user.role)
  return jsonResponse(apiPayload(context, {
    period: revenueBonusPeriodSnapshot({
      state,
      store,
      period,
      now: context.now,
      canViewAllAllocations,
      viewerEmployeeIds: revenueBonusViewerEmployeeIds(state, user),
      includeAdminDetails: user.role === 'admin',
    }),
  }))
}

"""
server = replace_section(
    server,
    'const getRevenueBonusLive = async (request, env, context, url) => {\n',
    'const DOMAIN_PROTECTED_STATE_COLLECTIONS = new Set([\n',
    revenue_read_block,
    'server live and period read endpoints',
)
server = replace_once(
    server,
    """  if (path === '/api/revenue-bonus/live') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getRevenueBonusLive(request, env, context, url)
  }
""",
    """  if (path === '/api/revenue-bonus/live') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getRevenueBonusLive(request, env, context, url)
  }
  if (path === '/api/revenue-bonus/period') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getRevenueBonusPeriod(request, env, context, url)
  }
""",
    'route automatic revenue period endpoint',
)
write(server_path, server)


# ---------------------------------------------------------------------------
# Client API: server-authoritative month history.
# ---------------------------------------------------------------------------
api_path = 'src/services/idosiApi.js'
api = read(api_path)
api = replace_once(
    api,
    "const REVENUE_BONUS_LIVE_TIMEOUT_MS = 15_000\n",
    "const REVENUE_BONUS_LIVE_TIMEOUT_MS = 15_000\nconst REVENUE_BONUS_PERIOD_TIMEOUT_MS = 20_000\n",
    'revenue period timeout',
)
api = replace_once(
    api,
    """export const apiGetRevenueBonusLive = ({ storeId, businessDate }) => {
  const query = new URLSearchParams({
    storeId: String(storeId || ''),
    businessDate: String(businessDate || ''),
  })
  return request(`/api/revenue-bonus/live?${query.toString()}`, {
    timeoutMs: REVENUE_BONUS_LIVE_TIMEOUT_MS,
    timeoutMessage: 'Máy chủ chưa cập nhật được trạng thái tính thưởng. Hệ thống sẽ tự thử lại.',
    retries: 1,
  })
}

""",
    """export const apiGetRevenueBonusLive = ({ storeId, businessDate }) => {
  const query = new URLSearchParams({
    storeId: String(storeId || ''),
    businessDate: String(businessDate || ''),
  })
  return request(`/api/revenue-bonus/live?${query.toString()}`, {
    timeoutMs: REVENUE_BONUS_LIVE_TIMEOUT_MS,
    timeoutMessage: 'Máy chủ chưa cập nhật được trạng thái tính thưởng. Hệ thống sẽ tự thử lại.',
    retries: 1,
  })
}

export const apiGetRevenueBonusPeriod = ({ storeId, period }) => {
  const query = new URLSearchParams({
    storeId: String(storeId || ''),
    period: String(period || ''),
  })
  return request(`/api/revenue-bonus/period?${query.toString()}`, {
    timeoutMs: REVENUE_BONUS_PERIOD_TIMEOUT_MS,
    timeoutMessage: 'Máy chủ chưa tải được lịch sử thưởng doanh thu. Hệ thống sẽ tự thử lại.',
    retries: 1,
  })
}

""",
    'revenue period API client',
)
write(api_path, api)


# ---------------------------------------------------------------------------
# UI: use full server history, show support exclusion/admin delta clearly.
# ---------------------------------------------------------------------------
page_path = 'src/pages/compensation/RevenueBonusPage.jsx'
page = read(page_path)
page = replace_once(
    page,
    "import { apiGetRevenueBonusLive } from '../../services/idosiApi'\n",
    "import { apiGetRevenueBonusLive, apiGetRevenueBonusPeriod } from '../../services/idosiApi'\n",
    'page period API import',
)
page = replace_once(
    page,
    """    employees: Array.isArray(app.employees) ? app.employees : [],
    overrides: Array.isArray(app.revenueBonusOverrides) ? app.revenueBonusOverrides : [],
""",
    """    employees: Array.isArray(app.employees) ? app.employees : [],
    supportTransfers: Array.isArray(app.supportTransfers) ? app.supportTransfers : [],
    overrides: Array.isArray(app.revenueBonusOverrides) ? app.revenueBonusOverrides : [],
""",
    'local live support transfers',
)
page = replace_once(
    page,
    """  if (status === 'ADMIN_DELETED') return 'Admin đã xóa'
  return statusLabel(record)
""",
    """  if (status === 'ADMIN_DELETED') return 'Admin đã xóa'
  if (status === 'SUPPORT_EXCLUDED') return 'Hỗ trợ cửa hàng – không nhận thưởng'
  return statusLabel(record)
""",
    'support exclusion status label',
)
page = replace_once(
    page,
    """  if (status === 'ADMIN_DELETED') return 'red'
  return statusTone(record)
""",
    """  if (status === 'ADMIN_DELETED') return 'red'
  if (status === 'SUPPORT_EXCLUDED') return 'orange'
  return statusTone(record)
""",
    'support exclusion status tone',
)
page = replace_once(
    page,
    """  const [remoteRefreshVersion, setRemoteRefreshVersion] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
""",
    """  const [remoteRefreshVersion, setRemoteRefreshVersion] = useState(0)
  const [remoteHistoryPeriod, setRemoteHistoryPeriod] = useState(null)
  const [remoteHistoryError, setRemoteHistoryError] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
""",
    'remote period state',
)
page = replace_once(
    page,
    """            employees: app.employees,
            revenueBonusOverrides: app.revenueBonusOverrides,
""",
    """            employees: app.employees,
            supportTransfers: app.supportTransfers,
            revenueBonusOverrides: app.revenueBonusOverrides,
""",
    'local snapshot support state',
)
page = replace_once(
    page,
    """    app.orders,
    app.revenueBonusOverrides,
""",
    """    app.orders,
    app.revenueBonusOverrides,
    app.supportTransfers,
""",
    'local snapshot support dependency',
)
period_effect = r"""
  useEffect(() => {
    const automaticHistoryMonth = historyMonth >= AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE.slice(0, 7)
    if (!selectedStoreId || !serverBacked || !automaticHistoryMonth) return undefined
    let active = true
    let busy = false
    const scope = `${identifierKey(selectedStoreId)}:${historyMonth}`
    const refresh = async () => {
      if (busy || (typeof document !== 'undefined' && document.hidden)) return
      busy = true
      try {
        const response = await apiGetRevenueBonusPeriod({ storeId: selectedStoreId, period: historyMonth })
        if (active) {
          setRemoteHistoryPeriod(response?.period || null)
          setRemoteHistoryError(null)
        }
      } catch {
        if (active) setRemoteHistoryError({ scope })
      } finally {
        busy = false
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 10_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [historyMonth, remoteRefreshVersion, selectedStoreId, serverBacked])

"""
page = replace_once(
    page,
    """  const liveScope = `${identifierKey(selectedStoreId)}:${businessDate}`
""",
    period_effect + "  const liveScope = `${identifierKey(selectedStoreId)}:${businessDate}`\n",
    'server period polling',
)
page = replace_once(
    page,
    """  const automaticLoading = automaticMode && serverBacked && !liveSnapshot && !remoteDataStale
""",
    """  const automaticLoading = automaticMode && serverBacked && !liveSnapshot && !remoteDataStale
  const historyScope = `${identifierKey(selectedStoreId)}:${historyMonth}`
  const automaticHistoryMonth = historyMonth >= AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE.slice(0, 7)
  const matchingRemoteHistoryPeriod = automaticHistoryMonth && serverBacked && remoteHistoryPeriod
    && sameOperationalIdentifier(remoteHistoryPeriod.storeId, selectedStoreId)
    && String(remoteHistoryPeriod.period || '') === historyMonth
    ? remoteHistoryPeriod
    : null
  const remoteHistoryUnavailable = automaticHistoryMonth && serverBacked
    && remoteHistoryError?.scope === historyScope
""",
    'match server history scope',
)
page = replace_once(
    page,
    """  const allocatedTotal = automaticMode ? Number(liveSnapshot?.allocatedVnd || 0) : savedAllocationTotal
  const allocationTotal = allocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
""",
    """  const allocatedTotal = automaticMode ? Number(liveSnapshot?.allocatedVnd || 0) : savedAllocationTotal
  const adminAdjustmentTotal = automaticMode ? Number(liveSnapshot?.adminAdjustmentVnd || 0) : 0
  const excludedSupportShareTotal = automaticMode ? Number(liveSnapshot?.excludedSupportShareVnd || 0) : 0
  const allocationTotal = allocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
""",
    'automatic financial deltas',
)
old_history = """  const automaticHistory = useMemo(() => {
    if (!revenueProgram || !selectedStoreId
      || historyMonth < AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE.slice(0, 7)) {
      return { days: [], allocations: [] }
    }
    return calculateAutomaticRevenueBonusPeriod({
      storeId: selectedStoreId,
      period: historyMonth,
      programId: revenueProgram.id,
      milestoneProgramId,
      orders: Array.isArray(app.orders) ? app.orders : [],
      attendance: Array.isArray(app.attendance) ? app.attendance : [],
      employees: Array.isArray(app.employees) ? app.employees : [],
      overrides: Array.isArray(app.revenueBonusOverrides) ? app.revenueBonusOverrides : [],
      nowMs,
    })
  }, [
    app.attendance,
    app.employees,
    app.orders,
    app.revenueBonusOverrides,
    historyMonth,
    milestoneProgramId,
    nowMs,
    revenueProgram,
    selectedStoreId,
  ])
"""
new_history = """  const automaticHistory = useMemo(() => {
    if (!revenueProgram || !selectedStoreId
      || historyMonth < AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE.slice(0, 7)) {
      return { days: [], allocations: [] }
    }
    if (serverBacked) return matchingRemoteHistoryPeriod || { days: [], allocations: [] }
    return calculateAutomaticRevenueBonusPeriod({
      storeId: selectedStoreId,
      period: historyMonth,
      programId: revenueProgram.id,
      milestoneProgramId,
      orders: Array.isArray(app.orders) ? app.orders : [],
      attendance: Array.isArray(app.attendance) ? app.attendance : [],
      employees: Array.isArray(app.employees) ? app.employees : [],
      supportTransfers: Array.isArray(app.supportTransfers) ? app.supportTransfers : [],
      overrides: Array.isArray(app.revenueBonusOverrides) ? app.revenueBonusOverrides : [],
      nowMs,
    })
  }, [
    app.attendance,
    app.employees,
    app.orders,
    app.revenueBonusOverrides,
    app.supportTransfers,
    historyMonth,
    matchingRemoteHistoryPeriod,
    milestoneProgramId,
    nowMs,
    revenueProgram,
    selectedStoreId,
    serverBacked,
  ])
"""
page = replace_once(page, old_history, new_history, 'server-authoritative automatic history')
page = replace_once(
    page,
    """        <MetricCard compact label="ĐÃ PHÂN BỔ" value={metricValue(money(allocatedTotal))} helper={Number(liveSnapshot?.adminAdjustmentVnd || 0) !== 0 ? 'Đã gồm điều chỉnh của Admin' : 'Tự động theo giờ thực tế'} icon={WalletCards} tone="green" />
        <MetricCard compact label="CHƯA PHÂN BỔ" value={metricValue(money(unallocatedTotal))} helper={unallocatedTotal > 0 ? 'Thiếu thời gian làm việc hợp lệ' : 'Đã đối soát'} icon={Clock3} tone={unallocatedTotal > 0 ? 'orange' : 'blue'} />
        <MetricCard compact label="TỔNG GIỜ LÀM CỬA HÀNG" value={formatWorkedHours(totalStoreHours)} helper={`${attendanceCount} ca trong ngày`} icon={Clock3} tone="orange" />
""",
    """        <MetricCard compact label="ĐÃ PHÂN BỔ HIỆU LỰC" value={metricValue(money(allocatedTotal))} helper={adminAdjustmentTotal !== 0 ? 'Đã gồm điều chỉnh của Admin' : 'Tự động theo giờ thực tế'} icon={WalletCards} tone="green" />
        <MetricCard compact label="CHƯA PHÂN BỔ THEO CÔNG THỨC" value={metricValue(money(unallocatedTotal))} helper={excludedSupportShareTotal > 0 ? 'Phần của giờ hỗ trợ được giữ lại, không trả cho người hỗ trợ' : unallocatedTotal > 0 ? 'Thiếu thời gian làm việc hợp lệ' : 'Đã đối soát'} icon={Clock3} tone={unallocatedTotal > 0 ? 'orange' : 'blue'} />
        <MetricCard compact label="ĐIỀU CHỈNH ADMIN" value={metricValue(money(adminAdjustmentTotal))} helper={adminAdjustmentTotal === 0 ? 'Chưa có điều chỉnh' : 'Chênh lệch so với kết quả tự động'} icon={Pencil} tone={adminAdjustmentTotal === 0 ? 'blue' : 'orange'} />
        <MetricCard compact label="TỔNG GIỜ LÀM CỬA HÀNG" value={formatWorkedHours(totalStoreHours)} helper={`${attendanceCount} ca trong ngày`} icon={Clock3} tone="orange" />
""",
    'clear automatic allocation metrics',
)
page = replace_once(
    page,
    """      {unallocatedTotal > 0 && privileged && <InfoNote tone="orange">
        Có quỹ chưa phân bổ do thiếu thời gian làm việc hợp lệ. Hệ thống sẽ tự phân bổ lại khi dữ liệu chấm công được cập nhật.
      </InfoNote>}
""",
    """      {unallocatedTotal > 0 && privileged && <InfoNote tone="orange">
        {excludedSupportShareTotal > 0
          ? `${money(excludedSupportShareTotal)} thuộc tỷ trọng giờ của nhân viên điều chuyển hỗ trợ: giờ vẫn nằm trong mẫu số nhưng nhân viên hỗ trợ không nhận thưởng doanh thu.`
          : 'Có quỹ chưa phân bổ do thiếu thời gian làm việc hợp lệ. Hệ thống sẽ tự phân bổ lại khi dữ liệu chấm công được cập nhật.'}
      </InfoNote>}
""",
    'support exclusion explanation',
)
page = replace_once(
    page,
    """              <td><Badge tone={revenueStatusTone(allocation)}>{revenueStatusLabel(allocation)}</Badge>{allocation.overrideReason && <small className="compensation-subline">{allocation.overrideReason}</small>}</td>
""",
    """              <td>
                <Badge tone={revenueStatusTone(allocation)}>{revenueStatusLabel(allocation)}</Badge>
                {allocation.supportTransferred && <small className="compensation-subline">Giờ làm vẫn được tính vào mẫu số chia thưởng.</small>}
                {allocation.overrideReason && <small className="compensation-subline">{allocation.overrideReason}</small>}
              </td>
""",
    'support row explanation',
)
page = replace_once(
    page,
    """      <RevenueHistorySections
""",
    """      {remoteHistoryUnavailable && <InfoNote tone="red">
        Không thể cập nhật lịch sử thưởng tự động từ máy chủ. Hệ thống sẽ tự thử lại; số liệu lịch sử cũ không được dùng để ước tính thay thế.
      </InfoNote>}

      <RevenueHistorySections
""",
    'history server error disclosure',
)
write(page_path, page)


# ---------------------------------------------------------------------------
# Existing UI mocks must expose the new API read.
# ---------------------------------------------------------------------------
for test_path in [
    'src/pages/compensation/CompensationPages.test.jsx',
    'src/pages/compensation/RevenueBonusCutoff.test.jsx',
    'src/pages/compensation/RevenueBonusStoreManager.test.jsx',
]:
    test = read(test_path)
    test = replace_once(
        test,
        "const mocked = vi.hoisted(() => ({ app: {}, liveRevenue: vi.fn() }))\n",
        "const mocked = vi.hoisted(() => ({ app: {}, liveRevenue: vi.fn(), periodRevenue: vi.fn() }))\n",
        f'{test_path} period mock state',
    )
    test = replace_once(
        test,
        """vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: (payload) => mocked.liveRevenue(payload),
}))
""",
        """vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: (payload) => mocked.liveRevenue(payload),
  apiGetRevenueBonusPeriod: (payload) => mocked.periodRevenue(payload),
}))
""",
        f'{test_path} period API mock',
    )
    test = replace_once(
        test,
        """    mocked.liveRevenue.mockReset()
""",
        """    mocked.liveRevenue.mockReset()
    mocked.periodRevenue.mockReset()
    mocked.periodRevenue.mockImplementation(({ storeId, period }) => Promise.resolve({
      period: { storeId, period, days: [], allocations: [] },
    }))
""",
        f'{test_path} period mock reset',
    )
    write(test_path, test)


# ---------------------------------------------------------------------------
# API client regression.
# ---------------------------------------------------------------------------
api_test_path = 'src/services/idosiApi.revenueBonus.test.js'
api_test = read(api_test_path)
api_test = replace_once(
    api_test,
    "import { apiGetRevenueBonusLive, clearApiSession } from './idosiApi'\n",
    "import { apiGetRevenueBonusLive, apiGetRevenueBonusPeriod, clearApiSession } from './idosiApi'\n",
    'API period test import',
)
api_test = insert_before_last(
    api_test,
    '\n})\n',
    """

  it('loads automatic period history from the server-authoritative endpoint', async () => {
    const payload = {
      ok: true,
      period: { storeId: 'DI-AN', period: '2026-09', days: [], allocations: [] },
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiGetRevenueBonusPeriod({ storeId: 'DI-AN', period: '2026-09' }))
      .resolves.toBe(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/revenue-bonus/period?storeId=DI-AN&period=2026-09',
      expect.objectContaining({ method: 'GET' }),
    )
  })
""",
    'API period endpoint test',
)
write(api_test_path, api_test)


# ---------------------------------------------------------------------------
# Pure server-period regression: full denominator, scoped employee output.
# ---------------------------------------------------------------------------
server_test_path = Path('server/automaticRevenueBonusPeriod.test.js')
if server_test_path.exists():
    raise SystemExit(f'{server_test_path}: already exists')
server_test_path.write_text(r"""// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { revenueBonusPeriodSnapshot } from './worker'

const store = { id: 'S01', name: 'SM TNV', code: 'SM-TNV', type: 'SM' }
const state = {
  stores: [store],
  employees: [
    { id: 'A', name: 'Nhân viên A', unit: 'store', storeId: 'S01' },
    { id: 'B', name: 'Nhân viên B', unit: 'store', storeId: 'S01' },
    { id: 'C', name: 'Nhân viên hỗ trợ C', unit: 'store', storeId: 'HOME' },
  ],
  orders: [{
    id: 'O01', storeId: 'S01', amount: 20_000_000, status: 'Hoàn tất',
    createdAt: '2026-09-03T10:00:00+07:00',
  }],
  attendance: [{
    id: 'AA', storeId: 'S01', employeeId: 'A', workDate: '2026-09-03',
    workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
  }, {
    id: 'AB', storeId: 'S01', employeeId: 'B', workDate: '2026-09-03',
    workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
  }, {
    id: 'AC', storeId: 'S01', employeeId: 'C', workDate: '2026-09-03',
    supportTransferId: 'ST-C', workedSeconds: 14_400,
    checkOutAt: '2026-09-03T10:00:00.000Z',
  }],
  supportTransfers: [{
    id: 'ST-C', employeeId: 'C', fromStoreId: 'HOME', toStoreId: 'S01',
    startAt: '2026-09-03T00:00:00+07:00', endAt: '2026-09-04T00:00:00+07:00',
    status: 'Hoàn tất',
  }],
  revenueBonusOverrides: [],
}

const allocation = (period, employeeId) => period.allocations.find((row) => row.employeeId === employeeId)

describe('server automatic revenue period projection', () => {
  it('uses complete server data and keeps support hours only in the denominator', () => {
    const period = revenueBonusPeriodSnapshot({
      state,
      store,
      period: '2026-09',
      now: '2026-09-03T12:00:00.000Z',
      canViewAllAllocations: true,
      includeAdminDetails: true,
    })

    expect(period).toMatchObject({
      storeId: 'S01',
      period: '2026-09',
      totalPoolVnd: 1_400_000,
      automaticAllocatedVnd: 1_120_000,
      allocatedVnd: 1_120_000,
      unallocatedVnd: 280_000,
      excludedSupportShareVnd: 280_000,
      dayCount: 1,
    })
    expect(allocation(period, 'A').amountVnd).toBe(560_000)
    expect(allocation(period, 'B').amountVnd).toBe(560_000)
    expect(allocation(period, 'C')).toMatchObject({
      amountVnd: 0,
      formulaShareVnd: 280_000,
      supportTransferred: true,
      status: 'SUPPORT_EXCLUDED',
    })
    expect(period.days[0]).toMatchObject({
      totalWorkedSeconds: 72_000,
      supportExcludedCount: 1,
      excludedSupportShareVnd: 280_000,
    })
    expect(period.days[0]).not.toHaveProperty('allocations')
  })

  it('returns only the requesting employee allocation while preserving the full-team denominator', () => {
    const period = revenueBonusPeriodSnapshot({
      state,
      store,
      period: '2026-09',
      now: '2026-09-03T12:00:00.000Z',
      canViewAllAllocations: false,
      viewerEmployeeIds: ['B'],
      includeAdminDetails: false,
    })

    expect(period.allocations).toHaveLength(1)
    expect(period.allocations[0]).toMatchObject({
      employeeId: 'B',
      amountVnd: 560_000,
      weightPercent: 40,
    })
    expect(period.visibleAllocatedVnd).toBe(560_000)
    expect(period.days[0].totalWorkedSeconds).toBe(72_000)
  })
})
""", encoding='utf-8')
print(f'create: {server_test_path}')


# ---------------------------------------------------------------------------
# UI regression: employee history must come from full server projection.
# ---------------------------------------------------------------------------
ui_test_path = Path('src/pages/compensation/RevenueBonusAutomaticHistory.test.jsx')
if ui_test_path.exists():
    raise SystemExit(f'{ui_test_path}: already exists')
ui_test_path.write_text(r"""import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueBonusPage } from './RevenueBonusPage'

const mocked = vi.hoisted(() => ({ app: {}, liveRevenue: vi.fn(), periodRevenue: vi.fn() }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: (payload) => mocked.liveRevenue(payload),
  apiGetRevenueBonusPeriod: (payload) => mocked.periodRevenue(payload),
}))

const app = () => ({
  session: { role: 'employee', employeeId: 'E01', storeId: 'S01' },
  currentEmployee: { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'S01' },
  activeStoreId: 'S01',
  stores: [{ id: 'S01', name: 'Dosii NTL', code: 'DOSII-NTL' }],
  employees: [{ id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'S01' }],
  // The employee bootstrap intentionally contains only their own rows. The UI
  // must not use these partial collections to recompute the team denominator.
  orders: [{
    id: 'OWN-ORDER', storeId: 'S01', employeeId: 'E01', amount: 1_000_000,
    status: 'Hoàn tất', createdAt: '2026-09-03T10:00:00+07:00',
  }],
  attendance: [{
    id: 'OWN-ATT', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-03',
    workedSeconds: 3_600, checkOutAt: '2026-09-03T11:00:00.000Z',
  }],
  supportTransfers: [],
  revenueBonusDaily: [],
  revenueBonusAllocations: [],
  revenueBonusOverrides: [],
  revenueBonuses: [],
  apiStatus: 'connected',
  notify: vi.fn(),
})

describe('RevenueBonusPage server-authoritative automatic history', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-03T12:00:00.000Z'))
    mocked.app = app()
    mocked.liveRevenue.mockReset().mockResolvedValue({
      snapshot: {
        storeId: 'S01', businessDate: '2026-09-03', projectedAt: '2026-09-03T12:00:00.000Z',
        revenueVnd: 2_000_000, totalPoolVnd: 20_000, automaticAllocatedVnd: 20_000,
        allocatedVnd: 20_000, unallocatedVnd: 0, adminAdjustmentVnd: 0,
        totalWorkedSeconds: 7_200, attendanceCount: 2, allocations: [{
          id: 'automatic-revenue:S01:2026-09-03:E01', storeId: 'S01', businessDate: '2026-09-03',
          employeeId: 'E01', employeeName: 'Nguyễn An', workedSeconds: 3_600,
          approvedSalesHours: 1, weightPercent: 50, automaticAmountVnd: 10_000,
          amountVnd: 10_000, status: 'LIVE',
        }],
      },
    })
    mocked.periodRevenue.mockReset().mockResolvedValue({
      period: {
        storeId: 'S01', period: '2026-09', projectedAt: '2026-09-03T12:00:00.000Z',
        days: [{ businessDate: '2026-09-03', projectedAt: '2026-09-03T12:00:00.000Z' }],
        allocations: [{
          id: 'server-history-E01', storeId: 'S01', businessDate: '2026-09-03', period: '2026-09',
          employeeId: 'E01', employeeName: 'Nguyễn An', workedSeconds: 3_600,
          approvedSalesHours: 1, weightPercent: 25, automaticAmountVnd: 123_456,
          amountVnd: 123_456, status: 'LIVE',
        }],
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders employee month history from the server instead of partial local state', async () => {
    render(<RevenueBonusPage storeScoped />)

    await waitFor(() => expect(mocked.periodRevenue).toHaveBeenCalledWith({
      storeId: 'S01', period: '2026-09',
    }))
    expect(await screen.findByText('123.456 ₫')).toBeTruthy()
    expect(screen.getByText('25.00%')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /tính thưởng ngày/i })).toBeNull()
  })
})
""", encoding='utf-8')
print(f'create: {ui_test_path}')

print('PR 124 correctness patch applied successfully.')
