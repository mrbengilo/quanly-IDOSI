// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OrderItemSelector } from './OrderItemSelector'

const options = [
  { id: 'P1', kind: 'product', code: 'PRD-001', label: 'Đồ nam', active: true },
  { id: 'P2', kind: 'product', code: 'PRD-002', label: 'Đầm', active: true },
]
afterEach(cleanup)

function Harness({ initialItems = [], onItems = () => {}, onSubmit = () => {}, ...props }) {
  const [items, setItems] = useState(initialItems)
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit(items) }}>
    <OrderItemSelector options={options} value={items} {...props} onChange={(next) => { setItems(next); onItems(next) }} />
  </form>
}
const input = (kg = false) => screen.getByRole('spinbutton', { name: `${kg ? 'Khối lượng' : 'Số lượng'} Đồ nam` })
const plus = (kg = false) => screen.getByRole('button', { name: `Tăng ${kg ? 'khối lượng' : 'số lượng'} Đồ nam` })
const minus = (kg = false) => screen.getByRole('button', { name: `Giảm ${kg ? 'khối lượng' : 'số lượng'} Đồ nam` })
const checkbox = () => screen.getByRole('checkbox', { name: /Đồ nam/u })

describe('OrderItemSelector quantity steppers', () => {
  it('shows zero and +/- for every unselected product without adding order lines', () => {
    const onItems = vi.fn()
    render(<Harness onItems={onItems} />)
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
    expect(input().value).toBe('0')
    expect(checkbox().checked).toBe(false)
    expect(minus().disabled).toBe(true)
    expect(plus().disabled).toBe(false)
    expect(onItems).not.toHaveBeenCalled()
  })

  it('selects with plus, increments, decrements, and removes at zero without negatives', () => {
    const onItems = vi.fn()
    render(<Harness onItems={onItems} />)
    fireEvent.click(plus())
    expect(input().value).toBe('1')
    expect(checkbox().checked).toBe(true)
    fireEvent.click(plus())
    expect(input().value).toBe('2')
    fireEvent.click(minus())
    expect(input().value).toBe('1')
    fireEvent.click(minus())
    expect(input().value).toBe('0')
    expect(checkbox().checked).toBe(false)
    expect(minus().disabled).toBe(true)
    expect(onItems.mock.lastCall[0]).toEqual([])
  })

  it('keeps the checkbox and direct quantity input synchronized', () => {
    render(<Harness />)
    fireEvent.click(checkbox())
    expect(input().value).toBe('1')
    fireEvent.change(input(), { target: { value: '12' } })
    expect(input().value).toBe('12')
    fireEvent.click(checkbox())
    expect(input().value).toBe('0')
    fireEvent.change(input(), { target: { value: '7' } })
    expect(checkbox().checked).toBe(true)
    fireEvent.change(input(), { target: { value: '0' } })
    fireEvent.blur(input())
    expect(checkbox().checked).toBe(false)
  })

  it('allows clearing and retyping a selected draft without losing its sale price', () => {
    const onItems = vi.fn()
    render(<Harness revenueType="SALE_PIECE" initialItems={[{ productId: 'P1', revenueType: 'SALE_PIECE', unit: 'PIECE', quantity: 2, unitPrice: 10000 }]} onItems={onItems} />)
    fireEvent.change(input(), { target: { value: '' } })
    expect(input().value).toBe('')
    expect(checkbox().checked).toBe(true)
    fireEvent.change(input(), { target: { value: '3' } })
    expect(onItems.mock.lastCall[0][0]).toMatchObject({ quantity: 3, unitPrice: 10000 })
  })

  it.each(['NORMAL', 'SALE_PIECE'])('rejects negative, fractional pieces and above-limit quantities for %s', (revenueType) => {
    render(<Harness revenueType={revenueType} initialItems={[{ productId: 'P1', quantity: 2 }]} />)
    for (const value of ['-1', '1.5', '1000001']) {
      fireEvent.change(input(), { target: { value } })
      expect(input().value).toBe('2')
    }
  })

  it('steps kg by 0.1 without accumulated float drift and removes at zero', () => {
    const onItems = vi.fn()
    render(<Harness revenueType="SALE_KG" onItems={onItems} />)
    fireEvent.click(plus(true))
    expect(onItems.mock.lastCall[0][0]).toMatchObject({ quantity: 0.1, unit: 'KG', revenueType: 'SALE_KG' })
    fireEvent.click(plus(true))
    fireEvent.click(plus(true))
    expect(input(true).value).toBe('0.3')
    fireEvent.change(input(true), { target: { value: '2.4' } })
    fireEvent.click(plus(true))
    expect(input(true).value).toBe('2.5')
    fireEvent.click(minus(true))
    expect(input(true).value).toBe('2.4')
    fireEvent.change(input(true), { target: { value: '0.001' } })
    fireEvent.click(minus(true))
    expect(input(true).value).toBe('0')
    expect(onItems.mock.lastCall[0]).toEqual([])
  })

  it('preserves gram precision entered manually and clamps kg at the maximum', () => {
    render(<Harness revenueType="SALE_KG" initialItems={[{ productId: 'P1', quantity: 1.125 }]} />)
    fireEvent.click(plus(true))
    expect(input(true).value).toBe('1.225')
    fireEvent.keyDown(input(true), { key: 'ArrowDown' })
    expect(input(true).value).toBe('1.125')
    expect(input(true).step).toBe('0.001')
    fireEvent.change(input(true), { target: { value: '999999.999' } })
    fireEvent.click(plus(true))
    expect(input(true).value).toBe('1000000')
    expect(plus(true).disabled).toBe(true)
  })

  it('keeps a sale price while a sub-kilogram quantity is typed through zero', () => {
    const onItems = vi.fn()
    render(<Harness revenueType="SALE_KG" onItems={onItems} initialItems={[
      { productId: 'P1', revenueType: 'SALE_KG', unit: 'KG', quantity: 2.5, unitPrice: 20000 },
    ]} />)
    fireEvent.change(input(true), { target: { value: '0' } })
    expect(checkbox().checked).toBe(true)
    fireEvent.change(input(true), { target: { value: '0.5' } })
    fireEvent.blur(input(true))
    expect(onItems.mock.lastCall[0][0]).toMatchObject({ quantity: 0.5, unitPrice: 20000 })
    expect(screen.getByText('10,000 đ')).toBeTruthy()
  })

  it('does not round over-precise manually entered weights silently', () => {
    render(<Harness revenueType="SALE_KG" initialItems={[{ productId: 'P1', quantity: 1.25 }]} />)
    fireEvent.change(input(true), { target: { value: '1.2345' } })
    expect(input(true).value).toBe('1.25')
  })

  it('retains price and metadata but removes stale derived amounts after a step', () => {
    const onItems = vi.fn()
    render(<Harness revenueType="SALE_PIECE" onItems={onItems} initialItems={[
      { productId: 'P1', productName: 'Đồ nam', revenueType: 'SALE_PIECE', unit: 'PIECE', quantity: 1, unitPrice: 10000, lineAmount: 10000 },
      { productId: 'P2', quantity: 4, unitPrice: 2000 },
    ]} />)
    fireEvent.click(plus())
    const [changed, other] = onItems.mock.lastCall[0]
    expect(changed).toMatchObject({ productId: 'P1', quantity: 2, unitPrice: 10000, revenueType: 'SALE_PIECE' })
    expect(changed).not.toHaveProperty('lineAmount')
    expect(other).toMatchObject({ productId: 'P2', quantity: 4, unitPrice: 2000 })
    expect(screen.getByText('20,000 đ')).toBeTruthy()
  })

  it('disables plus at the shared quantity limit and permits decreasing', () => {
    render(<Harness initialItems={[{ productId: 'P1', quantity: 1000000 }]} />)
    expect(plus().disabled).toBe(true)
    fireEvent.click(minus())
    expect(input().value).toBe('999999')
    expect(plus().disabled).toBe(false)
  })

  it('supports arrow keys without submitting and does not submit when +/- are clicked', () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    fireEvent.click(plus())
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('2')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.click(minus())
    expect(input().value).toBe('0')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(plus().type).toBe('button')
    expect(minus().type).toBe('button')
  })

  it('locks every edit control while the parent is disabled', () => {
    const onItems = vi.fn()
    render(<Harness disabled onItems={onItems} initialItems={[{ productId: 'P1', quantity: 2 }]} />)
    expect(checkbox().disabled).toBe(true)
    expect(input().disabled).toBe(true)
    expect(plus().disabled).toBe(true)
    expect(minus().disabled).toBe(true)
    fireEvent.click(plus())
    fireEvent.change(input(), { target: { value: '8' } })
    expect(onItems).not.toHaveBeenCalled()
  })
})
