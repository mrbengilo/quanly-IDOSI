// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrderRevenueEditor, OrderRevenueSummary } from './OrderRevenue'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../domain/orderInformationSettings'
import { prepareOrderRevenueInput } from '../domain/orderRevenue'
import { resolveOrderItems } from '../domain/orderItems'

afterEach(cleanup)
const options = DEFAULT_ORDER_INFORMATION_OPTIONS
function Harness({ save, disabled = false, initialItems = [] }) {
  const [items, setItems] = useState(initialItems)
  const [amount, setAmount] = useState('')
  const submit = () => {
    const resolved = resolveOrderItems({ items, options })
    save({ ...prepareOrderRevenueInput({ amount, items: resolved.items }), items: resolved.items })
  }
  return <><OrderRevenueEditor options={options} items={items} amount={amount} onItemsChange={setItems} onAmountChange={setAmount} disabled={disabled} /><button onClick={submit}>Lưu thử</button></>
}
const firstProduct = options.find((option) => option.kind === 'product')
const selectFirst = () => fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(firstProduct.label) }))
describe('three category order editor and real domain contract', () => {
  it('keeps selections across tabs and submits the same precise mixed breakdown validated by backend', () => {
    const save = vi.fn()
    render(<Harness save={save} />)
    selectFirst()
    fireEvent.change(screen.getByPlaceholderText('Nhập số tiền'), { target: { value: '100000' } })
    fireEvent.click(screen.getByRole('tab', { name: /Sale theo ký/ }))
    selectFirst()
    fireEvent.change(screen.getByLabelText(`Khối lượng ${firstProduct.label}`), { target: { value: '2.5' } })
    fireEvent.change(screen.getByLabelText(`Đơn giá ${firstProduct.label}`), { target: { value: '20000' } })
    fireEvent.click(screen.getByRole('tab', { name: /Sale theo cái/ }))
    selectFirst()
    fireEvent.change(screen.getByLabelText(`Số lượng ${firstProduct.label}`), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(`Đơn giá ${firstProduct.label}`), { target: { value: '10000' } })
    expect(within(screen.getByRole('region', { name: 'Tổng tiền đơn đang nhập' })).getByText('180,000 đ')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Bán thường/ }))
    expect(screen.getByRole('checkbox', { name: new RegExp(firstProduct.label) }).checked).toBe(true)
    fireEvent.click(screen.getByText('Lưu thử'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ amount: 180000, normalAmount: 100000, items: expect.arrayContaining([
      expect.objectContaining({ revenueType: 'NORMAL', quantity: 1 }),
      expect.objectContaining({ revenueType: 'SALE_KG', quantity: 2.5, unit: 'KG', lineAmount: 50000 }),
      expect.objectContaining({ revenueType: 'SALE_PIECE', quantity: 3, unit: 'PIECE', lineAmount: 30000 }),
    ]) }))
  })
  it('supports sale-only input and recalculates persisted line amounts on edit', () => {
    const save = vi.fn()
    render(<Harness save={save} initialItems={[{ productId: firstProduct.id, revenueType: 'SALE_KG', unit: 'KG', quantity: 2.5, unitPrice: 20000, lineAmount: 50000 }]} />)
    fireEvent.click(screen.getByRole('tab', { name: /Sale theo ký/ }))
    fireEvent.change(screen.getByLabelText(`Khối lượng ${firstProduct.label}`), { target: { value: '3' } })
    fireEvent.click(screen.getByText('Lưu thử'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ amount: 60000, normalAmount: 0 }))
  })
  it('requires an explicit confirmation before a historical ordinary line becomes NORMAL', () => {
    const save = vi.fn()
    render(<Harness save={save} initialItems={[{ productId: firstProduct.id, quantity: 2 }]} />)
    fireEvent.change(screen.getByPlaceholderText('Nhập số tiền'), { target: { value: '100000' } })
    expect(within(screen.getByRole('region', { name: 'Tổng tiền đơn đang nhập' })).getByText('CHƯA PHÂN LOẠI')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận Bán thường' }))
    fireEvent.click(screen.getByText('Lưu thử'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ amount: 100000, items: [expect.objectContaining({ revenueType: 'NORMAL', quantity: 2 })] }))
    expect(screen.queryByText('Chưa phân loại trong dữ liệu đã lưu')).toBeNull()
  })
  it('disables tab actions while saving and never displays loading as zero revenue', () => {
    render(<Harness save={vi.fn()} disabled />)
    expect(screen.getAllByRole('tab').every((tab) => tab.disabled)).toBe(true)
    expect(screen.queryByText('0 đ')).toBeNull()
  })
  it('shows all three zero categories when a confirmed summary is empty', () => {
    render(<OrderRevenueSummary totals={{ revenue: 0, revenueByType: { NORMAL: 0, SALE_KG: 0, SALE_PIECE: 0 } }} />)
    expect(screen.getAllByText('0 đ')).toHaveLength(4)
  })
})
