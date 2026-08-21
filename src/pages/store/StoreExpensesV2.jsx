import { useMemo, useState } from 'react'
import { Edit3, Plus, ReceiptText, Save, Trash2, WalletCards } from 'lucide-react'
import {
  Button,
  Card,
  Field,
  InfoNote,
  Input,
  MoneyInput,
  MetricCard,
  Modal,
  PageHeader,
  Select,
  TableWrap,
} from '../../components/UI'
import { useApp } from '../../state/AppContext'
import { money, shortDateTime24 } from '../../utils'
import './StoreExpensesV2.css'

const STORE_EXPENSE_CATEGORIES = ['Set up', 'Mặt bằng', 'Điện', 'Nước', 'Wifi', 'Marketing', 'Rác', 'Khác']

const parseMoney = (value) => Number(String(value ?? '').replace(/\D/g, '')) || 0
const moneyInput = (value) => value === '' ? '' : new Intl.NumberFormat('en-US').format(parseMoney(value))
const localDateTimeValue = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
const toOccurredAt = (value) => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}
const emptyLine = (category = 'Điện') => ({ category, name: '', amount: '', description: '' })
const newExpenseForm = () => ({ occurredAt: localDateTimeValue(), note: '', reason: '', items: [emptyLine()] })
const expenseItems = (expense = {}) => {
  if (Array.isArray(expense.items) && expense.items.length) {
    return expense.items.map((item) => ({
      category: item.category || item.type || 'Khác',
      name: item.name || '',
      amount: Number(item.amount || 0),
      description: item.description || '',
    }))
  }
  const legacyCategory = expense.type === 'Wi-Fi'
    ? 'Wifi'
    : expense.type === 'Chi phí thiết lập cửa hàng'
      ? 'Set up'
      : expense.type === 'Chi phí khác'
        ? 'Khác'
        : STORE_EXPENSE_CATEGORIES.includes(expense.type) ? expense.type : 'Khác'
  return [{
    category: legacyCategory,
    name: legacyCategory === 'Khác' ? expense.type || 'Khoản chi khác' : '',
    amount: Number(expense.totalAmount ?? expense.amount ?? 0),
    description: expense.description || expense.note || '',
  }]
}
const expenseTotal = (expense = {}) => Number(expense.totalAmount ?? expense.amount)
  || expenseItems(expense).reduce((total, item) => total + Number(item.amount || 0), 0)
const actorName = (actor) => typeof actor === 'string' ? actor : actor?.name || actor?.displayName || actor?.username || actor?.id || 'Hệ thống'
const normalizedRole = (role) => role === 'manager' ? 'business_support' : role

const useStoreExpenseData = () => {
  const app = useApp()
  const role = normalizedRole(app.session?.role)
  const storeId = role === 'store_manager'
    ? app.session?.storeId
    : app.activeStore?.id || app.activeStoreId || app.session?.storeId
  const store = app.stores?.find((item) => String(item.id) === String(storeId)) || app.activeStore
  return { ...app, role, storeId, store }
}

