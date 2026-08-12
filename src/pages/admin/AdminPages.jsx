import { useState } from 'react'
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
import { useApp } from '../../state/AppContext'
import { downloadCsv, money } from '../../utils'

const sum = (items, key) => items.reduce((total, item) => total + (Number(item[key]) || 0), 0)

function AdminMetrics({ stores, compact = false }) {
  const revenue = sum(stores, 'revenue')
  const expense = sum(stores, 'expense')
  return (
    <div className={`metric-grid ${compact ? 'metric-grid--compact' : ''}`}>
      <MetricCard label="TỔNG DOANH THU" value={money(revenue)} icon={BadgeDollarSign} trend={12.45} helper=" so với kỳ trước" tone="green" compact={compact} />
      <MetricCard label="TỔNG CHI PHÍ" value={money(expense)} icon={ShoppingCart} trend={8.32} helper=" so với kỳ trước" tone="orange" compact={compact} />
      <MetricCard label="TỔNG LỢI NHUẬN" value={money(revenue - expense)} icon={TrendingUp} trend={16.78} helper=" so với kỳ trước" tone="blue" compact={compact} />
      {compact && <MetricCard label="TỶ LỆ LỢI NHUẬN" value={`${(((revenue - expense) / revenue) * 100).toFixed(2)}%`} icon={BarChart3} trend={2.14} helper=" so với kỳ trước" tone="teal" compact />}
    </div>
  )
}

