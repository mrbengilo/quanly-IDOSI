import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { apiGetCustomerLookup } from '../services/idosiApi'
import { subscribeCustomerChanges, customerChangeSnapshot } from '../services/customerLookupSync'
import { customerDirectory, customerPublicInfo, customerSuggestions, customerPurchaseStatus, customerPurchasedAtStore, customerMatchesHistoryQuery, customerOrderDetails } from '../domain/customerLookup'

export function useCustomerLookup({ app, storeId, scope = 'store', mode = 'list', field = 'phone', query = '', customerKey = '', offset = 0, enabled = true, revision = 0 }) {
  const remote = ['connected', 'connecting', 'syncing', 'error'].includes(app.apiStatus)
  const allowed = scope !== 'global' || ['admin', 'business_support', 'store_manager'].includes(app.session?.role)
  const ready = enabled && allowed && (scope === 'global' || Boolean(storeId))
  const options = { storeId, scope, mode, field, query, customerKey, offset }
  const subscribe = useCallback((listener) => remote && ready
    ? subscribeCustomerChanges(listener) : () => {}, [remote, ready])
  const customerRevision = useSyncExternalStore(subscribe, customerChangeSnapshot, customerChangeSnapshot)
  const queryKey = JSON.stringify([options, app.stateVersion, revision, customerRevision])
  // Command deltas replace orders before the deferred authoritative refresh
  // advances stateVersion. Invalidate every customer read on that delta too,
  // without serializing order history into the request/cache identity.
  const identity = useMemo(() => ({ queryKey, orders: app.orders }), [queryKey, app.orders])
  const [result, setResult] = useState({ identity: '', value: null, error: '' })
  useEffect(() => {
    if (!remote || !ready) return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      apiGetCustomerLookup({ storeId, scope, mode, field, query, customerKey, offset, signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) setResult({ identity, value, error: '' }) })
        .catch((error) => {
          if (!controller.signal.aborted) setResult({ identity, value: null, error: error.message || 'Không thể tải thông tin khách hàng.' })
        })
    }, query ? 250 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [customerKey, ready, field, identity, mode, offset, query, remote, scope, storeId])
  if (!allowed) return { value: null, error: 'Tài khoản không có quyền tra cứu toàn hệ thống.', loading: false }
  if (!ready) return { value: null, error: '', loading: false }
  if (app.session?.role === 'employee' && (mode === 'list' || (mode === 'history'
    && (field === 'phone' ? String(query).replace(/\D/gu, '') : query.trim()).length < 2))) {
    return { value: null, error: 'Tìm và chọn khách hàng khi tạo đơn để xem lịch sử.', loading: false }
  }
  if (remote) return result.identity === identity
    ? { ...result, loading: false } : { value: null, error: '', loading: true }
  const customers = customerDirectory(app.orders || [], { query: mode === 'list' ? query : '' })
  if (mode === 'suggest') return { loading: false, error: '', value: { suggestions: customerSuggestions(customers, query, field, 10, app.stores) } }
  if (mode === 'status') return { loading: false, error: '', value: { ...customerPurchaseStatus(customers, query, field),
    hasSuggestions: customerSuggestions(customers, query, field, 1).length > 0 } }
  if (mode === 'list') {
    const visible = scope === 'global' ? customers : customers.filter((customer) => customerPurchasedAtStore(customer, storeId))
    return { loading: false, error: '', value: { customers: visible.slice(offset, offset + 20).map(customerPublicInfo), total: visible.length, limit: 20 } }
  }
  const contact = customers.find((candidate) => candidate.key === customerKey)
  const customer = contact && (app.session?.role === 'employee' ? customerMatchesHistoryQuery(contact, query, field)
    : scope === 'global' || customerPurchasedAtStore(contact, storeId)) ? contact : null
  return customer ? { loading: false, error: '', value: { customer: customerPublicInfo(customer), records: customer.orders.slice(offset, offset + 20).map((order) => customerOrderDetails(order, app)), total: customer.orderCount, limit: 20 } }
    : { loading: false, value: null, error: 'Không tìm thấy khách hàng trong hệ thống.' }
}
