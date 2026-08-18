import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetState: vi.fn(),
  apiLogin: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  clearApiSession: vi.fn(),
}))

vi.mock('../services/idosiApi', () => ({
  apiBootstrapState: api.apiBootstrapState,
  apiCommand: api.apiCommand,
  apiGetState: api.apiGetState,
  apiLogin: api.apiLogin,
  apiListUsers: api.apiListUsers,
  apiLogout: api.apiLogout,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  clearApiSession: api.clearApiSession,
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => false,
}))

const supportUser = {
  id: 'USER-HTKD-001',
  employeeId: 'HTKD-001',
  username: 'support-one',
  displayName: 'Hỗ trợ KD',
  role: 'business_support',
  status: 'active',
  version: 1,
}

const makeRemoteState = (activeStoreId = 'STORE-A') => ({
  ...createInitialState(),
  stores: [
    { id: 'STORE-A', name: 'Cửa hàng A', status: 'Đang hoạt động' },
    { id: 'STORE-B', name: 'Cửa hàng B', status: 'Đang hoạt động' },
  ],
  employees: [{
    id: 'HTKD-001',
    code: 'HTKD-001',
    name: 'Hỗ trợ KD',
    unit: 'business_support',
    storeId: 'BUSINESS_SUPPORT',
    status: 'Đang làm việc',
  }],
  activeStoreId,
})

let appRef

const AppProbe = forwardRef(function AppProbe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return <output aria-label="Cửa hàng đang chọn">{app.activeStoreId || 'none'}</output>
})

const renderProvider = () => render(<AppProvider><AppProbe ref={appRef} /></AppProvider>)

describe('remote command active-store preservation', () => {
  beforeEach(() => {
    appRef = createRef()
    const bootstrap = () => ({ user: supportUser, state: makeRemoteState('STORE-A'), policies: [], version: 1 })
    api.apiLogin.mockResolvedValue({ user: supportUser })
    api.apiBootstrapState.mockImplementation(async () => bootstrap())
    api.apiListUsers.mockResolvedValue({ users: [supportUser] })
    api.apiGetState.mockImplementation(async () => bootstrap())
    api.apiCommand.mockResolvedValue({ version: 2, store: { id: 'STORE-A', name: 'Cửa hàng A mới' } })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps store B selected after a successful command refresh returns global store A', async () => {
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })
    act(() => appRef.current.setActiveStoreId('STORE-B'))
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')

    await act(async () => {
      expect((await appRef.current.updateStore('STORE-A', { name: 'Cửa hàng A mới' })).ok).toBe(true)
    })

    expect(api.apiGetState).toHaveBeenCalledWith('global')
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')
  })

  it('keeps store B selected when a version conflict refreshes the latest state', async () => {
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })
    act(() => appRef.current.setActiveStoreId('STORE-B'))
    const conflict = Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' })
    api.apiCommand.mockRejectedValueOnce(conflict)

    await act(async () => {
      expect((await appRef.current.updateStore('STORE-A', { name: 'Cửa hàng A mới' })).ok).toBe(false)
    })

    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')
  })
})
