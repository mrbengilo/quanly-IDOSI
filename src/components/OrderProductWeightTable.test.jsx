import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { summarizeOrders } from '../domain/orderSummary'
import { OrderProductWeightTable } from './OrderProductWeightTable'

afterEach(cleanup)
const scopeLabel = 'Tháng 09/2026'
const base = { storeId: 'S1', createdAt: '2026-09-01', amount: 100000 }
const rowItem = (productId, productName, quantity) => ({ productId, productName, quantity })
const products = summarizeOrders([
  { ...base, id: 'PIECES', items: [rowItem('MEN', 'Đồ nam', 300), rowItem('DRESS', 'Đầm', 400), rowItem('BED', 'Chăn, ga, bao gối, nệm gòn', 2)] },
  { ...base, id: 'KG', amount: 5000, items: [{ ...rowItem('DRESS', 'Đầm', 5), revenueType: 'SALE_KG', unitPrice: 1000 }] },
]).products
const renderTable = (data = products) => render(<OrderProductWeightTable rows={data.weightByProduct} totals={data} scopeLabel={scopeLabel} />)
const table = () => screen.getByRole('table', { name: `Thống kê mặt hàng • ${scopeLabel}` })

describe('simple monthly product report', () => {
  it('shows three columns and one row per product with pieces beside estimated kg', () => {
    renderTable()
    const summary = within(table())
    expect(summary.getAllByRole('columnheader').map((node) => node.textContent)).toEqual(['Mặt hàng', 'Số lượng đã bán (cái)', 'Khối lượng ước tính (kg)'])
    expect(summary.getAllByRole('row')).toHaveLength(5)
    expect(summary.getByRole('row', { name: 'Đồ nam 300 ≈ 100 kg' })).toBeTruthy()
    expect(summary.getByRole('row', { name: 'Đầm 400 ≈ 133,333 kg' })).toBeTruthy()
    expect(summary.getByRole('row', { name: 'Chăn, ga, bao gối, nệm gòn 2 ≈ 6 kg' })).toBeTruthy()
    expect(summary.queryByText('200 kg')).toBeNull()
    expect(summary.getByRole('row', { name: 'Tổng 702 ≈ 239,333 kg' })).toBeTruthy()
  })
  it('does not include actual kg in piece counts or estimates, while keeping detailed weights available', () => {
    const { container } = renderTable()
    expect(container.querySelector('details').open).toBe(false)
    expect(within(table()).queryByText('138,333 kg')).toBeNull()
    expect(screen.getByText(/Bán theo ký: 5 kg thực bán/u)).toBeTruthy()
    fireEvent.click(screen.getByText('Xem khối lượng chi tiết theo loại bán'))
    expect(container.querySelector('details').open).toBe(true)
    const details = within(container.querySelector('.store-statistics-product-weight'))
    expect(details.getByText('≈ 138,333 kg')).toBeTruthy()
  })
  it('uses server totals rather than adding already-rounded product rows', () => {
    const data = summarizeOrders([{ ...base, id: 'FRACTIONS', items: [rowItem('A', 'Đầm', 1), rowItem('B', 'Đồ nam', 1), rowItem('C', 'Đồ bộ', 1)] }]).products
    renderTable(data)
    expect(within(table()).getByRole('row', { name: 'Tổng 3 ≈ 1 kg' })).toBeTruthy()
  })
  it('shows known counts but not invented zero weights for unmapped products', () => {
    renderTable(summarizeOrders([{ ...base, items: [rowItem('UNKNOWN', 'Mặt hàng chưa có hệ số', 5)] }]).products)
    expect(within(table()).getByRole('row', { name: 'Mặt hàng chưa có hệ số 5 Chưa đủ dữ liệu' })).toBeTruthy()
    expect(within(table()).queryByText('0 kg')).toBeNull()
  })
  it('distinguishes an empty month from an unsupported or missing response', () => {
    const view = renderTable({ weightByProduct: [] })
    expect(screen.getByText('Chưa có mặt hàng bán trong phạm vi đã chọn.')).toBeTruthy()
    view.rerender(<OrderProductWeightTable scopeLabel={scopeLabel} />)
    expect(screen.getByText('Chưa tải được bảng mặt hàng của phạm vi này.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
