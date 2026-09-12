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
