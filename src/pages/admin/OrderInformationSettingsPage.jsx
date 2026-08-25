import { useMemo, useState } from 'react'
import './OrderInformationSettingsPage.css'
import {
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  Edit3,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InfoNote,
  Input,
  Modal,
  PageHeader,
  Select,
  TableWrap,
} from '../../components/UI'
import {
  normalizeOrderInformationOptions,
  ORDER_PAYMENT_METHODS,
  validateOrderInformationOptionInput,
} from '../../domain/orderInformationSettings'
import { useApp } from '../../state/AppContext'
import { shortDateTime24 } from '../../utils'

const EMPTY_FORM = Object.freeze({ label: '', code: '', active: true })

const nextOccupationCode = (options = []) => {
  const numbers = options.map((option) => Number(String(option.code || '').match(/(\d+)$/u)?.[1] || 0))
  return `OCC-${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`
}

export function OrderInformationSettingsPage() {
  const {
    apiStatus,
    orderInformationOptions = [],
    createOrderInformationOption,
    updateOrderInformationOption,
    deleteOrderInformationOption,
    restoreOrderInformationOption,
    reorderOrderInformationOptions,
    notify,
  } = useApp()
  const options = useMemo(() => normalizeOrderInformationOptions(orderInformationOptions), [orderInformationOptions])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
  const filtered = options.filter((option) => (
    (!normalizedQuery || `${option.label} ${option.code}`.toLocaleLowerCase('vi-VN').includes(normalizedQuery))
    && (status === 'all' || (status === 'active' ? option.active : !option.active))
  ))

  const openCreate = () => {
    setEditing({ id: '' })
    setForm({ ...EMPTY_FORM, code: nextOccupationCode(options) })
  }

  const openEdit = (option) => {
    setEditing(option)
    setForm({ label: option.label, code: option.code, active: option.active })
  }

  const closeEditor = () => {
    if (saving) return
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  const save = async () => {
    const message = validateOrderInformationOptionInput(form, options, { currentId: editing?.id })
    if (message) {
      notify?.(message, 'info')
      return
    }
    setSaving(true)
    try {
      const result = editing?.id
        ? await updateOrderInformationOption?.(editing.id, form)
        : await createOrderInformationOption?.(form)
      if (result?.ok) closeEditor()
    } finally {
      setSaving(false)
    }
  }

  const confirmStatusChange = async () => {
    if (!confirming) return
    setSaving(true)
    try {
      const result = confirming.active
        ? await deleteOrderInformationOption?.(confirming.id, 'Ngừng sử dụng trong đơn hàng mới')
        : await restoreOrderInformationOption?.(confirming.id)
      if (result?.ok) setConfirming(null)
    } finally {
      setSaving(false)
    }
  }

  const move = async (option, offset) => {
    const index = options.findIndex((candidate) => candidate.id === option.id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= options.length) return
    const orderedIds = options.map(({ id }) => id)
    ;[orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]]
    await reorderOrderInformationOptions?.(orderedIds)
  }

  return (
    <div className="page order-information-settings-page">
      <PageHeader
        title="CÀI ĐẶT THÔNG TIN ĐƠN HÀNG"
        subtitle="Quản lý nguồn lựa chọn dùng chung cho đơn hàng trên toàn hệ thống."
        icon={Settings2}
        actions={<Button icon={Plus} onClick={openCreate}>THÊM NGHỀ NGHIỆP</Button>}
      />

      {apiStatus === 'error' && <InfoNote tone="red">Không thể đồng bộ cấu hình từ máy chủ. Vui lòng tải lại trước khi thay đổi dữ liệu.</InfoNote>}

      <Card title="Hình thức thanh toán" action={<Badge tone="blue">Trường hệ thống</Badge>}>
        <InfoNote icon={ShieldCheck}>Hai lựa chọn cốt lõi được bảo vệ để không làm sai báo cáo, đối soát và lịch sử đơn hàng.</InfoNote>
        <div className="order-information-payment-list">
          {ORDER_PAYMENT_METHODS.map((method, index) => (
            <div key={method}><strong>{method}</strong><span>PAY-{String(index + 1).padStart(3, '0')}</span><Badge tone="green">Đang hoạt động</Badge></div>
          ))}
        </div>
      </Card>

      <Card title="Công việc / Nghề nghiệp">
        <div className="section-heading order-information-filters">
          <Input icon={Search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên hoặc mã..." aria-label="Tìm nghề nghiệp" />
          <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Lọc trạng thái">
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Đang hoạt động</option>
            <option value="inactive">Đã vô hiệu hóa</option>
          </Select>
        </div>
        {filtered.length ? <TableWrap>
          <thead><tr><th>Thứ tự</th><th>Tên hiển thị</th><th>Mã ổn định</th><th>Trạng thái</th><th>Cập nhật</th><th>Thao tác</th></tr></thead>
          <tbody>{filtered.map((option) => {
            const absoluteIndex = options.findIndex((candidate) => candidate.id === option.id)
            return <tr key={option.id}>
              <td><div className="row-actions"><Button variant="outline" icon={ArrowUp} aria-label={`Đưa ${option.label} lên`} disabled={absoluteIndex === 0} onClick={() => move(option, -1)} /><Button variant="outline" icon={ArrowDown} aria-label={`Đưa ${option.label} xuống`} disabled={absoluteIndex === options.length - 1} onClick={() => move(option, 1)} /></div></td>
              <td><strong>{option.label}</strong><small className="table-note">Dùng cho đơn hàng mới</small></td>
              <td>{option.code}</td>
              <td><Badge tone={option.active ? 'green' : 'orange'}>{option.active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</Badge></td>
              <td>{shortDateTime24(option.updatedAt || option.createdAt)}</td>
              <td><div className="row-actions"><Button variant="outline" icon={Edit3} onClick={() => openEdit(option)}>Sửa</Button><Button variant={option.active ? 'danger' : 'outline'} icon={option.active ? Trash2 : RefreshCcw} onClick={() => setConfirming(option)}>{option.active ? 'Vô hiệu hóa' : 'Khôi phục'}</Button></div></td>
            </tr>
          })}</tbody>
        </TableWrap> : <EmptyState icon={BriefcaseBusiness} title="Không có nghề nghiệp phù hợp" description="Thay đổi bộ lọc hoặc thêm một lựa chọn mới." />}
      </Card>

      <Modal open={Boolean(editing)} onClose={closeEditor} title={editing?.id ? 'Sửa nghề nghiệp' : 'Thêm nghề nghiệp'} footer={<><Button variant="outline" onClick={closeEditor}>Hủy</Button><Button icon={Save} loading={saving} disabled={saving || apiStatus === 'error'} onClick={save}>LƯU</Button></>}>
        <div className="form-grid">
          <Field label="Tên hiển thị" required><Input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} maxLength={120} /></Field>
          <Field label="Mã ổn định" required hint="2–40 ký tự in hoa, số, gạch ngang hoặc gạch dưới."><Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} maxLength={40} /></Field>
        </div>
      </Modal>

      <Modal open={Boolean(confirming)} onClose={() => !saving && setConfirming(null)} title={confirming?.active ? 'Xác nhận vô hiệu hóa' : 'Khôi phục nghề nghiệp'} footer={<><Button variant="outline" onClick={() => setConfirming(null)}>Hủy</Button><Button variant={confirming?.active ? 'danger' : 'primary'} loading={saving} onClick={confirmStatusChange}>{confirming?.active ? 'VÔ HIỆU HÓA' : 'KHÔI PHỤC'}</Button></>}>
        <p>{confirming?.active
          ? <>Nghề nghiệp <strong>{confirming?.label}</strong> sẽ không còn xuất hiện trong đơn hàng mới. Đơn hàng cũ vẫn giữ nguyên lịch sử.</>
          : <>Nghề nghiệp <strong>{confirming?.label}</strong> sẽ xuất hiện lại trong đơn hàng mới.</>}</p>
      </Modal>
    </div>
  )
}

export default OrderInformationSettingsPage
