import { useMemo, useState } from 'react'
import { ClipboardList, Edit3, Plus, RefreshCcw, Save, Search, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InfoNote,
  Input,
  Modal,
  MoneyInput,
  PageHeader,
  Select,
  TableWrap,
} from '../../components/UI'
import {
  WORK_CATALOG_KIND,
  WORK_CATALOG_TARGET,
  normalizeWorkCatalogItem,
} from '../../domain/workCatalog'
import { useApp } from '../../state/AppContext'
import { money, shortDateTime24, today } from '../../utils'
import './WorkCatalogSettingsPage.css'

const TARGET_LABELS = Object.freeze({
  [WORK_CATALOG_TARGET.STORE]: 'Nhân viên cửa hàng',
  [WORK_CATALOG_TARGET.OFFICE]: 'Khối văn phòng',
  [WORK_CATALOG_TARGET.BUSINESS_SUPPORT]: 'Nhân viên hỗ trợ KD',
})

const KIND_LABELS = Object.freeze({
  [WORK_CATALOG_KIND.FIXED_TASK]: 'Công việc cố định',
  [WORK_CATALOG_KIND.REWARD_TASK]: 'Công việc nhận thưởng',
  [WORK_CATALOG_KIND.VIOLATION]: 'Vi phạm',
})

const EMPTY_FORM = Object.freeze({
  targetGroup: WORK_CATALOG_TARGET.STORE,
  kind: WORK_CATALOG_KIND.FIXED_TASK,
  storeId: '',
  shiftId: '',
  name: '',
  amountVnd: '',
  sortOrder: '0',
  effectiveFrom: '',
  effectiveTo: '',
})

const itemKey = (item) => String(item.id || '')
const storeKey = (store) => String(store.id || store.code || '')
const itemIsActive = (item) => item.active !== false && !item.deletedAt
const makeCode = (kind) => `${String(kind || 'item').toLocaleLowerCase('en-US')}-${crypto.randomUUID()}`

