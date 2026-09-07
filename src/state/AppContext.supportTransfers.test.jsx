import { act, cleanup, render } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetAccountAvatar: vi.fn(),
  apiGetState: vi.fn(),
  apiGetStoreWorkspaceState: vi.fn(),
  apiGetSystemScreenState: vi.fn(),
  apiGetStateMetadata: vi.fn(),
  apiLogin: vi.fn(),
  apiSelectSessionRole: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  clearApiSession: vi.fn(),
}))

vi.mock('../services/idosiApi', () => ({
  apiBootstrapState: api.apiBootstrapState,
  apiCommand: api.apiCommand,
  apiGetAccountAvatar: api.apiGetAccountAvatar,
  apiGetState: api.apiGetState,
  apiGetStoreWorkspaceState: api.apiGetStoreWorkspaceState,
  apiGetSystemScreenState: api.apiGetSystemScreenState,
  apiGetStateMetadata: api.apiGetStateMetadata,
  apiLogin: api.apiLogin,
  apiSelectSessionRole: api.apiSelectSessionRole,
  apiListUsers: api.apiListUsers,
  apiLogout: api.apiLogout,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  clearApiSession: api.clearApiSession,
  hasApiSession: () => false,
  hasPendingApiRequests: () => false,
  isLocalApiFallbackAllowed: () => false,
}))

const admin = { id: 'ADMIN', username: 'admin', displayName: 'Admin', role: 'admin', status: 'active', version: 1 }
const exactTransfer = {
  id: 'TR-EXACT', employeeId: 'E1', fromStoreId: 'A', toStoreId: 'B',
  startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T05:00:00.000Z',
  fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 30_000,
  allowance: 0, status: 'Đã duyệt', version: 1,
}
const remoteState = () => ({
  ...createInitialState(),
  stores: [{ id: 'A', name: 'Cửa hàng A' }, { id: 'B', name: 'Cửa hàng B' }],
  employees: [{ id: 'E1', name: 'Nhân viên 1', unit: 'store', storeId: 'A', status: 'Đang làm việc' }],
  supportTransfers: [exactTransfer],
})

let appRef
const Probe = forwardRef(function Probe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return null
})

const renderAdmin = async () => {
  const payload = () => ({ user: admin, state: remoteState(), policies: [], version: 1 })
  api.apiLogin.mockResolvedValue({ user: admin })
  api.apiBootstrapState.mockImplementation(async () => payload())
  api.apiGetState.mockImplementation(async () => payload())
  api.apiListUsers.mockResolvedValue({ users: [admin] })
  render(<AppProvider><Probe ref={appRef} /></AppProvider>)
  await act(async () => { expect((await appRef.current.login('admin', 'password')).ok).toBe(true) })
}

describe('AppContext support-transfer date commands', () => {
  beforeEach(() => {
    appRef = createRef()
    localStorage.clear()
    sessionStorage.clear()
    api.apiCommand.mockImplementation(async (type, payload) => ({
      version: 2,
      transfer: { ...exactTransfer, ...payload, id: payload.transferId || 'TR-NEW' },
      command: type,
    }))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('sends inclusive date-only ranges for the current create and update contract', async () => {
    await renderAdmin()
    await act(async () => {
      expect((await appRef.current.saveSupportTransfer({
        employeeId: 'E1', fromStoreId: 'A', toStoreId: 'B',
        fromDate: '2026-08-21', toDate: '2026-08-22', hourlySupportRate: 35_000,
      })).ok).toBe(true)
      expect((await appRef.current.updateSupportTransfer('TR-EXACT', {
        fromDate: '2026-08-20', toDate: '2026-08-23', hourlySupportRate: 40_000,
      })).ok).toBe(true)
    })

    const createPayload = api.apiCommand.mock.calls.find(([type]) => type === 'support_transfer.create')[1]
    expect(createPayload).toMatchObject({ fromDate: '2026-08-21', toDate: '2026-08-22' })
    expect(createPayload).not.toHaveProperty('startAt')
    expect(createPayload).not.toHaveProperty('endAt')
    const updatePayload = api.apiCommand.mock.calls.find(([type]) => type === 'support_transfer.update')[1]
    expect(updatePayload).toMatchObject({ fromDate: '2026-08-20', toDate: '2026-08-23' })
    expect(updatePayload).not.toHaveProperty('startAt')
    expect(updatePayload).not.toHaveProperty('endAt')
  })

  it('preserves exact bounds for backwards-compatible callers using startAt/endAt', async () => {
    await renderAdmin()
    await act(async () => {
      expect((await appRef.current.updateSupportTransfer('TR-EXACT', {
        startAt: '2026-08-20T09:00', endAt: '2026-08-20T13:00', hourlySupportRate: 30_000,
      })).ok).toBe(true)
    })

    const payload = api.apiCommand.mock.calls.find(([type]) => type === 'support_transfer.update')[1]
    expect(payload).toMatchObject({
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T06:00:00.000Z',
    })
    expect(payload).not.toHaveProperty('fromDate')
    expect(payload).not.toHaveProperty('toDate')
  })
})
