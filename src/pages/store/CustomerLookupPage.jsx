import { useId, useState } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, TablePagination, TableWrap } from '../../components/UI'
import { OrderItemsSummary } from '../../components/OrderItemSelector'
import { OrderCustomFieldsSummary } from '../../components/OrderCustomFields'
import { OrderRevenueDetails } from '../../components/OrderRevenue'
import { useCustomerLookup } from '../../components/useCustomerLookup'
import { CustomerHistoryBadge } from '../../components/CustomerPhoneInput'
import { useApp } from '../../state/AppContext'
import { money, shortDateTime24 } from '../../utils'
import './CustomerLookupPage.css'

function Pagination({ result, offset, onChange }) {
  if (!result || result.total <= result.limit) return null
  return <TablePagination page={Math.floor(offset / result.limit) + 1} totalPages={Math.ceil(result.total / result.limit)}
    total={result.total} shown={Math.min(result.limit, result.total - offset)} from={offset + 1}
    onPageChange={(page) => onChange((page - 1) * result.limit)} />
}

function CustomerHistory({ app, storeId, customerKey, onClose, revision }) {
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const { value, loading, error } = useCustomerLookup({ app, storeId, mode: 'history', customerKey, offset, revision: revision + retry })
  return <Modal open onClose={onClose} title="Lịch sử mua hàng" wide footer={<Button variant="outline" onClick={onClose}>Đóng</Button>}>
    {value && <div className="customer-lookup__contact"><strong>{value.customer.customerName}</strong>
      <span>{value.customer.customerPhone || 'Không có SĐT'}</span><CustomerHistoryBadge hasPurchaseHistory={value.customer.hasPurchaseHistory} /><Badge>{value.total} đơn hàng tại cửa hàng</Badge></div>}
    {loading && <p role="status">Đang tải lịch sử mua hàng…</p>}
    {error && <p role="alert">{error} <Button variant="outline" onClick={() => setRetry((current) => current + 1)}>Thử lại</Button></p>}
    {value?.total === 0 && <EmptyState title="Chưa có đơn hàng tại cửa hàng này" description="Khách đã có lịch sử mua hàng trên toàn hệ thống và được nhận diện là KH cũ." />}
    {value?.total > 0 && <>
      <TableWrap paginate={false} tableLabel="Đơn hàng của khách" tableClassName="customer-history-table">
        <thead><tr><th>STT</th><th>Đơn hàng / Thời gian mua</th><th>Mặt hàng / Số lượng</th><th>Số tiền</th><th>Thông tin đơn</th></tr></thead>
        <tbody>{value.records.map((order, index) => <tr key={order.id || order.code}>
          <td data-label="STT">{offset + index + 1}</td>
          <td data-label="Đơn hàng / Thời gian mua"><strong>{order.code || order.id}</strong><small className="table-note">{shortDateTime24(order.createdAt || order.date || order.businessDate)}</small>
            <small className="table-note">{order.customerName} • {order.customerPhone || 'Không có SĐT'}</small></td>
          <td data-label="Mặt hàng / Số lượng" data-wide><OrderItemsSummary items={order.items} /><OrderCustomFieldsSummary values={order.customFields} /></td>
          <td data-label="Số tiền"><strong>{money(order.amount)}</strong><OrderRevenueDetails order={order} /></td>
          <td data-label="Thông tin đơn"><span>{order.paymentMethod || 'Chưa ghi nhận thanh toán'}</span><small className="table-note">{order.employeeName || order.employeeId || 'Chưa ghi nhận nhân viên'}</small>
            <small className="table-note">{order.shiftName || 'Chưa gắn ca'}</small><Badge>{order.status || 'Đã ghi nhận'}</Badge></td>
        </tr>)}</tbody>
      </TableWrap>
      <Pagination result={value} offset={offset} onChange={setOffset} />
    </>}
  </Modal>
}

