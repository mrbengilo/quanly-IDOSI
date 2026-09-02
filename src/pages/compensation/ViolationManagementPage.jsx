import { useMemo, useState } from 'react'
import { Save, ShieldAlert, UserRoundCheck, XCircle } from 'lucide-react'
import { useApp } from '../../state/AppContext'
import {
  Badge,
  Button,
  Card,
  Field,
  InfoNote,
  Input,
  PageHeader,
  Select,
  TableWrap,
} from '../../components/UI'
import { money } from '../../utils'
import { activeWorkCatalogItems, WORK_CATALOG_KIND } from '../../domain/workCatalog'
import { resolveAttendanceWorkingTime } from '../../domain/attendanceWorkingTime'
import {
  canonicalRole,
  employeesForTarget,
  entityId,
  entryAmount,
  entryDate,
  entryEmployeeId,
  entryStoreId,
  isVoided,
  statusLabel,
  statusTone,
  storesVisibleToRole,
  targetUnitOfViolation,
} from './compensationViewModel'
import {
  AccessDenied,
  ActionError,
  displayDate,
  employeeName,
  storeName,
  useCompensationAction,
  vietnamToday,
} from './compensationUi'
import { violationStatistics } from './compensationStatistics'
import { CompensationStatisticsGrid } from './CompensationStatisticsTables'
import './compensation-page.css'

const UNIT_LABELS = {
  store: 'Nhân viên cửa hàng',
  office: 'Khối văn phòng',
  business_support: 'Nhân viên hỗ trợ KD',
}

const routeTargetUnit = () => {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname.toLowerCase()
  if (pathname.includes('business-support') || pathname.includes('htkd')) return 'business_support'
  if (pathname.includes('office')) return 'office'
  return 'store'
}

const recordDate = (record = {}) => String(
  record.workDate || record.attendanceDate || record.date || record.checkInAt || '',
).slice(0, 10)

const recordEmployeeId = (record = {}) => String(record.employeeId || record.employeeCode || '').trim()

const shiftTime = (entry = {}) => {
  const start = String(entry.shiftStart || entry.start || '').trim()
  const end = String(entry.shiftEnd || entry.end || '').trim()
  return start || end ? `${start || '--:--'}–${end || '--:--'}` : ''
}

const violationShiftLabel = (entry = {}) => (
  entry.shiftName || entry.shift?.name || entry.shiftId || 'Chưa gắn ca'
)

