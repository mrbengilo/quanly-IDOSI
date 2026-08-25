import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Buffer } from 'node:buffer'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetAccountAvatar: vi.fn(),
  apiGetState: vi.fn(),
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
  apiLogin: api.apiLogin,
  apiListUsers: api.apiListUsers,
  apiLogout: api.apiLogout,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  apiSelectSessionRole: vi.fn(),
  clearApiSession: api.clearApiSession,
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => false,
}))

const admin = {
  id: 'usr_admin', username: 'admin', displayName: 'Admin', role: 'admin', status: 'active', version: 1,
}
const metadata = (version) => ({
  key: `account-avatars/usr_admin/avatar-v${version}.gif`,
  contentType: 'image/gif',
  size: 128,
  version,
  uploadedAt: `2026-08-2${version}T00:00:00.000Z`,
})
const remoteState = (version) => ({
  ...createInitialState(),
  settings: { name: 'Admin', email: 'admin@idosi.vn', avatar: metadata(version), notifications: {} },
})

const Probe = forwardRef(function Probe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return <output data-testid="avatar-state">{JSON.stringify({
    avatar: app.settings?.avatar,
    loading: app.settings?.avatarLoading,
    error: app.settings?.avatarError,
  })}</output>
})

describe('AppContext private account-avatar lifecycle', () => {
  let appRef
  let originalCreateObjectURL
  let originalRevokeObjectURL

  beforeEach(() => {
    appRef = createRef()
    sessionStorage.clear()
    localStorage.clear()
    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn()
      .mockReturnValueOnce('blob:account-avatar-v1')
      .mockReturnValueOnce('blob:account-avatar-v2')
    URL.revokeObjectURL = vi.fn()
    api.apiLogin.mockResolvedValue({ user: admin })
    api.apiBootstrapState.mockResolvedValue({ user: admin, state: remoteState(1), policies: [], version: 1 })
    api.apiListUsers.mockResolvedValue({ users: [] })
    api.apiGetAccountAvatar
      .mockResolvedValueOnce(new Blob(['avatar-v1'], { type: 'image/gif' }))
      .mockResolvedValueOnce(new Blob(['avatar-v2'], { type: 'image/gif' }))
    api.apiCommand.mockResolvedValue({ version: 2, settings: { ...remoteState(2).settings }, user: { ...admin, version: 2 } })
    api.apiGetState.mockResolvedValue({ user: admin, state: remoteState(2), policies: [], version: 2 })
  })

  afterEach(() => {
    cleanup()
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.clearAllMocks()
  })

  it('loads, replaces, and revokes authenticated Blob URLs without persisting them', async () => {
    const view = render(<AppProvider><Probe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    await waitFor(() => expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v1'))
    expect(api.apiGetAccountAvatar).toHaveBeenCalledTimes(1)

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
    await act(async () => {
      expect((await appRef.current.saveSettings({
        ...appRef.current.settings,
        avatar: `data:image/png;base64,${png}`,
      })).ok).toBe(true)
    })
    await waitFor(() => expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v2'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:account-avatar-v1')
    expect(api.apiCommand).toHaveBeenCalledWith(
      'account_settings.update',
      expect.objectContaining({ avatar: expect.stringMatching(/^data:image\/png;base64,/u) }),
      expect.any(Object),
    )
    expect(JSON.stringify(api.apiCommand.mock.calls)).not.toContain('blob:account-avatar')

    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:account-avatar-v2')
  })
})
