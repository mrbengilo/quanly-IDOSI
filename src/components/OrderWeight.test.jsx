import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OrderRevenueEditor } from './OrderRevenue'
import { OrderItemWeight, OrderWeightSummary, WeightConversionTable } from './OrderWeight'
import { summarizeItemWeights } from '../domain/orderWeight'
import { weightRuleText } from './orderWeightFormat'

afterEach(cleanup)
const name = 'Chăn, ga, bao gối, nệm gòn'
describe('weight conversion UI', () => {
  it('displays the exact bedding rule in an expandable reference table with all 25 products', () => {
    const { container } = render(<WeightConversionTable />)
    const details = container.querySelector('details')
    expect(details.open).toBe(false)
    fireEvent.click(container.querySelector('summary'))
    expect(details.open).toBe(true)
    const table = screen.getByRole('table', { name: 'Bảng quy đổi cái sang kg' })
    expect(within(table).getAllByRole('row')).toHaveLength(26)
    expect(within(table).getByRole('row', { name: `${name} 1 cái = 3 kg` })).toBeTruthy()
    expect(within(table).getByRole('row', { name: 'Đầm 3 cái = 1 kg' })).toBeTruthy()
    expect(within(table).getByRole('row', { name: 'Quần áo nam 3 cái = 1 kg' })).toBeTruthy()
    expect(within(table).queryByText('0,3')).toBeNull()
    expect(weightRuleText({ piecesPerKg: null, kgPerPiece: 3 })).toBe('1 cái = 3 kg')
  })
  it('keeps the numeric kg input distinct from its calculated output', () => {
    render(<OrderRevenueEditor options={[{ id: 'B', kind: 'product', label: name, active: true }]} items={[
      { productId: 'B', productName: name, quantity: 5, revenueType: 'SALE_KG', unitPrice: 20000 },
    ]} amount="0" />)
    expect(screen.getByLabelText(`Khối lượng ${name}`).tagName).toBe('INPUT')
    expect(screen.getByLabelText(`Kết quả khối lượng ${name}`).textContent).toBe('5 kg thực bán')
  })
  it('shows 3/6 estimated kg and 5 actual kg with no multiplication of actual weights', () => {
    const items = [{ productName: name, quantity: 1 }, { productName: name, quantity: 2, revenueType: 'SALE_PIECE' }, { productName: name, quantity: 5, revenueType: 'SALE_KG' }]
    const { container } = render(<><OrderWeightSummary weight={summarizeItemWeights(items)} />{items.map((item, index) => <OrderItemWeight key={index} item={item} />)}</>)
    expect(screen.getByRole('region', { name: 'Khối lượng hàng hóa' }).textContent).toContain('≈ 14 kg')
    expect(container.textContent).toContain('1 cái = 3 kg → ≈ 3 kg')
    expect(container.textContent).toContain('1 cái = 3 kg → ≈ 6 kg')
    expect(container.textContent).toContain('5 kg thực bán')
  })
  it('marks missing mappings without replacing action status announcements or inventing zero totals', () => {
    render(<OrderWeightSummary weight={summarizeItemWeights([{ productName: 'Chưa xác định', quantity: 1 }])} />)
    expect(screen.getByRole('note', { name: 'Dữ liệu khối lượng chưa đầy đủ' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Chưa đủ dữ liệu')).toBeTruthy()
  })
})
