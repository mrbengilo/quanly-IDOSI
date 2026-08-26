import { useMemo, useState } from 'react'
import { CheckCircle2, Gift, Plus, ShieldCheck, XCircle } from 'lucide-react'
import { useApp } from '../../state/AppContext'
import {
  Badge,
  Button,
  Card,
  Field,
  InfoNote,
  Input,
  MoneyInput,
  PageHeader,
  Select,
  TableWrap,
} from '../../components/UI'
import { money } from '../../utils'
import {
  canonicalRole,
  entityId,
  entryAmount,
  entryDate,
  entryEmployeeId,
  entryStoreId,
  entryType,
  isApproved,
  isVoided,
  managerCandidates,
  statusLabel,
  statusTone,
  storesVisibleToRole,
  typeLabel,
} from './compensationViewModel'
import {
  AccessDenied,
  ActionError,
  displayDate,
  employeeName,
  useCompensationAction,
  vietnamToday,
} from './compensationUi'
import './compensation-page.css'

const initialForm = () => ({ type: 'MANUAL', employeeId: '', amount: '', effectiveDate: vietnamToday(), note: '' })

export function ManagerCompensationPage() {
  const app = useApp()
  const role = canonicalRole(app.session?.role)
  const canManage = ['admin', 'business_support'].includes(role)
  const stores = useMemo(() => storesVisibleToRole(app.stores, app.session), [app.stores, app.session])
  const [storeSelection, setStoreSelection] = useState('')
  const selectedStoreId = storeSelection || entityId(stores[0])
  const managers = useMemo(() => managerCandidates({
    employees: app.employees,
    managerAccounts: app.managerAccounts,
    storeId: selectedStoreId,
  }), [app.employees, app.managerAccounts, selectedStoreId])
  const [form, setForm] = useState(initialForm)
  const [validation, setValidation] = useState('')
  const { busyKey, error, run } = useCompensationAction(app)
  const selectedEmployeeId = form.employeeId || entityId(managers[0])
  const managerIds = useMemo(() => new Set(managers.map(entityId)), [managers])
  const rows = (app.compensationEntries || [])
    .filter((entry) => managerIds.has(entryEmployeeId(entry)) && entryStoreId(entry) === selectedStoreId)
    .filter((entry) => ['MANUAL', 'ALLOWANCE'].includes(entryType(entry)))
    .sort((left, right) => String(right.createdAt || right.effectiveDate || '').localeCompare(String(left.createdAt || left.effectiveDate || '')))

  if (!canManage) return <AccessDenied subtitle="Chỉ Admin và Nhân viên hỗ trợ KD được quản lý thưởng, phụ cấp của quản lý cửa hàng." />

  const createEntry = async () => {
    const amountVnd = Number(form.amount)
    if (!selectedStoreId || !selectedEmployeeId || !Number.isSafeInteger(amountVnd) || amountVnd <= 0 || !form.effectiveDate || !form.note.trim()) {
      setValidation('Vui lòng chọn cửa hàng, quản lý, nhập số tiền hợp lệ, ngày áp dụng và nội dung ghi nhận.')
      return
    }
    setValidation('')
    const saved = await run({
      key: 'create',
      action: app.createCompensationEntry,
      payload: {
        type: form.type,
        targetUnit: 'store_manager',
        employeeId: selectedEmployeeId,
        storeId: selectedStoreId,
        amountVnd,
        effectiveDate: form.effectiveDate,
        note: form.note.trim(),
      },
      success: `Đã tạo ${typeLabel(form.type).toLowerCase()} cho quản lý cửa hàng.`,
    })
    if (saved) setForm(initialForm())
  }

  const approveEntry = (entry) => run({
    key: `approve:${entry.id}`,
    action: app.approveCompensationEntry,
    payload: { id: entry.id, expectedVersion: entry.version },
    success: 'Đã duyệt khoản ghi nhận.',
  })

  const voidEntry = (entry) => {
    if (typeof window !== 'undefined' && !window.confirm('Hủy khoản ghi nhận này? Lịch sử vẫn được giữ lại để đối soát.')) return
    run({
      key: `void:${entry.id}`,
      action: app.voidCompensationEntry,
      payload: { id: entry.id, expectedVersion: entry.version, reason: 'Hủy từ màn hình quản lý lương thưởng' },
      success: 'Đã hủy khoản ghi nhận và giữ lại lịch sử.',
    })
  }

  return (
    <div className="page compensation-page manager-compensation-page">
      <PageHeader
        title="THƯỞNG VÀ PHỤ CẤP QUẢN LÝ CỬA HÀNG"
        subtitle="Ghi nhận khoản thưởng thủ công hoặc phụ cấp riêng cho quản lý; Nhân viên hỗ trợ KD quản lý toàn bộ cửa hàng vận hành."
        icon={Gift}
      />
      <Card title="Tạo khoản ghi nhận">
        <div className="compensation-form-grid">
          <Field label="Cửa hàng" required>
            <Select aria-label="Cửa hàng" value={selectedStoreId} onChange={(event) => { setStoreSelection(event.target.value); setForm((current) => ({ ...current, employeeId: '' })) }}>
              {stores.map((store) => <option key={entityId(store)} value={entityId(store)}>{store.name}</option>)}
            </Select>
          </Field>
          <Field label="Quản lý cửa hàng" required>
            <Select aria-label="Quản lý cửa hàng" value={selectedEmployeeId} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))} disabled={!managers.length}>
              {managers.map((employee) => <option key={entityId(employee)} value={entityId(employee)}>{employee.name} — {entityId(employee)}</option>)}
            </Select>
          </Field>
          <Field label="Loại khoản" required>
            <Select aria-label="Loại khoản" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}>
              <option value="MANUAL">Thưởng thủ công</option>
              <option value="ALLOWANCE">Phụ cấp</option>
            </Select>
          </Field>
          <Field label="Số tiền" required>
            <MoneyInput aria-label="Số tiền" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="Nhập số tiền thực tế" />
          </Field>
          <Field label="Ngày áp dụng" required>
            <Input aria-label="Ngày áp dụng" type="date" value={form.effectiveDate} onChange={(event) => setForm((current) => ({ ...current, effectiveDate: event.target.value }))} />
          </Field>
          <Field label="Nội dung" required className="compensation-form-span">
            <Input aria-label="Nội dung" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Nêu rõ lý do thưởng hoặc phụ cấp" />
          </Field>
        </div>
        {!stores.length && <InfoNote tone="orange">Chưa có cửa hàng vận hành để ghi nhận.</InfoNote>}
        {stores.length > 0 && !managers.length && <InfoNote tone="orange">Cửa hàng này chưa có hồ sơ quản lý được liên kết với nhân viên.</InfoNote>}
        {validation && <InfoNote tone="red">{validation}</InfoNote>}
        <ActionError message={error} />
        <div className="compensation-actions">
          <Button icon={Plus} loading={busyKey === 'create'} disabled={!stores.length || !managers.length || Boolean(busyKey)} onClick={createEntry}>TẠO KHOẢN GHI NHẬN</Button>
        </div>
      </Card>
      <Card title="Lịch sử thưởng và phụ cấp" action={<Badge tone="blue">{rows.length} khoản</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày áp dụng</th><th>Quản lý</th><th>Loại</th><th>Số tiền</th><th>Nội dung</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {rows.map((entry) => <tr key={entry.id}>
              <td>{displayDate(entryDate(entry))}</td>
              <td><strong>{employeeName(managers, entryEmployeeId(entry), entry.employeeName)}</strong><small className="compensation-subline">{entryEmployeeId(entry)}</small></td>
              <td><Badge tone={entryType(entry) === 'ALLOWANCE' ? 'blue' : 'green'}>{typeLabel(entryType(entry))}</Badge></td>
              <td><strong>{money(entryAmount(entry))}</strong></td>
              <td>{entry.note || entry.reason || '—'}</td>
              <td><Badge tone={statusTone(entry)}>{statusLabel(entry)}</Badge></td>
              <td><div className="compensation-row-actions">
                {!isApproved(entry) && !isVoided(entry) && typeof app.approveCompensationEntry === 'function' && <Button variant="outline" icon={CheckCircle2} loading={busyKey === `approve:${entry.id}`} disabled={Boolean(busyKey)} onClick={() => approveEntry(entry)}>Duyệt</Button>}
                {!isVoided(entry) && typeof app.voidCompensationEntry === 'function' && <Button variant="danger" icon={XCircle} loading={busyKey === `void:${entry.id}`} disabled={Boolean(busyKey)} onClick={() => voidEntry(entry)}>Hủy</Button>}
                {isVoided(entry) && <ShieldCheck size={19} aria-label="Đã lưu lịch sử" />}
              </div></td>
            </tr>)}
            {!rows.length && <tr><td colSpan="7" className="compensation-empty">Chưa có khoản thưởng hoặc phụ cấp cho quản lý tại cửa hàng này.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  )
}
