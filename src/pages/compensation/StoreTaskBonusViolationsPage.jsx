import { useMemo, useRef, useState } from 'react'
import {
  CircleDollarSign,
  ClipboardCheck,
  RotateCcw,
  Save,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { useApp } from '../../state/AppContext'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InfoNote,
  Input,
  MetricCard,
  PageHeader,
  SearchInput,
  Select,
  TableWrap,
} from '../../components/UI'
import { money } from '../../utils'
import {
  activeWorkCatalogItems,
  WORK_CATALOG_KIND,
  WORK_CATALOG_TARGET,
} from '../../domain/workCatalog'
import { STORE_VIOLATIONS } from '../../domain/compensationPolicies'
import {
  canonicalRole,
  entityId,
  entryAmount,
  entryDate,
  entryEmployeeId,
  entryStoreId,
  isVoided,
  storesVisibleToRole,
  targetUnitOfViolation,
} from './compensationViewModel'
import {
  AccessDenied,
  displayDate,
  displayDateTime,
  employeeName,
  storeName,
  vietnamToday,
} from './compensationUi'
import {
  filterRewardSubmissionRows,
  selectRewardSubmissionRows,
  selectStoreEmployees,
  selectWorkedShiftOptions,
} from './taskBonusViolationsViewModel'
import './compensation-page.css'
import './store-task-bonus-violations.css'

