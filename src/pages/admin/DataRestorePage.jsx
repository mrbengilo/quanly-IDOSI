import { useCallback, useEffect, useMemo, useState } from 'react'
import { History, LockKeyhole, RefreshCcw, Search } from 'lucide-react'
import { Badge, Button, Card, Field, InfoNote, Modal, PageHeader, SearchInput, Select, TableWrap } from '../../components/UI'
import { apiGetAudit } from '../../services/idosiApi'
import { useApp } from '../../state/AppContext'
import { shortDateTime24 } from '../../utils'

const RESTORABLE_AUDITS = Object.freeze({
  'order:order.update': 'orders',
  'order:order.delete': 'orders',
  'attendance:attendance.update': 'attendance',
  'employee:employee.update': 'employees',
  'employee:employee.delete': 'employees',
})

const ENTITY_LABELS = Object.freeze({
  order: 'Đơn hàng',
  attendance: 'Chấm công',
  employee: 'Nhân viên',
  'operational-reset': 'Khôi phục dữ liệu',
})

const actionLabel = (action) => {
  const operation = String(action || '').split('.').at(-1)
  if (operation === 'delete') return 'Xóa'
  if (operation === 'update') return 'Sửa'
  if (operation === 'restore') return 'Khôi phục'
  return action || '—'
}

const recordDate = (record = {}) => String(
  record.workDate || record.attendanceDate || record.date || record.createdAt || record.updatedAt || '',
).slice(0, 10)

const changedFields = (audit) => {
  const metadataFields = Array.isArray(audit.metadata?.changedFields) ? audit.metadata.changedFields : []
  if (metadataFields.length) return metadataFields
  const before = audit.before && typeof audit.before === 'object' ? audit.before : {}
  const after = audit.after && typeof audit.after === 'object' ? audit.after : {}
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !['updatedAt', 'updatedBy', 'editedAt', 'editedBy'].includes(field))
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .slice(0, 8)
}

const auditSummary = (audit) => {
  const fields = changedFields(audit)
  if (fields.length) return fields.join(', ')
  if (audit.action === 'employee.delete') return 'Hồ sơ và trạng thái tài khoản'
  return 'Dữ liệu trước/sau đã được lưu trong nhật ký'
}

