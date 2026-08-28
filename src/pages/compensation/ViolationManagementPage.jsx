import { useMemo, useState } from 'react'
import { Plus, ShieldAlert, UserRoundCheck, XCircle } from 'lucide-react'
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
import { activeStoreShiftDefinitions } from '../store/scheduleView'
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

const violationShiftName = (entry = {}) => entry.shiftName || entry.shiftId || 'Chưa gắn ca'
const violationShiftTime = (entry = {}) => entry.shiftStart && entry.shiftEnd
  ? `${entry.shiftStart} – ${entry.shiftEnd}`
  : ''

export function ViolationManagementPage({ targetUnit: requestedTargetUnit }) {
  const app = useApp()
  const role = canonicalRole(app.session?.role)
  const targetUnit = requestedTargetUnit || routeTargetUnit()
  const permittedUnit = ['store', 'office', 'business_support'].includes(targetUnit)
  const canManage = ['admin', 'business_support'].includes(role)
    && (targetUnit !== 'business_support' || role === 'admin')
  const stores = useMemo(() => storesVisibleToRole(app.stores, app.session), [app.stores, app.session])
  const [storeSelection, setStoreSelection] = useState('')
  const selectedStoreId = targetUnit === 'store' ? storeSelection || entityId(stores[0]) : ''
  const employees = useMemo(() => employeesForTarget({
    employees: app.employees,
    targetUnit,
    storeId: selectedStoreId,
  }), [app.employees, targetUnit, selectedStoreId])
  const [employeeSelection, setEmployeeSelection] = useState('')
  const [shiftSelection, setShiftSelection] = useState('')
  const [policyId, setPolicyId] = useState('')
  const [occurredOn, setOccurredOn] = useState(vietnamToday)
  const [note, setNote] = useState('')
  const [validation, setValidation] = useState('')
  const { busyKey, error, run } = useCompensationAction(app)
  const selectedEmployeeId = employeeSelection || entityId(employees[0])
  const shifts = useMemo(() => targetUnit === 'store'
    ? activeStoreShiftDefinitions(app.shiftDefinitions || [], { storeId: selectedStoreId, date: occurredOn })
    : [], [app.shiftDefinitions, targetUnit, selectedStoreId, occurredOn])
  const selectedShiftId = shiftSelection || entityId(shifts[0])
  const selectedShift = shifts.find((shift) => entityId(shift) === selectedShiftId)
  const policies = useMemo(() => activeWorkCatalogItems(app.workCatalogItems || [], {
    targetGroup: targetUnit,
    storeId: targetUnit === 'store' ? selectedStoreId : null,
    date: occurredOn,
    kinds: WORK_CATALOG_KIND.VIOLATION,
  }), [app.workCatalogItems, targetUnit, selectedStoreId, occurredOn])
  const selectedPolicy = policies.find((policy) => policy.id === policyId)
  const visibleEmployeeIds = useMemo(() => new Set(employees.map(entityId)), [employees])
  const rows = (app.violations || [])
    .filter((entry) => targetUnitOfViolation(entry) === targetUnit)
    .filter((entry) => targetUnit !== 'store' || entryStoreId(entry) === selectedStoreId)
    .filter((entry) => visibleEmployeeIds.has(entryEmployeeId(entry)))
    .sort((left, right) => String(right.createdAt || right.occurredOn || '').localeCompare(String(left.createdAt || left.occurredOn || '')))

  if (!permittedUnit || !canManage) {
    const subtitle = targetUnit === 'business_support'
      ? 'Chỉ Admin được ghi nhận vi phạm cho Nhân viên hỗ trợ KD.'
      : 'Chỉ Admin và Nhân viên hỗ trợ KD được quản lý vi phạm của đơn vị này.'
    return <AccessDenied subtitle={subtitle} />
  }

  const createViolation = async () => {
    if (!selectedEmployeeId || !selectedPolicy || !occurredOn || (targetUnit === 'store' && !selectedShift)) {
      setValidation('Vui lòng chọn nhân viên, nội dung vi phạm, ngày phát sinh và ca làm việc.')
      return
    }
    setValidation('')
    const saved = await run({
      key: 'create',
      action: app.createViolation,
      payload: {
        targetUnit,
        employeeId: selectedEmployeeId,
        storeId: selectedStoreId || null,
        catalogItemId: selectedPolicy.id,
        policyCode: selectedPolicy.code,
        title: selectedPolicy.name,
        amountVnd: selectedPolicy.amountVnd,
        occurredOn,
        ...(selectedShift ? {
          shiftId: selectedShiftId,
          shiftName: selectedShift.name,
          shiftStart: selectedShift.start,
          shiftEnd: selectedShift.end,
        } : {}),
        note: note.trim(),
      },
      success: 'Đã ghi nhận vi phạm. Số tiền được lưu là khoản phải thu dương.',
    })
    if (saved) setNote('')
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
    <div className="page compensation-page violation-management-page">
      <PageHeader
        title={`QUẢN LÝ VI PHẠM — ${UNIT_LABELS[targetUnit].toUpperCase()}`}
        subtitle={targetUnit === 'store' ? 'Admin và Nhân viên hỗ trợ KD quản lý vi phạm tại mọi cửa hàng vận hành.' : `Quản lý vi phạm của ${UNIT_LABELS[targetUnit].toLowerCase()} theo đúng phạm vi quyền.`}
        icon={ShieldAlert}
      />
      <Card title="Ghi nhận vi phạm">
        <div className="compensation-form-grid">
          {targetUnit === 'store' && <Field label="Cửa hàng" required>
            <Select aria-label="Cửa hàng" value={selectedStoreId} onChange={(event) => { setStoreSelection(event.target.value); setEmployeeSelection(''); setShiftSelection('') }}>
              {stores.map((store) => <option key={entityId(store)} value={entityId(store)}>{store.name}</option>)}
            </Select>
          </Field>}
          <Field label="Nhân viên" required>
            <Select aria-label="Nhân viên" value={selectedEmployeeId} onChange={(event) => setEmployeeSelection(event.target.value)} disabled={!employees.length}>
              {employees.map((employee) => <option key={entityId(employee)} value={entityId(employee)}>{employee.name} — {entityId(employee)}</option>)}
            </Select>
          </Field>
          {targetUnit === 'store' && <Field label="Ca vi phạm" required>
            <Select aria-label="Ca vi phạm" value={selectedShiftId} onChange={(event) => setShiftSelection(event.target.value)} disabled={!shifts.length}>
              {shifts.map((shift) => <option key={entityId(shift)} value={entityId(shift)}>{shift.name} · {shift.time || `${shift.start} – ${shift.end}`}</option>)}
            </Select>
          </Field>}
          <Field label="Nội dung vi phạm" required className="compensation-form-span">
            <div className="compensation-catalog-checklist" role="group" aria-label="Nội dung vi phạm">
              {policies.map((policy) => <label key={policy.id} className={selectedPolicy?.id === policy.id ? 'selected' : ''}>
                <input type="checkbox" checked={selectedPolicy?.id === policy.id} onChange={() => setPolicyId((current) => current === policy.id ? '' : policy.id)} />
                <span><strong>{policy.name}</strong><small>{money(policy.amountVnd)}</small></span>
              </label>)}
              {!policies.length && <InfoNote tone="orange">Chưa có vi phạm đang hoạt động cho phạm vi và ngày đã chọn. Hãy thêm tại “Danh mục công việc & vi phạm”.</InfoNote>}
            </div>
          </Field>
          <Field label="Số tiền phải thu">
            <Input aria-label="Số tiền phải thu" value={money(selectedPolicy?.amountVnd || 0)} readOnly />
          </Field>
          <Field label="Ngày phát sinh" required>
            <Input aria-label="Ngày phát sinh" type="date" value={occurredOn} onChange={(event) => { setOccurredOn(event.target.value); setShiftSelection('') }} />
          </Field>
          <Field label="Ghi chú" className="compensation-form-span">
            <Input aria-label="Ghi chú" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Thông tin đối soát bổ sung (nếu có)" />
          </Field>
        </div>
        {!employees.length && <InfoNote tone="orange">Không có nhân viên đang hoạt động trong phạm vi đã chọn.</InfoNote>}
        {targetUnit === 'store' && !shifts.length && <InfoNote tone="orange">Chưa có ca làm việc đang hoạt động cho cửa hàng và ngày đã chọn.</InfoNote>}
        <InfoNote>Vi phạm luôn là khoản phải thu dương. Khi quyết toán, hệ thống áp dụng theo thứ tự thưởng → phụ cấp → lương và không làm thực nhận âm.</InfoNote>
        {validation && <InfoNote tone="red">{validation}</InfoNote>}
        <ActionError message={error} />
        <div className="compensation-actions"><Button icon={Plus} loading={busyKey === 'create'} disabled={!employees.length || !selectedPolicy || (targetUnit === 'store' && !selectedShift) || Boolean(busyKey)} onClick={createViolation}>GHI NHẬN VI PHẠM</Button></div>
      </Card>
      <Card title="Lịch sử vi phạm" action={<Badge tone="red">{rows.filter((entry) => !isVoided(entry)).length} đang hiệu lực</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày</th><th>Nhân viên</th>{targetUnit === 'store' && <th>Cửa hàng</th>}{targetUnit === 'store' && <th>Ca làm việc</th>}<th>Nội dung</th><th>Số tiền phải thu</th><th>Ghi chú</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {rows.map((entry) => <tr key={entry.id}>
              <td>{displayDate(entryDate(entry))}</td>
              <td><strong>{employeeName(employees, entryEmployeeId(entry), entry.employeeName)}</strong><small className="compensation-subline">{entryEmployeeId(entry)}</small></td>
              {targetUnit === 'store' && <td>{storeName(stores, entryStoreId(entry), entry.storeName)}</td>}
              {targetUnit === 'store' && <td><strong>{violationShiftName(entry)}</strong>{violationShiftTime(entry) && <small className="compensation-subline">{violationShiftTime(entry)}</small>}</td>}
              <td>{entry.title || entry.label || entry.reason || entry.policyCode || '—'}</td>
              <td><strong className="compensation-debit">{money(Math.abs(entryAmount(entry)))}</strong></td>
              <td>{entry.note || '—'}</td>
              <td><Badge tone={statusTone(entry)}>{statusLabel(entry)}</Badge></td>
              <td>{!isVoided(entry) && typeof app.voidViolation === 'function' ? <Button variant="danger" icon={XCircle} loading={busyKey === `void:${entry.id}`} disabled={Boolean(busyKey)} onClick={() => voidViolation(entry)}>Hủy</Button> : <span>—</span>}</td>
            </tr>)}
            {!rows.length && <tr><td colSpan={targetUnit === 'store' ? 9 : 7} className="compensation-empty">Chưa có vi phạm trong phạm vi này.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>
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
      <div className="compensation-summary-strip"><span>TỔNG SỐ TIỀN BỊ TRỪ</span><strong>{money(outstandingVnd)}</strong></div>
      <Card title="Chi tiết và trạng thái đối soát">
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày vi phạm</th><th>Cửa hàng</th><th>Ca làm việc</th><th>Nội dung vi phạm</th><th>Số tiền bị trừ</th><th>Ghi chú</th><th>Trạng thái</th></tr></thead>
          <tbody>{rows.map((entry) => <tr key={entry.id}><td><strong>{displayDate(entryDate(entry))}</strong></td><td>{targetUnitOfViolation(entry) === 'store' ? storeName(app.stores || [], entryStoreId(entry), entry.storeName) : UNIT_LABELS[targetUnitOfViolation(entry)]}</td><td><strong>{violationShiftName(entry)}</strong>{violationShiftTime(entry) && <small className="compensation-subline">{violationShiftTime(entry)}</small>}</td><td>{entry.title || entry.label || entry.reason || entry.policyCode || '—'}</td><td><strong className="compensation-debit">−{money(Math.abs(entryAmount(entry)))}</strong></td><td>{entry.note || '—'}</td><td><Badge tone={statusTone(entry)}>{statusLabel(entry)}</Badge></td></tr>)}{!rows.length && <tr><td colSpan="7" className="compensation-empty">Bạn chưa có bản ghi vi phạm.</td></tr>}</tbody>
        </TableWrap>
      </Card>
    </div>
  )
}
