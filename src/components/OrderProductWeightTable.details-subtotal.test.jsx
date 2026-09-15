import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { summarizeOrders } from '../domain/orderSummary'
import { OrderProductWeightTable } from './OrderProductWeightTable'

afterEach(cleanup)

describe('expanded product estimate subtotals', () => {
  it('explains the compact subtotal with known estimates in both piece-sale detail columns', () => {
    const common = { storeId: 'S1', createdAt: '2026-09-15T09:00:00+07:00', amount: 3000 }
    const line = (quantity, revenueType = 'NORMAL', missing = false) => ({
      productId: 'DRESS', productName: 'Đầm', quantity, revenueType,
      ...(revenueType !== 'NORMAL' ? { unitPrice: 1000 } : {}),
      ...(missing ? { weightConversion: { version: 'IDOSI-2026-09-15-v2', status: 'UNMAPPED', ruleId: null, piecesPerKg: null } } : {}),
    })
    const products = summarizeOrders([
      { ...common, id: 'NORMAL-KNOWN', items: [line(3)] },
      { ...common, id: 'NORMAL-MISSING', items: [line(3, 'NORMAL', true)] },
      { ...common, id: 'SALE-KNOWN', amount: 6000, items: [line(6, 'SALE_PIECE')] },
      { ...common, id: 'SALE-MISSING', items: [line(3, 'SALE_PIECE', true)] },
      { ...common, id: 'KG', amount: 5000, items: [line(5, 'SALE_KG')] },
    ]).products
    const { container } = render(<OrderProductWeightTable rows={products.weightByProduct} totals={products} scopeLabel="Tháng 09/2026" />)
    const compact = screen.getByRole('table', { name: 'Thống kê mặt hàng • Tháng 09/2026' })
    expect(within(compact).getByRole('row', { name: 'Đầm 15 ≈ 3 kg Phần đã quy đổi' })).toBeTruthy()
    fireEvent.click(screen.getByText('Xem khối lượng chi tiết theo loại bán'))
    expect(container.querySelector('details').open).toBe(true)
    const cells = container.querySelectorAll('.store-statistics-product-weight tbody tr td')
    expect(within(cells[2]).getByText('≈ 1 kg')).toBeTruthy()
    expect(within(cells[2]).getByText('Phần đã quy đổi')).toBeTruthy()
    expect(within(cells[3]).getByText('≈ 2 kg')).toBeTruthy()
    expect(within(cells[3]).getByText('Phần đã quy đổi')).toBeTruthy()
    expect(cells[4].textContent).toBe('5 kg')
    // Total kg still means the complete weight, not the partial estimate shown above.
    expect(cells[5].textContent).toBe('Chưa đủ dữ liệu')
    expect(products.weight).toMatchObject({ estimatedKg: 3, actualKg: 5, knownKg: 8, isComplete: false, totalKg: null })
  })
})