export function AdminOverview() {
  const { stores, setActiveStoreId } = useApp()
  const navigate = useNavigate()
  return (
    <div className="page">
      <PageHeader
        title="Tổng quan"
        subtitle="Xin chào, Quản trị viên! Đây là tổng quan hoạt động của tất cả cửa hàng."
        actions={<DateRange value="20/05/2025 - 26/05/2025" />}
      />
      <AdminMetrics stores={stores} />
      <div className="section-heading">
        <div><h2>Quản lý cửa hàng</h2><p>Chọn cửa hàng để xem và quản lý chi tiết.</p></div>
        <Button variant="ghost" onClick={() => navigate('/admin/stores')}>Xem tất cả</Button>
      </div>
      <div className="store-card-grid">
        {stores.map((store) => (
          <Card key={store.id} className="store-card">
            <StoreIllustration name={store.name} accent={store.accent} />
            <div className="store-card__body">
              <h3>{store.name}</h3>
              <p><MapPin size={17} /> {store.location}</p>
              <p><BarChart3 size={17} /> Doanh thu kỳ này</p>
              <strong>{money(store.revenue)}</strong>
              <Button onClick={() => { setActiveStoreId?.(store.id); navigate('/store/overview') }}>Quản lý cửa hàng <span>→</span></Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function AdminStores() {
  const { stores, addStore, deleteStore, notify } = useApp()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', location: '', address: '' })
  const filtered = stores.filter((item) => `${item.name} ${item.location}`.toLowerCase().includes(query.toLowerCase()))
  const revenue = sum(stores, 'revenue')
  const expense = sum(stores, 'expense')

  const save = (event) => {
    event.preventDefault()
    if (!form.name || !form.location) return notify('Vui lòng nhập tên và khu vực cửa hàng.', 'info')
    addStore({ ...form, name: form.name.trim() })
    setForm({ name: '', location: '', address: '' })
    setOpen(false)
  }

  return (
    <div className="page">
      <PageHeader
        title="Quản lý cửa hàng"
        subtitle="Quản lý thông tin cửa hàng, nhân sự và kết quả hoạt động của từng cửa hàng."
        actions={<DateRange value="20/05/2025 - 26/05/2025" />}
      />
      <div className="toolbar toolbar--right">
        <SearchInput value={query} onChange={setQuery} placeholder="Tìm kiếm cửa hàng..." />
        <Button icon={Plus} onClick={() => setOpen(true)}>Thêm cửa hàng</Button>
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
            {filtered.map((store, index) => (
              <tr key={store.id}>
                <td>{index + 1}</td>
                <td><div className="store-cell"><StoreIllustration name={store.name} accent={store.accent} /><strong>{store.name}</strong></div></td>
                <td><span className="cell-muted"><MapPin size={15} />{store.location}</span></td>
                <td><strong className="green-text">{store.employees}</strong><small className="table-sub">nhân viên</small></td>
                <td className="green-text"><strong>{money(store.revenue)}</strong></td>
                <td className="orange-text"><strong>{money(store.expense)}</strong></td>
                <td><strong>{money(store.revenue - store.expense)}</strong><small className="green-text table-sub">({(((store.revenue - store.expense) / store.revenue) * 100).toFixed(2)}%)</small></td>
                <td><Badge>{store.status}</Badge></td>
                <td><div className="row-actions"><button onClick={() => notify('Chế độ chỉnh sửa đã sẵn sàng.', 'info')}><Edit3 size={17} /></button><button className="danger" onClick={() => window.confirm(`Xóa ${store.name}?`) && deleteStore(store.id)}><Trash2 size={17} /></button><button><Eye size={17} /></button></div></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <TableFooter shown={filtered.length} total={filtered.length} />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Thêm cửa hàng mới" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button icon={Save} onClick={save}>Lưu cửa hàng</Button></>}>
        <form className="form-grid" onSubmit={save}>
          <Field label="Tên cửa hàng" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ví dụ: Idosi Tô Ngọc Vân" /></Field>
          <Field label="Khu vực" required><Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Quận/Huyện, Tỉnh/Thành" /></Field>
          <Field label="Địa chỉ chi tiết" className="span-2"><textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Nhập địa chỉ..." /></Field>
        </form>
      </Modal>
    </div>
  )
}

export function AdminTasks() {
  const { stores, tasks, replaceTasks, notify } = useApp()
  const [storeId, setStoreId] = useState('')
  const [shiftId, setShiftId] = useState('ca1')
  const [date, setDate] = useState('2025-05-20')
  const [rows, setRows] = useState(tasks.map(({ id, title, detail }) => ({ id, title, detail })))

  const update = (index, key, value) => setRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, [key]: value } : item))
  const remove = (index) => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
  const send = () => {
    if (!storeId) return notify('Vui lòng chọn cửa hàng trước khi gửi.', 'info')
    if (!rows.some((item) => item.title.trim())) return notify('Danh sách công việc đang trống.', 'info')
    replaceTasks(rows.filter((item) => item.title.trim()).map((item, index) => ({ ...item, id: index + 1, done: false })))
  }

  return (
    <div className="page admin-task-page">
      <PageHeader title="Giao việc" subtitle="Danh sách công việc cho từng ca làm – giúp nhân viên dễ dàng theo dõi và thực hiện." icon={ClipboardCheck} actions={<DateRange value="20/05/2025 - 26/05/2025" />} />
      <Card className="task-toolbar-card">
        <div className="task-toolbar-grid">
          <Field label="Cửa hàng" required><Select value={storeId} onChange={(event) => setStoreId(event.target.value)} icon={Store}><option value="">Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
          <Field label="Ca làm" required><Select value={shiftId} onChange={(event) => setShiftId(event.target.value)}><option value="ca1">Ca sáng (07:00 – 12:00)</option><option value="ca2">Ca chiều (12:00 – 17:00)</option><option value="ca3">Ca tối (17:00 – 23:00)</option></Select></Field>
          <Field label="Ngày áp dụng" required><Input icon={CalendarDays} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
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
              <button onClick={() => remove(index)}><Trash2 size={18} /></button>
            </div>
          ))}
          <button className="add-row" onClick={() => setRows((current) => [...current, { id: Date.now(), title: '', detail: '' }])}><Plus size={18} /> Thêm công việc</button>
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
  const { stores } = useApp()
  const [storeId, setStoreId] = useState(stores[0]?.id)
  const selected = stores.find((store) => store.id === storeId) || stores[0]
  const revenue = selected?.revenue || 0
  const expense = selected?.expense || 0
  const rows = adminSeries.map((item) => ({
    date: item.day,
    revenue: Math.round((revenue / 7) * (item.revenue / 95)),
    expense: Math.round((expense / 7) * (item.expense / 55)),
  }))

  return (
    <div className="page">
      <PageHeader title="Dòng tiền" subtitle="Theo dõi doanh thu, chi phí và lợi nhuận của từng cửa hàng." />
      <Card className="filter-card">
        <div className="filter-grid">
          <Field label="Chọn cửa hàng"><Select icon={Store} value={storeId} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
          <Field label="Chọn thời gian"><DateRange value="20/05/2025 - 26/05/2025" /></Field>
          <ExportButton label="Xuất báo cáo" onClick={() => downloadCsv('dong-tien-idosi.csv', rows)} />
        </div>
      </Card>
      <div className="metric-grid">
        <MetricCard label="DOANH THU" value={money(revenue)} icon={TrendingUp} trend={12.45} helper=" so với kỳ trước" tone="green" />
        <MetricCard label="CHI PHÍ" value={money(expense)} icon={Wallet} trend={8.32} helper=" so với kỳ trước" tone="orange" />
        <MetricCard label="LỢI NHUẬN" value={money(revenue - expense)} icon={BarChart3} trend={16.78} helper=" so với kỳ trước" tone="blue" />
      </div>
      <div className="chart-grid chart-grid--wide">
        <Card title="Biểu đồ dòng tiền" action={<Select defaultValue="day"><option value="day">Theo ngày</option></Select>}><FinancialChart data={adminSeries} /></Card>
        <Card title="Tỷ lệ cơ cấu">
          <div className="donut-with-legend">
            <DonutChart data={[{ name: 'Doanh thu', value: revenue }, { name: 'Chi phí', value: expense }, { name: 'Lợi nhuận', value: revenue - expense }]} center={money(revenue)} subcenter="Tổng" />
            <div className="legend-list"><p><i className="dot green" />Doanh thu <strong>{money(revenue)}</strong></p><p><i className="dot orange" />Chi phí <strong>{money(expense)}</strong></p><p><i className="dot blue" />Lợi nhuận <strong>{money(revenue - expense)}</strong></p></div>
          </div>
        </Card>
      </div>
      <Card title="Chi tiết dòng tiền">
        <TableWrap><thead><tr><th>Ngày</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th><th>Ghi chú</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{row.date}/2025</td><td>{money(row.revenue)}</td><td>{money(row.expense)}</td><td className="green-text"><strong>{money(row.revenue - row.expense)}</strong></td><td>–</td></tr>)}</tbody></TableWrap>
        <TableFooter shown={rows.length} total={rows.length} />
      </Card>
    </div>
  )
}

export function ManagerPayroll() {
  const { stores, managerPayroll, saveManagerPayroll, notify } = useApp()
  const [form, setForm] = useState({ store: stores[1]?.name || stores[0]?.name, month: '05/2025', salary: 15000000, bonus: 3000000, allowance: 1500000 })
  const total = Number(form.salary) + Number(form.bonus) + Number(form.allowance)
  const save = () => saveManagerPayroll({ ...form, salary: Number(form.salary), bonus: Number(form.bonus), allowance: Number(form.allowance) })

  return (
    <div className="page">
      <PageHeader title="LƯƠNG THƯỞNG QUẢN LÝ" subtitle="Nhập và quản lý lương thưởng của quản lý theo cửa hàng và từng tháng." actions={<DateRange value="20/05/2025 - 26/05/2025" />} />
      <Card className="payroll-form-card">
        <div className="payroll-form-layout">
          <div>
            <div className="form-grid form-grid--payroll">
              <Field label="Cửa hàng"><Select icon={Store} value={form.store} onChange={(event) => setForm({ ...form, store: event.target.value })}>{stores.map((store) => <option key={store.id}>{store.name}</option>)}</Select></Field>
              <Field label="Tháng / Năm"><Input icon={CalendarDays} value={form.month} onChange={(event) => setForm({ ...form, month: event.target.value })} /></Field>
              <Field label="Lương (VNĐ)"><Input type="number" value={form.salary} onChange={(event) => setForm({ ...form, salary: event.target.value })} /></Field>
              <Field label="Thưởng (VNĐ)"><Input type="number" value={form.bonus} onChange={(event) => setForm({ ...form, bonus: event.target.value })} /></Field>
              <Field label="Phụ cấp (VNĐ)"><Input type="number" value={form.allowance} onChange={(event) => setForm({ ...form, allowance: event.target.value })} /></Field>
            </div>
          </div>
          <InfoNote><h3>Hướng dẫn</h3><ul><li>Nhập số tiền lương, thưởng và phụ cấp cho quản lý.</li><li>Tổng nhận được tính tự động.</li><li>Có thể chỉnh sửa và lưu lại bất cứ lúc nào.</li></ul></InfoNote>
        </div>
        <div className="payroll-total-row">
          <div><span>Tổng nhận</span><strong>{money(total)}</strong><small>(Lương + Thưởng + Phụ cấp)</small></div>
          <div><Button variant="outline" icon={RefreshCcw} onClick={() => setForm({ ...form, salary: 0, bonus: 0, allowance: 0 })}>Hủy</Button><Button icon={Save} onClick={save}>Lưu</Button></div>
        </div>
      </Card>
      <Card title="Lịch sử lương thưởng" action={<Select defaultValue="year"><option value="year">Xem lịch sử theo năm</option></Select>}>
        <TableWrap><thead><tr><th>STT</th><th>Tháng / Năm</th><th>Cửa hàng</th><th>Lương</th><th>Thưởng</th><th>Phụ cấp</th><th>Tổng nhận</th><th>Cập nhật lúc</th><th>Thao tác</th></tr></thead><tbody>{managerPayroll.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.month}</td><td>{row.store}</td><td>{money(row.salary)}</td><td>{money(row.bonus)}</td><td>{money(row.allowance)}</td><td className="green-text"><strong>{money(row.salary + row.bonus + row.allowance)}</strong></td><td>{row.updatedAt}</td><td><div className="row-actions"><button onClick={() => notify('Bạn có thể tạo bản ghi điều chỉnh mới.', 'info')}><Edit3 size={17} /></button><button className="danger" onClick={() => notify('Dữ liệu mẫu được bảo vệ.', 'info')}><Trash2 size={17} /></button></div></td></tr>)}</tbody></TableWrap>
        <TableFooter shown={Math.min(managerPayroll.length, 8)} total={managerPayroll.length} />
      </Card>
    </div>
  )
}

