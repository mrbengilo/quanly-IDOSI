import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Banknote, CalendarDays, PackageCheck, ShoppingCart } from 'lucide-react'
import {
  Card,
  Field,
  InfoNote,
  Input,
  MetricCard,
  PageHeader,
  Select,
  TableWrap,
} from '../../components/UI'
import { OrderPaymentSummary } from '../../components/OrderPaymentSummary'
import { apiGetOrderSummary } from '../../services/idosiApi'
import { useApp } from '../../state/AppContext'
import { money, sameOperationalIdentifier, today } from '../../utils'
import './StoreStatisticsPage.css'

const EMPTY_PRODUCTS = Object.freeze({ totalQuantity: 0, productTypes: 0, ordersWithItems: 0, unclassifiedOrders: 0, items: [] })
const summaryRequest = ({ mode, storeId, month, date, shiftId }) => ({
  storeId,
  period: mode === 'month' ? month : date.slice(0, 7),
  ...(mode === 'month' ? {} : { date }),
  ...(mode === 'shift' && shiftId ? { shiftId } : {}),
})
const requestKey = (request) => JSON.stringify(request)

export function StoreStatisticsPage() {
  const app = useApp()
  const storeId = String(app.activeStoreId || app.session?.storeId || '')
  const store = (app.stores || []).find((candidate) => sameOperationalIdentifier(candidate.id, storeId))
  const [mode, setMode] = useState('day')
  const [month, setMonth] = useState(today().slice(0, 7))
  const [date, setDate] = useState(today())
  const shifts = useMemo(() => (app.shiftDefinitions || [])
    .filter((shift) => (
      !shift.deletedAt
      && shift.active !== false
      && (!shift.storeId || sameOperationalIdentifier(shift.storeId, storeId))
    ))
    .sort((left, right) => String(left.start || left.startTime || '').localeCompare(String(right.start || right.startTime || ''))), [app.shiftDefinitions, storeId])
  const [shiftId, setShiftId] = useState('')
  const effectiveShiftId = shifts.some((shift) => String(shift.id) === shiftId) ? shiftId : String(shifts[0]?.id || '')
  const query = useMemo(() => summaryRequest({ mode, storeId, month, date, shiftId: effectiveShiftId }), [date, effectiveShiftId, mode, month, storeId])
  const key = requestKey(query)
  const cacheRef = useRef(new Map())
  const [result, setResult] = useState({ key: '', status: 'idle', value: null, error: '' })

  useEffect(() => {
    if (!storeId || (mode === 'shift' && !effectiveShiftId)) return undefined
    const cached = cacheRef.current.get(key)
    if (cached) {
      setResult({ key, status: 'ready', value: cached, error: '' })
      return undefined
    }
    const controller = new AbortController()
    setResult((current) => ({ ...current, key, status: 'loading', error: '' }))
    apiGetOrderSummary({ ...query, signal: controller.signal }).then((payload) => {
      cacheRef.current.set(key, payload)
      setResult({ key, status: 'ready', value: payload, error: '' })
    }).catch((error) => {
      if (error?.code !== 'REQUEST_ABORTED') {
        setResult({ key, status: 'error', value: null, error: error?.message || 'Không thể tải số liệu thống kê.' })
      }
    })
    return () => controller.abort()
  }, [effectiveShiftId, key, mode, query, storeId])

  useEffect(() => {
    if (result.key !== key || result.status !== 'ready' || !storeId) return undefined
    let cancelled = false
    const controller = new AbortController()
    const candidates = [
      summaryRequest({ mode: 'month', storeId, month: date.slice(0, 7), date, shiftId: '' }),
      ...shifts.slice(0, 2).map((shift) => summaryRequest({ mode: 'shift', storeId, month, date, shiftId: String(shift.id) })),
    ].filter((candidate) => requestKey(candidate) !== key && !cacheRef.current.has(requestKey(candidate)))
    const warm = async () => {
      for (const candidate of candidates) {
        if (cancelled) return
        try {
          const payload = await apiGetOrderSummary({ ...candidate, signal: controller.signal })
          cacheRef.current.set(requestKey(candidate), payload)
        } catch {
          if (cancelled) return
        }
      }
    }
    let idleId
    const timer = window.setTimeout(() => {
      if (window.requestIdleCallback) idleId = window.requestIdleCallback(() => void warm(), { timeout: 2_000 })
      else void warm()
    }, 1_000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId)
      controller.abort()
    }
  }, [date, key, month, result.key, result.status, shifts, storeId])

  const summary = result.key === key ? result.value : null
  const totals = summary?.totals || { orders: 0, revenue: 0, cash: 0, transfer: 0, cashOrders: 0, transferOrders: 0 }
  const products = summary?.products || EMPTY_PRODUCTS
  const shift = shifts.find((candidate) => String(candidate.id) === effectiveShiftId)
  const scopeLabel = mode === 'month'
    ? `Tháng ${month.split('-').reverse().join('/')}`
    : mode === 'shift'
      ? `${shift?.name || 'Ca'} • ${date.split('-').reverse().join('/')}`
      : `Ngày ${date.split('-').reverse().join('/')}`

  return <div className="page store-statistics-page">
    <PageHeader
      title="SỐ LIỆU THỐNG KÊ"
      subtitle={`Doanh thu và mặt hàng đã bán tại ${store?.name || 'cửa hàng đang chọn'}; chỉ tải dữ liệu của phạm vi đang xem.`}
      icon={BarChart3}
    />

    <Card title="Phạm vi thống kê">
      <div className="store-statistics-filters">
        <Field label="Xem theo"><Select aria-label="Xem thống kê theo" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="shift">Theo ca</option>
          <option value="day">Theo ngày</option>
          <option value="month">Theo tháng</option>
        </Select></Field>
        {mode === 'month'
          ? <Field label="Tháng"><Input aria-label="Tháng thống kê" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field>
          : <Field label="Ngày"><Input aria-label="Ngày thống kê" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>}
        {mode === 'shift' && <Field label="Ca làm việc"><Select aria-label="Ca thống kê" value={effectiveShiftId} onChange={(event) => setShiftId(event.target.value)} disabled={!shifts.length}>
          {shifts.length ? shifts.map((item) => <option key={item.id} value={item.id}>{item.name || item.id} ({item.start || item.startTime || '—'}–{item.end || item.endTime || '—'})</option>) : <option value="">Chưa cấu hình ca</option>}
        </Select></Field>}
      </div>
    </Card>

    {result.key === key && result.status === 'loading' && <InfoNote>Đang tổng hợp {scopeLabel.toLocaleLowerCase('vi-VN')}…</InfoNote>}
    {result.key === key && result.status === 'error' && <InfoNote tone="red">{result.error}</InfoNote>}
    {mode === 'shift' && !shifts.length && <InfoNote tone="orange">Cửa hàng chưa có ca làm việc đang hoạt động.</InfoNote>}

    {summary && <>
      <p className="store-statistics-scope"><CalendarDays size={16} /><strong>{scopeLabel}</strong></p>
      <div className="store-statistics-metrics">
        <MetricCard label="DOANH THU" value={money(totals.revenue)} helper={`${totals.orders} đơn hoàn tất`} icon={Banknote} tone="green" />
        <MetricCard label="TỔNG ĐƠN" value={totals.orders} helper={`${totals.cashOrders} TM • ${totals.transferOrders} CK`} icon={ShoppingCart} tone="blue" />
        <MetricCard label="SẢN PHẨM ĐÃ BÁN" value={`${products.totalQuantity.toLocaleString('vi-VN')} cái`} helper={`${products.productTypes} mặt hàng`} icon={PackageCheck} tone="orange" />
      </div>
      <OrderPaymentSummary totals={totals} />
      {products.unclassifiedOrders > 0 && <InfoNote tone="orange">Có {products.unclassifiedOrders} đơn cũ chưa ghi nhận mặt hàng; doanh thu vẫn được tính đầy đủ.</InfoNote>}
      <Card title="Mặt hàng đã bán">
        {products.items.length ? <TableWrap tableClassName="store-statistics-products" paginate={false}>
          <thead><tr><th>Mặt hàng</th><th>Mã</th><th>Số đơn có mặt hàng</th><th>Số lượng đã bán</th></tr></thead>
          <tbody>{products.items.map((item) => <tr key={item.productId || item.productCode || item.productName}>
            <td data-label="Mặt hàng"><strong>{item.productName || 'Mặt hàng chưa đặt tên'}</strong></td>
            <td data-label="Mã">{item.productCode || '—'}</td>
            <td data-label="Số đơn">{Number(item.orders || 0).toLocaleString('vi-VN')}</td>
            <td data-label="Số lượng"><strong>{Number(item.quantity || 0).toLocaleString('vi-VN')} cái</strong></td>
          </tr>)}</tbody>
        </TableWrap> : <InfoNote>Chưa có mặt hàng được ghi nhận trong phạm vi này.</InfoNote>}
      </Card>
    </>}
  </div>
}

export default StoreStatisticsPage
