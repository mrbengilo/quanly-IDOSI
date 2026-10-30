import { useEffect, useState } from 'react'
import { apiGetCustomerLookup } from '../services/idosiApi'
import { customerDirectory, customerPublicInfo, customerSuggestions, customerPurchaseStatus, customerHistoryForStore, customerOrderDetails } from '../domain/customerLookup'

export function useCustomerLookup({ app, storeId, scope = 'store', mode = 'list', field = 'phone', query = '', customerKey = '', offset = 0, enabled = true, revision = 0 }) {
  const remote = ['connected', 'connecting', 'syncing', 'error'].includes(app.apiStatus)
  const allowed = scope !== 'global' || ['admin', 'business_support', 'store_manager'].includes(app.session?.role)
  const ready = enabled && allowed && (scope === 'global' || Boolean(storeId))
  const options = { storeId, scope, mode, field, query, customerKey, offset }
  const identity = JSON.stringify([options, app.stateVersion, revision])
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
  if (remote) return result.identity === identity
    ? { ...result, loading: false } : { value: null, error: '', loading: true }
  const customers = customerDirectory(app.orders || [], { query: mode === 'list' ? query : '' })
  if (mode === 'suggest') return { loading: false, error: '', value: { suggestions: customerSuggestions(customers, query, field) } }
  if (mode === 'status') return { loading: false, error: '', value: { ...customerPurchaseStatus(customers, query, field),
    hasSuggestions: customerSuggestions(customers, query, field, 1).length > 0 } }
  if (mode === 'list') return { loading: false, error: '', value: { customers: customers.slice(offset, offset + 20)
    .map((customer) => customerPublicInfo(customerHistoryForStore(customer, scope === 'global' ? '' : storeId))), total: customers.length, limit: 20 } }
  const contact = customers.find((candidate) => candidate.key === customerKey)
  const customer = contact && customerHistoryForStore(contact, scope === 'global' ? '' : storeId)
  return customer ? { loading: false, error: '', value: { customer: customerPublicInfo(customer), records: customer.orders.slice(offset, offset + 20).map((order) => customerOrderDetails(order, app)), total: customer.orderCount, limit: 20 } }
    : { loading: false, value: null, error: 'Không tìm thấy khách hàng trong hệ thống.' }
}