export function StoreExpensesV2() {
  const app = useStoreExpenseData()
  const {
    role,
    storeId,
    store,
    fixedExpenses = [],
    addFixedExpense,
    updateFixedExpense,
    deleteFixedExpense,
    notify,
  } = app
  const canManage = ['admin', 'business_support', 'store_manager'].includes(role)
  const canDelete = role === 'admin'
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(newExpenseForm)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')

  const vouchers = useMemo(() => fixedExpenses
    .filter((expense) => !expense.deletedAt && String(expense.storeId || '') === String(storeId || ''))
    .sort((left, right) => String(right.occurredAt || right.createdAt || '').localeCompare(String(left.occurredAt || left.createdAt || ''))), [fixedExpenses, storeId])
  const totals = useMemo(() => vouchers.reduce((summary, expense) => ({
    vouchers: summary.vouchers + 1,
    items: summary.items + expenseItems(expense).length,
    amount: summary.amount + expenseTotal(expense),
  }), { vouchers: 0, items: 0, amount: 0 }), [vouchers])
  const formTotal = form.items.reduce((total, item) => total + parseMoney(item.amount), 0)

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    setForm(newExpenseForm())
  }
  const openCreate = () => {
    if (!canManage) return
    setEditing(null)
    setForm(newExpenseForm())
    setModalOpen(true)
  }
  const openEdit = (expense) => {
    if (!canManage) return
    setEditing(expense)
    setForm({
      occurredAt: localDateTimeValue(expense.occurredAt || expense.createdAt),
      note: expense.note || '',
      reason: '',
      items: expenseItems(expense).map((item) => ({ ...item, amount: moneyInput(item.amount) })),
    })
    setModalOpen(true)
  }
  const updateLine = (index, updates) => setForm((current) => ({
    ...current,
    items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...updates } : item),
  }))
  const removeLine = (index) => setForm((current) => ({
    ...current,
    items: current.items.length === 1 ? current.items : current.items.filter((_, itemIndex) => itemIndex !== index),
  }))
  const addCustomLine = () => setForm((current) => ({ ...current, items: [...current.items, emptyLine('Khác')] }))

  const save = async () => {
    if (!canManage) return
    const items = form.items.map((item) => ({
      category: item.category,
      name: String(item.name || '').trim(),
      amount: parseMoney(item.amount),
      description: String(item.description || '').trim(),
    }))
    if (!items.length || items.some((item) => item.amount <= 0)) return notify('Mỗi khoản chi phải có số tiền lớn hơn 0.', 'info')
    if (items.some((item) => item.category === 'Khác' && !item.name)) return notify('Vui lòng nhập tên cho khoản chi Khác.', 'info')
    if (items.some((item) => item.category === 'Khác' && !item.description)) return notify('Vui lòng nhập mô tả cho khoản chi Khác.', 'info')
    if (editing && !form.reason.trim()) return notify('Vui lòng nhập lý do chỉnh sửa.', 'info')
    const payload = { storeId, occurredAt: toOccurredAt(form.occurredAt), note: form.note.trim(), items }
    const result = editing
      ? await updateFixedExpense(editing.id, { ...payload, reason: form.reason.trim() })
      : await addFixedExpense(payload)
    if (!result?.ok) return notify(result?.message || 'Không thể lưu phiếu chi.', 'info')
    closeModal()
  }

  const confirmDelete = async () => {
    if (!canDelete || !deleteTarget) return
    if (!deleteReason.trim()) return notify('Vui lòng nhập lý do xóa.', 'info')
    const result = await deleteFixedExpense(deleteTarget.id, deleteReason.trim())
    if (!result?.ok) return notify(result?.message || 'Không thể xóa phiếu chi.', 'info')
    setDeleteTarget(null)
    setDeleteReason('')
  }

  return (
    <div className="page store-expenses-page">
      <PageHeader
        title="CHI PHÍ CỬA HÀNG"
        subtitle={`Lập phiếu và theo dõi chi phí phát sinh tại ${store?.name || 'cửa hàng đang chọn'}.`}
        icon={ReceiptText}
        actions={canManage ? <Button icon={Plus} onClick={openCreate}>TẠO PHIẾU CHI</Button> : null}
      />
      <div className="metrics-grid metrics-grid--3" aria-label="Tổng quan chi phí cửa hàng">
        <MetricCard label="SỐ PHIẾU CHI" value={totals.vouchers} suffix="phiếu" icon={ReceiptText} tone="blue" />
        <MetricCard label="SỐ KHOẢN CHI" value={totals.items} suffix="khoản" icon={WalletCards} tone="orange" />
        <MetricCard label="TỔNG CHI PHÍ" value={money(totals.amount)} icon={WalletCards} tone="green" />
      </div>
      <InfoNote>Mỗi phiếu chi được tính vào chi phí của đúng cửa hàng đang mở. Admin, Hỗ trợ KD và Quản lý cửa hàng được tạo/sửa; chỉ Admin được xóa.</InfoNote>
      <Card title="Lịch sử phiếu chi">
        <TableWrap>
          <thead><tr><th>Thời gian</th><th>Các khoản chi</th><th>Người tạo</th><th>Ghi chú</th><th>Tổng tiền</th>{canManage && <th>Thao tác</th>}</tr></thead>
          <tbody>{vouchers.map((expense) => (
            <tr key={expense.id}>
              <td><strong>{shortDateTime24(expense.occurredAt || expense.createdAt)}</strong>{expense.updatedAt && <small className="table-note">Sửa {shortDateTime24(expense.updatedAt)}</small>}</td>
              <td><ul className="store-expense-items">{expenseItems(expense).map((item, index) => <li key={`${expense.id}-${index}`}><span>{item.name || item.category}<small>{item.category === 'Khác' && item.description ? item.description : item.category}</small></span><strong>{money(item.amount)}</strong></li>)}</ul></td>
              <td>{actorName(expense.createdBy)}</td>
              <td>{expense.note || '—'}</td>
              <td><strong className="store-expense-total">{money(expenseTotal(expense))}</strong></td>
              {canManage && <td><div className="row-actions"><button type="button" onClick={() => openEdit(expense)} aria-label={`Sửa phiếu chi ${expense.id}`}><Edit3 /></button>{canDelete && <button type="button" className="danger" onClick={() => { setDeleteTarget(expense); setDeleteReason('') }} aria-label={`Xóa phiếu chi ${expense.id}`}><Trash2 /></button>}</div></td>}
            </tr>
          ))}{!vouchers.length && <tr><td colSpan={canManage ? 6 : 5}>Chưa có phiếu chi nào tại cửa hàng này.</td></tr>}</tbody>
        </TableWrap>
      </Card>

      {canManage && <Modal wide open={modalOpen} onClose={closeModal} title={editing ? 'Sửa phiếu chi cửa hàng' : 'Tạo phiếu chi cửa hàng'} footer={<><Button variant="outline" onClick={closeModal}>Hủy</Button><Button icon={Save} onClick={save}>{editing ? 'CẬP NHẬT' : 'LƯU PHIẾU'}</Button></>}>
        <div className="store-expense-form">
          <div className="form-grid store-expense-form__header">
            <Field label="Thời gian phát sinh" required><Input type="datetime-local" value={form.occurredAt} onChange={(event) => setForm({ ...form, occurredAt: event.target.value })} /></Field>
            <Field label="Ghi chú phiếu"><textarea rows="2" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Thông tin chung của phiếu" /></Field>
          </div>
          <div className="store-expense-lines" aria-label="Danh sách khoản chi">
            {form.items.map((item, index) => <div className="store-expense-line" role="group" aria-label={`Khoản chi ${index + 1}`} key={index}>
              <span className="store-expense-line__index">{index + 1}</span>
              <Field label="Danh mục" required><Select value={item.category} onChange={(event) => updateLine(index, { category: event.target.value, ...(event.target.value !== 'Khác' ? { name: '', description: '' } : {}) })}>{STORE_EXPENSE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field>
              {item.category === 'Khác' && <Field label="Tên khoản chi" required><Input value={item.name} onChange={(event) => updateLine(index, { name: event.target.value })} placeholder="Ví dụ: Sửa bảng hiệu" /></Field>}
              <Field label="Số tiền" required><MoneyInput value={item.amount} onChange={(event) => updateLine(index, { amount: event.target.value })} placeholder="Nhập số nghìn" /></Field>
              {item.category === 'Khác' && <Field label="Mô tả" required><Input value={item.description} onChange={(event) => updateLine(index, { description: event.target.value })} placeholder="Mô tả bắt buộc" /></Field>}
              <button type="button" className="store-expense-line__remove" onClick={() => removeLine(index)} disabled={form.items.length === 1} aria-label={`Xóa khoản chi ${index + 1}`}><Trash2 size={18} /></button>
            </div>)}
          </div>
          <div className="store-expense-form__summary"><Button type="button" variant="outline" icon={Plus} onClick={addCustomLine}>THÊM KHOẢN CHI KHÁC</Button><p><span>Tổng phiếu</span><strong>{money(formTotal)}</strong></p></div>
          {editing && <Field label="Lý do chỉnh sửa" required><Input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Bắt buộc để lưu lịch sử chỉnh sửa" /></Field>}
        </div>
      </Modal>}

      {canDelete && <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Xóa phiếu chi" footer={<><Button variant="outline" onClick={() => setDeleteTarget(null)}>Hủy</Button><Button variant="danger" icon={Trash2} onClick={confirmDelete}>XÓA PHIẾU</Button></>}>
        <InfoNote>Phiếu chi sẽ bị loại khỏi chi phí cửa hàng. Thao tác được lưu trong lịch sử kiểm toán.</InfoNote>
        <Field label="Lý do xóa" required><Input value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="Nhập lý do xóa phiếu" /></Field>
      </Modal>}
    </div>
  )
}

export default StoreExpensesV2
