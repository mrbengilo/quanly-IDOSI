import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Badge, Button, EmptyState, Modal, TablePagination, TableWrap } from './UI'
import { OrderItemsSummary } from './OrderItemSelector'
import { OrderCustomFieldsSummary } from './OrderCustomFields'
import { OrderRevenueDetails } from './OrderRevenue'
import { useCustomerLookup } from './useCustomerLookup'
import { money, shortDateTime24 } from '../utils'
import './CustomerPurchaseHistory.css'

export function CustomerHistoryBadge({ isReturningCustomer }) {
  return <Badge tone={isReturningCustomer ? 'green' : 'blue'}>{isReturningCustomer ? 'KH cũ' : 'KH mới'}</Badge>
}

export function CustomerLookupPagination({ result, offset, onChange }) {
  if (!result || result.total <= result.limit) return null
  return <TablePagination page={Math.floor(offset / result.limit) + 1} totalPages={Math.ceil(result.total / result.limit)}
    total={result.total} shown={Math.min(result.limit, result.total - offset)} from={offset + 1}
    onPageChange={(page) => onChange((page - 1) * result.limit)} />
}

export function CustomerPurchaseHistory({ app, storeId, scope = 'store', customerKey, onClose, revision = 0, query = '', field = 'phone' }) {
  const container = useRef(null)
  useEffect(() => {
    const trigger = document.activeElement
    container.current?.querySelector('button')?.focus()
    return () => { if (trigger?.isConnected) trigger.focus() }
  }, [])
  const keyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    if (event.key !== 'Tab') return
    const targets = [...container.current.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
    const first = targets[0], last = targets.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const { value, loading, error } = useCustomerLookup({ app, storeId, scope, mode: 'history', customerKey, query, field, offset, revision: revision + retry })
  return createPortal(<div className="customer-purchase-history" ref={container} onKeyDown={keyDown}><Modal open onClose={onClose} title="Lịch sử mua hàng" wide footer={<Button variant="outline" onClick={onClose}>Đóng</Button>}>
    {value && <div className="customer-lookup__contact"><strong>{value.customer.customerName}</strong>
      <span>{value.customer.customerPhone || 'Không có SĐT'}</span><CustomerHistoryBadge isReturningCustomer={value.customer.isReturningCustomer} /><Badge>{value.total} đơn hàng</Badge></div>}
    {loading && <p role="status">Đang tải lịch sử mua hàng…</p>}
    {error && <p role="alert">{error} <Button variant="outline" onClick={() => setRetry((current) => current + 1)}>Thử lại</Button></p>}
    {value?.total === 0 && <EmptyState title="Chưa có lịch sử mua hàng" description="Chưa có đơn hàng phù hợp trên toàn hệ thống." />}
    {value?.total > 0 && <>
      <TableWrap paginate={false} tableLabel="Đơn hàng của khách" tableClassName="customer-history-table">
        <thead><tr><th>STT</th><th>Đơn hàng / Thời gian mua</th><th>Mặt hàng / Số lượng</th><th>Số tiền</th><th>Cửa hàng</th><th>Nhân viên bán</th><th>Thông tin đơn</th></tr></thead>
        <tbody>{value.records.map((order, index) => <tr key={order.id || order.code}>
          <td data-label="STT">{offset + index + 1}</td>
          <td data-label="Đơn hàng / Thời gian mua"><strong>{order.code || order.id}</strong><small className="table-note">{shortDateTime24(order.createdAt || order.date || order.businessDate)}</small>
            <small className="table-note">{order.customerName} • {order.customerPhone || 'Không có SĐT'}</small></td>
          <td data-label="Mặt hàng / Số lượng" data-wide><OrderItemsSummary items={order.items} /><OrderCustomFieldsSummary values={order.customFields} /></td>
          <td data-label="Số tiền"><strong>{money(order.amount)}</strong><OrderRevenueDetails order={order} /></td>
          <td data-label="Cửa hàng">{order.storeName || order.storeId || 'Chưa ghi nhận cửa hàng'}</td>
          <td data-label="Nhân viên bán">{order.employeeName || order.employeeId || 'Chưa ghi nhận nhân viên'}</td>
          <td data-label="Thông tin đơn"><span>{order.paymentMethod || 'Chưa ghi nhận thanh toán'}</span>
            <small className="table-note">{order.shiftName || 'Chưa gắn ca'}</small><Badge>{order.status || 'Đã ghi nhận'}</Badge></td>
        </tr>)}</tbody>
      </TableWrap>
      <CustomerLookupPagination result={value} offset={offset} onChange={setOffset} />
    </>}
  </Modal></div>, document.body)
}

