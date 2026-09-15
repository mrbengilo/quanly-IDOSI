import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { summarizeOrders } from '../domain/orderSummary'
import { OrderProductWeightTable } from './OrderProductWeightTable'

afterEach(cleanup)
const scope = { storeId: 'S1', period: '2026-09' }
const base = { storeId: 'S1', employeeId: 'E1', createdAt: '2026-09-15T09:00:00+07:00', amount: 100000, shiftId: 'AM' }
const line = (productId, productName, quantity) => ({ productId, productName, quantity })
const renderReport = (products) => render(<OrderProductWeightTable rows={products.weightByProduct} totals={products} scopeLabel="Tháng 09/2026" />)
const table = () => screen.getByRole('table', { name: 'Thống kê mặt hàng • Tháng 09/2026' })
const summary = (orders) => summarizeOrders(orders, scope)

describe('estimated-weight subtotal with incomplete legacy data', () => {
  it('shows the sum of 392 known pieces while keeping unrelated unclassified orders visibly separate', () => {
    const quantities = [
      ['Áo nữ', 21], ['Chân váy', 5], ['Đầm', 4], ['Đồ bộ', 1], ['Đồ nam', 17], ['Đồ nội y mới', 6],
      ['Đồ thể thao', 10], ['Giày dép túi xách', 15], ['Hàng thương hiệu', 35], ['Khăn lông', 1],
      ['Nam SM', 12], ['Nữ SM', 214], ['Quần dài nữ', 4], ['Quần short', 1], ['Sản phẩm tiện ích', 14], ['Trẻ em SM', 32],
    ]
    const report = summary([
      { ...base, id: 'KNOWN', items: quantities.map(([name, quantity], index) => line(`P${index}`, name, quantity)) },
      { ...base, id: 'LEGACY', items: [] },
    ])
    expect(report.products.weight).toMatchObject({ estimatedKg: 112.083333, actualKg: 0, isComplete: false, totalKg: null, unclassifiedOrders: 1 })
    renderReport(report.products)
    const footer = within(table()).getByRole('row', { name: 'Tổng 392 ≈ 112,083 kg Phần đã quy đổi' })
    expect(within(footer).queryByText('Chưa đủ dữ liệu')).toBeNull()
    expect(screen.getByText(/chưa gồm 1 đơn chưa ghi nhận mặt hàng/u)).toBeTruthy()
    expect(report.products.weight.isComplete).toBe(false)
    expect(report.totals.revenue).toBe(200000)
  })

  it('uses the backend fraction total, not the sum of rounded display values or actual kg', () => {
    const report = summary([
      ...['Đầm', 'Đồ nam', 'Đồ bộ'].map((name, index) => ({ ...base, id: `R${index}`, items: [line(`P${index}`, name, 1)] })),
      { ...base, id: 'KG', amount: 5000, items: [{ ...line('KG', 'Đầm', 5), revenueType: 'SALE_KG', unitPrice: 1000 }] },
      { ...base, id: 'OLD' },
    ])
    renderReport(report.products)
    expect(within(table()).getByRole('row', { name: 'Tổng 3 ≈ 1 kg Phần đã quy đổi' })).toBeTruthy()
    expect(report.products.weight).toMatchObject({ estimatedKg: 1, actualKg: 5, knownKg: 6, totalKg: null })
    expect(within(table()).queryByText('≈ 0,999 kg')).toBeNull()
  })

  it('retains positive known estimates within an incomplete product and explains missing factors', () => {
    const report = summary([
      { ...base, id: 'MAPPED', items: [line('DRESS', 'Đầm', 3)] },
      { ...base, id: 'UNMAPPED', items: [{ ...line('DRESS', 'Đầm', 4), weightConversion: { version: 'IDOSI-2026-09-15-v2', status: 'UNMAPPED', ruleId: null, piecesPerKg: null } }] },
    ])
    renderReport(report.products)
    expect(within(table()).getByRole('row', { name: 'Đầm 7 ≈ 1 kg Phần đã quy đổi' })).toBeTruthy()
    expect(within(table()).getByRole('row', { name: 'Tổng 7 ≈ 1 kg Phần đã quy đổi' })).toBeTruthy()
    expect(screen.getByText(/1 dòng chưa có hệ số quy đổi phù hợp/u)).toBeTruthy()
    expect(report.products.weight.totalKg).toBeNull()
  })

  it('never presents an entirely unmapped set as zero kg', () => {
    renderReport(summary([{ ...base, items: [line('NEW', 'Chưa có hệ số', 5)] }]).products)
    expect(within(table()).getByRole('row', { name: 'Tổng 5 Chưa đủ dữ liệu' })).toBeTruthy()
    expect(within(table()).queryByText('0 kg')).toBeNull()
    expect(screen.queryByText('Phần đã quy đổi')).toBeNull()
  })

  it('does not invent a sum when the API omits or returns an invalid estimated value', () => {
    const products = summary([{ ...base, items: [line('DRESS', 'Đầm', 3)] }]).products
    const view = renderReport({ ...products, weight: { ...products.weight, estimatedKg: null } })
    for (const estimatedKg of [undefined, Number.NaN, -1, Infinity, '1']) {
      view.rerender(<OrderProductWeightTable rows={products.weightByProduct} totals={{ ...products, weight: { ...products.weight, estimatedKg } }} scopeLabel="Tháng 09/2026" />)
      expect(within(table()).getByRole('row', { name: 'Tổng 3 —' })).toBeTruthy()
    }
  })

  it('keeps complete zero estimates valid and removes partial warnings when the report becomes complete', () => {
    const complete = summary([{ ...base, items: [line('DRESS', 'Đầm', 3)] }]).products
    const view = renderReport({ ...complete, weight: { ...complete.weight, isComplete: false, totalKg: null, invalidLines: 1 } })
    expect(screen.getByText(/1 dòng có dữ liệu không hợp lệ/u)).toBeTruthy()
    view.rerender(<OrderProductWeightTable rows={complete.weightByProduct} totals={complete} scopeLabel="Tháng 09/2026" />)
    expect(within(table()).getByRole('row', { name: 'Tổng 3 ≈ 1 kg' })).toBeTruthy()
    expect(screen.queryByText('Phần đã quy đổi')).toBeNull()
    const actualOnly = summary([{ ...base, amount: 5000, items: [{ ...line('KG', 'Đầm', 5), revenueType: 'SALE_KG', unitPrice: 1000 }] }]).products
    view.rerender(<OrderProductWeightTable rows={actualOnly.weightByProduct} totals={actualOnly} scopeLabel="Tháng 09/2026" />)
    expect(within(table()).getByRole('row', { name: 'Tổng 0 0 kg' })).toBeTruthy()
  })
})
