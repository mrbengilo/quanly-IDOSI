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
  apiLogin: vi.fn(),
  apiSelectSessionRole: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(async () => {
    const error = new Error('Phiên đăng nhập không hợp lệ.')
    error.status = 401
    error.code = 'SESSION_INVALID'
    throw error
  }),
  clearApiSession: vi.fn(),
}))

vi.mock('../services/idosiApi', () => ({
  ...api,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => true,
}))

const workspaceCache = vi.hoisted(() => ({
  clearWorkspaceCache: vi.fn(async () => {}),
  readWorkspaceCache: vi.fn(async () => null),
  writeWorkspaceCache: vi.fn(async () => {}),
}))
vi.mock('../services/workspaceCache', () => workspaceCache)

let appRef
const AppProbe = forwardRef(function AppProbe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return null
})

describe('remote session revoked while the workspace is open', () => {
  beforeEach(() => { appRef = createRef(); localStorage.clear(); sessionStorage.clear() })
  afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks() })

  it('returns to login and drops the previous employee data on SESSION_INVALID from a command', async () => {
    const remoteUser = {
      id: 'USER-E01', username: 'employee.departed', displayName: 'Nhân viên đã nghỉ',
      role: 'employee', employeeId: 'E01', storeId: 'S01', status: 'active', version: 1,
    }
    const remoteState = {
      ...createInitialState(),
      session: null,
      activeStoreId: 'S01',
      stores: [{ id: 'S01', name: 'Cửa hàng', status: 'Đang hoạt động' }],
      employees: [{ id: 'E01', name: 'Nhân viên đã nghỉ', unit: 'store', storeId: 'S01', status: 'Đang làm việc', phone: '0901234567' }],
      attendance: [],
    }
    api.apiLogin.mockResolvedValueOnce({ user: remoteUser })
    api.apiBootstrapState.mockResolvedValueOnce({ user: remoteUser, state: remoteState, policies: [], version: 1 })
    const revoked = new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.')
    revoked.status = 401
    revoked.code = 'SESSION_INVALID'
    api.apiCommand.mockRejectedValueOnce(revoked)
    render(<AppProvider><AppProbe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect(await appRef.current.login('employee.departed', 'Departed-Password-01')).toMatchObject({ ok: true })
    })
    expect(appRef.current.session).toBeTruthy()
    expect(appRef.current.employees.some((profile) => profile.id === 'E01')).toBe(true)

    await act(async () => {
      expect(await appRef.current.clearNotifications()).toMatchObject({ ok: false })
    })
    expect(appRef.current.session).toBeNull()
    expect(appRef.current.employees.some((profile) => profile.id === 'E01')).toBe(false)
    expect(api.clearApiSession).toHaveBeenCalled()
    expect(workspaceCache.clearWorkspaceCache).toHaveBeenCalled()
  })
})