const allowedRoles = new Set(['admin', 'business_support', 'store_manager'])
const requestId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`

const monthStart = (date) => `${String(date || '').slice(0, 8)}01`
const shiftTime = (row) => row.shiftStart && row.shiftEnd ? `${row.shiftStart} – ${row.shiftEnd}` : ''

const activeViolationOptions = ({ items, storeId, date, shift }) => {
  try {
    const catalog = activeWorkCatalogItems(items || [], {
      targetGroup: WORK_CATALOG_TARGET.STORE,
      storeId,
      shiftId: shift?.id || null,
      shiftName: shift?.name || null,
      date,
      kinds: WORK_CATALOG_KIND.VIOLATION,
    })
    return {
      error: '',
      policies: catalog.length ? catalog.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        amountVnd: item.amountVnd,
        source: 'catalog',
      })) : STORE_VIOLATIONS.map((policy) => ({
        id: policy.code,
        code: policy.code,
        name: policy.label,
        amountVnd: policy.amountVnd,
        source: 'policy',
      })),
    }
  } catch {
    return {
      error: 'Danh mục vi phạm đang có dữ liệu không hợp lệ. Vui lòng liên hệ Admin để sửa danh mục trước khi lưu.',
      policies: [],
    }
  }
}

function RewardSubmissionsTab({ app, storeId, employees }) {
  const today = vietnamToday()
  const [fromDate, setFromDate] = useState(() => monthStart(today))
  const [toDate, setToDate] = useState(today)
  const [shiftId, setShiftId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [query, setQuery] = useState('')
  const rows = useMemo(() => selectRewardSubmissionRows({
    workCatalogProgress: app.workCatalogProgress,
    taskAssignmentHistory: app.taskAssignmentHistory,
    workCatalogItems: app.workCatalogItems,
    compensationEntries: app.compensationEntries,
    attendance: app.attendance,
    schedule: app.schedule,
    employees: app.employees,
    shiftDefinitions: app.shiftDefinitions,
    storeId,
  }), [
    app.workCatalogProgress,
    app.taskAssignmentHistory,
    app.workCatalogItems,
    app.compensationEntries,
    app.attendance,
    app.schedule,
    app.employees,
    app.shiftDefinitions,
    storeId,
  ])
  const filteredRows = useMemo(() => filterRewardSubmissionRows(rows, {
    fromDate, toDate, shiftId, employeeId, query,
  }), [rows, fromDate, toDate, shiftId, employeeId, query])
  const shiftOptions = useMemo(() => [...new Map(rows
    .filter((row) => row.shiftId)
    .map((row) => [row.shiftId, { id: row.shiftId, name: row.shiftName, time: shiftTime(row) }]))
    .values()].sort((left, right) => left.name.localeCompare(right.name, 'vi')), [rows])
  const employeeOptions = useMemo(() => {
    const options = new Map(employees.map((employee) => [entityId(employee), {
      id: entityId(employee), name: employee.name,
    }]))
    rows.forEach((row) => options.set(row.employeeId, { id: row.employeeId, name: row.employeeName }))
    return [...options.values()].sort((left, right) => left.name.localeCompare(right.name, 'vi'))
  }, [employees, rows])
  const payableTotal = filteredRows
    .filter((row) => row.payable)
    .reduce((sum, row) => sum + row.amountVnd, 0)
  const employeeCount = new Set(filteredRows.map((row) => row.employeeId)).size

  const reset = () => {
    setFromDate(monthStart(today))
    setToDate(today)
    setShiftId('')
    setEmployeeId('')
    setQuery('')
  }

  return (
    <div className="task-bonus-tab-panel" role="tabpanel" id="task-bonus-panel" aria-labelledby="task-bonus-tab">
      <Card title="Bộ lọc công việc đã gửi" className="task-bonus-filter-card">
        <div className="task-bonus-filter-grid">
          <Field label="Từ ngày">
            <Input aria-label="Từ ngày" type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} />
          </Field>
          <Field label="Đến ngày">
            <Input aria-label="Đến ngày" type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} />
          </Field>
          <Field label="Ca làm việc">
            <Select aria-label="Lọc ca làm việc" value={shiftId} onChange={(event) => setShiftId(event.target.value)}>
              <option value="">Tất cả ca</option>
              {shiftOptions.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}{shift.time ? ` · ${shift.time}` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Nhân viên">
            <Select aria-label="Lọc nhân viên" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">Tất cả nhân viên</option>
              {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.id}</option>)}
            </Select>
          </Field>
          <Field label="Tìm kiếm" className="task-bonus-search-field">
            <SearchInput value={query} onChange={setQuery} placeholder="Tên nhân viên hoặc công việc..." aria-label="Tìm công việc tính thưởng" />
          </Field>
          <Button variant="outline" icon={RotateCcw} onClick={reset}>ĐẶT LẠI</Button>
        </div>
      </Card>

      <div className="metric-grid task-bonus-metrics">
        <MetricCard label="CÔNG VIỆC ĐÃ GỬI" value={filteredRows.length} helper="Theo bộ lọc hiện tại" icon={ClipboardCheck} tone="blue" compact />
        <MetricCard label="THƯỞNG ĐỦ ĐIỀU KIỆN" value={money(payableTotal)} helper="Không gồm khoản chờ đối soát" icon={CircleDollarSign} tone="green" compact />
        <MetricCard label="NHÂN VIÊN THỰC HIỆN" value={employeeCount} helper="Tài khoản riêng biệt" icon={Users} tone="purple" compact />
      </div>

      <Card title="Lịch sử công việc tính thưởng" action={<Badge tone="blue">{filteredRows.length} công việc</Badge>}>
        <InfoNote>Thông tin tên công việc và số tiền lấy từ bản chụp tại thời điểm nhân viên gửi. Khoản chờ đối soát điều chuyển chưa được cộng vào tổng thưởng đủ điều kiện.</InfoNote>
        {filteredRows.length ? <TableWrap className="compensation-table task-bonus-table">
          <thead><tr><th>Nhân viên</th><th>Công việc</th><th>Tiền thưởng</th><th>Ngày</th><th>Ca làm</th><th>Thời gian gửi</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead>
          <tbody>{filteredRows.map((row) => <tr key={row.id}>
            <td><div className="task-bonus-person"><Avatar name={row.employeeName} employeeId={row.employeeId} size={34} /><span><strong>{row.employeeName}</strong><small>{row.employeeId}</small></span></div></td>
            <td className="task-bonus-task-cell"><strong>{row.name}</strong>{row.catalogCode && <small>{row.catalogCode}</small>}</td>
            <td><strong className={row.payable ? 'task-bonus-credit' : 'task-bonus-pending'}>+{money(row.amountVnd)}</strong></td>
            <td>{displayDate(row.date)}</td>
            <td><strong>{row.shiftName}</strong>{shiftTime(row) && <small className="compensation-subline">{shiftTime(row)}</small>}</td>
            <td>{displayDateTime(row.submittedAt)}</td>
            <td><Badge tone={row.statusTone}>{row.status}</Badge></td>
            <td><small className="task-bonus-reference">{row.assignmentId || row.taskId || '—'}</small></td>
          </tr>)}</tbody>
        </TableWrap> : <EmptyState title="Chưa có công việc tính thưởng" description="Không có kết quả phù hợp với cửa hàng và bộ lọc đang chọn." />}
      </Card>
    </div>
  )
}

function ViolationEntryTab({ app, storeId, store, employees }) {
  const [employeeSelection, setEmployeeSelection] = useState('')
  const [occurredOn, setOccurredOn] = useState(vietnamToday)
  const [shiftSelection, setShiftSelection] = useState('')
  const [selectedPolicyIds, setSelectedPolicyIds] = useState([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(null)
  const employeeIds = new Set(employees.map(entityId))
  const selectedEmployeeId = employeeIds.has(employeeSelection) ? employeeSelection : entityId(employees[0])
  const shifts = useMemo(() => selectWorkedShiftOptions({
    attendance: app.attendance,
    schedule: app.schedule,
    shiftDefinitions: app.shiftDefinitions,
    employeeId: selectedEmployeeId,
    storeId,
    date: occurredOn,
  }), [app.attendance, app.schedule, app.shiftDefinitions, selectedEmployeeId, storeId, occurredOn])
  const selectedShiftId = shifts.some((shift) => shift.id === shiftSelection) ? shiftSelection : shifts[0]?.id || ''
  const selectedShift = shifts.find((shift) => shift.id === selectedShiftId) || null
  const catalogState = useMemo(() => activeViolationOptions({
    items: app.workCatalogItems,
    storeId,
    date: occurredOn,
    shift: selectedShift,
  }), [app.workCatalogItems, storeId, occurredOn, selectedShift])
  const policies = catalogState.policies
  const selectedPolicies = policies.filter((policy) => selectedPolicyIds.includes(policy.id))
  const totalVnd = selectedPolicies.reduce((sum, policy) => sum + policy.amountVnd, 0)
  const catalogBacked = policies.length > 0 && policies.every((policy) => policy.source === 'catalog')
  const rows = useMemo(() => (app.violations || [])
    .filter((entry) => targetUnitOfViolation(entry) === 'store')
    .filter((entry) => entryStoreId(entry) === storeId)
    .filter((entry) => !entry.deletedAt)
    .sort((left, right) => String(right.createdAt || right.occurredOn || '').localeCompare(String(left.createdAt || left.occurredOn || ''))), [app.violations, storeId])

  const resetDependentSelection = () => {
    setShiftSelection('')
    setSelectedPolicyIds([])
    setError('')
    requestRef.current = null
  }

  const togglePolicy = (id) => {
    setSelectedPolicyIds((current) => current.includes(id)
      ? current.filter((policyId) => policyId !== id)
      : [...current, id])
    setError('')
    requestRef.current = null
  }

  const canSave = Boolean(selectedEmployeeId && occurredOn && selectedShift && selectedPolicies.length && !busy)

  const save = async () => {
    if (!selectedEmployeeId || !occurredOn || !selectedShift || !selectedPolicies.length) {
      setError('Vui lòng chọn nhân viên, ngày, ca làm việc và ít nhất một vi phạm.')
      return
    }
    if (typeof app.createViolationBatch !== 'function') {
      setError('Chức năng lưu nhiều vi phạm đang được đồng bộ với máy chủ.')
      return
    }
    const selection = selectedPolicies.map((policy) => policy.id).sort()
    const fingerprint = JSON.stringify({ storeId, employeeId: selectedEmployeeId, occurredOn, shiftId: selectedShift.id, selection, note: note.trim() })
    if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, idempotencyKey: `violation-batch:${requestId()}` }
    }
    const payload = {
      targetUnit: 'store',
      storeId,
      employeeId: selectedEmployeeId,
      occurredOn,
      shiftId: selectedShift.id,
      note: note.trim(),
      ...(catalogBacked
        ? { catalogItemIds: selectedPolicies.map((policy) => policy.id) }
        : { policyCodes: selectedPolicies.map((policy) => policy.code) }),
      idempotencyKey: requestRef.current.idempotencyKey,
    }
    setBusy(true)
    setError('')
    try {
      const result = await app.createViolationBatch(payload)
      if (result?.ok === false) throw new Error(result.message || 'Không thể lưu vi phạm.')
      requestRef.current = null
      setSelectedPolicyIds([])
      setNote('')
      app.notify?.(`Đã ghi nhận ${selectedPolicies.length} vi phạm cho ${employeeName(employees, selectedEmployeeId)}.`, 'success')
    } catch (saveError) {
      setError(String(saveError?.message || 'Không thể lưu vi phạm. Vui lòng thử lại.').slice(0, 180))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="task-bonus-tab-panel" role="tabpanel" id="violation-entry-panel" aria-labelledby="violation-entry-tab">
      <div className="violation-entry-layout">
        <Card title="Ghi nhận vi phạm" className="violation-entry-card">
          <div className="violation-entry-fields">
            <Field label="Nhân viên" required>
              <Select aria-label="Nhân viên vi phạm" value={selectedEmployeeId} disabled={!employees.length || busy} onChange={(event) => { setEmployeeSelection(event.target.value); resetDependentSelection() }}>
                {employees.map((employee) => <option key={entityId(employee)} value={entityId(employee)}>{employee.name} — {entityId(employee)}</option>)}
              </Select>
            </Field>
            <Field label="Ngày vi phạm" required>
              <Input aria-label="Ngày vi phạm" type="date" value={occurredOn} disabled={busy} onChange={(event) => { setOccurredOn(event.target.value); resetDependentSelection() }} />
            </Field>
            <Field label="Ca nhân viên đã làm" required hint="Ưu tiên ca đã chấm công; lịch phân ca được dùng khi nhân viên quên điểm danh.">
              <Select aria-label="Ca nhân viên đã làm" value={selectedShiftId} disabled={!shifts.length || busy} onChange={(event) => { setShiftSelection(event.target.value); setSelectedPolicyIds([]); requestRef.current = null }}>
                {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}{shift.time ? ` · ${shift.time}` : ''} · {shift.sourceLabel}</option>)}
              </Select>
            </Field>
          </div>
          {!employees.length && <InfoNote tone="orange">Cửa hàng chưa có nhân viên trong phạm vi quản lý.</InfoNote>}
          {employees.length > 0 && !shifts.length && <InfoNote tone="orange">Nhân viên chưa có lịch phân ca hoặc chấm công tại cửa hàng trong ngày này.</InfoNote>}

          <div className="violation-catalog-heading">
            <div><h3 id="violation-catalog-title">Danh sách vi phạm</h3><p>Chọn một hoặc nhiều nội dung cần ghi nhận.</p></div>
            <Badge tone={selectedPolicies.length ? 'red' : 'gray'}>{selectedPolicies.length} đã chọn</Badge>
          </div>
          {catalogState.error
            ? <InfoNote tone="red">{catalogState.error}</InfoNote>
            : <div className="violation-checklist" role="group" aria-labelledby="violation-catalog-title">
              {policies.map((policy) => {
                const checked = selectedPolicyIds.includes(policy.id)
                return <label key={policy.id} className={checked ? 'selected' : ''}>
                  <input type="checkbox" checked={checked} disabled={!selectedShift || busy} onChange={() => togglePolicy(policy.id)} aria-label={`Chọn vi phạm ${policy.name}`} />
                  <span><strong>{policy.name}</strong><small>{policy.code}</small></span>
                  <b>−{money(policy.amountVnd)}</b>
                </label>
              })}
            </div>}
          <Field label="Ghi chú chung" hint="Ghi chú sẽ được lưu cùng đợt ghi nhận.">
            <Input aria-label="Ghi chú vi phạm" value={note} maxLength="1000" disabled={busy} onChange={(event) => { setNote(event.target.value); requestRef.current = null }} placeholder="Thông tin đối soát bổ sung (nếu có)" />
          </Field>
        </Card>

        <aside className="violation-summary" aria-label="Tóm tắt vi phạm đã chọn">
          <div className="violation-summary__title"><ShieldAlert size={22} /><div><h2>Tóm tắt ghi nhận</h2><p>Kiểm tra trước khi lưu</p></div></div>
          <dl>
            <div><dt>Nhân viên</dt><dd>{employeeName(employees, selectedEmployeeId)}</dd></div>
            <div><dt>Cửa hàng</dt><dd>{store?.name || storeId}</dd></div>
            <div><dt>Ngày</dt><dd>{displayDate(occurredOn)}</dd></div>
            <div><dt>Ca làm</dt><dd>{selectedShift?.name || 'Chưa có ca'}{selectedShift?.time && <small>{selectedShift.time}</small>}</dd></div>
            <div><dt>Số vi phạm</dt><dd>{selectedPolicies.length}</dd></div>
          </dl>
          <div className="violation-summary__total"><span>Tổng tiền bị trừ</span><strong>−{money(totalVnd)}</strong></div>
          <div className="violation-summary__items">
            {selectedPolicies.map((policy) => <p key={policy.id}><span>{policy.name}</span><strong>−{money(policy.amountVnd)}</strong></p>)}
            {!selectedPolicies.length && <small>Chưa chọn nội dung vi phạm.</small>}
          </div>
          {error && <InfoNote tone="red">{error}</InfoNote>}
          <Button icon={Save} loading={busy} disabled={!canSave} onClick={save}>LƯU VI PHẠM</Button>
          <small className="violation-summary__privacy">Dữ liệu được gửi đúng tài khoản nhân viên, ngày và ca làm việc đã chọn.</small>
        </aside>
      </div>

      <Card title="Lịch sử ghi nhận vi phạm" action={<Badge tone="red">{rows.filter((row) => !isVoided(row)).length} hiệu lực</Badge>}>
        {rows.length ? <TableWrap className="compensation-table task-bonus-table violation-history-table">
          <thead><tr><th>Nhân viên</th><th>Vi phạm</th><th>Số tiền bị trừ</th><th>Ngày</th><th>Ca làm</th><th>Người ghi nhận</th><th>Thời gian lưu</th><th>Trạng thái</th></tr></thead>
          <tbody>{rows.map((entry) => <tr key={entry.id}>
            <td><strong>{employeeName(app.employees || [], entryEmployeeId(entry), entry.employeeName)}</strong><small className="compensation-subline">{entryEmployeeId(entry)}</small></td>
            <td className="task-bonus-task-cell"><strong>{entry.title || entry.label || entry.policyCode || '—'}</strong>{entry.policyCode && <small>{entry.policyCode}</small>}</td>
            <td><strong className="compensation-debit">−{money(Math.abs(entryAmount(entry)))}</strong></td>
            <td>{displayDate(entryDate(entry))}</td>
            <td><strong>{entry.shiftName || entry.shiftId || 'Chưa gắn ca'}</strong>{entry.shiftStart && entry.shiftEnd && <small className="compensation-subline">{entry.shiftStart} – {entry.shiftEnd}</small>}</td>
            <td>{entry.createdBy?.name || entry.createdByName || entry.createdBy?.id || entry.createdBy || '—'}</td>
            <td>{displayDateTime(entry.createdAt)}</td>
            <td><Badge tone={isVoided(entry) ? 'gray' : 'red'}>{isVoided(entry) ? 'Đã hủy' : 'Đã ghi nhận'}</Badge></td>
          </tr>)}</tbody>
        </TableWrap> : <EmptyState title="Chưa có vi phạm" description="Các vi phạm được lưu cho cửa hàng sẽ hiển thị tại đây." />}
      </Card>
    </div>
  )
}

export function StoreTaskBonusViolationsPage() {
  const app = useApp()
  const role = canonicalRole(app.session?.role)
  const [tab, setTab] = useState('rewards')
  const tabRefs = useRef({})
  const stores = useMemo(() => storesVisibleToRole(app.stores || [], app.session || {}), [app.stores, app.session])
  const requestedStoreId = role === 'store_manager'
    ? String(app.session?.storeId || '')
    : String(app.activeStoreId || app.session?.storeId || '')
  const store = stores.find((item) => entityId(item) === requestedStoreId) || stores[0] || null
  const storeId = entityId(store)
  const employees = useMemo(() => selectStoreEmployees({
    employees: app.employees,
    storeId,
  }), [app.employees, storeId])
  const handleTabKeyDown = (event, currentTab) => {
    const tabs = ['rewards', 'violations']
    const currentIndex = tabs.indexOf(currentTab)
    let nextTab = null
    if (event.key === 'ArrowRight') nextTab = tabs[(currentIndex + 1) % tabs.length]
    if (event.key === 'ArrowLeft') nextTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length]
    if (event.key === 'Home') nextTab = tabs[0]
    if (event.key === 'End') nextTab = tabs.at(-1)
    if (!nextTab) return
    event.preventDefault()
    setTab(nextTab)
    tabRefs.current[nextTab]?.focus()
  }

  if (!allowedRoles.has(role)) {
    return <AccessDenied subtitle="Chỉ Admin, Nhân viên hỗ trợ KD và Quản lý cửa hàng được truy cập danh mục này." />
  }
  if (!storeId) {
    return (
      <div className="page compensation-page">
        <PageHeader title="CÔNG VIỆC TÍNH THƯỞNG VÀ VI PHẠM" subtitle="Chọn một cửa hàng vận hành trước khi làm việc với dữ liệu." icon={ClipboardCheck} />
        <InfoNote tone="orange">Tài khoản chưa có cửa hàng hợp lệ trong phạm vi quản lý.</InfoNote>
      </div>
    )
  }

  return (
    <div className="page compensation-page store-task-bonus-violations-page">
      <PageHeader
        title="CÔNG VIỆC TÍNH THƯỞNG VÀ VI PHẠM"
        subtitle="Theo dõi công việc nhân viên đã gửi và ghi nhận vi phạm đúng ngày, đúng ca làm việc."
        icon={ClipboardCheck}
        actions={<Badge tone="green">{storeName(stores, storeId, store?.name)}</Badge>}
      />
      <div className="tabs task-bonus-tabs" role="tablist" aria-label="Công việc tính thưởng và vi phạm">
        <button type="button" ref={(node) => { tabRefs.current.rewards = node }} id="task-bonus-tab" role="tab" tabIndex={tab === 'rewards' ? 0 : -1} aria-selected={tab === 'rewards'} aria-controls="task-bonus-panel" className={tab === 'rewards' ? 'active' : ''} onClick={() => setTab('rewards')} onKeyDown={(event) => handleTabKeyDown(event, 'rewards')}>
          <CircleDollarSign /> Công việc tính thưởng
        </button>
        <button type="button" ref={(node) => { tabRefs.current.violations = node }} id="violation-entry-tab" role="tab" tabIndex={tab === 'violations' ? 0 : -1} aria-selected={tab === 'violations'} aria-controls="violation-entry-panel" className={tab === 'violations' ? 'active' : ''} onClick={() => setTab('violations')} onKeyDown={(event) => handleTabKeyDown(event, 'violations')}>
          <ShieldAlert /> Ghi nhận vi phạm
        </button>
      </div>
      {tab === 'rewards'
        ? <RewardSubmissionsTab key={storeId} app={app} storeId={storeId} employees={employees} />
        : <ViolationEntryTab key={storeId} app={app} storeId={storeId} store={store} employees={employees} />}
    </div>
  )
}