export function DataRestorePage() {
  const { session, restoreOperationalData, notify } = useApp()
  const [audit, setAudit] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [entityType, setEntityType] = useState('all')
  const [selected, setSelected] = useState(null)
  const [reason, setReason] = useState('')
  const [restoring, setRestoring] = useState(false)
  const isAdmin = session?.role === 'admin'

  const loadAudit = useCallback(async ({ append = false } = {}) => {
    if (!isAdmin) return
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    try {
      const beforeId = append ? Number(audit.at(-1)?.id || 0) : 0
      const response = await apiGetAudit({ limit: 100, beforeId })
      const rows = Array.isArray(response.audit) ? response.audit : []
      setAudit((current) => append ? [...current, ...rows] : rows)
      setHasMore(rows.length === 100)
    } catch (requestError) {
      setError(requestError.message || 'Không thể tải nhật ký dữ liệu.')
    } finally {
      append ? setLoadingMore(false) : setLoading(false)
    }
  }, [audit, isAdmin])

  useEffect(() => {
    if (!isAdmin) return undefined
    let active = true
    apiGetAudit({ limit: 100, beforeId: 0 })
      .then((response) => {
        if (!active) return
        const rows = Array.isArray(response.audit) ? response.audit : []
        setAudit(rows)
        setHasMore(rows.length === 100)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Không thể tải nhật ký dữ liệu.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [isAdmin])

  const restoredAuditIds = useMemo(() => new Set(audit
    .filter((item) => item.action === 'operational_reset.restore')
    .map((item) => Number(item.metadata?.sourceAuditLogId || 0))
    .filter((id) => id > 0)), [audit])

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
    return audit.filter((item) => {
      const operation = String(item.action || '').split('.').at(-1)
      if (!['update', 'delete', 'restore'].includes(operation)) return false
      if (entityType !== 'all' && item.entityType !== entityType) return false
      if (!normalizedQuery) return true
      return [item.entityId, item.action, item.actorId, item.before?.name, item.after?.name, item.before?.code, item.after?.code]
        .some((value) => String(value || '').toLocaleLowerCase('vi-VN').includes(normalizedQuery))
    })
  }, [audit, entityType, query])

  const restoreSelected = async () => {
    if (!selected || restoring) return
    if (!reason.trim()) return notify('Vui lòng nhập lý do khôi phục dữ liệu.', 'info')
    const dataType = RESTORABLE_AUDITS[`${selected.entityType}:${selected.action}`]
    if (!dataType) return notify('Loại dữ liệu này chưa hỗ trợ khôi phục tự động.', 'info')
    const source = selected.after || selected.before || {}
    const date = recordDate(source)
    setRestoring(true)
    try {
      const result = await restoreOperationalData({
        dataType,
        auditLogId: selected.id,
        storeId: source.storeId || '',
        ...(date ? { fromDate: date, toDate: date } : {}),
        ...(source.employeeId ? { employeeId: source.employeeId } : {}),
        reason: reason.trim(),
      })
      if (!result?.ok) return notify(result?.message || 'Không thể khôi phục dữ liệu.', 'info')
      setSelected(null)
      setReason('')
      await loadAudit()
    } finally {
      setRestoring(false)
    }
  }

  if (!isAdmin) {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Chỉ Admin được xem và khôi phục dữ liệu hệ thống." icon={LockKeyhole} /></div>
  }

  return <div className="page governance-page">
    <PageHeader
      title="KHÔI PHỤC DỮ LIỆU"
      subtitle="Xem lịch sử sửa/xóa thực tế và khôi phục đúng một phiên bản đã chọn."
      icon={History}
      actions={<Button variant="outline" icon={RefreshCcw} onClick={() => loadAudit()} loading={loading}>TẢI LẠI</Button>}
    />
    <InfoNote>Hệ thống chỉ khôi phục khi dữ liệu hiện tại vẫn khớp bản ghi sau thao tác. Kỳ lương đã khóa/đã chi và dữ liệu phát sinh thay đổi mới hơn luôn được chặn để bảo toàn số liệu.</InfoNote>
    <Card title="Lịch sử dữ liệu đã sửa hoặc xóa" action={<div className="toolbar-wrap"><SearchInput value={query} onChange={setQuery} placeholder="Tìm mã dữ liệu, nhân viên..." /><Select aria-label="Loại dữ liệu" value={entityType} onChange={(event) => setEntityType(event.target.value)}><option value="all">Tất cả dữ liệu</option><option value="order">Đơn hàng</option><option value="attendance">Chấm công</option><option value="employee">Nhân viên</option></Select></div>}>
      {error ? <InfoNote tone="orange">{error}</InfoNote> : null}
      <TableWrap><thead><tr><th>Thời gian</th><th>Loại dữ liệu</th><th>Mã dữ liệu</th><th>Thao tác</th><th>Nội dung thay đổi</th><th>Người thực hiện</th><th>Khôi phục</th></tr></thead><tbody>
        {rows.map((item) => {
          const supported = Boolean(RESTORABLE_AUDITS[`${item.entityType}:${item.action}`])
          const restored = restoredAuditIds.has(Number(item.id))
          return <tr key={item.id}><td>{shortDateTime24(item.serverTimestamp)}</td><td><strong>{ENTITY_LABELS[item.entityType] || item.entityType || 'Dữ liệu'}</strong></td><td><strong>{item.entityId || '—'}</strong></td><td><Badge tone={item.action.endsWith('.delete') ? 'red' : item.action.endsWith('.restore') ? 'green' : 'orange'}>{actionLabel(item.action)}</Badge></td><td>{auditSummary(item)}</td><td>{item.actorId || 'Hệ thống'}<small className="table-note">{item.actorRole || '—'}</small></td><td>{restored ? <Badge tone="green">Đã khôi phục</Badge> : supported ? <Button variant="outline" icon={RefreshCcw} onClick={() => { setSelected(item); setReason('') }}>Khôi phục</Button> : <span className="table-note">Chỉ xem</span>}</td></tr>
        })}
        {!loading && !rows.length ? <tr><td colSpan="7">Chưa có lịch sử sửa hoặc xóa phù hợp.</td></tr> : null}
        {loading ? <tr><td colSpan="7">Đang tải nhật ký dữ liệu...</td></tr> : null}
      </tbody></TableWrap>
      {hasMore ? <div className="card-actions card-actions--below"><Button variant="outline" icon={Search} loading={loadingMore} onClick={() => loadAudit({ append: true })}>TẢI THÊM LỊCH SỬ</Button></div> : null}
    </Card>
    <Modal open={Boolean(selected)} onClose={() => !restoring && setSelected(null)} title="Xác nhận khôi phục dữ liệu" footer={<><Button variant="outline" disabled={restoring} onClick={() => setSelected(null)}>Hủy</Button><Button icon={RefreshCcw} loading={restoring} disabled={restoring || !reason.trim()} onClick={restoreSelected}>KHÔI PHỤC DỮ LIỆU</Button></>}>
      <div className="form-stack">
        <InfoNote tone="orange">Khôi phục <strong>{ENTITY_LABELS[selected?.entityType] || selected?.entityType}</strong> mã <strong>{selected?.entityId}</strong> về trạng thái trước thao tác lúc {shortDateTime24(selected?.serverTimestamp)}.</InfoNote>
        <Field label="Lý do khôi phục" required><textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Nhập lý do để lưu nhật ký kiểm toán" /></Field>
      </div>
    </Modal>
  </div>
}
