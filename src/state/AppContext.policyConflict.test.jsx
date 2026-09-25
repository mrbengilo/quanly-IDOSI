import { act, cleanup, render } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetAccountAvatar: vi.fn(),
  apiGetState: vi.fn(),
  apiGetStateMetadata: vi.fn(),
  apiGetStoreWorkspaceState: vi.fn(),
  apiGetSystemScreenState: vi.fn(),
  apiLogin: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  clearApiSession: vi.fn(),
}))

vi.mock('../services/idosiApi', () => ({
  apiBootstrapState: api.apiBootstrapState,
  apiCommand: api.apiCommand,
  apiGetAccountAvatar: api.apiGetAccountAvatar,
  apiGetState: api.apiGetState,
  apiGetStateMetadata: api.apiGetStateMetadata,
  apiGetStoreWorkspaceState: api.apiGetStoreWorkspaceState,
  apiGetSystemScreenState: api.apiGetSystemScreenState,
  apiLogin: api.apiLogin,
  apiListUsers: api.apiListUsers,
  apiLogout: api.apiLogout,
  apiPolicyEntries: (policies) => [['attendance.lateToleranceMinutes', policies.lateToleranceMinutes]],
  apiPolicyMap: () => ({}),
  apiSelectSessionRole: vi.fn(),
  clearApiSession: api.clearApiSession,
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => false,
}))

const admin = {
  id: 'usr_admin', username: 'admin', displayName: 'Admin', role: 'admin', status: 'active', version: 1,
}

const Probe = forwardRef(function Probe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return null
})

describe('AppContext policy save conflicts', () => {
  let appRef

  beforeEach(() => {
    appRef = createRef()
    Object.values(api).forEach((mock) => mock.mockReset?.())
    sessionStorage.clear()
    localStorage.clear()
    api.apiLogin.mockResolvedValue({ user: admin })
    api.apiBootstrapState.mockResolvedValue({
      user: admin,
      state: createInitialState(),
      policies: [{ key: 'attendance.lateToleranceMinutes', value: 5, version: 3 }],
      version: 1,
    })
    api.apiListUsers.mockResolvedValue({ users: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('retries with policy versions from metadata instead of downloading the full state', async () => {
    render(<AppProvider><Probe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    api.apiCommand
      .mockRejectedValueOnce(Object.assign(new Error('stale policy'), { code: 'VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ policies: [{ key: 'attendance.lateToleranceMinutes', value: 9, version: 5 }] })
    api.apiGetStateMetadata.mockResolvedValueOnce({
      scope: 'global', version: 1, policyVersions: { 'attendance.lateToleranceMinutes': 4 },
    })

    let result
    await act(async () => {
      result = await appRef.current.savePolicies({ lateToleranceMinutes: 9 })
    })

    expect(result.ok).toBe(true)
    expect(api.apiGetState).not.toHaveBeenCalled()
    expect(api.apiGetStateMetadata).toHaveBeenCalledTimes(1)
    expect(api.apiCommand).toHaveBeenCalledTimes(2)
    expect(api.apiCommand.mock.calls[0][1].updates[0].expectedVersion).toBe(3)
    expect(api.apiCommand.mock.calls[1][1].updates[0].expectedVersion).toBe(4)
  })
})