const resolveShiftOptions = ({
  attendance = [],
  schedules = [],
  supportSchedules = [],
  shiftDefinitions = [],
  employeeId,
  storeId,
  targetUnit,
  occurredOn,
  employee,
}) => {
  if (!employeeId || !employee) return []
  const definitions = new Map((Array.isArray(shiftDefinitions) ? shiftDefinitions : [])
    .map((shift) => [String(shift.id || ''), shift]))
  const result = []
  const signatures = new Set()
  const add = (candidate) => {
    const id = String(candidate.id || '').trim()
    if (!id) return
    const name = String(candidate.name || definitions.get(id)?.name || id).trim()
    const start = String(candidate.start || definitions.get(id)?.start || '').trim()
    const end = String(candidate.end || definitions.get(id)?.end || '').trim()
    const signature = `${name.toLocaleLowerCase('vi-VN')}|${start}|${end}`
    if (signatures.has(signature)) return
    signatures.add(signature)
    result.push({ ...candidate, id, name, start, end, key: `${id}:${candidate.attendanceId || candidate.scheduleId || signature}` })
  }

  ;(Array.isArray(attendance) ? attendance : []).filter((record) => (
    !record.deletedAt
    && recordEmployeeId(record) === String(employeeId || '')
    && recordDate(record) === occurredOn
    && (!storeId || !record.storeId || String(record.storeId) === String(storeId))
  )).forEach((record) => add({
    id: record.shiftId || record.shift || record.checklistSnapshot?.shiftId,
    name: record.shiftName || record.checklistSnapshot?.shiftName,
    start: record.shiftStart,
    end: record.shiftEnd,
    attendanceId: record.id || record.attendanceId,
    source: 'attendance',
  }))

  if (targetUnit === 'store') {
    ;(Array.isArray(schedules) ? schedules : []).filter((record) => (
      !record.deletedAt
      && recordEmployeeId(record) === String(employeeId || '')
      && recordDate(record) === occurredOn
      && (!storeId || !record.storeId || String(record.storeId) === String(storeId))
    )).forEach((record) => {
      const ids = Array.isArray(record.shiftIds) ? record.shiftIds : [record.shiftId]
      ids.filter(Boolean).forEach((id) => {
        const snapshot = (record.shiftSnapshots || []).find((item) => String(item.id) === String(id))
        add({
          id,
          name: snapshot?.name || record.shiftName,
          start: snapshot?.start || record.shiftStart || record.start,
          end: snapshot?.end || record.shiftEnd || record.end,
          scheduleId: record.id,
          source: 'schedule',
        })
      })
    })
  } else {
    const workingTime = resolveAttendanceWorkingTime(employee || {}, occurredOn, supportSchedules)
    ;(Array.isArray(workingTime.workShifts) ? workingTime.workShifts : []).forEach((shift) => add({
      id: shift.id,
      name: shift.name,
      start: shift.start,
      end: shift.end,
      scheduleId: workingTime.attendanceScheduleId,
      source: shift.source || workingTime.attendanceWorkingTimeSource,
    }))
  }

  return result.toSorted((left, right) => (
    String(left.start).localeCompare(String(right.start)) || left.name.localeCompare(right.name, 'vi-VN')
  ))
}

