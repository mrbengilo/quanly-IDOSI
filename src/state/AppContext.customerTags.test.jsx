import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, useApp } from './AppContext'
import { CustomerPurchaseStatus } from '../components/CustomerPhoneInput'
import { CustomerLookupPage } from '../pages/store/CustomerLookupPage'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../domain/orderInformationDefaults'
import { customerDirectory, customerHistoryForStore, customerPublicInfo, customerPurchaseStatus, customerSuggestions } from '../domain/customerLookup'

const api = vi.hoisted(() => ({ command: vi.fn(), lookup: vi.fn(), login: vi.fn(), bootstrap: vi.fn(), read: vi.fn(), metadata: vi.fn() }))
vi.mock('../services/idosiApi', () => ({
  apiCommand: api.command, apiGetCustomerLookup: api.lookup, apiLogin: api.login,
  apiBootstrapState: api.bootstrap, apiGetState: api.read, apiGetStoreWorkspaceState: api.read,
  apiGetSystemScreenState: api.read, apiGetStateMetadata: api.metadata,
  apiGetAccountAvatar: vi.fn(), apiSelectSessionRole: vi.fn(), apiListUsers: async () => ({ users: [] }),
  apiLogout: vi.fn(), apiPolicyEntries: () => [], apiPolicyMap: () => ({}), clearApiSession: vi.fn(),
  hasApiSession: () => false, hasPendingApiRequests: () => false, isLocalApiFallbackAllowed: () => false,
}))
const phoneA = '0900000101', phoneB = '0900000202'
const user = { id: 'ADMIN', username: 'customer.lifecycle', displayName: 'Admin', role: 'admin', status: 'active', version: 1 }
let state, version, ref
const Probe = forwardRef(function Probe(_props, target) {
  const app = useApp()
  useImperativeHandle(target, () => app, [app])
  return <>
    <section aria-label="Trạng thái khách A"><CustomerPurchaseStatus app={app} storeId={app.stores[0]?.id} phone={phoneA} /></section>
    <section aria-label="Trạng thái khách B"><CustomerPurchaseStatus app={app} storeId={app.stores[0]?.id} phone={phoneB} /></section>
    <CustomerLookupPage systemWide />
  </>
})
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  ref = createRef()
  state = createInitialState()
  state.orderInformationOptions = DEFAULT_ORDER_INFORMATION_OPTIONS.map((option) => ({ ...option }))
  version = 1
  state.orders = [
    { id: 'FIRST-A', code: 'FIRST-A', storeId: state.stores[0].id, customerName: 'Khách A', customerPhone: phoneA, amount: 100000 },
    { id: 'FIRST-B', code: 'FIRST-B', storeId: state.stores[1].id, customerName: 'Khách B', customerPhone: phoneB, amount: 100000 },
  ]
  const payload = () => ({ user, state, policies: [], version })
  api.login.mockResolvedValue({ user })
  api.bootstrap.mockImplementation(async () => payload())
  api.read.mockImplementation(async () => payload())
  api.metadata.mockImplementation(async () => ({ version, scopes: { global: version } }))
  api.lookup.mockImplementation(async ({ mode = 'list', customerKey, query = '', field = 'phone', storeId, scope }) => {
    const customers = customerDirectory(state.orders)
    if (mode === 'status') return { ...customerPurchaseStatus(customers, query, field), hasSuggestions: customerSuggestions(customers, query, field).length > 0 }
    if (mode === 'suggest') return { suggestions: customerSuggestions(customers, query, field) }
    if (mode === 'list') return { customers: customers.map((customer) => customerPublicInfo(customerHistoryForStore(customer, scope === 'global' ? '' : storeId))), total: customers.length, limit: 20 }
    const customer = customerHistoryForStore(customers.find((candidate) => candidate.key === customerKey))
    return { customer: customerPublicInfo(customer), records: customer.orders, total: customer.orderCount, limit: 20 }
  })
  api.command.mockImplementation(async (type, input) => {
    if (type === 'order.create') {
      const order = { ...input, id: `CREATED-${version}`, code: `CREATED-${version}`, status: 'Hoàn tất' }
      state = { ...state, orders: [...state.orders, order] }
      return { version: ++version, order }
    }
    const previous = state.orders.find((order) => order.id === input.orderId)
    const order = type === 'order.delete'
      ? { ...previous, deletedAt: new Date().toISOString(), status: 'Đã xóa' }
      : { ...previous, ...input }
    state = { ...state, orders: state.orders.map((candidate) => candidate.id === order.id ? order : candidate) }
    return { version: ++version, order }
  })
})
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear() })

it.each([0, 1])('refreshes list, an open history and order-entry tags after create/edit/delete in store index %i without a manual refresh', async (storeIndex) => {
  render(<AppProvider><Probe ref={ref} /></AppProvider>)
  await act(async () => { expect((await ref.current.login(user.username, 'fixture-password')).ok).toBe(true) })
  const statusA = screen.getByRole('region', { name: 'Trạng thái khách A' })
  const statusB = screen.getByRole('region', { name: 'Trạng thái khách B' })
  await within(statusA).findByText('KH mới')
  await within(statusB).findByText('KH mới')
  const initialVersion = ref.current.stateVersion
  const table = await screen.findByRole('table', { name: 'Danh sách khách hàng' })
  fireEvent.click(within(within(table).getByText('Khách A').closest('tr')).getByRole('button', { name: 'Lịch sử mua hàng (1)' }))
  await within(screen.getByRole('dialog')).findByText('1 đơn hàng')
  const assertTags = async (returningA, returningB, countA) => {
    const tagA = returningA ? 'KH cũ' : 'KH mới', tagB = returningB ? 'KH cũ' : 'KH mới'
    await within(statusA).findByText(tagA)
    await within(statusB).findByText(tagB)
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText(`${countA} đơn hàng`)
    expect(within(dialog).getByText(tagA)).toBeTruthy()
    const list = await screen.findByRole('table', { name: 'Danh sách khách hàng' })
    expect(within(within(list).getByText('Khách A').closest('tr')).getByText(tagA)).toBeTruthy()
    expect(within(within(list).getByText('Khách B').closest('tr')).getByText(tagB)).toBeTruthy()
  }
  let created
  await act(async () => {
    created = await ref.current.createOrder({ storeId: state.stores[storeIndex].id, customerName: 'Khách A', customerPhone: phoneA,
      amount: 100000, gender: 'Nam', occupation: state.orderInformationOptions.find((option) => option.kind === 'occupation' && option.active !== false).label,
      acquisitionChannel: 'Facebook', paymentMethod: 'Tiền mặt' })
    expect(created.ok).toBe(true)
  })
  // The real command delta updates orders before the deferred full projection.
  expect(ref.current.stateVersion).toBe(initialVersion)
  await assertTags(true, false, 2)
  await act(async () => {
    expect((await ref.current.updateOrder(created.order.id, { customerName: 'Khách B', customerPhone: phoneB, reason: 'Sửa nhầm khách' })).ok).toBe(true)
  })
  await assertTags(false, true, 1)
  await act(async () => {
    expect((await ref.current.updateOrder(created.order.id, { customerName: 'Khách A', customerPhone: phoneA, reason: 'Đối soát lại khách' })).ok).toBe(true)
  })
  await assertTags(true, false, 2)
  await act(async () => {
    expect((await ref.current.deleteOrder(created.order.id, 'Xóa đơn kiểm thử')).ok).toBe(true)
  })
  await assertTags(false, false, 1)
}, 15000)
