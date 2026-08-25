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
    Object.values(api).forEach((mock) => mock.mockReset?.())
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
    expect(api.apiGetState).not.toHaveBeenCalled()
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

  it('keeps the new preview visible while the private object is loading or temporarily unavailable', async () => {
    render(<AppProvider><Probe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    await waitFor(() => expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v1'))

    let rejectDownload
    api.apiGetAccountAvatar.mockReset().mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectDownload = reject
    }))
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
    const preview = `data:image/png;base64,${png}`
    await act(async () => {
      expect((await appRef.current.saveSettings({ avatar: preview })).ok).toBe(true)
    })

    expect(appRef.current.settings.avatar).toBe(preview)
    expect(appRef.current.settings.avatarLoading).toBe(true)
    expect(api.apiGetState).not.toHaveBeenCalled()

    await act(async () => {
      rejectDownload(new Error('R2 tạm thời không phản hồi'))
    })
    await waitFor(() => expect(appRef.current.settings.avatarLoading).toBe(false))
    expect(appRef.current.settings.avatar).toBe(preview)
    expect(appRef.current.settings.avatarError).toContain('R2 tạm thời')
  })

  it('finishes durable avatar cleanup automatically without requiring another Save click', async () => {
    render(<AppProvider><Probe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    await waitFor(() => expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v1'))

    const cleanup = Object.assign(new Error('cleanup completed'), { code: 'ACCOUNT_AVATAR_CLEANUP_RETRY' })
    api.apiCommand
      .mockRejectedValueOnce(cleanup)
      .mockResolvedValueOnce({
        version: 2,
        settings: { ...remoteState(2).settings },
        user: { ...admin, version: 2 },
      })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
    let result
    await act(async () => {
      result = await appRef.current.saveSettings({ avatar: `data:image/png;base64,${png}` })
    })

    expect(result.ok).toBe(true)
    expect(api.apiCommand).toHaveBeenCalledTimes(2)
    expect(api.apiCommand.mock.calls[0][2].idempotencyKey).toBe(api.apiCommand.mock.calls[1][2].idempotencyKey)
  })

  it('refreshes a stale account version and retries once with a fresh idempotency key', async () => {
    render(<AppProvider><Probe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    await waitFor(() => expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v1'))

    const conflict = Object.assign(new Error('stale admin state'), { code: 'VERSION_CONFLICT' })
    api.apiGetState.mockResolvedValueOnce({
      user: { ...admin, version: 7 },
      state: remoteState(1),
      policies: [],
      version: 7,
    })
    api.apiCommand
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        version: 8,
        settings: { ...remoteState(2).settings },
        user: { ...admin, version: 8 },
      })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
    const preview = `data:image/png;base64,${png}`

    let result
    await act(async () => {
      result = await appRef.current.saveSettings({ avatar: preview, phone: '0900000000' })
    })

    expect(result.ok).toBe(true)
    expect(api.apiGetState).toHaveBeenCalledTimes(1)
    expect(api.apiCommand).toHaveBeenCalledTimes(2)
    expect(api.apiCommand.mock.calls[0][2].expectedVersion).toBe(1)
    expect(api.apiCommand.mock.calls[1][2].expectedVersion).toBe(7)
    expect(api.apiCommand.mock.calls[0][2].idempotencyKey).not.toBe(api.apiCommand.mock.calls[1][2].idempotencyKey)
    expect(api.apiCommand.mock.calls[0][1]).toEqual(api.apiCommand.mock.calls[1][1])
    expect(result.settings.avatar).toBe(preview)
    expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v2')
  })

  it('keeps the last confirmed avatar when the bounded version-conflict retry also fails', async () => {
    render(<AppProvider><Probe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    await waitFor(() => expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v1'))

    const conflict = () => Object.assign(new Error('stale admin state'), { code: 'VERSION_CONFLICT' })
    api.apiGetState.mockResolvedValueOnce({
      user: { ...admin, version: 7 },
      state: remoteState(1),
      policies: [],
      version: 7,
    })
    api.apiCommand.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict())
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')

    let result
    await act(async () => {
      result = await appRef.current.saveSettings({ avatar: `data:image/png;base64,${png}` })
    })

    expect(result.ok).toBe(false)
    expect(api.apiCommand).toHaveBeenCalledTimes(2)
    expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v1')
    expect(appRef.current.settings.avatarMetadata).toEqual(metadata(1))
  })

  it('does not leave the avatar loading state stuck when saving unrelated settings', async () => {
    render(<AppProvider><Probe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    await waitFor(() => expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v1'))
    api.apiCommand.mockResolvedValueOnce({
      version: 2,
      settings: { ...remoteState(1).settings, bio: 'Thông tin mới' },
      user: { ...admin, version: 2 },
    })

    await act(async () => {
      expect((await appRef.current.saveSettings({ bio: 'Thông tin mới' })).ok).toBe(true)
    })

    expect(appRef.current.settings.avatar).toBe('blob:account-avatar-v1')
    expect(appRef.current.settings.avatarLoading).toBe(false)
    expect(api.apiGetAccountAvatar).toHaveBeenCalledTimes(1)
  })

  it('preserves a compatible legacy avatar URL when saving unrelated settings', async () => {
    const legacyUrl = '/legacy-images/employee-avatar.jpg'
    api.apiBootstrapState.mockResolvedValueOnce({
      user: admin,
      state: { ...remoteState(1), settings: { ...remoteState(1).settings, avatar: legacyUrl } },
      policies: [],
      version: 1,
    })
    api.apiCommand.mockResolvedValueOnce({
      version: 2,
      settings: { ...remoteState(1).settings, avatar: legacyUrl, bio: 'Thông tin mới' },
      user: { ...admin, version: 2 },
    })
    render(<AppProvider><Probe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })

    await act(async () => {
      expect((await appRef.current.saveSettings({ bio: 'Thông tin mới' })).ok).toBe(true)
    })

    expect(appRef.current.settings.avatar).toBe(legacyUrl)
    expect(appRef.current.settings.avatarLoading).toBe(false)
    expect(api.apiGetAccountAvatar).not.toHaveBeenCalled()
  })
})