export function CustomerLookupPage() {
  const app = useApp()
  const storeId = String(app.activeStoreId || app.session?.storeId || '')
  const [search, setSearch] = useState({ storeId, query: '', offset: 0 })
  const [selected, setSelected] = useState(null)
  const [revision, setRevision] = useState(0)
  const id = useId()
  const query = search.storeId === storeId ? search.query : ''
  const offset = search.storeId === storeId ? search.offset : 0
  const { value, loading, error } = useCustomerLookup({ app, storeId, query, offset, revision })
  const changeOffset = (next) => setSearch({ storeId, query, offset: next })
  return <div className="page customer-lookup-page">
    <PageHeader title="Tra cứu" subtitle="Tìm khách hàng và nhận diện KH cũ trên toàn hệ thống. Chi tiết đơn hiển thị theo quyền tại cửa hàng."
      actions={<Button variant="outline" icon={RefreshCw} onClick={() => { changeOffset(0); setRevision((current) => current + 1) }}>Làm mới</Button>} />
    <Card title="Khách hàng" subtitle={value ? `${value.total} khách hàng phù hợp` : 'Tra cứu theo tên hoặc số điện thoại'}>
      <div className="customer-lookup__search"><Field label="Tìm theo tên khách hàng hoặc SĐT">
        <Input icon={Search} list={id} value={query} autoComplete="off" placeholder="Nhập tên khách hàng hoặc số điện thoại…"
          onChange={(event) => setSearch({ storeId, query: event.target.value, offset: 0 })} />
        <datalist id={id}>{(value?.customers || []).map((customer) => <option key={customer.key}
          value={customer.customerPhone || customer.customerName}>{customer.customerName} • {customer.customerPhone || 'Không có SĐT'} • {customer.hasPurchaseHistory ? 'KH cũ' : 'KH mới'}</option>)}</datalist>
      </Field></div>
      {!storeId && <EmptyState title="Chưa chọn cửa hàng" description="Chọn cửa hàng để tra cứu khách hàng." />}
      {loading && <p role="status">Đang tra cứu khách hàng…</p>}
      {error && <p role="alert">{error}</p>}
      {value?.customers.length > 0 && <>
        <TableWrap paginate={false} tableLabel="Danh sách khách hàng">
          <thead><tr><th>STT</th><th>Tên khách hàng</th><th>SĐT</th><th>Lịch sử tại cửa hàng</th></tr></thead>
          <tbody>{value.customers.map((customer, index) => <tr key={customer.key}>
            <td data-label="STT">{offset + index + 1}</td><td data-label="Tên khách hàng"><strong>{customer.customerName}</strong><span className="table-note"><CustomerHistoryBadge hasPurchaseHistory={customer.hasPurchaseHistory} /></span></td>
            <td data-label="SĐT">{customer.customerPhone || 'Không có SĐT'}</td>
            <td data-label="Lịch sử tại cửa hàng"><Button variant="outline" onClick={() => setSelected({ storeId, key: customer.key })}>Lịch sử mua hàng ({customer.orderCount})</Button></td>
          </tr>)}</tbody>
        </TableWrap><Pagination result={value} offset={offset} onChange={changeOffset} />
      </>}
      {value?.customers.length === 0 && <>{query.trim() && <div className="customer-lookup__contact"><CustomerHistoryBadge hasPurchaseHistory={false} /><span>Chưa có lịch sử mua hàng khớp thông tin tra cứu trên toàn hệ thống.</span></div>}<EmptyState title={query ? 'Không tìm thấy khách hàng' : 'Chưa có khách hàng'} description={query ? 'Thử tên hoặc số điện thoại khác.' : 'Khách hàng sẽ xuất hiện khi hệ thống có đơn hàng.'} /></>}
    </Card>
    {selected?.storeId === storeId && <CustomerHistory key={`${storeId}:${selected.key}`} app={app} storeId={storeId}
      customerKey={selected.key} revision={revision} onClose={() => setSelected(null)} />}
  </div>
}
