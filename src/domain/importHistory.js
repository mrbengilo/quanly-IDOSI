import { businessDate } from '../utils'

export const validImportPeriod = (value, mode = 'month') => {
  const text = String(value || '')
  if (mode === 'month') return /^[1-9]\d{3}-(0[1-9]|1[0-2])$/u.test(text)
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])-\d{2}$/u.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

export const previousImportPeriod = (period, mode = 'month') => {
  if (!validImportPeriod(period, mode)) return ''
  const date = new Date(`${mode === 'month' ? `${period}-01` : period}T00:00:00Z`)
  if (mode === 'month') date.setUTCMonth(date.getUTCMonth() - 1)
  else date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, mode === 'month' ? 7 : 10)
}

// Stored totals are authoritative. The fallback matches legacy voucher creation:
// rounded weight × unit price per item, plus shipping and related costs.
export const importVoucherAmounts = (voucher) => {
  const goods = Number(voucher.goodsAmount ?? (voucher.items || []).reduce((sum, item) => (
    sum + Math.round(Number(item.weight ?? item.quantity ?? 0) * Number(item.price || 0))
  ), 0))
  const shipping = Number(voucher.shippingAmount || 0)
  const related = Number(voucher.relatedAmount || 0)
  return { goods, shipping, total: Number(voucher.totalAmount ?? (goods + shipping + related)) }
}

export function selectImportHistory(vouchers, { storeId, period, mode = 'month' }) {
  const rows = validImportPeriod(period, mode) && storeId
    ? (vouchers || []).filter((voucher) => (
      voucher.storeId === storeId && !voucher.deletedAt && voucher.status !== 'Đã xóa'
      && businessDate(voucher.createdAt).slice(0, mode === 'month' ? 7 : 10) === period
    )).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    : []
  const totals = rows.reduce((sum, voucher) => {
    const amounts = importVoucherAmounts(voucher)
    return { goods: sum.goods + amounts.goods, shipping: sum.shipping + amounts.shipping, total: sum.total + amounts.total }
  }, { goods: 0, shipping: 0, total: 0 })
  return { rows, totals: { ...totals, count: rows.length } }
}

export const importPeriodChange = (current, previous) => ({
  amount: current - previous,
  percent: previous ? ((current - previous) / previous) * 100 : current ? null : 0,
})
