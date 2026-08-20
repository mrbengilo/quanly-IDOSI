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
})