export function ViolationManagementPage({ targetUnit: requestedTargetUnit, storeId: requestedStoreId = '', embedded = false }) {
  const app = useApp()
  const role = canonicalRole(app.session?.role)
  const targetUnit = requestedTargetUnit || routeTargetUnit()
  const permittedUnit = ['store', 'office', 'business_support'].includes(targetUnit)
  const canManage = ['admin', 'business_support'].includes(role)
    || (role === 'store_manager' && targetUnit === 'store')
  const visibleStores = useMemo(() => storesVisibleToRole(app.stores, app.session), [app.stores, app.session])
  const stores = useMemo(() => {
    const fixedStoreId = String(requestedStoreId || '').trim()
    if (!fixedStoreId) return visibleStores
    const exact = visibleStores.filter((store) => entityId(store) === fixedStoreId)
    if (exact.length === 1) return exact
    const normalized = fixedStoreId.toLocaleLowerCase('en-US')
    const folded = visibleStores.filter((store) => entityId(store).toLocaleLowerCase('en-US') === normalized)
    return folded.length === 1 ? folded : []
  }, [visibleStores, requestedStoreId])
  const [storeSelection, setStoreSelection] = useState('')
  const selectedStoreId = targetUnit === 'store'
    ? String(requestedStoreId || '').trim() || storeSelection || entityId(stores[0])
    : ''
  const employees = useMemo(() => employeesForTarget({
    employees: app.employees,
    targetUnit,
    storeId: selectedStoreId,
  }), [app.employees, targetUnit, selectedStoreId])
  const [employeeSelection, setEmployeeSelection] = useState('')
  const [selectedPolicyIds, setSelectedPolicyIds] = useState([])
  const [occurredOn, setOccurredOn] = useState(vietnamToday)
  const [shiftSelection, setShiftSelection] = useState('')
  const [note, setNote] = useState('')
  const [validation, setValidation] = useState('')
  const [historyDateFilter, setHistoryDateFilter] = useState('')
  const [historyEmployeeFilter, setHistoryEmployeeFilter] = useState('all')
  const { busyKey, error, run } = useCompensationAction(app)
  const selectedEmployeeId = employeeSelection || entityId(employees[0])
  const selectedEmployee = employees.find((employee) => entityId(employee) === selectedEmployeeId) || null
  const shiftOptions = useMemo(() => resolveShiftOptions({
    attendance: app.attendance,
    schedules: app.schedule,
    supportSchedules: app.supportWorkSchedules,
    shiftDefinitions: app.shiftDefinitions,
    employeeId: selectedEmployeeId,
    storeId: selectedStoreId,
    targetUnit,
    occurredOn,
    employee: selectedEmployee,
  }), [app.attendance, app.schedule, app.supportWorkSchedules, app.shiftDefinitions, selectedEmployeeId, selectedStoreId, selectedEmployee, targetUnit, occurredOn])
  const selectedShift = shiftOptions.find((shift) => shift.key === shiftSelection) || shiftOptions[0] || null
  const policies = useMemo(() => activeWorkCatalogItems(app.workCatalogItems || [], {
    targetGroup: targetUnit,
    storeId: targetUnit === 'store' ? selectedStoreId : null,
    shiftId: selectedShift?.id || null,
    shiftName: selectedShift?.name || null,
    date: occurredOn,
    kinds: WORK_CATALOG_KIND.VIOLATION,
  }), [app.workCatalogItems, targetUnit, selectedStoreId, selectedShift, occurredOn])
  const selectedPolicyIdSet = new Set(selectedPolicyIds)
  const selectedPolicies = policies.filter((policy) => selectedPolicyIdSet.has(policy.id))
  const selectedTotalVnd = selectedPolicies.reduce((sum, policy) => sum + Math.abs(Number(policy.amountVnd || 0)), 0)
  const rows = useMemo(() => (Array.isArray(app.violations) ? app.violations : [])
    .filter((entry) => targetUnitOfViolation(entry) === targetUnit)
    .filter((entry) => targetUnit !== 'store' || entryStoreId(entry) === selectedStoreId)
    .toSorted((left, right) => String(right.createdAt || right.occurredOn || '').localeCompare(String(left.createdAt || left.occurredOn || ''))), [app.violations, targetUnit, selectedStoreId])
  const historyEmployeeOptions = useMemo(() => [...rows.reduce((options, entry) => {
    const employeeId = entryEmployeeId(entry)
    if (employeeId && !options.has(employeeId)) {
      options.set(employeeId, employeeName(employees, employeeId, entry.employeeName))
    }
    return options
  }, new Map())].map(([value, label]) => ({ value, label })), [rows, employees])
  const historyFilterable = targetUnit === 'business_support'
  const filteredRows = useMemo(() => rows.filter((entry) => (
    (!historyFilterable || !historyDateFilter || entryDate(entry) === historyDateFilter)
    && (!historyFilterable || historyEmployeeFilter === 'all' || entryEmployeeId(entry) === historyEmployeeFilter)
  )), [rows, historyFilterable, historyDateFilter, historyEmployeeFilter])
  const filteredViolationTotal = useMemo(() => filteredRows
    .filter((entry) => !isVoided(entry))
    .reduce((total, entry) => total + Math.abs(entryAmount(entry)), 0), [filteredRows])
  const statistics = useMemo(() => violationStatistics(rows), [rows])

  if (!permittedUnit || !canManage) {
    const subtitle = role === 'store_manager'
        ? 'Quản lý cửa hàng chỉ được ghi nhận vi phạm tại cửa hàng được phân công.'
        : 'Chỉ Admin và Nhân viên hỗ trợ KD được quản lý vi phạm của đơn vị này.'
    return embedded ? <InfoNote tone="orange">{subtitle}</InfoNote> : <AccessDenied subtitle={subtitle} />
  }

  const resetDependentSelection = () => {
    setShiftSelection('')
    setSelectedPolicyIds([])
    setValidation('')
  }

  const togglePolicy = (policyId) => setSelectedPolicyIds((current) => (
    current.includes(policyId) ? current.filter((id) => id !== policyId) : [...current, policyId]
  ))

  const createViolation = async () => {
    if (!selectedEmployeeId || !selectedPolicies.length || !occurredOn || !selectedShift) {
      setValidation('Vui lòng chọn nhân viên, ngày, ca làm và ít nhất một nội dung vi phạm.')
      return
    }
    setValidation('')
    const saved = await run({
      key: 'create',
      action: typeof app.createViolationBatch === 'function'
        ? async (payload) => {
          const result = await app.createViolationBatch(payload)
          if (result?.ok === false) throw new Error(result.message || 'Không thể ghi nhận vi phạm.')
          return result
        }
        : app.createViolationBatch,
      payload: {
        targetUnit,
        employeeId: selectedEmployeeId,
        storeId: selectedStoreId || null,
        occurredOn,
        shiftId: selectedShift.id,
        ...(selectedShift.attendanceId ? { attendanceId: selectedShift.attendanceId } : {}),
        catalogItemIds: selectedPolicies.map((policy) => policy.id),
        note: note.trim(),
      },
      success: false,
    })
    if (saved) {
      const createdCount = Number(saved?.createdCount)
      if (Number.isSafeInteger(createdCount)) {
        if (createdCount > 0) {
          app.notify?.(`Đã ghi nhận ${createdCount} vi phạm theo đúng ca làm.`, 'success')
        } else {
          app.notify?.('Không tạo bản ghi mới vì các vi phạm đã tồn tại trong lịch sử đối soát.', 'info')
        }
      } else {
        app.notify?.(`Đã ghi nhận ${selectedPolicies.length} vi phạm theo đúng ca làm.`, 'success')
      }
      setNote('')
      setSelectedPolicyIds([])
    }
  }

  const voidViolation = (entry) => {
    if (typeof window !== 'undefined' && !window.confirm('Hủy vi phạm này? Bản ghi vẫn được giữ trong lịch sử đối soát.')) return
    run({
      key: `void:${entry.id}`,
      action: app.voidViolation,
      payload: { id: entry.id, expectedVersion: entry.version, reason: 'Hủy từ màn hình quản lý vi phạm' },
      success: 'Đã hủy vi phạm và giữ lại lịch sử.',
    })
  }

  return (
    <div className={`${embedded ? '' : 'page '}compensation-page violation-management-page`}>
      {!embedded && <PageHeader
        title={`QUẢN LÝ VI PHẠM — ${UNIT_LABELS[targetUnit].toUpperCase()}`}
        subtitle={targetUnit === 'store' ? 'Admin và Nhân viên hỗ trợ KD quản lý vi phạm tại mọi cửa hàng vận hành.' : `Quản lý vi phạm của ${UNIT_LABELS[targetUnit].toLowerCase()} theo đúng phạm vi quyền.`}
        icon={ShieldAlert}
      />}
      <Card title="Ghi nhận vi phạm">
        <div className="compensation-form-grid">
          {targetUnit === 'store' && <Field label="Cửa hàng" required>
            {requestedStoreId
              ? <Input aria-label="Cửa hàng" value={stores[0]?.name || selectedStoreId} readOnly />
              : <Select aria-label="Cửa hàng" value={selectedStoreId} onChange={(event) => { setStoreSelection(event.target.value); setEmployeeSelection(''); resetDependentSelection() }}>
                {stores.map((store) => <option key={entityId(store)} value={entityId(store)}>{store.name}</option>)}
              </Select>}
          </Field>}
          <Field label="Ngày phát sinh" required>
            <Input aria-label="Ngày phát sinh" type="date" value={occurredOn} onChange={(event) => { setOccurredOn(event.target.value); resetDependentSelection() }} />
          </Field>
          <Field label="Nhân viên" required>
            <Select aria-label="Nhân viên" value={selectedEmployeeId} onChange={(event) => { setEmployeeSelection(event.target.value); resetDependentSelection() }} disabled={!employees.length}>
              {employees.map((employee) => <option key={entityId(employee)} value={entityId(employee)}>{employee.name} — {entityId(employee)}</option>)}
            </Select>
          </Field>
          <Field label="Ca nhân viên làm trong ngày" required>
            <Select aria-label="Ca nhân viên làm trong ngày" value={selectedShift?.key || ''} onChange={(event) => { setShiftSelection(event.target.value); setSelectedPolicyIds([]); setValidation('') }} disabled={!shiftOptions.length}>
              {!shiftOptions.length && <option value="">Chưa có ca làm phù hợp</option>}
              {shiftOptions.map((shift) => <option key={shift.key} value={shift.key}>{shift.name}{shift.start || shift.end ? ` — ${shift.start || '--:--'}–${shift.end || '--:--'}` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Nội dung vi phạm" required className="compensation-form-full">
            <div className="compensation-catalog-checklist" role="group" aria-label="Nội dung vi phạm">
              {policies.map((policy) => <label key={policy.id} className={selectedPolicyIdSet.has(policy.id) ? 'selected' : ''}>
                <input type="checkbox" checked={selectedPolicyIdSet.has(policy.id)} onChange={() => togglePolicy(policy.id)} />
                <span><strong>{policy.name}</strong><small>−{money(policy.amountVnd)}</small></span>
              </label>)}
              {!policies.length && <InfoNote tone="orange">Chưa có vi phạm đang hoạt động cho phạm vi và ngày đã chọn. Hãy thêm tại “Danh mục công việc & vi phạm”.</InfoNote>}
            </div>
          </Field>
          <Field label="Tổng số tiền bị trừ">
            <Input aria-label="Tổng số tiền bị trừ" value={`−${money(selectedTotalVnd)}`} readOnly />
          </Field>
          <Field label="Ghi chú" className="compensation-form-span">
            <Input aria-label="Ghi chú" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Thông tin đối soát bổ sung (nếu có)" />
          </Field>
        </div>
        {!employees.length && <InfoNote tone="orange">Không có nhân viên đang hoạt động trong phạm vi đã chọn.</InfoNote>}
        {employees.length > 0 && !shiftOptions.length && <InfoNote tone="orange">Không tìm thấy ca đã chấm công hoặc ca đã phân cho nhân viên trong ngày này. Hãy kiểm tra lịch làm việc trước khi ghi nhận vi phạm.</InfoNote>}
        <InfoNote>Vi phạm luôn là khoản phải thu dương. Khi quyết toán, hệ thống áp dụng theo thứ tự thưởng → phụ cấp → lương và không làm thực nhận âm.</InfoNote>
        {validation && <InfoNote tone="red">{validation}</InfoNote>}
        <ActionError message={error} />
        <div className="compensation-actions"><Button icon={Save} loading={busyKey === 'create'} disabled={!employees.length || !selectedShift || !selectedPolicies.length || Boolean(busyKey)} onClick={createViolation}>LƯU VI PHẠM</Button></div>
      </Card>
      <Card title="Lịch sử vi phạm" action={<Badge tone="red">{filteredRows.filter((entry) => !isVoided(entry)).length} đang hiệu lực</Badge>}>
        {historyFilterable && <div className="form-grid compensation-history-filters" role="group" aria-label="Bộ lọc lịch sử vi phạm">
          <Field label="Ngày">
            <Input type="date" aria-label="Ngày vi phạm" value={historyDateFilter} onChange={(event) => setHistoryDateFilter(event.target.value)} />
          </Field>
          <Field label="Nhân viên">
            <Select aria-label="Nhân viên vi phạm" value={historyEmployeeFilter} onChange={(event) => setHistoryEmployeeFilter(event.target.value)}>
              <option value="all">Tất cả nhân viên</option>
              {historyEmployeeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
        </div>}
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày</th><th>Ca làm</th><th>Nhân viên</th>{targetUnit === 'store' && <th>Cửa hàng</th>}<th>Nội dung</th><th>Số tiền bị trừ{historyFilterable && <small className="compensation-subline">Tổng: <strong className="compensation-debit">−{money(filteredViolationTotal)}</strong></small>}</th><th>Ghi chú</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {filteredRows.map((entry) => <tr key={entry.id}>
              <td>{displayDate(entryDate(entry))}</td>
              <td><strong>{violationShiftLabel(entry)}</strong>{shiftTime(entry) && <small className="compensation-subline">{shiftTime(entry)}</small>}</td>
              <td><strong>{employeeName(employees, entryEmployeeId(entry), entry.employeeName)}</strong><small className="compensation-subline">{entryEmployeeId(entry)}</small></td>
              {targetUnit === 'store' && <td>{storeName(stores, entryStoreId(entry), entry.storeName)}</td>}
              <td>{entry.title || entry.label || entry.reason || entry.policyCode || '—'}</td>
              <td><strong className="compensation-debit">−{money(Math.abs(entryAmount(entry)))}</strong></td>
              <td>{entry.note || '—'}</td>
              <td><Badge tone={statusTone(entry)}>{statusLabel(entry)}</Badge></td>
              <td>{!isVoided(entry) && typeof app.voidViolation === 'function' ? <Button variant="danger" icon={XCircle} loading={busyKey === `void:${entry.id}`} disabled={Boolean(busyKey)} onClick={() => voidViolation(entry)}>Hủy</Button> : <span>—</span>}</td>
            </tr>)}
            {!filteredRows.length && <tr><td colSpan={targetUnit === 'store' ? 9 : 8} className="compensation-empty">{rows.length ? 'Không có lịch sử phù hợp bộ lọc.' : 'Chưa có vi phạm trong phạm vi này.'}</td></tr>}
          </tbody>
        </TableWrap>
      </Card>
      <Card title="Thống kê số lần và đánh giá mức độ vi phạm"><CompensationStatisticsGrid statistics={statistics} employees={employees} showEmployee mode="violation" /></Card>
    </div>
  )
}
export function MyViolationsPage() {
  const app = useApp()
  const employeeId = entityId(app.currentEmployee) || String(app.session?.employeeId || '')
  const rows = (app.violations || [])
    .filter((entry) => entryEmployeeId(entry) === employeeId)
    .sort((left, right) => String(right.createdAt || right.occurredOn || '').localeCompare(String(left.createdAt || left.occurredOn || '')))
  const outstandingVnd = rows.filter((entry) => !isVoided(entry)).reduce((sum, entry) => sum + Math.abs(entryAmount(entry)), 0)

  return (
    <div className="page compensation-page my-violations-page">
      <PageHeader title="VI PHẠM CỦA TÔI" subtitle="Chỉ hiển thị dữ liệu gắn với tài khoản nhân viên đang đăng nhập." icon={UserRoundCheck} />
      <div className="compensation-summary-strip"><span>Tổng số tiền bị trừ đang hiệu lực</span><strong>−{money(outstandingVnd)}</strong></div>
      <Card title="Chi tiết và trạng thái đối soát">
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày</th><th>Ca làm</th><th>Đơn vị</th><th>Nội dung</th><th>Số tiền bị trừ</th><th>Ghi chú</th><th>Trạng thái</th></tr></thead>
          <tbody>{rows.map((entry) => <tr key={entry.id}><td>{displayDate(entryDate(entry))}</td><td><strong>{violationShiftLabel(entry)}</strong>{shiftTime(entry) && <small className="compensation-subline">{shiftTime(entry)}</small>}</td><td>{UNIT_LABELS[targetUnitOfViolation(entry)]}</td><td>{entry.title || entry.label || entry.reason || entry.policyCode || '—'}</td><td><strong className="compensation-debit">−{money(Math.abs(entryAmount(entry)))}</strong></td><td>{entry.note || '—'}</td><td><Badge tone={statusTone(entry)}>{statusLabel(entry)}</Badge></td></tr>)}{!rows.length && <tr><td colSpan="7" className="compensation-empty">Bạn chưa có bản ghi vi phạm.</td></tr>}</tbody>
        </TableWrap>
      </Card>
      <Card title="Lịch sử vi phạm theo ngày, theo tháng"><CompensationStatisticsGrid statistics={violationStatistics(rows)} mode="violation" /></Card>
    </div>
  )
}
