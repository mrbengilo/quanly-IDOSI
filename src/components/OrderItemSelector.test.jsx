import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../domain/orderInformationSettings'
import { OrderItemSelector, OrderItemsSummary } from './OrderItemSelector'

describe('OrderItemSelector', () => {
  afterEach(cleanup)

  it('selects several products and keeps each quantity independently', () => {
    const onChange = vi.fn()
    const { rerender } = render(<OrderItemSelector options={DEFAULT_ORDER_INFORMATION_OPTIONS} value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Đồ nam/u }))
    expect(onChange).toHaveBeenLastCalledWith([{ productId: 'order-product-001', quantity: 1 }])

    rerender(<OrderItemSelector options={DEFAULT_ORDER_INFORMATION_OPTIONS} value={[
      { productId: 'order-product-001', quantity: 1 },
      { productId: 'order-product-002', quantity: 1 },
    ]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Số lượng Đồ nam'), { target: { value: '2' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { productId: 'order-product-001', quantity: 2 },
      { productId: 'order-product-002', quantity: 1 },
    ])
  })

  it('keeps an empty quantity input visible so validation can explain the error', () => {
    render(<OrderItemSelector options={DEFAULT_ORDER_INFORMATION_OPTIONS} value={[
      { productId: 'order-product-001', quantity: '' },
    ]} onChange={vi.fn()} error="Số lượng không hợp lệ" />)
    expect(screen.getByLabelText('Số lượng Đồ nam').value).toBe('')
    expect(screen.getByRole('alert').textContent).toContain('Số lượng không hợp lệ')
  })

  it('renders compact historical order details without truncating information', () => {
    render(<OrderItemsSummary items={[
      { productId: 'p1', productName: 'Đồ nam', quantity: 2 },
      { productId: 'p2', productName: 'Áo nữ', quantity: 3 },
    ]} />)
    expect(screen.getByText('Đồ nam')).toBeTruthy()
    expect(screen.getByText('2 cái')).toBeTruthy()
    expect(screen.getByText('Áo nữ')).toBeTruthy()
    expect(screen.getByText('3 cái')).toBeTruthy()
  })
})

describe('sale selector controls', () => {
  afterEach(cleanup)
  it('switches all three types without erasing other selections and uses kg-specific input rules', () => {
    const onChange = vi.fn()
    const initial = [{ productId: 'order-product-001', quantity: 2 }]
    const view = render(<OrderItemSelector options={DEFAULT_ORDER_INFORMATION_OPTIONS} value={initial} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sale theo ký Hàng sale' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Đồ nam/u }))
    const mixed = onChange.mock.calls.at(-1)[0]
    expect(mixed).toEqual([...initial, { productId: 'order-product-001', revenueType: 'SALE_KG', unit: 'KG', quantity: 1, unitPrice: '' }])
    view.rerender(<OrderItemSelector options={DEFAULT_ORDER_INFORMATION_OPTIONS} value={mixed} onChange={onChange} />)
    expect(screen.getByLabelText('Khối lượng Đồ nam').step).toBe('0.001')
    fireEvent.change(screen.getByLabelText('Khối lượng Đồ nam'), { target: { value: '2.5' } })
    expect(onChange.mock.calls.at(-1)[0][1].quantity).toBe(2.5)
    fireEvent.change(screen.getByLabelText('Đơn giá Đồ nam'), { target: { value: '20000' } })
    expect(onChange.mock.calls.at(-1)[0][1].unitPrice).toBe(20_000)
    fireEvent.click(screen.getByRole('button', { name: 'Sale theo cái Hàng sale' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Đồ nam/u }))
    expect(onChange.mock.calls.at(-1)[0]).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Bán thường Như hiện tại' }))
    expect(screen.getByRole('checkbox', { name: /Đồ nam/u }).checked).toBe(true)
    expect(screen.getByLabelText('Số lượng Đồ nam').value).toBe('2')
    expect(screen.getByLabelText('Đơn giá Đồ nam').value).toBe('')
    fireEvent.click(screen.getByRole('checkbox', { name: /Đồ nam/u }))
    expect(onChange.mock.calls.at(-1)[0]).toEqual([mixed[1]])
  })
  it('never labels kg as pieces and keeps sale names visible', () => {
    render(<OrderItemsSummary items={[{ productId: 'p', productName: 'Đồ nam', revenueType: 'SALE_KG', quantity: 1.005, unitPrice: 1000 }]} />)
    expect(screen.getByText('1,005 kg')).toBeTruthy()
    expect(screen.getByText('Sale theo ký')).toBeTruthy()
    expect(screen.queryByText(/cái/u)).toBeNull()
  })
})
