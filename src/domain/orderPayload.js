import { resolveOrderItems } from './orderItems.js'
import { resolveOrderCustomFields } from './orderCustomFields.js'
import { orderRevenueByType, validateOrderRevenue } from './orderRevenue.js'

// Loaded only when a command needs order payload validation, not during login.
export const resolveOrderPayload = ({ payload = {}, options, previous, canChangeRevenue = true } = {}) => {
  const resolvedItems = payload.items === undefined
    ? { items: previous?.items || [], error: '' }
    : resolveOrderItems({ items: payload.items, options, previousItems: previous?.items, allowHistorical: Boolean(previous) })
  const resolvedCustomFields = payload.customFields === undefined
    ? { values: previous?.customFields || [], error: '' }
    : resolveOrderCustomFields({ values: payload.customFields, options, previousValues: previous?.customFields, allowHistorical: Boolean(previous) })
  let error = resolvedItems.error || resolvedCustomFields.error
  if (!error) {
    try {
      const revenue = validateOrderRevenue({ amount: payload.amount ?? previous?.amount, normalAmount: payload.normalAmount, items: resolvedItems.items })
      if (previous && !canChangeRevenue && JSON.stringify(revenue) !== JSON.stringify(orderRevenueByType(previous))) {
        error = 'Chỉ Admin được thay đổi số tiền hoặc phân loại doanh thu.'
      }
    } catch (failure) { error = failure.message }
  }
  return { resolvedItems, resolvedCustomFields, error }
}
