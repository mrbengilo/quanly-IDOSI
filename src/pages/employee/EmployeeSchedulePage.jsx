import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarCheck, CalendarDays, Clock3, Store } from 'lucide-react'
import { Badge, Card, Field, Input, PageHeader, TableWrap } from '../../components/UI'
import { isVietnamDateTimeLocal } from '../../domain/supportTransferTime'
import { useApp } from '../../state/AppContext'
import { money, shortDate, today } from '../../utils'
import { employeeScheduleDate, employeeScheduleRange, employeeScheduleRows } from './employeeSchedule'

const employeeKey = (employee = {}) => String(employee.id || employee.code || employee.employeeId || '')
const identifierKey = (value) => String(value || '').trim().toLocaleLowerCase('vi-VN')
const employeeIdentifiers = (employee = {}) => [employee.id, employee.code, employee.employeeId, employee.employeeCode]
  .map(identifierKey).filter(Boolean)
const currentEmployeeOf = (app) => {
  if (app.currentEmployee) return app.currentEmployee
  const keys = new Set(employeeIdentifiers(app.session))
  return (app.employees || []).find((employee) => employeeIdentifiers(employee).some((key) => keys.has(key))) || app.session || {}
}
const scheduleKindLabels = Object.freeze({
  home: 'Lịch cửa hàng chính',
  support: 'Lịch cửa hàng hỗ trợ',
  other: 'Lịch cửa hàng khác',
})
const scheduleKindTone = (kind) => kind === 'support' ? 'orange' : kind === 'home' ? 'green' : 'blue'

export function EmployeeSchedulePage() {
  const app = useApp()
  const employee = currentEmployeeOf(app)
  const [mode, setMode] = useState('day')
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedDate = searchParams.get('date') || ''
  const anchorDate = isVietnamDateTimeLocal(`${requestedDate}T00:00`) ? requestedDate : today()
  const setAnchorDate = (date) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    next.set('date', date)
    return next
  }, { replace: true })
  const range = useMemo(() => employeeScheduleRange(anchorDate, mode), [anchorDate, mode])
  const rows = useMemo(() => employeeScheduleRows({
    schedule: app.schedule,
    shiftDefinitions: app.shiftDefinitions,
    supportTransfers: app.supportTransfers,
    stores: app.stores,
    employee,
    range,
  }), [app.schedule, app.shiftDefinitions, app.stores, app.supportTransfers, employee, range])

  return (
    <div className="page employee-schedule-page">
      <PageHeader title="LỊCH PHÂN CA" subtitle={`Lịch làm việc của ${employee.name || employeeKey(employee) || 'nhân viên'}.`} icon={CalendarCheck} />
      <Card className="filter-card">
        <div className="tabs" role="tablist" aria-label="Kiểu xem lịch phân ca">
          <button type="button" className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')}>Theo ngày</button>
          <button type="button" className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>Theo tuần</button>
          <button type="button" className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>Theo tháng</button>
        </div>
        <Field label={mode === 'month' ? 'Chọn tháng' : 'Chọn ngày'}>
          <Input
            icon={CalendarDays}
            type={mode === 'month' ? 'month' : 'date'}
            value={mode === 'month' ? anchorDate.slice(0, 7) : anchorDate}
            onChange={(event) => setAnchorDate(mode === 'month' ? `${event.target.value}-01` : employeeScheduleDate(event.target.value))}
          />
        </Field>
        <p className="table-note">Phạm vi: {shortDate(range.from)} – {shortDate(range.to)}</p>
      </Card>
      <Card title="Bảng phân ca làm việc">
        <TableWrap>
          <thead><tr><th>Ngày</th><th>Cửa hàng</th><th>Ca / Thời gian</th><th>Loại lịch</th><th>Lương hỗ trợ</th><th>Phụ cấp</th><th>Ghi chú</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td><strong>{shortDate(row.date)}</strong></td>
            <td><span className="table-stack"><strong><Store size={14} /> {row.storeName}</strong></span></td>
            <td><span className="table-stack"><strong>{row.shiftName}</strong><small><Clock3 size={13} /> {row.start || '—'} – {row.end || '—'}</small></span></td>
            <td><Badge tone={scheduleKindTone(row.kind)}>{scheduleKindLabels[row.kind] || scheduleKindLabels.other}</Badge></td>
            <td>{row.kind === 'support' ? `${money(row.hourlyRate)}/giờ` : '—'}</td>
            <td>{row.kind === 'support' ? money(row.allowance) : '—'}</td>
            <td>{row.note || '—'}</td>
          </tr>)}{!rows.length && <tr><td colSpan="7">Chưa có lịch phân ca trong phạm vi đã chọn.</td></tr>}</tbody>
        </TableWrap>
      </Card>
    </div>
  )
}

export default EmployeeSchedulePage
