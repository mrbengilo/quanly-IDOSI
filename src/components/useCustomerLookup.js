import { useEffect, useState } from 'react'
import { apiGetCustomerLookup } from '../services/idosiApi'
import { customerDirectory, customerPhone, customerPublicInfo } from '../domain/customerLookup'

export function useCustomerLookup({ app, storeId, mode = 'list', query = '', customerKey = '', offset = 0, enabled = true, revision = 0 }) {
  const remote = ['connected', 'connecting', 'syncing', 'error'].includes(app.apiStatus)
  const options = { storeId, mode, query, customerKey, offset }
  const identity = JSON.stringify([options, app.stateVersion, revision])
  const [result, setResult] = useState({ identity: '', value: null, error: '' })
  useEffect(() => {
    if (!remote || !enabled || !storeId) return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      apiGetCustomerLookup({ storeId, mode, query, customerKey, offset, signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) setResult({ identity, value, error: '' }) })
        .catch((error) => {
          if (!controller.signal.aborted) setResult({ identity, value: null, error: error.message || 'Không thể tải thông tin khách hàng.' })
        })
    }, query ? 250 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [customerKey, enabled, identity, mode, offset, query, remote, storeId])
  if (!enabled || !storeId) return { value: null, error: '', loading: false }
  if (remote) return result.identity === identity
    ? { ...result, loading: false } : { value: null, error: '', loading: true }
  const customers = customerDirectory(app.orders || [], { storeId, query: mode === 'list' ? query : '' })
  if (mode === 'suggest') return { loading: false, error: '', value: { suggestions: customerPhone(query).length < 2 ? []
    : customers.filter((customer) => customer.customerPhone.includes(customerPhone(query))).slice(0, 10)
      .map((customer) => ({ customerPhone: customer.customerPhone })) } }
  if (mode === 'list') return { loading: false, error: '', value: { customers: customers.slice(offset, offset + 20).map(customerPublicInfo), total: customers.length, limit: 20 } }
  const customer = customers.find((candidate) => candidate.key === customerKey)
  return customer ? { loading: false, error: '', value: { customer: customerPublicInfo(customer), records: customer.orders.slice(offset, offset + 20), total: customer.orderCount, limit: 20 } }
    : { loading: false, value: null, error: 'Không tìm thấy khách hàng trong cửa hàng này.' }
}
