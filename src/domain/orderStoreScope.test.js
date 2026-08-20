import { describe, expect, it } from 'vitest'
import { resolveOrderNotificationTarget, resolveOrderRouteScope } from './orderStoreScope'

const stores = [
  { id: 'NTL', short: 'NTL', name: 'Dosii NTL' },
  { id: 'KVC', short: 'KVC', name: 'Dosii KVC' },
]

describe('order store scope', () => {
  it('prefers the matched order store over a stale notification store', () => {
    const target = resolveOrderNotificationTarget({
      notification: { orderCode: 'DOSIIKVC-00008', storeId: 'NTL' },
      orders: [{ id: 'ORDER-KVC', code: 'DOSIIKVC-00008', storeId: 'KVC' }],
      stores,
    })

    expect(target).toMatchObject({ orderId: 'ORDER-KVC', storeId: 'KVC' })
  })

  it('uses the order-code prefix when a legacy notification has no loaded order', () => {
    const target = resolveOrderNotificationTarget({
      notification: { orderCode: 'DOSIIKVC-00008', storeId: 'NTL' },
      stores,
    })

    expect(target).toMatchObject({ orderId: 'DOSIIKVC-00008', storeId: 'KVC' })
  })

  it('treats a legacy orderId containing the visible code as a code after exact ID lookup', () => {
    const target = resolveOrderNotificationTarget({
      notification: { orderId: 'DOSIIKVC-00008', storeId: 'NTL' },
      orders: [{ id: 'ORDER-KVC', code: 'DOSIIKVC-00008', storeId: 'KVC' }],
      stores,
    })

    expect(target).toMatchObject({ order: { id: 'ORDER-KVC' }, orderId: 'ORDER-KVC', storeId: 'KVC' })
  })

  it('uses the self-describing legacy orderId code to resolve duplicate codes independent of array order', () => {
    const duplicateOrders = [
      { id: 'ORDER-NTL', code: 'KVC-00008', storeId: 'NTL' },
      { id: 'ORDER-KVC', code: 'KVC-00008', storeId: 'KVC' },
    ]
    for (const orders of [duplicateOrders, [...duplicateOrders].reverse()]) {
      const target = resolveOrderNotificationTarget({
        notification: { orderId: 'KVC-00008', storeId: 'NTL' },
        orders,
        stores,
      })

      expect(target).toMatchObject({ order: { id: 'ORDER-KVC' }, orderId: 'ORDER-KVC', storeId: 'KVC' })
    }
  })

  it('overrides a stale route store with the requested order store', () => {
    const scope = resolveOrderRouteScope({
      requestedStoreId: 'NTL',
      requestedOrderId: 'ORDER-KVC',
      fallbackStoreId: 'NTL',
      orders: [{ id: 'ORDER-KVC', code: 'DOSIIKVC-00008', storeId: 'KVC' }],
      stores,
    })

    expect(scope.storeId).toBe('KVC')
  })

  it('resolves exact order IDs before considering code collisions', () => {
    const target = resolveOrderNotificationTarget({
      notification: { orderId: 'ORDER-KVC', orderCode: 'SHARED-00001', storeId: 'NTL' },
      orders: [
        { id: 'OTHER', code: 'ORDER-KVC', storeId: 'NTL' },
        { id: 'ORDER-NTL', code: 'SHARED-00001', storeId: 'NTL' },
        { id: 'ORDER-KVC', code: 'SHARED-00001', storeId: 'KVC' },
      ],
      stores,
    })

    expect(target).toMatchObject({ order: { id: 'ORDER-KVC' }, orderId: 'ORDER-KVC', storeId: 'KVC' })
  })

  it('uses the embedded order store to disambiguate duplicate codes regardless of array order', () => {
    const duplicateOrders = [
      { id: 'ORDER-NTL', code: 'SHARED-00001', storeId: 'NTL' },
      { id: 'ORDER-KVC', code: 'SHARED-00001', storeId: 'KVC' },
    ]
    for (const orders of [duplicateOrders, [...duplicateOrders].reverse()]) {
      const target = resolveOrderNotificationTarget({
        notification: {
          orderCode: 'SHARED-00001',
          storeId: 'NTL',
          order: { code: 'SHARED-00001', storeId: 'KVC' },
        },
        orders,
        stores,
      })

      expect(target).toMatchObject({ order: { id: 'ORDER-KVC' }, orderId: 'ORDER-KVC', storeId: 'KVC' })
    }
  })

  it('uses a self-describing order-code store before a stale generic notification store', () => {
    const duplicateOrders = [
      { id: 'ORDER-NTL', code: 'KVC-00008', storeId: 'NTL' },
      { id: 'ORDER-KVC', code: 'KVC-00008', storeId: 'KVC' },
    ]
    for (const orders of [duplicateOrders, [...duplicateOrders].reverse()]) {
      const target = resolveOrderNotificationTarget({
        notification: { orderCode: 'KVC-00008', storeId: 'NTL' },
        orders,
        stores,
      })

      expect(target).toMatchObject({ order: { id: 'ORDER-KVC' }, orderId: 'ORDER-KVC', storeId: 'KVC' })
    }
  })

  it('uses the requested route store to disambiguate duplicate order codes without array-order fallback', () => {
    const duplicateOrders = [
      { id: 'ORDER-NTL', code: 'SHARED-00001', storeId: 'NTL' },
      { id: 'ORDER-KVC', code: 'SHARED-00001', storeId: 'KVC' },
    ]
    for (const orders of [duplicateOrders, [...duplicateOrders].reverse()]) {
      const scope = resolveOrderRouteScope({
        requestedStoreId: 'KVC',
        requestedOrderId: 'SHARED-00001',
        fallbackStoreId: 'NTL',
        orders,
        stores,
      })

      expect(scope).toMatchObject({ order: { id: 'ORDER-KVC' }, storeId: 'KVC' })
    }

    expect(resolveOrderRouteScope({
      requestedOrderId: 'SHARED-00001',
      orders: duplicateOrders,
      stores,
    }).order).toBeNull()
  })
})
