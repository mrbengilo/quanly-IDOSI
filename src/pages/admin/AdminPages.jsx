import { useRef, useState } from 'react'
import {
  BadgeDollarSign,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  Eye,
  FileDown,
  Info,
  MapPin,
  Plus,
  RefreshCcw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Trash2,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  DateRange,
  DonutChart,
  ExportButton,
  Field,
  FinancialChart,
  InfoNote,
  Input,
  MetricCard,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StoreIllustration,
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { adminSeries } from '../../data'
import { financeSummaryFromState } from '../../domain'
import { useApp } from '../../state/AppContext'
import { downloadCsv, money, today, validateVietnamPhone } from '../../utils'

const sum = (items, key) => items.reduce((total, item) => total + (Number(item[key]) || 0), 0)
const percent = (value, total) => total > 0 ? `${((value / total) * 100).toFixed(2)}%` : '0.00%'
const emptyStoreForm = { name: '', location: '', address: '' }

const seriesDate = (day, year = new Date().getFullYear()) => {
  const [date, month] = String(day).split('/')
  return `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
}

const parseRange = (value = '') => {
  const dates = String(value).match(/\d{2}\/\d{2}\/\d{4}/g) || []
  if (dates.length !== 2) return null
  const toIso = (date) => date.split('/').reverse().join('-')
  return [toIso(dates[0]), toIso(dates[1])]
}

function AdminMetrics({ stores, compact = false }) {
  const revenue = sum(stores, 'revenue')
  const expense = sum(stores, 'expense')
  return (
    <div className={`metric-grid ${compact ? 'metric-grid--compact' : ''}`}>
      <MetricCard label="TỔNG DOANH THU" value={money(revenue)} icon={BadgeDollarSign} trend={12.45} helper=" so với kỳ trước" tone="green" compact={compact} />
      <MetricCard label="TỔNG CHI PHÍ" value={money(expense)} icon={ShoppingCart} trend={8.32} helper=" so với kỳ trước" tone="orange" compact={compact} />
      <MetricCard label="TỔNG LỢI NHUẬN" value={money(revenue - expense)} icon={TrendingUp} trend={16.78} helper=" so với kỳ trước" tone="blue" compact={compact} />
      {compact && <MetricCard label="TỶ LỆ LỢI NHUẬN" value={percent(revenue - expense, revenue)} icon={BarChart3} trend={2.14} helper=" so với kỳ trước" tone="teal" compact />}
    </div>
  )
}

export function AdminOverview() {
  const { stores, setActiveStoreId, session } = useApp()
  const navigate = useNavigate()
  const activeStores = stores.filter((store) => !['Tạm ngưng', 'Ngưng hoạt động', 'Ngừng hoạt động'].includes(store.status))
  const openStore = (store) => {
    if (setActiveStoreId?.(store.id) !== false) navigate('/store/overview')
  }
  return (
    <div className="page">
      <PageHeader
        title="Tổng quan"
        subtitle={`Xin chào, ${session?.name || (session?.role === 'admin' ? 'Admin' : ['manager', 'business_support'].includes(session?.role) ? 'Hỗ trợ KD' : 'Nhân viên')}! Đây là tổng quan hoạt động của tất cả cửa hàng.`}
        actions={<DateRange value={new Date().toLocaleDateString('vi-VN')} />}
      />
      <AdminMetrics stores={stores} />
      <div className="section-heading">
        <div><h2>Quản lý cửa hàng</h2><p>Chọn cửa hàng để mở không gian quản lý độc lập.</p></div>
        <div className="section-heading__actions"><Badge tone="green">{activeStores.length} cửa hàng hoạt động</Badge><Button variant="ghost" onClick={() => navigate('/admin/stores')}>Xem tất cả</Button></div>
      </div>
      <div className="store-card-grid">
        {stores.map((store) => (
          <Card key={store.id} className="store-card">
            <StoreIllustration name={store.name} accent={store.accent} />
            <div className="store-card__body">
              <div className="store-card__title"><h3>{store.name}</h3><Badge tone={!['Tạm ngưng', 'Ngưng hoạt động', 'Ngừng hoạt động'].includes(store.status) ? 'green' : 'orange'}>{!['Tạm ngưng', 'Ngưng hoạt động', 'Ngừng hoạt động'].includes(store.status) ? 'Đang hoạt động' : 'Ngưng hoạt động'}</Badge></div>
              <p><MapPin size={17} /> {store.location}</p>
              <div className="store-card__finance">
                <span><small>Doanh thu kỳ này</small><strong>{money(store.revenue)}</strong></span>
                <span><small>Lợi nhuận kỳ này</small><strong>{money(Number(store.revenue) - Number(store.expense))}</strong></span>
              </div>
              <Button onClick={() => openStore(store)}>Xem cửa hàng <span>→</span></Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function AdminStores() {
  const app = useApp()
  const { stores, addStore, updateStore, deleteStore, setActiveStoreId, notify, session } = app
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [editingStore, setEditingStore] = useState(null)
  const [viewingStore, setViewingStore] = useState(null)
  const [form, setForm] = useState(emptyStoreForm)
  const filtered = stores.filter((item) => `${item.name} ${item.location}`.toLowerCase().includes(query.toLowerCase()))
  const financeByStore = new Map(stores.map((store) => [store.id, financeSummaryFromState(app, { storeId: store.id })]))
  const revenue = [...financeByStore.values()].reduce((total, summary) => total + summary.revenue, 0)
  const expense = [...financeByStore.values()].reduce((total, summary) => total + summary.expense, 0)
  const canManageStoreDirectory = session?.role === 'admin' || ['manager', 'business_support'].includes(session?.role)
  const canDeleteStore = session?.role === 'admin'

  const setStoreStatus = async (store, active) => {
    if (!canManageStoreDirectory) return
    if (typeof updateStore !== 'function') return notify('Chức năng cập nhật cửa hàng chưa sẵn sàng.', 'info')
    try {
      const result = await updateStore(store.id, { status: active ? 'Đang hoạt động' : 'Ngưng hoạt động' })
      if (!result?.ok) notify(result?.message || 'Không thể cập nhật trạng thái cửa hàng.', 'info')
    } catch (error) {
      notify(error.message || 'Không thể cập nhật trạng thái cửa hàng.', 'info')
    }
  }

  const openCreate = () => {
    setEditingStore(null)
    setForm(emptyStoreForm)
    setOpen(true)
  }

  const openEdit = (store) => {
    setEditingStore(store)
    setForm({ name: store.name || '', location: store.location || '', address: store.address || '' })
    setOpen(true)
  }

  const closeForm = () => {
    setOpen(false)
    setEditingStore(null)
    setForm(emptyStoreForm)
  }

  const save = async (event) => {
    event?.preventDefault()
    const payload = {
      name: form.name.trim(),
      location: form.location.trim(),
      address: form.address.trim(),
    }
    if (!payload.name || !payload.location || !payload.address) return notify('Vui lòng nhập đầy đủ tên, khu vực và địa chỉ cửa hàng.', 'info')
    const duplicate = stores.some((store) => store.id !== editingStore?.id && store.name.trim().toLowerCase() === payload.name.toLowerCase())
    if (duplicate) return notify('Tên cửa hàng đã tồn tại.', 'info')
    const action = editingStore ? updateStore : addStore
    if (typeof action !== 'function') return notify('Chức năng lưu cửa hàng chưa sẵn sàng.', 'info')
    try {
      const result = editingStore ? await action(editingStore.id, payload) : await action(payload)
      if (!result?.ok) return notify(result?.message || 'Không thể lưu thông tin cửa hàng.', 'info')
      closeForm()
    } catch (error) {
      notify(error.message || 'Không thể lưu thông tin cửa hàng.', 'info')
    }
  }

  const removeStore = async (store) => {
    if (!canDeleteStore || !window.confirm(`Xóa ${store.name}?`)) return
    if (typeof deleteStore !== 'function') return notify('Chức năng xóa cửa hàng chưa sẵn sàng.', 'info')
    try {
      const result = await deleteStore(store.id)
      if (!result?.ok) return notify(result?.message || 'Không thể xóa cửa hàng.', 'info')
      if (viewingStore?.id === store.id) setViewingStore(null)
    } catch (error) {
      notify(error.message || 'Không thể xóa cửa hàng.', 'info')
    }
  }

  const manageStore = (store) => {
    const selected = setActiveStoreId?.(store.id)
    if (selected === false) return notify('Không thể mở cửa hàng đã chọn.', 'info')
    setViewingStore(null)
    navigate('/store/overview')
  }

  return (
    <div className="page">
      <PageHeader
        title="Quản lý cửa hàng"
        subtitle="Quản lý thông tin cửa hàng, nhân sự và kết quả hoạt động của từng cửa hàng."
        actions={<DateRange value={new Date().toLocaleDateString('vi-VN')} />}
      />
      <div className="toolbar toolbar--right">
        <SearchInput value={query} onChange={setQuery} placeholder="Tìm kiếm cửa hàng..." />
        {canManageStoreDirectory && <Button icon={Plus} onClick={openCreate}>Thêm cửa hàng</Button>}
      </div>
      <div className="metric-grid metric-grid--five">
        <MetricCard label="Tổng số cửa hàng" value={stores.length} suffix="cửa hàng" icon={Store} tone="green" compact />
        <MetricCard label="Tổng nhân viên" value={sum(stores, 'employees')} suffix="nhân viên" icon={Users} tone="green" compact />
        <MetricCard label="Tổng doanh thu" value={money(revenue)} helper="Trong khoảng thời gian đã chọn" icon={BarChart3} tone="green" compact />
        <MetricCard label="Tổng chi phí" value={money(expense)} helper="Trong khoảng thời gian đã chọn" icon={Wallet} tone="orange" compact />
        <MetricCard label="Tổng lợi nhuận" value={money(revenue - expense)} helper="Trong khoảng thời gian đã chọn" icon={TrendingUp} tone="blue" compact />
      </div>
      <Card title="Danh sách cửa hàng">
        <TableWrap>
          <thead><tr><th>#</th><th>Tên cửa hàng</th><th>Địa chỉ</th><th>Nhân viên</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {filtered.map((store, index) => {
              const storeFinance = financeByStore.get(store.id) || { revenue: 0, expense: 0, profit: 0, marginPercent: 0 }
              return (
              <tr key={store.id}>
                <td>{index + 1}</td>
                <td><div className="store-cell"><StoreIllustration name={store.name} accent={store.accent} /><strong>{store.name}</strong></div></td>
                <td className="address-cell"><strong>{store.address || store.location}</strong>{store.address && store.location && <small className="table-note">{store.location}</small>}</td>
                <td><strong className="green-text">{store.employees}</strong><small className="table-sub">nhân viên</small></td>
                <td className="green-text"><strong>{money(storeFinance.revenue)}</strong></td>
                <td className="orange-text"><strong>{money(storeFinance.expense)}</strong></td>
                <td><strong>{money(storeFinance.profit)}</strong><small className="green-text table-sub">({storeFinance.marginPercent.toFixed(2)}%)</small></td>
                <td><div className="filter-pills"><button type="button" className={!['Tạm ngưng', 'Ngưng hoạt động', 'Ngừng hoạt động'].includes(store.status) ? 'active' : ''} onClick={() => setStoreStatus(store, true)} disabled={!canManageStoreDirectory}>Đang hoạt động</button><button type="button" className={['Tạm ngưng', 'Ngưng hoạt động', 'Ngừng hoạt động'].includes(store.status) ? 'active' : ''} onClick={() => setStoreStatus(store, false)} disabled={!canManageStoreDirectory}>Ngưng hoạt động</button></div></td>
                <td><div className="row-actions">{canManageStoreDirectory && <button onClick={() => openEdit(store)} aria-label={`Sửa ${store.name}`}><Edit3 size={17} /></button>}{canDeleteStore && <button className="danger" onClick={() => removeStore(store)} aria-label={`Xóa ${store.name}`}><Trash2 size={17} /></button>}<button onClick={() => setViewingStore(store)} aria-label={`Xem ${store.name}`}><Eye size={17} /></button></div></td>
              </tr>
              )
            })}
          </tbody>
        </TableWrap>
        <TableFooter shown={filtered.length} total={filtered.length} />
      </Card>

      <Modal open={open} onClose={closeForm} title={editingStore ? 'Cập nhật cửa hàng' : 'Thêm cửa hàng mới'} footer={<><Button variant="outline" onClick={closeForm}>Hủy</Button><Button icon={Save} onClick={save}>{editingStore ? 'Lưu thay đổi' : 'Lưu cửa hàng'}</Button></>}>
        <form className="form-grid" onSubmit={save}>
          <Field label="Tên cửa hàng" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ví dụ: Idosi Tô Ngọc Vân" /></Field>
          <Field label="Khu vực" required><Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Quận/Huyện, Tỉnh/Thành" /></Field>
          <Field label="Địa chỉ chi tiết" required className="span-2"><textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Nhập địa chỉ..." /></Field>
        </form>
      </Modal>

      <Modal open={Boolean(viewingStore)} onClose={() => setViewingStore(null)} title="Chi tiết cửa hàng" footer={<><Button variant="outline" onClick={() => setViewingStore(null)}>Đóng</Button><Button onClick={() => viewingStore && manageStore(viewingStore)}>Quản lý cửa hàng</Button></>}>
        {viewingStore && <div className="form-stack">
          <InfoNote><strong>{viewingStore.name}</strong><br />{viewingStore.address || viewingStore.location}</InfoNote>
          <div className="summary-list">
            <p><span>Mã cửa hàng</span><strong>{viewingStore.id}</strong></p>
            <p><span>Nhân viên</span><strong>{viewingStore.employees || 0}</strong></p>
            <p><span>Doanh thu</span><strong>{money(financeByStore.get(viewingStore.id)?.revenue || 0)}</strong></p>
            <p><span>Chi phí</span><strong>{money(financeByStore.get(viewingStore.id)?.expense || 0)}</strong></p>
            <p className="total"><span>Lợi nhuận</span><strong>{money(financeByStore.get(viewingStore.id)?.profit || 0)}</strong></p>
          </div>
        </div>}
      </Modal>
    </div>
  )
}

export function AdminTasks() {
  const { stores, tasks, replaceTasks, notify } = useApp()
  const initialStoreId = tasks[0]?.storeId || stores[0]?.id || ''
  const initialShiftId = tasks[0]?.shiftId || 'ca1'
  const initialDate = tasks[0]?.date || today()
  const rowsForScope = (nextStoreId, nextShiftId, nextDate) => tasks
    .filter((task) => task.storeId === nextStoreId && task.shiftId === nextShiftId && task.date === nextDate)
    .map(({ id, title, detail }) => ({ id, title, detail }))
  const [storeId, setStoreId] = useState(initialStoreId)
  const [shiftId, setShiftId] = useState(initialShiftId)
  const [date, setDate] = useState(initialDate)
  const [rows, setRows] = useState(() => rowsForScope(initialStoreId, initialShiftId, initialDate))

  const update = (index, key, value) => setRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, [key]: value } : item))
  const remove = (index) => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
  const send = () => {
    if (!storeId) return notify('Vui lòng chọn cửa hàng trước khi gửi.', 'info')
    if (!date) return notify('Vui lòng chọn ngày áp dụng.', 'info')
    if (!rows.some((item) => item.title.trim())) return notify('Danh sách công việc đang trống.', 'info')
    const store = stores.find((item) => item.id === storeId)
    const nextTasks = rows.filter((item) => item.title.trim()).map((item, index) => ({
      ...item,
      id: item.id || `CV-${Date.now()}-${index + 1}`,
      title: item.title.trim(),
      detail: item.detail.trim(),
      storeId,
      storeName: store?.name || '',
      shiftId,
      date,
      done: false,
    }))
    replaceTasks?.(nextTasks)
    setRows(nextTasks.map(({ id, title, detail }) => ({ id, title, detail })))
  }

  return (
    <div className="page admin-task-page">
      <PageHeader title="Giao việc" subtitle="Danh sách công việc cho từng ca làm – giúp nhân viên dễ dàng theo dõi và thực hiện." icon={ClipboardCheck} />
      <Card className="task-toolbar-card">
        <div className="task-toolbar-grid">
          <Field label="Cửa hàng" required><Select value={storeId} onChange={(event) => { const next = event.target.value; setStoreId(next); setRows(rowsForScope(next, shiftId, date)) }} icon={Store}><option value="">Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
          <Field label="Ca làm" required><Select value={shiftId} onChange={(event) => { const next = event.target.value; setShiftId(next); setRows(rowsForScope(storeId, next, date)) }}><option value="ca1">Ca sáng (07:00 – 12:00)</option><option value="ca2">Ca chiều (12:00 – 17:00)</option><option value="ca3">Ca tối (17:00 – 23:00)</option></Select></Field>
          <Field label="Ngày áp dụng" required><Input icon={CalendarDays} type="date" value={date} onChange={(event) => { const next = event.target.value; setDate(next); setRows(rowsForScope(storeId, shiftId, next)) }} /></Field>
          <Button icon={Send} onClick={send} className="task-send">Lưu và gửi</Button>
        </div>
      </Card>
      <div className="split-layout split-layout--tasks">
        <Card title="Danh sách công việc" className="task-editor">
          <div className="task-editor__head"><span>STT</span><span>Nội dung công việc *</span><span>Chi tiết / Ghi chú</span><span /></div>
          {rows.map((item, index) => (
            <div className="task-editor__row" key={item.id || index}>
              <b>{index + 1}</b>
              <input value={item.title} onChange={(event) => update(index, 'title', event.target.value)} placeholder="Nhập nội dung công việc" />
              <textarea value={item.detail} onChange={(event) => update(index, 'detail', event.target.value)} placeholder="Chi tiết thực hiện" />
              <button type="button" onClick={() => remove(index)} aria-label={`Xóa công việc ${index + 1}`}><Trash2 size={18} /></button>
            </div>
          ))}
          <button type="button" className="add-row" onClick={() => setRows((current) => [...current, { id: `CV-${Date.now()}`, title: '', detail: '' }])}><Plus size={18} /> Thêm công việc</button>
        </Card>
        <Card className="guide-card">
          <h2><Info size={22} /> Hướng dẫn</h2>
          <ol><li>Chọn cửa hàng, ca làm và ngày áp dụng.</li><li>Nhập danh sách công việc cho nhân viên trong ca.</li><li>Nhấn “Lưu và gửi” để chuyển công việc đến màn hình nhân viên.</li></ol>
          <InfoNote><strong>Sau khi lưu và gửi</strong><br />Công việc sẽ xuất hiện trong mục “Công việc cần làm” của nhân viên.</InfoNote>
          <div className="mini-notification"><CheckCircle2 /> Công việc cần làm <Badge tone="red">{rows.length}</Badge></div>
        </Card>
      </div>
    </div>
  )
}

export function AdminCashflow() {
  const { stores, notify } = useApp()
  const seriesYear = new Date().getFullYear()
  const defaultRange = adminSeries.length ? `${adminSeries[0].day}/${seriesYear} - ${adminSeries[adminSeries.length - 1].day}/${seriesYear}` : ''
  const [storeId, setStoreId] = useState(stores[0]?.id || '')
  const [dateRange, setDateRange] = useState(defaultRange)
  const [chartType, setChartType] = useState('line')
  const selected = stores.find((store) => store.id === storeId) || stores[0]
  const selectedRevenue = Number(selected?.revenue) || 0
  const selectedExpense = Number(selected?.expense) || 0
  const revenueWeight = sum(adminSeries, 'revenue') || 1
  const expenseWeight = sum(adminSeries, 'expense') || 1
  const range = parseRange(dateRange)
  const rows = adminSeries.map((item) => {
    const revenue = Math.round(selectedRevenue * ((Number(item.revenue) || 0) / revenueWeight))
    const expense = Math.round(selectedExpense * ((Number(item.expense) || 0) / expenseWeight))
    return { day: item.day, date: seriesDate(item.day, seriesYear), revenue, expense, profit: revenue - expense }
  }).filter((row) => !range || (row.date >= range[0] && row.date <= range[1]))
  const revenue = sum(rows, 'revenue')
  const expense = sum(rows, 'expense')

  const exportReport = () => {
    if (!rows.length) return notify('Không có dữ liệu trong khoảng thời gian đã chọn.', 'info')
    downloadCsv(`dong-tien-${selected?.id || 'idosi'}.csv`, rows.map((row) => ({
      cửa_hàng: selected?.name || '',
      ngày: row.date,
      doanh_thu: row.revenue,
      chi_phí: row.expense,
      lợi_nhuận: row.profit,
    })))
    notify('Đã xuất báo cáo dòng tiền CSV.')
  }

  return (
    <div className="page">
      <PageHeader title="Dòng tiền" subtitle="Theo dõi doanh thu, chi phí và lợi nhuận của từng cửa hàng." />
      <Card className="filter-card">
        <div className="filter-grid">
          <Field label="Chọn cửa hàng"><Select icon={Store} value={storeId} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
          <Field label="Chọn thời gian"><DateRange value={dateRange} onChange={setDateRange} /></Field>
          <ExportButton label="Xuất báo cáo" onClick={exportReport} />
        </div>
      </Card>
      <div className="metric-grid">
        <MetricCard label="DOANH THU" value={money(revenue)} icon={TrendingUp} trend={12.45} helper=" so với kỳ trước" tone="green" />
        <MetricCard label="CHI PHÍ" value={money(expense)} icon={Wallet} trend={8.32} helper=" so với kỳ trước" tone="orange" />
        <MetricCard label="LỢI NHUẬN" value={money(revenue - expense)} icon={BarChart3} trend={16.78} helper=" so với kỳ trước" tone="blue" />
      </div>
      <div className="chart-grid chart-grid--wide">
        <Card title="Biểu đồ dòng tiền" action={<Select value={chartType} onChange={(event) => setChartType(event.target.value)}><option value="line">Biểu đồ đường</option><option value="bar">Biểu đồ cột</option></Select>}><FinancialChart data={rows} type={chartType} /></Card>
        <Card title="Tỷ lệ cơ cấu">
          <div className="donut-with-legend">
            <DonutChart data={[{ name: 'Doanh thu', value: revenue }, { name: 'Chi phí', value: expense }, { name: 'Lợi nhuận', value: revenue - expense }]} center={money(revenue)} subcenter="Tổng" />
            <div className="legend-list"><p><i className="dot green" />Doanh thu <strong>{money(revenue)}</strong></p><p><i className="dot orange" />Chi phí <strong>{money(expense)}</strong></p><p><i className="dot blue" />Lợi nhuận <strong>{money(revenue - expense)}</strong></p></div>
          </div>
        </Card>
      </div>
      <Card title="Chi tiết dòng tiền">
        <TableWrap><thead><tr><th>Ngày</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th><th>Ghi chú</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{row.day}/{seriesYear}</td><td>{money(row.revenue)}</td><td>{money(row.expense)}</td><td className="green-text"><strong>{money(row.profit)}</strong></td><td>–</td></tr>)}{!rows.length && <tr><td colSpan="5">Không có dữ liệu trong khoảng thời gian đã chọn.</td></tr>}</tbody></TableWrap>
        <TableFooter shown={rows.length} total={rows.length} />
      </Card>
    </div>
  )
}

export function AdminReports() {
  const { stores, notify } = useApp()
  const [view, setView] = useState('all')
  const [period, setPeriod] = useState('day')
  const [storeId, setStoreId] = useState(stores[0]?.id || '')
  const reportYear = new Date().getFullYear()
  const defaultRange = adminSeries.length ? `${adminSeries[0].day}/${reportYear} - ${adminSeries[adminSeries.length - 1].day}/${reportYear}` : ''
  const [dateRange, setDateRange] = useState(defaultRange)
  const range = parseRange(dateRange)
  const filteredSeries = adminSeries.filter((item) => {
    const date = seriesDate(item.day, reportYear)
    return !range || (date >= range[0] && date <= range[1])
  })
  const revenueRatio = sum(adminSeries, 'revenue') ? sum(filteredSeries, 'revenue') / sum(adminSeries, 'revenue') : 0
  const expenseRatio = sum(adminSeries, 'expense') ? sum(filteredSeries, 'expense') / sum(adminSeries, 'expense') : 0
  const baseStores = view === 'single' ? stores.filter((store) => store.id === storeId) : stores
  const reportStores = baseStores.map((store) => ({
    ...store,
    revenue: Math.round((Number(store.revenue) || 0) * revenueRatio),
    expense: Math.round((Number(store.expense) || 0) * expenseRatio),
  }))
  const revenue = sum(reportStores, 'revenue')
  const expense = sum(reportStores, 'expense')
  const profit = revenue - expense
  const donut = reportStores.map((store) => ({ name: store.name, value: store.revenue }))
  const reportMonth = adminSeries[0]?.day?.split('/')[1] || String(new Date().getMonth() + 1).padStart(2, '0')
  const chartData = period === 'month'
    ? [{ day: `${reportMonth}/${reportYear}`, revenue: sum(filteredSeries, 'revenue'), expense: sum(filteredSeries, 'expense'), profit: sum(filteredSeries, 'profit') }]
    : filteredSeries

  const reportRows = reportStores.map((store) => ({
    cửa_hàng: store.name,
    doanh_thu: store.revenue,
    chi_phí: store.expense,
    lợi_nhuận: store.revenue - store.expense,
    tỷ_lệ_lợi_nhuận: percent(store.revenue - store.expense, store.revenue),
  }))

  const exportReport = () => {
    if (!reportRows.length) return notify('Không có dữ liệu báo cáo để xuất.', 'info')
    downloadCsv('bao-cao-he-thong-idosi.csv', reportRows)
    notify('Đã xuất báo cáo hệ thống CSV; tệp có thể mở bằng Excel.')
  }

  return (
    <div className="page">
      <PageHeader title="Báo cáo" subtitle="Theo dõi và phân tích kết quả hoạt động của hệ thống." actions={<><div className="segmented"><button className={period === 'day' ? 'active' : ''} onClick={() => setPeriod('day')}>Theo ngày</button><button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Theo tháng</button></div><DateRange value={dateRange} onChange={setDateRange} /><div className="export-pair"><Button icon={FileDown} onClick={exportReport}>File Excel</Button><Button variant="danger" icon={FileDown} onClick={() => notify('Xuất PDF chưa có dịch vụ tạo tệp; vui lòng dùng File Excel/CSV.', 'info')}>File PDF</Button></div></>} />
      <div className="tabs"><button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}><BarChart3 />Tổng tất cả cửa hàng</button><button className={view === 'single' ? 'active' : ''} onClick={() => setView('single')}><Store />Theo từng cửa hàng</button>{view === 'single' && <Select value={storeId} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}</div>
      <AdminMetrics stores={reportStores} compact />
      <div className="chart-grid">
        <Card title={period === 'day' ? 'Biểu đồ tổng theo ngày' : 'Biểu đồ tổng theo tháng'}><FinancialChart data={chartData} type="bar" /></Card>
        <Card title="Cơ cấu doanh thu theo cửa hàng"><div className="donut-with-legend"><DonutChart data={donut} center={money(revenue)} subcenter="Tổng" /><div className="legend-list">{reportStores.map((store) => <p key={store.id}><i className="dot" style={{ background: store.accent }} />{store.name}<strong>{revenue > 0 ? `${((store.revenue / revenue) * 100).toFixed(1)}%` : '0.0%'}</strong></p>)}</div></div></Card>
      </div>
      <Card title="Chi tiết doanh thu – chi phí – lợi nhuận từng cửa hàng">
        <TableWrap><thead><tr><th>STT</th><th>Cửa hàng</th><th>Tổng doanh thu</th><th>Tổng chi phí</th><th>Lợi nhuận</th><th>Tỷ lệ lợi nhuận</th></tr></thead><tbody>{reportStores.map((store, index) => <tr key={store.id}><td>{index + 1}</td><td><strong>{store.name}</strong></td><td>{money(store.revenue)}</td><td>{money(store.expense)}</td><td>{money(store.revenue - store.expense)}</td><td className="green-text"><strong>{percent(store.revenue - store.expense, store.revenue)}</strong></td></tr>)}{reportStores.length > 0 && <tr className="total-row"><td colSpan="2">Tổng cộng</td><td>{money(revenue)}</td><td>{money(expense)}</td><td>{money(profit)}</td><td>{percent(profit, revenue)}</td></tr>}{!reportStores.length && <tr><td colSpan="6">Không có dữ liệu phù hợp với bộ lọc.</td></tr>}</tbody></TableWrap>
        <InfoNote><strong>Xu hướng:</strong> Doanh thu và lợi nhuận tăng ổn định, đạt mức cao nhất trong tuần.</InfoNote>
      </Card>
    </div>
  )
}

export function AdminSettings() {
  const { settings, session, saveSettings, changeAdminPassword, verifyCurrentPassword, resetDemo, notify } = useApp()
  const [tab, setTab] = useState('profile')
  const [form, setForm] = useState(settings || {})
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [notifications, setNotifications] = useState(() => ({
    tasks: settings?.notifications?.tasks ?? true,
    dailyReport: settings?.notifications?.dailyReport ?? true,
    expenseAlert: settings?.notifications?.expenseAlert ?? false,
  }))
  const photoInput = useRef(null)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const saveProfile = async () => {
    if (!String(form.name || '').trim() || !String(form.email || '').trim()) return notify('Họ tên và email là trường bắt buộc.', 'info')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.email))) return notify('Email không đúng định dạng.', 'info')
    if (form.phone && !validateVietnamPhone(form.phone)) return notify('Số điện thoại Việt Nam không đúng định dạng.', 'info')
    if (typeof saveSettings !== 'function') return notify('Chức năng lưu cài đặt chưa sẵn sàng.', 'info')
    const result = await saveSettings({ ...settings, ...form, notifications })
    if (!result?.ok) return notify(result?.message || 'Không thể lưu thông tin tài khoản.', 'info')
    setForm((current) => ({ ...current, ...(result.settings || {}) }))
  }

  const choosePhoto = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      notify('Ảnh đại diện chỉ hỗ trợ JPG hoặc PNG.', 'info')
      event.target.value = ''
      return
    }
    if (file.size > 95 * 1024) {
      notify('Tệp ảnh đại diện không được vượt quá 95KB để dữ liệu ảnh sau mã hóa không vượt 128KB.', 'info')
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const avatar = String(reader.result || '')
      if (avatar.length > 128 * 1024) return notify('Dữ liệu ảnh sau mã hóa vượt quá 128KB.', 'info')
      setForm((current) => ({ ...current, avatar }))
    }
    reader.readAsDataURL(file)
  }

  const requestPasswordChange = async () => {
    if (!passwordForm.current || !passwordForm.next || !passwordForm.confirm) return notify('Vui lòng nhập đầy đủ ba trường mật khẩu.', 'info')
    if (!await verifyCurrentPassword?.(passwordForm.current)) return notify('Mật khẩu hiện tại chưa đúng.', 'info')
    if (passwordForm.next.length < 8) return notify('Mật khẩu mới phải có ít nhất 8 ký tự.', 'info')
    if (passwordForm.next !== passwordForm.confirm) return notify('Xác nhận mật khẩu mới không khớp.', 'info')
    const changed = await changeAdminPassword?.(session?.id || session?.username, passwordForm.next, passwordForm.current)
    if (changed) setPasswordForm({ current: '', next: '', confirm: '' })
  }

  const saveNotifications = async () => {
    if (typeof saveSettings !== 'function') return notify('Chức năng lưu cài đặt chưa sẵn sàng.', 'info')
    const result = await saveSettings({ ...settings, ...form, notifications })
    if (!result?.ok) return notify(result?.message || 'Không thể lưu thiết lập thông báo.', 'info')
    if (result.settings?.notifications) setNotifications(result.settings.notifications)
  }

  const restoreDemo = async () => {
    if (!window.confirm('Khôi phục dữ liệu mẫu sẽ thay thế các thay đổi đang lưu. Bạn có chắc chắn?')) return
    if (typeof resetDemo !== 'function') return notify('Chức năng khôi phục dữ liệu chưa sẵn sàng.', 'info')
    const result = await resetDemo()
    if (!result?.ok) notify(result?.message || 'Không thể khôi phục dữ liệu mẫu.', 'info')
  }

  return (
    <div className="page settings-page">
      <PageHeader title="Cài đặt" subtitle="Quản lý thông tin tài khoản và các thiết lập hệ thống." icon={Settings} />
      <div className="settings-layout">
        <Card className="settings-nav" title="Cài đặt">
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><UserRound />Thông tin cá nhân</button>
          <button className={tab === 'password' ? 'active' : ''} onClick={() => setTab('password')}><ShieldCheck />Đổi mật khẩu</button>
          <button className={tab === 'notifications' ? 'active' : ''} onClick={() => setTab('notifications')}><Info />Thông báo</button>
          {session?.role === 'admin' && <button onClick={restoreDemo}><RefreshCcw />Khôi phục dữ liệu mẫu</button>}
        </Card>
        {tab === 'profile' ? (
          <Card className="settings-content">
            <h2>Thông tin cá nhân</h2><p>Cập nhật thông tin tài khoản của bạn.</p>
            <div className="profile-form">
              <div className="profile-photo"><div>{form.avatar ? <img src={form.avatar} alt="Ảnh đại diện quản trị" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : 'QT'}</div><input ref={photoInput} type="file" accept="image/jpeg,image/png" hidden onChange={choosePhoto} /><Button variant="outline" onClick={() => photoInput.current?.click()}>Đổi ảnh</Button><small>Định dạng JPG, PNG<br />Tệp tối đa 95KB</small></div>
              <div className="form-grid">
                <Field label="Họ và tên"><Input value={form.name} onChange={set('name')} /></Field><Field label="Email"><Input value={form.email} onChange={set('email')} /></Field>
                <Field label="Số điện thoại"><Input value={form.phone} onChange={set('phone')} /></Field><Field label="Chức vụ"><Select value="admin" disabled><option value="admin">Quản lý hệ thống</option></Select></Field>
                <Field label="Ngày sinh"><Input type="date" value={form.birthday} onChange={set('birthday')} /></Field><Field label="Giới tính"><Select value={form.gender} onChange={set('gender')}><option>Nam</option><option>Nữ</option><option>Khác</option></Select></Field>
                <Field label="Địa chỉ" className="span-2"><Input value={form.address} onChange={set('address')} /></Field>
                <Field label="Giới thiệu" className="span-2"><textarea value={form.bio || ''} onChange={set('bio')} maxLength={200} /><small>{String(form.bio || '').length}/200</small></Field>
              </div>
            </div>
            <div className="login-info"><h3>Thông tin đăng nhập</h3><div className="form-grid"><Field label="Tên đăng nhập"><Input value={session?.username || 'admin'} disabled /></Field><Field label="Vai trò"><Input value={['manager', 'business_support'].includes(session?.role) ? 'Nhân viên hỗ trợ KD' : 'Admin'} disabled /></Field></div></div>
            <div className="card-actions"><Button icon={Save} onClick={saveProfile}>Lưu thay đổi</Button></div>
          </Card>
        ) : (
          <Card className="settings-content settings-placeholder"><ShieldCheck size={48} /><h2>{tab === 'password' ? 'Đổi mật khẩu' : 'Thiết lập thông báo'}</h2><p>{tab === 'password' ? 'Nhập mật khẩu mới để tăng cường bảo mật tài khoản.' : 'Chọn loại thông báo bạn muốn nhận từ hệ thống.'}</p><div className="form-stack">{tab === 'password' ? <><Field label="Mật khẩu hiện tại"><Input type="password" value={passwordForm.current} onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })} /></Field><Field label="Mật khẩu mới"><Input type="password" value={passwordForm.next} onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })} /></Field><Field label="Xác nhận mật khẩu"><Input type="password" value={passwordForm.confirm} onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })} /></Field></> : <><label className="switch-row"><span>Thông báo công việc mới</span><input type="checkbox" checked={notifications.tasks} onChange={(event) => setNotifications({ ...notifications, tasks: event.target.checked })} /></label><label className="switch-row"><span>Báo cáo doanh thu hàng ngày</span><input type="checkbox" checked={notifications.dailyReport} onChange={(event) => setNotifications({ ...notifications, dailyReport: event.target.checked })} /></label><label className="switch-row"><span>Cảnh báo chi phí</span><input type="checkbox" checked={notifications.expenseAlert} onChange={(event) => setNotifications({ ...notifications, expenseAlert: event.target.checked })} /></label></>}<Button onClick={tab === 'password' ? requestPasswordChange : saveNotifications}>Lưu thiết lập</Button></div></Card>
        )}
      </div>
    </div>
  )
}
