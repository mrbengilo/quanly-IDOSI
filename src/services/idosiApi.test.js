import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiAddressSuggestions,
  apiBootstrapState,
  apiCommand,
  apiGetAccountAvatar,
  apiGetEmployeeAvatar,
  apiGetIdentityImage,
  apiGetStoreWorkspaceState,
  apiGetStateMetadata,
  apiListUsers,
  apiLogin,
  apiPolicyEntries,
  apiPolicyMap,
  clearApiSession,
} from './idosiApi'

afterEach(() => {
  clearApiSession()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('IDOSI login resilience', () => {
  it('allows a cold login request 30 seconds before timing out without retrying the POST', async () => {
    vi.useFakeTimers()
    let signal
    const fetchMock = vi.fn((_path, options) => {
      signal = options.signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const login = apiLogin('admin', 'secret')
    const rejected = expect(login).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringContaining('30 giây'),
    })
    await vi.advanceTimersByTimeAsync(29_999)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it.each([
    ['bootstrap', () => apiBootstrapState()],
    ['users', () => apiListUsers()],
  ])('retries one transient %s GET and then returns the hydrated payload', async (_name, read) => {
    vi.useFakeTimers()
    const payload = { ok: true, state: { stores: [] }, version: 1 }
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce({ ok: true, json: async () => payload })
    vi.stubGlobal('fetch', fetchMock)

    const pending = read()
    await vi.advanceTimersByTimeAsync(250)

    await expect(pending).resolves.toBe(payload)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true)
  })

  it('stops a state read after one transport retry', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection reset'))
    vi.stubGlobal('fetch', fetchMock)

    const pending = apiBootstrapState()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    await vi.advanceTimersByTimeAsync(250)

    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an authenticated state read after an HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error: { code: 'SESSION_INVALID', message: 'Phiên không hợp lệ.' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiBootstrapState()).rejects.toMatchObject({ code: 'SESSION_INVALID', status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('directs static-only responses back to the canonical production login URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }))

    await expect(apiLogin('admin', 'secret')).rejects.toMatchObject({
      code: 'API_UNAVAILABLE',
      message: expect.stringContaining('https://idosi.io.vn/#/login'),
    })
  })
})

describe('IDOSI policy API mapping', () => {
  it('round-trips all attendance evaluation thresholds', () => {
    const policies = {
      lateToleranceMinutes: 10,
      earlyCheckInLimitMinutes: 120,
      attendanceEvaluation: { maintainMaxLateCount: 2, improveMinLateCount: 4, improveMinLateMinutes: 45 },
    }
    const records = apiPolicyEntries(policies).map(([key, value]) => ({ key, value }))
    expect(apiPolicyMap(records)).toMatchObject({
      attendanceEvaluation: { maintainMaxLateCount: 2, improveMinLateCount: 4, improveMinLateMinutes: 45 },
    })
    expect(records.map((record) => record.key)).not.toContain('employee_kpi_percent_30000')
  })
})

describe('IDOSI private identity images', () => {
  it('loads a CCCD image with the active bearer session', async () => {
    const image = new Blob(['image-bytes'], { type: 'image/png' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'session-token', user: { id: 'admin' } }) })
      .mockResolvedValueOnce({ ok: true, blob: async () => image })
    vi.stubGlobal('fetch', fetchMock)

    await apiLogin('admin', 'secret')
    await expect(apiGetIdentityImage('HTKD-001', 'front')).resolves.toBe(image)

    expect(fetchMock).toHaveBeenLastCalledWith('/api/identity-images/HTKD-001/front', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }))
  })
})

describe('IDOSI private account avatar', () => {
  it('loads the current account avatar with the active bearer session', async () => {
    const image = new Blob(['avatar-bytes'], { type: 'image/gif' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'session-token', user: { id: 'admin' } }) })
      .mockResolvedValueOnce({ ok: true, blob: async () => image })
    vi.stubGlobal('fetch', fetchMock)

    await apiLogin('admin', 'secret')
    await expect(apiGetAccountAvatar()).resolves.toBe(image)

    expect(fetchMock).toHaveBeenLastCalledWith('/api/account-avatar', expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
      headers: expect.objectContaining({
        Accept: expect.stringContaining('image/gif'),
        Authorization: 'Bearer session-token',
      }),
    }))
  })

  it('loads the authorized avatar for the requested canonical employee instead of the session avatar', async () => {
    const image = new Blob(['employee-avatar-bytes'], { type: 'image/webp' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'session-token', user: { id: 'support-user' } }) })
      .mockResolvedValueOnce({ ok: true, blob: async () => image })
    vi.stubGlobal('fetch', fetchMock)

    await apiLogin('htkd', 'secret')
    await expect(apiGetEmployeeAvatar('NV KVC/001')).resolves.toBe(image)

    expect(fetchMock).toHaveBeenLastCalledWith('/api/account-avatars/NV%20KVC%2F001', expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
      headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }))
  })

  it('rejects a missing employee id without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiGetEmployeeAvatar('  ')).rejects.toMatchObject({
      code: 'EMPLOYEE_AVATAR_ID_REQUIRED',
      status: 400,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('IDOSI lightweight state synchronization', () => {
  it('requests the compact initial bootstrap profile for progressive Admin hydration', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, partial: true, state: { stores: [] }, version: 12 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiBootstrapState('global', { profile: 'initial' })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/bootstrap?scope=global&profile=initial')
  })

  it('can request a version-only state patch response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, command: 'state.merge', version: 13 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiCommand('state.merge', { patch: { activeStoreId: 'S01' } }, {
      expectedVersion: 12,
      idempotencyKey: 'state-merge-version-only-0001',
      includeState: false,
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      type: 'state.merge',
      expectedVersion: 12,
      includeState: false,
      payload: { patch: { activeStoreId: 'S01' } },
    })
  })

  it('requests only the selected store workspace projection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, projection: 'store', storeId: 'CH 01', state: {} }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiGetStoreWorkspaceState('CH 01')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/state?scope=global&view=store&storeId=CH+01')
  })

  it('loads only state metadata with the active bearer session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'session-token', user: { id: 'admin' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, scope: 'global', version: 12 }) })
    vi.stubGlobal('fetch', fetchMock)

    await apiLogin('admin', 'secret')
    await expect(apiGetStateMetadata()).resolves.toMatchObject({ scope: 'global', version: 12 })

    expect(fetchMock.mock.calls[1][0]).toBe('/api/state-metadata?scope=global')
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }))
  })
})

describe('IDOSI address suggestions', () => {
  it('requests dependent Google Maps-backed suggestions with encoded context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, suggestions: ['Hiệp Bình'] }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiAddressSuggestions({
      type: 'ward', query: 'hiệp', province: 'Hồ Chí Minh', ward: '',
    })).resolves.toMatchObject({ suggestions: ['Hiệp Bình'] })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/address-suggestions?type=ward&query=hi%E1%BB%87p&province=H%E1%BB%93+Ch%C3%AD+Minh')
  })
})
