import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import { Badge, Button, Card } from './UI'
import { SupportEmployeeTag } from './SupportEmployeeTag'
import { formatVietnamTransferDateTime, supportTransferBounds } from '../domain/supportTransferTime'
import { sameScheduleIdentifier as same, scheduleWindows, supportAllowsScheduling } from '../domain/supportScheduling'
import './supportTransferOverview.css'

export function SupportTransferOverview() {
  const app = useApp()
  const navigate = useNavigate()
  const [now, setNow] = useState(Date.now)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  const isEmployee = app.session?.role === 'employee'
  const employeeId = app.session?.employeeId || app.session?.code || app.session?.id
  const storeId = app.activeStore?.id || app.activeStoreId || app.session?.storeId
  const employees = [...(app.employees || []), ...(app.supportRoster || [])]
  const storeName = (id, fallback) => app.stores?.find((store) => same(store.id, id))?.name || fallback || id
  const windows = scheduleWindows(app)
  const rows = (app.supportTransfers || []).flatMap((transfer) => {
    if (isEmployee ? !same(transfer.employeeId, employeeId)
      : ![transfer.fromStoreId, transfer.toStoreId].some((id) => same(id, storeId))) return []
    const bounds = supportTransferBounds(transfer)
    const ownOpen = (app.attendance || []).filter((record) => same(record.employeeId || record.employeeCode, transfer.employeeId)
      && !record.deletedAt && !record.checkOut && !record.checkOutAt)
    const supportingOpen = ownOpen.find((record) => same(record.supportTransferId, transfer.id))
    if (!supportingOpen && (!bounds || bounds.endMs <= now || !supportAllowsScheduling(transfer))) return []
    const planned = windows.filter((window) => same(window.employeeId, transfer.employeeId)
      && same(window.storeId, transfer.toStoreId) && bounds
      && bounds.startMs <= window.startMs && window.endMs <= bounds.endMs)
    const blockedAt = ownOpen.find((record) => !same(record.storeId, transfer.toStoreId))
    const blocked = Boolean(blockedAt)
    const status = supportingOpen
      ? transfer.schedulingClosedAt ? 'Đã dừng phân ca — Chưa kết ca'
        : bounds?.endMs <= now ? 'Hết thời gian hỗ trợ — Chưa kết ca' : 'Đang làm việc tại cửa hàng hỗ trợ'
      : blocked ? `Đang làm tại ${storeName(blockedAt.storeId)} — Chưa kết ca`
        : planned.length ? 'Đã phân ca — Chưa điểm danh' : 'Chờ phân ca hỗ trợ'
    return [{ transfer, bounds, supportingOpen, blocked, planned, status }]
  }).sort((a, b) => Number(Boolean(b.supportingOpen)) - Number(Boolean(a.supportingOpen))
    || (a.bounds?.startMs || 0) - (b.bounds?.startMs || 0))
  if (!rows.length) return null
  return <section className="support-transfer-overview" aria-label="Thông tin điều chuyển hỗ trợ">
    <Card title={`Điều chuyển hỗ trợ (${rows.length})`}>
      <div className="support-transfer-overview__list">
        {(expanded ? rows : rows.slice(0, 4)).map(({ transfer, bounds, supportingOpen, blocked, planned, status }) => {
          const employee = employees.find((item) => same(item.id || item.code, transfer.employeeId))
          const fromName = storeName(transfer.fromStoreId, transfer.fromStoreName)
          const toName = storeName(transfer.toStoreId, transfer.toStoreName)
          return <article key={transfer.id} className="support-transfer-overview__item">
            <div className="support-transfer-overview__details">
              <strong>{employee?.name || transfer.employeeName || transfer.employeeId}</strong>
              <SupportEmployeeTag context={{ homeStoreId: transfer.fromStoreId, homeStoreName: fromName,
                supportStoreId: transfer.toStoreId, supportStoreName: toName }} />
              <span>{fromName} → {toName}</span>
              <span>{formatVietnamTransferDateTime(bounds?.startAt)} – {formatVietnamTransferDateTime(bounds?.endAt)}</span>
              {supportingOpen ? <span>Ca {supportingOpen.shiftName || supportingOpen.shiftId}: {supportingOpen.shiftStart}–{supportingOpen.shiftEnd}</span>
                : <span>{planned.length ? `Đã xếp ${planned.length} ca. Xem lịch để kiểm tra ngày giờ.` : 'Cửa hàng nhận có thể phân ca trong thời gian hỗ trợ.'}</span>}
              <Badge tone={supportingOpen || blocked ? 'orange' : 'blue'}>{status}</Badge>
              {blocked && <small>Phải kết ca đang làm thành công trước khi vào ca hỗ trợ.</small>}
              {transfer.note && <small>{transfer.note}</small>}
            </div>
            <Button variant="outline" onClick={() => navigate(isEmployee
              ? supportingOpen ? '/employee/attendance' : '/employee/schedule'
              : '/store/schedule')}>
              {isEmployee ? supportingOpen ? 'Xem ca đang làm' : 'Xem lịch' : 'Xem / phân ca'}
            </Button>
          </article>
        })}
      </div>
      {rows.length > 4 && <Button variant="ghost" onClick={() => setExpanded((value) => !value)}>
        {expanded ? 'Thu gọn' : `Xem tất cả ${rows.length} điều chuyển`}
      </Button>}
    </Card>
  </section>
}