export function WorkCatalogSettingsPage() {
  const app = useApp()
  const items = useMemo(() => (Array.isArray(app.workCatalogItems) ? app.workCatalogItems : [])
    .map((item) => {
      try { return normalizeWorkCatalogItem(item) } catch { return null }
    })
    .filter(Boolean)
    .toSorted((left, right) => (
      left.targetGroup.localeCompare(right.targetGroup)
      || left.kind.localeCompare(right.kind)
      || left.sortOrder - right.sortOrder
      || left.name.localeCompare(right.name, 'vi-VN')
    )), [app.workCatalogItems])
  const stores = useMemo(() => (Array.isArray(app.stores) ? app.stores : [])
    .filter((store) => !store.deletedAt && store.status !== 'Ngừng hoạt động'), [app.stores])
  const shifts = useMemo(() => (Array.isArray(app.shiftDefinitions) ? app.shiftDefinitions : [])
    .filter((shift) => !shift.deletedAt && shift.active !== false), [app.shiftDefinitions])
  const [target, setTarget] = useState('all')
  const [kind, setKind] = useState('all')
  const [storeId, setStoreId] = useState('all')
  const [status, setStatus] = useState('active')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
  const filtered = items.filter((item) => (
    (target === 'all' || item.targetGroup === target)
    && (kind === 'all' || item.kind === kind)
    && (storeId === 'all' || item.storeId === storeId)
    && (status === 'all' || (status === 'active' ? itemIsActive(item) : !itemIsActive(item)))
    && (!normalizedQuery || `${item.name} ${item.code}`.toLocaleLowerCase('vi-VN').includes(normalizedQuery))
  ))

  const openCreate = () => {
    const initialTarget = target === 'all' ? WORK_CATALOG_TARGET.STORE : target
    const initialKind = kind === 'all' ? WORK_CATALOG_KIND.FIXED_TASK : kind
    setEditing({ id: '' })
    setForm({
      ...EMPTY_FORM,
      targetGroup: initialTarget,
      kind: initialKind,
      storeId: initialTarget === WORK_CATALOG_TARGET.STORE && storeId !== 'all' ? storeId : '',
    })
  }

  const openEdit = (item) => {
    setEditing(item)
    setForm({
      targetGroup: item.targetGroup,
      kind: item.kind,
      storeId: item.storeId || '',
      shiftId: item.shiftId || '',
      name: item.name,
      amountVnd: String(item.amountVnd || ''),
      sortOrder: String(item.sortOrder || 0),
      effectiveFrom: item.effectiveFrom || '',
      effectiveTo: item.effectiveTo || '',
    })
  }

  const closeEditor = () => {
    if (saving) return
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const applicableShifts = shifts.filter((shift) => !form.storeId || String(shift.storeId || '') === form.storeId)

  const save = async () => {
    const amountVnd = Number(form.amountVnd || 0)
    if (!form.name.trim()) return app.notify?.('Vui lòng nhập tên công việc hoặc vi phạm.', 'info')
    if (!Number.isSafeInteger(amountVnd) || amountVnd < 0) return app.notify?.('Số tiền phải là số nguyên không âm theo đơn vị đồng.', 'info')
    if (form.kind !== WORK_CATALOG_KIND.FIXED_TASK && amountVnd <= 0) {
      return app.notify?.('Công việc nhận thưởng và vi phạm phải có số tiền lớn hơn 0 đồng.', 'info')
    }
    if (form.effectiveFrom && form.effectiveTo && form.effectiveFrom > form.effectiveTo) {
      return app.notify?.('Ngày bắt đầu không được sau ngày kết thúc.', 'info')
    }
    setSaving(true)
    try {
      const selectedShift = applicableShifts.find((shift) => String(shift.id) === form.shiftId)
      const payload = {
        targetGroup: form.targetGroup,
        kind: form.kind,
        storeId: form.targetGroup === WORK_CATALOG_TARGET.STORE ? form.storeId || null : null,
        shiftId: form.targetGroup === WORK_CATALOG_TARGET.STORE ? form.shiftId || null : null,
        shiftName: selectedShift?.name || null,
        name: form.name.trim(),
        amountVnd,
        sortOrder: Number(form.sortOrder || 0),
        effectiveFrom: form.effectiveFrom || null,
        effectiveTo: form.effectiveTo || null,
      }
      const result = editing?.id
        ? await app.updateWorkCatalogItem?.({ ...payload, id: editing.id, expectedVersion: editing.version })
        : await app.createWorkCatalogItem?.({ ...payload, code: makeCode(form.kind) })
      if (result?.ok !== false) closeEditor()
    } catch (error) {
      app.notify?.(error.message || 'Không thể lưu danh mục.', 'info')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async () => {
    if (!confirming) return
    setSaving(true)
    try {
      const result = itemIsActive(confirming)
        ? await app.deleteWorkCatalogItem?.({ id: confirming.id, expectedVersion: confirming.version, reason: 'Ngừng sử dụng từ màn hình danh mục công việc' })
        : await app.restoreWorkCatalogItem?.({ id: confirming.id, expectedVersion: confirming.version })
      if (result?.ok !== false) setConfirming(null)
    } catch (error) {
      app.notify?.(error.message || 'Không thể thay đổi trạng thái danh mục.', 'info')
    } finally {
      setSaving(false)
    }
  }

  return <div className="page work-catalog-settings-page">
    <PageHeader
      title="DANH MỤC CÔNG VIỆC VÀ VI PHẠM"
      subtitle="Admin và Nhân viên hỗ trợ KD quản lý danh sách dùng chung; lịch sử đã phát sinh luôn giữ nguyên bản chụp."
      icon={ClipboardList}
      actions={<Button icon={Plus} onClick={openCreate}>THÊM DANH MỤC</Button>}
    />
    <Card title="Bộ lọc danh mục">
      <div className="work-catalog-filters">
        <Input icon={Search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên công việc, vi phạm..." aria-label="Tìm danh mục" />
        <Select value={target} onChange={(event) => { setTarget(event.target.value); setStoreId('all') }} aria-label="Nhóm nhân viên">
          <option value="all">Tất cả nhóm nhân viên</option>
          {Object.entries(TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Loại danh mục">
          <option value="all">Tất cả loại</option>
          {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={storeId} onChange={(event) => setStoreId(event.target.value)} aria-label="Cửa hàng" disabled={!['all', WORK_CATALOG_TARGET.STORE].includes(target)}>
          <option value="all">Tất cả cửa hàng</option>
          {stores.map((store) => <option key={storeKey(store)} value={storeKey(store)}>{store.name}</option>)}
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Trạng thái">
          <option value="active">Đang sử dụng</option>
          <option value="inactive">Đã ngừng sử dụng</option>
          <option value="all">Tất cả trạng thái</option>
        </Select>
      </div>
    </Card>
    <Card title="Danh sách cấu hình" action={<Badge tone="blue">{filtered.length} mục</Badge>}>
      <InfoNote>Danh sách đang hoạt động được chụp vào từng ca. Việc sửa hoặc ngừng sử dụng không làm thay đổi công việc, thưởng hoặc vi phạm đã phát sinh trước đó.</InfoNote>
      {filtered.length ? <TableWrap>
        <thead><tr><th>Nhóm / Cửa hàng</th><th>Loại</th><th>Tên</th><th>Số tiền</th><th>Ca áp dụng</th><th>Hiệu lực</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>{filtered.map((item) => <tr key={itemKey(item)}>
          <td><strong>{TARGET_LABELS[item.targetGroup]}</strong><small className="table-note">{item.storeId ? stores.find((store) => storeKey(store) === item.storeId)?.name || item.storeId : 'Toàn bộ nhóm'}</small></td>
          <td><Badge tone={item.kind === WORK_CATALOG_KIND.VIOLATION ? 'red' : item.kind === WORK_CATALOG_KIND.REWARD_TASK ? 'orange' : 'blue'}>{KIND_LABELS[item.kind]}</Badge></td>
          <td><strong>{item.name}</strong><small className="table-note">Thứ tự {item.sortOrder}</small></td>
          <td><strong className={item.kind === WORK_CATALOG_KIND.VIOLATION ? 'red-text' : item.kind === WORK_CATALOG_KIND.REWARD_TASK ? 'green-text' : ''}>{item.amountVnd ? money(item.amountVnd) : 'Không áp dụng'}</strong></td>
          <td>{item.shiftName || item.shiftId || 'Tất cả ca'}</td>
          <td>{item.effectiveFrom || item.effectiveTo ? `${item.effectiveFrom || 'Từ đầu'} → ${item.effectiveTo || 'Không giới hạn'}` : 'Không giới hạn'}</td>
          <td><Badge tone={itemIsActive(item) ? 'green' : 'orange'}>{itemIsActive(item) ? 'Đang sử dụng' : 'Đã ngừng'}</Badge><small className="table-note">{shortDateTime24(item.updatedAt || item.createdAt)}</small></td>
          <td><div className="row-actions"><Button variant="outline" icon={Edit3} disabled={!itemIsActive(item)} onClick={() => openEdit(item)}>Sửa</Button><Button variant={itemIsActive(item) ? 'danger' : 'outline'} icon={itemIsActive(item) ? Trash2 : RefreshCcw} onClick={() => setConfirming(item)}>{itemIsActive(item) ? 'Ngừng dùng' : 'Khôi phục'}</Button></div></td>
        </tr>)}</tbody>
      </TableWrap> : <EmptyState icon={ClipboardList} title="Chưa có danh mục phù hợp" description="Thêm danh mục mới hoặc thay đổi bộ lọc." />}
    </Card>

    <Modal open={Boolean(editing)} onClose={closeEditor} title={editing?.id ? 'Sửa danh mục' : 'Thêm danh mục'} footer={<><Button variant="outline" onClick={closeEditor}>Hủy</Button><Button icon={Save} loading={saving} disabled={saving || app.apiStatus === 'error'} onClick={save}>LƯU</Button></>}>
      <div className="form-grid">
        <Field label="Nhóm nhân viên" required><Select value={form.targetGroup} disabled={Boolean(editing?.id)} onChange={(event) => setForm((current) => ({ ...current, targetGroup: event.target.value, storeId: '', shiftId: '' }))}>{Object.entries(TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        <Field label="Loại danh mục" required><Select value={form.kind} disabled={Boolean(editing?.id)} onChange={update('kind')}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        {form.targetGroup === WORK_CATALOG_TARGET.STORE && <>
          <Field label="Cửa hàng" hint="Để trống nếu áp dụng cho mọi cửa hàng"><Select value={form.storeId} onChange={(event) => setForm((current) => ({ ...current, storeId: event.target.value, shiftId: '' }))}><option value="">Mọi cửa hàng</option>{stores.map((store) => <option key={storeKey(store)} value={storeKey(store)}>{store.name}</option>)}</Select></Field>
          <Field label="Ca làm việc" hint="Để trống nếu áp dụng cho mọi ca"><Select value={form.shiftId} onChange={update('shiftId')}><option value="">Mọi ca</option>{applicableShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.start || shift.startTime || '--:--'}–{shift.end || shift.endTime || '--:--'}</option>)}</Select></Field>
        </>}
        <Field label="Tên hiển thị" required className="span-2"><Input value={form.name} maxLength="300" onChange={update('name')} placeholder="Nhập tên công việc hoặc vi phạm" /></Field>
        <Field label="Số tiền" required={form.kind !== WORK_CATALOG_KIND.FIXED_TASK} hint={form.kind === WORK_CATALOG_KIND.FIXED_TASK ? 'Có thể để 0 đồng' : form.kind === WORK_CATALOG_KIND.REWARD_TASK ? 'Tiền thưởng khi hoàn thành' : 'Tiền vi phạm'}><MoneyInput value={form.amountVnd} onChange={update('amountVnd')} placeholder="Nhập đúng số tiền bằng đồng" /></Field>
        <Field label="Thứ tự"><Input type="number" min="0" step="1" value={form.sortOrder} onChange={update('sortOrder')} /></Field>
        <Field label="Hiệu lực từ"><Input type="date" value={form.effectiveFrom} onChange={update('effectiveFrom')} /></Field>
        <Field label="Hiệu lực đến"><Input type="date" value={form.effectiveTo} min={form.effectiveFrom || today()} onChange={update('effectiveTo')} /></Field>
      </div>
    </Modal>

    <Modal open={Boolean(confirming)} onClose={() => !saving && setConfirming(null)} title={itemIsActive(confirming || {}) ? 'Ngừng sử dụng danh mục' : 'Khôi phục danh mục'} footer={<><Button variant="outline" onClick={() => setConfirming(null)}>Hủy</Button><Button variant={itemIsActive(confirming || {}) ? 'danger' : 'primary'} loading={saving} onClick={changeStatus}>{itemIsActive(confirming || {}) ? 'NGỪNG SỬ DỤNG' : 'KHÔI PHỤC'}</Button></>}>
      <p>{itemIsActive(confirming || {}) ? <>Mục <strong>{confirming?.name}</strong> sẽ không xuất hiện trong ca mới. Toàn bộ lịch sử cũ vẫn được giữ nguyên.</> : <>Mục <strong>{confirming?.name}</strong> sẽ được sử dụng lại theo thời gian hiệu lực đã cài đặt.</>}</p>
    </Modal>
  </div>
}

export default WorkCatalogSettingsPage
