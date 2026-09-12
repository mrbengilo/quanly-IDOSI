import { describe, expect, it } from 'vitest'
import { DEFAULT_ORDER_INFORMATION_OPTIONS, productOptions } from './orderInformationSettings'
import {
  normalizeOrderItems,
  orderItemsLabel,
  resolveOrderItems,
  totalOrderItemQuantity,
} from './orderItems'

describe('order items', () => {
  const products = productOptions(DEFAULT_ORDER_INFORMATION_OPTIONS)

  it('resolves several selected products into immutable order snapshots', () => {
    const result = resolveOrderItems({
      items: [
        { productId: products[0].id, quantity: 2 },
        { productId: products[1].id, quantity: 3 },
      ],
      options: DEFAULT_ORDER_INFORMATION_OPTIONS,
    })
    expect(result.error).toBe('')
    expect(result.items).toEqual([
      expect.objectContaining({ productId: products[0].id, productName: 'Đồ nam', quantity: 2 }),
      expect.objectContaining({ productId: products[1].id, productName: 'Đầm', quantity: 3 }),
    ])
    expect(totalOrderItemQuantity(result.items)).toBe(5)
    expect(orderItemsLabel(result.items)).toBe('Đồ nam × 2, Đầm × 3')
  })

  it('rejects missing, duplicate and invalid quantities', () => {
    expect(resolveOrderItems({ items: [], options: DEFAULT_ORDER_INFORMATION_OPTIONS }).error).toMatch(/ít nhất một/u)
    expect(resolveOrderItems({
      items: [{ productId: products[0].id, quantity: 1 }, { productId: products[0].id, quantity: 2 }],
      options: DEFAULT_ORDER_INFORMATION_OPTIONS,
    }).error).toMatch(/lặp lại/u)
    expect(resolveOrderItems({
      items: [{ productId: products[0].id, quantity: 1.5 }],
      options: DEFAULT_ORDER_INFORMATION_OPTIONS,
    }).error).toMatch(/số nguyên/u)
  })

  it('preserves an inactive historical snapshot only while editing the same order', () => {
    const inactiveOptions = DEFAULT_ORDER_INFORMATION_OPTIONS.map((option) => (
      option.id === products[0].id ? { ...option, active: false, deletedAt: '2026-09-12T00:00:00Z' } : option
    ))
    const previousItems = [{
      productId: products[0].id,
      productCode: products[0].code,
      productName: 'Đồ nam cũ',
      quantity: 1,
    }]
    expect(resolveOrderItems({
      items: [{ productId: products[0].id, quantity: 2 }],
      options: inactiveOptions,
    }).error).toMatch(/không còn hoạt động/u)
    expect(resolveOrderItems({
      items: [{ productId: products[0].id, quantity: 2 }],
      options: inactiveOptions,
      previousItems,
      allowHistorical: true,
    }).items).toEqual([{ ...previousItems[0], quantity: 2 }])
  })

  it('keeps a legacy unclassified order editable without allowing products to be removed from a classified order', () => {
    expect(resolveOrderItems({
      items: [],
      previousItems: [],
      options: DEFAULT_ORDER_INFORMATION_OPTIONS,
      allowHistorical: true,
    })).toEqual({ items: [], error: '' })
    expect(resolveOrderItems({
      items: [],
      previousItems: [{ productId: products[0].id, productName: products[0].label, quantity: 1 }],
      options: DEFAULT_ORDER_INFORMATION_OPTIONS,
      allowHistorical: true,
    }).error).toMatch(/ít nhất một/u)
  })

  it('normalizes old malformed data without making reports fail', () => {
    expect(normalizeOrderItems([
      { productId: 'p1', productName: 'Áo nữ', quantity: '4' },
      { productId: 'p2', productName: 'Đầm', quantity: 0 },
    ])).toEqual([{ productId: 'p1', productCode: '', productName: 'Áo nữ', quantity: 4 }])
  })
})