export function AdminReports() {
  const { stores } = useApp()
  const [view, setView] = useState('all')
  const revenue = sum(stores, 'revenue')
  const expense = sum(stores, 'expense')
  const profit = revenue - expense
  const donut = stores.map((store) => ({ name: store.name, value: store.revenue }))

  return (
    <div className="page">
      <PageHeader title="Báo cáo" subtitle="Theo dõi và phân tích kết quả hoạt động của hệ thống." actions={<><div className="segmented"><button className="active">Theo ngày</button><button>Theo tháng</button></div><DateRange value="20/05/2025 - 26/05/2025" /><div className="export-pair"><Button icon={FileDown}>File Excel</Button><Button variant="danger" icon={FileDown}>File PDF</Button></div></>} />
      <div className="tabs"><button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}><BarChart3 />Tổng tất cả cửa hàng</button><button className={view === 'single' ? 'active' : ''} onClick={() => setView('single')}><Store />Theo từng cửa hàng</button></div>
      <AdminMetrics stores={view === 'single' ? [stores[0]] : stores} compact />
      <div className="chart-grid">
        <Card title="Biểu đồ tổng theo 7 ngày"><FinancialChart data={adminSeries} type="bar" /></Card>
        <Card title="Cơ cấu doanh thu theo cửa hàng"><div className="donut-with-legend"><DonutChart data={donut} center={money(revenue)} subcenter="Tổng" /><div className="legend-list">{stores.map((store) => <p key={store.id}><i className="dot" style={{ background: store.accent }} />{store.name}<strong>{((store.revenue / revenue) * 100).toFixed(1)}%</strong></p>)}</div></div></Card>
      </div>
      <Card title="Chi tiết doanh thu – chi phí – lợi nhuận từng cửa hàng">
        <TableWrap><thead><tr><th>STT</th><th>Cửa hàng</th><th>Tổng doanh thu</th><th>Tổng chi phí</th><th>Lợi nhuận</th><th>Tỷ lệ lợi nhuận</th></tr></thead><tbody>{stores.map((store, index) => <tr key={store.id}><td>{index + 1}</td><td><strong>{store.name}</strong></td><td>{money(store.revenue)}</td><td>{money(store.expense)}</td><td>{money(store.revenue - store.expense)}</td><td className="green-text"><strong>{(((store.revenue - store.expense) / store.revenue) * 100).toFixed(2)}%</strong></td></tr>)}<tr className="total-row"><td colSpan="2">Tổng cộng</td><td>{money(revenue)}</td><td>{money(expense)}</td><td>{money(profit)}</td><td>{((profit / revenue) * 100).toFixed(2)}%</td></tr></tbody></TableWrap>
        <InfoNote><strong>Xu hướng:</strong> Doanh thu và lợi nhuận tăng ổn định, đạt mức cao nhất trong tuần.</InfoNote>
      </Card>
    </div>
  )
}

