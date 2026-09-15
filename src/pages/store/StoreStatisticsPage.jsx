import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, CalendarDays, PackageCheck, ShoppingCart } from 'lucide-react'
import { Button, Card, Field, InfoNote, Input, MetricCard, PageHeader, Select, TableWrap } from '../../components/UI'
import { OrderRevenueSummary } from '../../components/OrderRevenue'
import { WeightConversionTable } from '../../components/OrderWeight'
import { weightTotalText } from '../../components/orderWeightFormat'
import { OrderProductWeightTable } from '../../components/OrderProductWeightTable'
import { ORDER_REVENUE_LABELS } from '../../domain/orderRevenue'
import { OrderPaymentSummary } from '../../components/OrderPaymentSummary'
import { apiGetOrderSummary } from '../../services/idosiApi'
import { useApp } from '../../state/AppContext'
import { money, sameOperationalIdentifier, today } from '../../utils'
import { statisticsShiftKey, statisticsShiftLabel, statisticsShiftOptions } from './statisticsShiftOptions'
import './StoreStatisticsPage.css'

const EMPTY_PRODUCTS = Object.freeze({ totalQuantity: 0, totalWeightKg: 0, productTypes: 0, ordersWithItems: 0, unclassifiedOrders: 0, items: [] })

function useSummaryResource(query, enabled, version, revision, cacheRef) {
  const key = JSON.stringify([query, version, revision])
  const [result, setResult] = useState({ key: '', status: 'idle', value: null, error: '' })
  useEffect(() => {
    if (!enabled || !query.storeId) return undefined
    const cached = cacheRef.current.get(key)
    if (cached) {
      setResult({ key, status: 'ready', value: cached, error: '' })
      return undefined
    }
    const controller = new AbortController()
    setResult({ key, status: 'loading', value: null, error: '' })
    apiGetOrderSummary({ ...query, signal: controller.signal }).then((payload) => {
      if (controller.signal.aborted) return
      if (cacheRef.current.size >= 24) cacheRef.current.clear()
      cacheRef.current.set(key, payload)
      setResult({ key, status: 'ready', value: payload, error: '' })
    }).catch((error) => {
      if (!controller.signal.aborted && error?.code !== 'REQUEST_ABORTED') {
        setResult({ key, status: 'error', value: null, error: error?.message || 'Không thể tải số liệu thống kê.' })
      }
    })
    return () => controller.abort()
  }, [cacheRef, enabled, key, query])
  if (!enabled || !query.storeId) return { key, status: 'idle', value: null, error: '' }
  return result.key === key ? result : { key, status: 'loading', value: null, error: '' }
}

