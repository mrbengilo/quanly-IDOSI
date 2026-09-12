import { useMemo, useState } from 'react'
import './OrderInformationSettingsPage.css'
import {
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  Edit3,
  Plus,
  PackageOpen,
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
  ORDER_CUSTOM_FIELD_TYPE,
  ORDER_INFORMATION_KIND,
  ORDER_PAYMENT_METHODS,
  validateOrderInformationOptionInput,
} from '../../domain/orderInformationSettings'
import { useApp } from '../../state/AppContext'
import { shortDateTime24 } from '../../utils'

const EMPTY_FORM = Object.freeze({
  kind: ORDER_INFORMATION_KIND.OCCUPATION,
  label: '',
  code: '',
  active: true,
  fieldType: ORDER_CUSTOM_FIELD_TYPE.TEXT,
  required: false,
  choicesText: '',
})

const nextOptionCode = (options = [], kind = ORDER_INFORMATION_KIND.OCCUPATION) => {
  const prefix = kind === ORDER_INFORMATION_KIND.PRODUCT
    ? 'PRD'
    : kind === ORDER_INFORMATION_KIND.CUSTOM_FIELD ? 'ATTR' : 'OCC'
  const numbers = options.map((option) => Number(String(option.code || '').match(/(\d+)$/u)?.[1] || 0))
  return `${prefix}-${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`
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
  const [kind, setKind] = useState(ORDER_INFORMATION_KIND.OCCUPATION)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
  const categoryOptions = options.filter((option) => option.kind === kind)
  const isProduct = kind === ORDER_INFORMATION_KIND.PRODUCT
  const isCustomField = kind === ORDER_INFORMATION_KIND.CUSTOM_FIELD
  const categoryName = isProduct ? 'mặt hàng' : isCustomField ? 'thuộc tính' : 'nghề nghiệp'
  const filtered = categoryOptions.filter((option) => (
    (!normalizedQuery || `${option.label} ${option.code}`.toLocaleLowerCase('vi-VN').includes(normalizedQuery))
    && (status === 'all' || (status === 'active' ? option.active : !option.active))
  ))

  const openCreate = () => {
    setEditing({ id: '' })
    setForm({ ...EMPTY_FORM, kind, code: nextOptionCode(categoryOptions, kind) })
  }

  const openEdit = (option) => {
    setEditing(option)
    setForm({
      kind: option.kind,
      label: option.label,
      code: option.code,
      active: option.active,
      fieldType: option.fieldType || ORDER_CUSTOM_FIELD_TYPE.TEXT,
      required: option.required === true,
      choicesText: Array.isArray(option.choices) ? option.choices.join(', ') : '',
    })
  }

  const closeEditor = () => {
    if (saving) return
    setEditing(null)
    setForm({ ...EMPTY_FORM, kind })
  }

  const save = async () => {
    const payload = {
      ...form,
      kind,
      choices: form.choicesText.split(/[,\n]/u).map((choice) => choice.trim()).filter(Boolean),
    }
    delete payload.choicesText
    const message = validateOrderInformationOptionInput(payload, options, { currentId: editing?.id })
    if (message) {
      notify?.(message, 'info')
      return
    }
    setSaving(true)
    try {
      const result = editing?.id
        ? await updateOrderInformationOption?.(editing.id, payload)
        : await createOrderInformationOption?.(payload)
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
        ? await deleteOrderInformationOption?.(confirming.id, `Ngừng sử dụng ${categoryName} trong đơn hàng mới`)
        : await restoreOrderInformationOption?.(confirming.id)
      if (result?.ok) setConfirming(null)
    } finally {
      setSaving(false)
    }
  }

  const move = async (option, offset) => {
    const index = categoryOptions.findIndex((candidate) => candidate.id === option.id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= categoryOptions.length) return
    const orderedIds = categoryOptions.map(({ id }) => id)
    ;[orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]]
    await reorderOrderInformationOptions?.(orderedIds, kind)
  }

  return (
    <div className="page order-information-settings-page">
      <PageHeader
        title="CÀI ĐẶT THÔNG TIN ĐƠN HÀNG"
        subtitle="Quản lý nguồn lựa chọn dùng chung cho đơn hàng trên toàn hệ thống."
        icon={Settings2}
        actions={<Button icon={Plus} onClick={openCreate}>THÊM {isProduct ? 'MẶT HÀNG' : isCustomField ? 'THUỘC TÍNH' : 'NGHỀ NGHIỆP'}</Button>}
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

      <Card title="Danh mục lựa chọn đơn hàng">
        <div className="section-heading order-information-filters">
          <Select value={kind} onChange={(event) => {
            setKind(event.target.value)
            setQuery('')
            setStatus('all')
          }} aria-label="Loại danh mục">
            <option value={ORDER_INFORMATION_KIND.OCCUPATION}>Nghề nghiệp khách hàng</option>
            <option value={ORDER_INFORMATION_KIND.PRODUCT}>Mặt hàng bán</option>
            <option value={ORDER_INFORMATION_KIND.CUSTOM_FIELD}>Thuộc tính bổ sung</option>
          </Select>
          <Input icon={Search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên hoặc mã..." aria-label={`Tìm ${categoryName}`} />
          <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Lọc trạng thái">
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Đang hoạt động</option>
            <option value="inactive">Đã vô hiệu hóa</option>
          </Select>
        </div>
        {filtered.length ? <TableWrap>
          <thead><tr><th>Thứ tự</th><th>Tên hiển thị</th><th>Mã ổn định</th><th>Trạng thái</th><th>Cập nhật</th><th>Thao tác</th></tr></thead>
          <tbody>{filtered.map((option) => {
            const absoluteIndex = categoryOptions.findIndex((candidate) => candidate.id === option.id)
            return <tr key={option.id}>
              <td><div className="row-actions"><Button variant="outline" icon={ArrowUp} aria-label={`Đưa ${option.label} lên`} disabled={absoluteIndex === 0} onClick={() => move(option, -1)} /><Button variant="outline" icon={ArrowDown} aria-label={`Đưa ${option.label} xuống`} disabled={absoluteIndex === categoryOptions.length - 1} onClick={() => move(option, 1)} /></div></td>
              <td><strong>{option.label}</strong><small className="table-note">{option.kind === ORDER_INFORMATION_KIND.CUSTOM_FIELD
                ? `${option.fieldType === ORDER_CUSTOM_FIELD_TYPE.TEXT ? 'Văn bản' : option.fieldType === ORDER_CUSTOM_FIELD_TYPE.NUMBER ? 'Số' : option.fieldType === ORDER_CUSTOM_FIELD_TYPE.SELECT ? 'Danh sách' : option.fieldType === ORDER_CUSTOM_FIELD_TYPE.BOOLEAN ? 'Có / Không' : 'Ngày'}${option.required ? ' • bắt buộc' : ' • không bắt buộc'}`
                : 'Dùng cho đơn hàng mới'}</small></td>
              <td>{option.code}</td>
              <td><Badge tone={option.active ? 'green' : 'orange'}>{option.active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</Badge></td>
              <td>{shortDateTime24(option.updatedAt || option.createdAt)}</td>
              <td><div className="row-actions"><Button variant="outline" icon={Edit3} onClick={() => openEdit(option)}>Sửa</Button><Button variant={option.active ? 'danger' : 'outline'} icon={option.active ? Trash2 : RefreshCcw} onClick={() => setConfirming(option)}>{option.active ? 'Vô hiệu hóa' : 'Khôi phục'}</Button></div></td>
            </tr>
          })}</tbody>
        </TableWrap> : <EmptyState icon={isProduct ? PackageOpen : isCustomField ? Settings2 : BriefcaseBusiness} title={`Không có ${categoryName} phù hợp`} description="Thay đổi bộ lọc hoặc thêm một lựa chọn mới." />}
      </Card>

      <Modal open={Boolean(editing)} onClose={closeEditor} title={`${editing?.id ? 'Sửa' : 'Thêm'} ${categoryName}`} footer={<><Button variant="outline" onClick={closeEditor}>Hủy</Button><Button icon={Save} loading={saving} disabled={saving || apiStatus === 'error'} onClick={save}>LƯU</Button></>}>
        <div className="form-grid">
          <Field label="Tên hiển thị" required><Input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} maxLength={120} /></Field>
          <Field label="Mã ổn định" required hint="2–40 ký tự in hoa, số, gạch ngang hoặc gạch dưới."><Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} maxLength={40} /></Field>
          {isCustomField && <>
            <Field label="Kiểu dữ liệu" required><Select value={form.fieldType} onChange={(event) => setForm((current) => ({ ...current, fieldType: event.target.value }))}>
              <option value={ORDER_CUSTOM_FIELD_TYPE.TEXT}>Văn bản</option>
              <option value={ORDER_CUSTOM_FIELD_TYPE.NUMBER}>Số</option>
              <option value={ORDER_CUSTOM_FIELD_TYPE.SELECT}>Danh sách lựa chọn</option>
              <option value={ORDER_CUSTOM_FIELD_TYPE.BOOLEAN}>Có / Không</option>
              <option value={ORDER_CUSTOM_FIELD_TYPE.DATE}>Ngày</option>
            </Select></Field>
            <Field label="Quy tắc nhập"><label className="order-information-required-toggle"><input type="checkbox" checked={form.required} onChange={(event) => setForm((current) => ({ ...current, required: event.target.checked }))} /><span>Bắt buộc nhập khi tạo đơn</span></label></Field>
            {form.fieldType === ORDER_CUSTOM_FIELD_TYPE.SELECT && <Field className="span-2" label="Các lựa chọn" required hint="Phân tách bằng dấu phẩy, tối đa 50 lựa chọn."><Input value={form.choicesText} onChange={(event) => setForm((current) => ({ ...current, choicesText: event.target.value }))} placeholder="Ví dụ: S, M, L, XL" /></Field>}
          </>}
        </div>
      </Modal>

      <Modal open={Boolean(confirming)} onClose={() => !saving && setConfirming(null)} title={confirming?.active ? 'Xác nhận vô hiệu hóa' : `Khôi phục ${categoryName}`} footer={<><Button variant="outline" onClick={() => setConfirming(null)}>Hủy</Button><Button variant={confirming?.active ? 'danger' : 'primary'} loading={saving} onClick={confirmStatusChange}>{confirming?.active ? 'VÔ HIỆU HÓA' : 'KHÔI PHỤC'}</Button></>}>
        <p>{confirming?.active
          ? <><span className="text-capitalize">{categoryName}</span> <strong>{confirming?.label}</strong> sẽ không còn xuất hiện trong đơn hàng mới. Đơn hàng cũ vẫn giữ nguyên lịch sử.</>
          : <><span className="text-capitalize">{categoryName}</span> <strong>{confirming?.label}</strong> sẽ xuất hiện lại trong đơn hàng mới.</>}</p>
      </Modal>
    </div>
  )
}

export default OrderInformationSettingsPage