export function AdminSettings() {
  const { settings, saveSettings, resetDemo, notify } = useApp()
  const [tab, setTab] = useState('profile')
  const [form, setForm] = useState(settings)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  return (
    <div className="page settings-page">
      <PageHeader title="Cài đặt" subtitle="Quản lý thông tin tài khoản và các thiết lập hệ thống." icon={Settings} />
      <div className="settings-layout">
        <Card className="settings-nav" title="Cài đặt">
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><UserRound />Thông tin cá nhân</button>
          <button className={tab === 'password' ? 'active' : ''} onClick={() => setTab('password')}><ShieldCheck />Đổi mật khẩu</button>
          <button className={tab === 'notifications' ? 'active' : ''} onClick={() => setTab('notifications')}><Info />Thông báo</button>
          <button onClick={resetDemo}><RefreshCcw />Khôi phục dữ liệu mẫu</button>
        </Card>
        {tab === 'profile' ? (
          <Card className="settings-content">
            <h2>Thông tin cá nhân</h2><p>Cập nhật thông tin tài khoản của bạn.</p>
            <div className="profile-form">
              <div className="profile-photo"><div>QT</div><Button variant="outline">Đổi ảnh</Button><small>Định dạng JPG, PNG<br />Tối đa 2MB</small></div>
              <div className="form-grid">
                <Field label="Họ và tên"><Input value={form.name} onChange={set('name')} /></Field><Field label="Email"><Input value={form.email} onChange={set('email')} /></Field>
                <Field label="Số điện thoại"><Input value={form.phone} onChange={set('phone')} /></Field><Field label="Chức vụ"><Select defaultValue="admin"><option value="admin">Quản lý hệ thống</option></Select></Field>
                <Field label="Ngày sinh"><Input type="date" value={form.birthday} onChange={set('birthday')} /></Field><Field label="Giới tính"><Select value={form.gender} onChange={set('gender')}><option>Nam</option><option>Nữ</option><option>Khác</option></Select></Field>
                <Field label="Địa chỉ" className="span-2"><Input value={form.address} onChange={set('address')} /></Field>
                <Field label="Giới thiệu" className="span-2"><textarea value={form.bio} onChange={set('bio')} maxLength={200} /><small>{form.bio.length}/200</small></Field>
              </div>
            </div>
            <div className="login-info"><h3>Thông tin đăng nhập</h3><div className="form-grid"><Field label="Tên đăng nhập"><Input value="admin" disabled /></Field><Field label="Vai trò"><Input value="Quản trị viên" disabled /></Field></div></div>
            <div className="card-actions"><Button icon={Save} onClick={() => saveSettings(form)}>Lưu thay đổi</Button></div>
          </Card>
        ) : (
          <Card className="settings-content settings-placeholder"><ShieldCheck size={48} /><h2>{tab === 'password' ? 'Đổi mật khẩu' : 'Thiết lập thông báo'}</h2><p>{tab === 'password' ? 'Nhập mật khẩu mới để tăng cường bảo mật tài khoản.' : 'Chọn loại thông báo bạn muốn nhận từ hệ thống.'}</p><div className="form-stack">{tab === 'password' ? <><Field label="Mật khẩu hiện tại"><Input type="password" /></Field><Field label="Mật khẩu mới"><Input type="password" /></Field><Field label="Xác nhận mật khẩu"><Input type="password" /></Field></> : <><label className="switch-row"><span>Thông báo công việc mới</span><input type="checkbox" defaultChecked /></label><label className="switch-row"><span>Báo cáo doanh thu hàng ngày</span><input type="checkbox" defaultChecked /></label><label className="switch-row"><span>Cảnh báo chi phí</span><input type="checkbox" /></label></>}<Button onClick={() => notify('Đã lưu thiết lập.')}>Lưu thiết lập</Button></div></Card>
        )}
      </div>
    </div>
  )
}
