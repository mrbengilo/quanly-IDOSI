import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, useApp } from './AppContext'

const mocks = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), clear: vi.fn(), metadata: vi.fn(), bootstrap: vi.fn(), clearSession: vi.fn(),
}))
vi.mock('../services/workspaceCache', () => ({
  readWorkspaceCache: mocks.read, writeWorkspaceCache: mocks.write, clearWorkspaceCache: mocks.clear,
}))
vi.mock('../services/idosiApi', async (original) => ({
  ...await original(), hasApiSession: () => true,
  apiGetStateMetadata: mocks.metadata, apiBootstrapState: mocks.bootstrap,
  clearApiSession: mocks.clearSession,
}))
const user = { id: 'U1', employeeId: 'E1', role: 'employee', storeId: 'S1', homeStoreId: 'S1', version: 2 }
let cached
const Probe = () => {
  const app = useApp()
  return <div>{app.authReady ? app.session?.name || 'signed-out' : 'restoring'}{app.orders.map((order) => <span key={order.id}>{order.id}</span>)}</div>
}
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState({}, '', '/employee/orders')
  const state = {
    ...createInitialState(), adminAccounts: [], managerAccounts: [],
    stores: [{ id: 'S1', name: 'Store 1' }], employees: [{ id: 'E1', storeId: 'S1', name: 'Employee 1', unit: 'store' }],
    orders: [{ id: 'CACHED-PRIVATE', employeeId: 'E1', storeId: 'S1' }],
    session: { ...user, name: 'Employee 1', accountType: 'employee' }, activeStoreId: 'S1',
  }
  cached = {
    user, userKey: JSON.stringify(['U1', 'employee', 'E1', 'S1', 'S1', '', 2]),
    version: 10, policyVersions: {}, state,
    projection: { kind: 'global', screen: 'employee-orders', storeId: '', period: '' },
  }
  mocks.read.mockResolvedValue(cached)
  mocks.metadata.mockResolvedValue({ user, version: 10, userVersion: 2, policyVersions: {} })
  mocks.clear.mockResolvedValue()
  mocks.bootstrap.mockResolvedValue({
    user, version: 11, policies: [], projection: 'global', screen: 'employee-orders',
    state: { ...state, orders: [{ id: 'FRESH-ORDER', employeeId: 'E1', storeId: 'S1' }] },
  })
})
afterEach(cleanup)

it('verifies the session before displaying cached data and skips bootstrap when unchanged', async () => {
  let verify
  mocks.metadata.mockImplementationOnce(() => new Promise((resolve) => { verify = resolve }))
  render(<AppProvider><Probe /></AppProvider>)
  await waitFor(() => expect(mocks.metadata).toHaveBeenCalledWith('global', { restore: true }))
  expect(screen.queryByText('CACHED-PRIVATE')).toBeNull()
  await act(async () => { verify({ user, version: 10, userVersion: 2, policyVersions: {} }) })
  expect(await screen.findByText('CACHED-PRIVATE')).toBeTruthy()
  expect(mocks.bootstrap).not.toHaveBeenCalled()
})

it.each([
  ['data version', { version: 11 }],
  ['account', { user: { ...user, id: 'U2' } }],
  ['effective store', { user: { ...user, storeId: 'S2' } }],
  ['policy', { policyVersions: { attendance: 2 } }],
])('fetches current data when the %s changes', async (_label, changed) => {
  mocks.metadata.mockResolvedValue({ user, version: 10, userVersion: 2, policyVersions: {}, ...changed })
  render(<AppProvider><Probe /></AppProvider>)
  expect(await screen.findByText('FRESH-ORDER')).toBeTruthy()
  expect(screen.queryByText('CACHED-PRIVATE')).toBeNull()
  expect(mocks.clear).toHaveBeenCalled()
  expect(mocks.bootstrap).toHaveBeenCalledTimes(1)
})

it('discards private cached data when the session has been revoked', async () => {
  mocks.metadata.mockRejectedValue(Object.assign(new Error('Revoked'), { status: 401, code: 'SESSION_INVALID' }))
  render(<AppProvider><Probe /></AppProvider>)
  await waitFor(() => expect(mocks.clearSession).toHaveBeenCalled())
  expect(screen.queryByText('CACHED-PRIVATE')).toBeNull()
  expect(mocks.clear).toHaveBeenCalled()
  expect(mocks.bootstrap).not.toHaveBeenCalled()
})
