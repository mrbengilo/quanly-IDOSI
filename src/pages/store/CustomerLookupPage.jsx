import { useId, useState } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import { Button, Card, EmptyState, Field, Input, PageHeader, TableWrap } from '../../components/UI'
import { useCustomerLookup } from '../../components/useCustomerLookup'
import { CustomerHistoryBadge, CustomerPurchaseHistory, CustomerLookupPagination } from '../../components/CustomerPurchaseHistory'
import { useApp } from '../../state/AppContext'
import './CustomerLookupPage.css'

export function CustomerLookupPage({ systemWide = false }) {
  const app = useApp()
  const globalHistory = systemWide
  const scope = globalHistory ? 'global' : 'store'
  const storeId = globalHistory ? '' : String(app.activeStoreId || app.session?.storeId || '')
  const [search, setSearch] = useState({ storeId, query: '', offset: 0 })
  const [selected, setSelected] = useState(null)
  const [revision, setRevision] = useState(0)
  const id = useId()
  const query = search.storeId === storeId ? search.query : ''
  const offset = search.storeId === storeId ? search.offset : 0
  const { value, loading, error } = useCustomerLookup({ app, storeId, scope, query, offset, revision })
  const changeOffset = (next) => setSearch({ storeId, query, offset: next })
  return <div className="page customer-lookup-page">
    <PageHeader title="Tra cứu" subtitle={globalHistory ? 'Thông tin khách hàng và toàn bộ lịch sử mua hàng trên toàn hệ thống.' : 'Khách đã mua tại cửa hàng này. Chọn khách để xem lịch sử mua hàng của khách trên toàn hệ thống.'}
      actions={<Button variant="outline" icon={RefreshCw} onClick={() => { changeOffset(0); setRevision((current) => current + 1) }}>Làm mới</Button>} />
    <Card title="Khách hàng" subtitle={value ? `${value.total} khách hàng phù hợp` : 'Tra cứu theo tên hoặc số điện thoại'}>
      <div className="customer-lookup__search"><Field label="Tìm theo tên khách hàng hoặc SĐT">
        <Input icon={Search} list={id} value={query} autoComplete="off" placeholder="Nhập tên khách hàng hoặc số điện thoại…"
          onChange={(event) => setSearch({ storeId, query: event.target.value, offset: 0 })} />
        <datalist id={id}>{(value?.customers || []).map((customer) => <option key={customer.key}
          value={customer.customerPhone || customer.customerName}>{customer.customerName} • {customer.customerPhone || 'Không có SĐT'} • {customer.isReturningCustomer ? 'KH cũ' : 'KH mới'}</option>)}</datalist>
      </Field></div>
      {!globalHistory && !storeId && <EmptyState title="Chưa chọn cửa hàng" description="Chọn cửa hàng để tra cứu khách hàng." />}
      {loading && <p role="status">Đang tra cứu khách hàng…</p>}
      {error && <p role="alert">{error}</p>}
      {value?.customers.length > 0 && <>
        <TableWrap paginate={false} tableLabel="Danh sách khách hàng">
          <thead><tr><th>STT</th><th>Tên khách hàng</th><th>SĐT</th><th>Lịch sử toàn hệ thống</th></tr></thead>
          <tbody>{value.customers.map((customer, index) => <tr key={customer.key}>
            <td data-label="STT">{offset + index + 1}</td><td data-label="Tên khách hàng"><strong>{customer.customerName}</strong><span className="table-note"><CustomerHistoryBadge isReturningCustomer={customer.isReturningCustomer} /></span></td>
            <td data-label="SĐT">{customer.customerPhone || 'Không có SĐT'}</td>
            <td data-label="Lịch sử toàn hệ thống"><Button variant="outline" onClick={() => setSelected({ storeId, key: customer.key })}>Lịch sử mua hàng ({customer.orderCount})</Button></td>
          </tr>)}</tbody>
        </TableWrap><CustomerLookupPagination result={value} offset={offset} onChange={changeOffset} />
      </>}
      {value?.customers.length === 0 && <EmptyState title={query ? 'Không tìm thấy khách hàng' : 'Chưa có khách hàng'} description={query ? (globalHistory ? 'Thử tên hoặc số điện thoại khác.' : 'Không có khách đã mua tại cửa hàng này khớp tên hoặc SĐT đã nhập.') : (globalHistory ? 'Khách hàng sẽ xuất hiện khi hệ thống có đơn hàng.' : 'Khách hàng sẽ xuất hiện khi có đơn mua tại cửa hàng này.')} />}
    </Card>
    {selected?.storeId === storeId && <CustomerPurchaseHistory key={`${scope}:${storeId}:${selected.key}`} app={app} storeId={storeId} scope={scope}
      customerKey={selected.key} revision={revision} onClose={() => setSelected(null)} />}
  </div>
}