export function StoreStatisticsPage() {
  const app = useApp()
  const storeId = String(app.activeStoreId || app.session?.storeId || '')
  const store = (app.stores || []).find((candidate) => sameOperationalIdentifier(candidate.id, storeId))
  const [mode, setMode] = useState('day')
  const [month, setMonth] = useState(today().slice(0, 7))
  const [date, setDate] = useState(today())
  const definitions = useMemo(() => (app.shiftDefinitions || [])
    .filter((shift) => !shift.deletedAt && shift.active !== false && (!shift.storeId || sameOperationalIdentifier(shift.storeId, storeId)))
    .sort((left, right) => String(left.start || left.startTime || '').localeCompare(String(right.start || right.startTime || ''))), [app.shiftDefinitions, storeId])
  const [selection, setSelection] = useState({ context: '', id: '' })
  const selectionContext = `${storeId}:${date}`
  const [revision, setRevision] = useState(0)
  const cacheRef = useRef(new Map())
  const version = app.stateVersion ?? 0
  const dayQuery = useMemo(() => ({ storeId, period: date.slice(0, 7), date }), [date, storeId])
  // Day groups identify historical shifts; never present this response as a selected shift total.
  const dayResult = useSummaryResource(dayQuery, mode !== 'month', version, revision, cacheRef)
  const shifts = useMemo(() => dayResult.status === 'ready' ? statisticsShiftOptions(definitions, dayResult.value?.groups?.shift || []) : [], [dayResult.status, dayResult.value, definitions])
  const requestedShiftId = selection.context === selectionContext ? selection.id : ''
  const effectiveShiftId = shifts.some((shift) => shift.id === requestedShiftId) ? requestedShiftId : shifts[0]?.id || ''
  const selectedQuery = useMemo(() => mode === 'month' ? { storeId, period: month } : { ...dayQuery, shiftId: effectiveShiftId }, [dayQuery, effectiveShiftId, mode, month, storeId])
  const selectedResult = useSummaryResource(selectedQuery, mode === 'month' || (mode === 'shift' && dayResult.status === 'ready' && Boolean(effectiveShiftId)), version, revision, cacheRef)
  const result = mode === 'day' || (mode === 'shift' && dayResult.status !== 'ready') ? dayResult : selectedResult
  const summary = result.status === 'ready' ? result.value : null
  const totals = summary?.totals || { orders: 0, revenue: 0, cash: 0, transfer: 0, cashOrders: 0, transferOrders: 0 }
  const products = summary?.products || EMPTY_PRODUCTS
  const shift = shifts.find((candidate) => candidate.id === effectiveShiftId)
  const scopeLabel = mode === 'month' ? `Tháng ${month.split('-').reverse().join('/')}` : mode === 'shift'
    ? `${shift?.name || 'Ca'} • ${date.split('-').reverse().join('/')}` : `Ngày ${date.split('-').reverse().join('/')}`
  const groups = mode === 'month' ? summary?.groups?.day || [] : summary?.groups?.shift || []
  const groupTitle = mode === 'month' ? 'Doanh thu từng ngày trong tháng' : 'Doanh thu từng ca'
  const selectShift = (id) => setSelection({ context: selectionContext, id })

  return <div className="page store-statistics-page">
    <PageHeader title="SỐ LIỆU THỐNG KÊ"
      subtitle={`Doanh thu và mặt hàng đã bán tại ${store?.name || 'cửa hàng đang chọn'}; chỉ tải dữ liệu của phạm vi đang xem.`} icon={BarChart3}
      actions={<Button variant="outline" onClick={() => setRevision((value) => value + 1)} disabled={result.status === 'loading'}>Làm mới số liệu</Button>} />
    <Card title="Phạm vi thống kê">
      <div className="store-statistics-filters">
        <Field label="Xem theo"><Select aria-label="Xem thống kê theo" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="shift">Theo ca</option><option value="day">Theo ngày</option><option value="month">Theo tháng</option>
        </Select></Field>
        {mode === 'month'
          ? <Field label="Tháng"><Input aria-label="Tháng thống kê" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field>
          : <Field label="Ngày"><Input aria-label="Ngày thống kê" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>}
        {mode === 'shift' && <Field label="Ca làm việc"><Select aria-label="Ca thống kê" value={effectiveShiftId} onChange={(event) => selectShift(event.target.value)} disabled={!shifts.length || dayResult.status !== 'ready'}>
          {shifts.length ? shifts.map((item) => <option key={item.id} value={item.id}>{statisticsShiftLabel(item)}</option>)
            : <option value="">{dayResult.status === 'loading' ? 'Đang tải danh sách ca…' : 'Chưa có ca để thống kê'}</option>}
        </Select></Field>}
      </div>
    </Card>
    <WeightConversionTable />
    {result.status === 'loading' && <InfoNote>Đang tổng hợp {scopeLabel.toLocaleLowerCase('vi-VN')}…</InfoNote>}
    {result.status === 'error' && <InfoNote tone="red">{result.error}</InfoNote>}
    {mode === 'shift' && dayResult.status === 'ready' && !shifts.length && <InfoNote tone="orange">Chưa có ca được ghi nhận hoặc cấu hình trong ngày đã chọn.</InfoNote>}
    {summary && <>
      <p className="store-statistics-scope"><CalendarDays size={16} /><strong>{scopeLabel}</strong></p>
      <OrderRevenueSummary totals={totals} label={`Doanh thu ${scopeLabel}`} />
      <div className="store-statistics-metrics">
        <MetricCard label="TỔNG ĐƠN" value={totals.orders} helper={`${totals.cashOrders} TM • ${totals.transferOrders} CK`} icon={ShoppingCart} tone="blue" />
        <MetricCard label="SẢN PHẨM ĐÃ BÁN" value={`${products.totalQuantity.toLocaleString('vi-VN')} cái`} helper={`${products.productTypes} mặt hàng`} icon={PackageCheck} tone="orange" />
      </div>
      <OrderPaymentSummary totals={totals} />
      {products.unclassifiedOrders > 0 && <InfoNote tone="orange">Có {products.unclassifiedOrders} đơn cũ chưa ghi nhận mặt hàng; doanh thu vẫn được tính đầy đủ.</InfoNote>}
      <Card title={groupTitle}>
        {groups.length ? <TableWrap tableClassName="store-statistics-revenue" paginate={false}>
          <thead><tr><th>{mode === 'month' ? 'Ngày' : 'Ca'}</th><th>Số đơn</th><th>Bán thường</th><th>Sale theo ký</th><th>Sale theo cái</th><th>Tổng doanh thu</th><th>Khối lượng</th>{mode !== 'shift' && <th>Chi tiết</th>}</tr></thead>
          <tbody>{groups.map((group) => <tr key={group.key}>
            <td data-label={mode === 'month' ? 'Ngày' : 'Ca'}>{mode === 'month' ? group.key.split('-').reverse().join('/') : group.shiftName || group.shiftId || 'Chưa gắn ca'}</td>
            <td data-label="Số đơn">{group.orders}</td>
            {['NORMAL', 'SALE_KG', 'SALE_PIECE'].map((type) => <td key={type} data-label={ORDER_REVENUE_LABELS[type]}>{group.revenueByType ? money(group.revenueByType[type]) : '—'}</td>)}
            <td data-label="Tổng doanh thu"><strong>{money(group.revenue)}</strong></td>
            <td data-label="Khối lượng">{weightTotalText(group.weight)}</td>
            {mode !== 'shift' && <td data-label="Chi tiết">{mode === 'month'
              ? <Button variant="outline" onClick={() => { setDate(group.key); setMode('day') }}>Xem ngày</Button>
              : statisticsShiftKey(group) ? <Button variant="outline" onClick={() => { selectShift(statisticsShiftKey(group)); setMode('shift') }}>Xem ca</Button> : '—'}</td>}
          </tr>)}</tbody>
        </TableWrap> : <InfoNote>Chưa có đơn hàng trong phạm vi này.</InfoNote>}
      </Card>
      <OrderProductWeightTable rows={products.weightByProduct} />
      <Card title="Mặt hàng đã bán">
        {products.items.length ? <TableWrap tableClassName="store-statistics-products" paginate={false}>
          <thead><tr><th>Mặt hàng</th><th>Mã</th><th>Loại doanh thu</th><th>Số đơn có mặt hàng</th><th>Số lượng đã bán</th><th>Khối lượng</th></tr></thead>
          <tbody>{products.items.map((item) => <tr key={`${item.productId || item.productCode || item.productName}:${item.revenueType || 'NORMAL'}`}>
            <td data-label="Mặt hàng">{item.productName || 'Mặt hàng chưa đặt tên'}</td>
            <td data-label="Mã">{item.productCode || '—'}</td>
            <td data-label="Loại doanh thu">{ORDER_REVENUE_LABELS[item.revenueType || 'NORMAL']}</td>
            <td data-label="Số đơn">{Number(item.orders || 0).toLocaleString('vi-VN')}</td>
            <td data-label="Số lượng"><strong>{Number(item.quantity || 0).toLocaleString('vi-VN')} {item.unit === 'KG' ? 'kg' : 'cái'}</strong></td>
            <td data-label="Khối lượng">{weightTotalText(item.weight)}<small className="table-note">{item.unit === 'KG' ? 'Thực bán' : 'Quy đổi ước tính'}</small></td>
          </tr>)}</tbody>
        </TableWrap> : <InfoNote>Chưa có mặt hàng được ghi nhận trong phạm vi này.</InfoNote>}
      </Card>
    </>}
  </div>
}

export default StoreStatisticsPage
