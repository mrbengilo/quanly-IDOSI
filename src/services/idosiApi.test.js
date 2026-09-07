import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiAddressSuggestions,
  apiBootstrapState,
  apiCommand,
  apiGetAccountAvatar,
  apiGetEmployeeAvatar,
  apiGetIdentityImage,
  apiGetHistory,
  apiGetOrderSummary,
  apiGetStoreScreenState,
  apiGetStoreWorkspaceState,
  apiGetSystemScreenState,
  apiGetStateMetadata,
  apiListUsers,
  apiLogin,
  apiPolicyEntries,
  apiPolicyMap,
  clearApiSession,
  hasApiSession,
  hasPendingApiRequests,
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
    expect(hasPendingApiRequests()).toBe(false)
  })

  it('directs static-only responses back to the canonical production login URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }))

    await expect(apiLogin('admin', 'secret')).rejects.toMatchObject({
      code: 'API_UNAVAILABLE',
      message: expect.stringContaining('https://idosi.io.vn/#/login'),
    })
  })
})

describe('IDOSI pending API requests', () => {
  it('stays busy until all concurrent requests finish reading their response bodies', async () => {
    let resolveFirst
    let resolveSecondBody
    const secondBody = new Promise((resolve) => { resolveSecondBody = resolve })
    const readSecondBody = vi.fn(() => secondBody)
    const payload = { ok: true, state: {} }
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ ok: true, json: readSecondBody })
    vi.stubGlobal('fetch', fetchMock)

    expect(hasPendingApiRequests()).toBe(false)
    const first = apiGetSystemScreenState('employees')
    const second = apiGetStoreWorkspaceState('S01')
    expect(hasPendingApiRequests()).toBe(true)

    resolveFirst({ ok: true, json: async () => payload })
    await expect(first).resolves.toBe(payload)
    expect(readSecondBody).toHaveBeenCalledOnce()
    expect(hasPendingApiRequests()).toBe(true)

    resolveSecondBody(payload)
    await expect(second).resolves.toBe(payload)
    expect(hasPendingApiRequests()).toBe(false)
  })
})

describe('IDOSI scoped request cancellation', () => {
  const fetchUntilAbort = (_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }, { once: true })
  })

  it.each([
    ['system screen', (signal) => apiGetSystemScreenState('employees', { signal })],
    ['store workspace', (signal) => apiGetStoreWorkspaceState('S01', { signal })],
    ['store screen', (signal) => apiGetStoreWorkspaceState('S01', { screen: 'orders', signal })],
  ])('does not fetch an already cancelled %s request', async (_name, read) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(read(controller.signal)).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(hasPendingApiRequests()).toBe(false)
  })

  it('cancels an in-flight screen request without retrying or clearing the active session', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'session-token', user: { id: 'admin' } }) })
      .mockImplementationOnce(fetchUntilAbort)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, state: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    await apiLogin('admin', 'secret')

    const pending = apiGetSystemScreenState('employees', { signal: controller.signal })
    expect(hasPendingApiRequests()).toBe(true)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'REQUEST_ABORTED', status: 0 })
    const requestSignal = fetchMock.mock.calls[1][1].signal
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(30_250)

    expect(requestSignal.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    expect(hasPendingApiRequests()).toBe(false)
    expect(hasApiSession()).toBe(true)
    await apiGetSystemScreenState('stores')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/system-screens/stores', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }))
  })

  it('rejects cancellation while parsing the response body instead of returning an empty payload', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const json = vi.fn()
    const fetchMock = vi.fn((_path, options) => {
      json.mockImplementation(() => fetchUntilAbort(_path, options))
      return Promise.resolve({ ok: true, json })
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = apiGetStoreWorkspaceState('S01', { signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
    await vi.advanceTimersByTimeAsync(0)
    expect(json).toHaveBeenCalledOnce()
    controller.abort()
    await rejected

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(hasPendingApiRequests()).toBe(false)
  })

  it('cancels immediately during the retry delay and removes the pending retry', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection reset'))
    vi.stubGlobal('fetch', fetchMock)

    const pending = apiGetSystemScreenState('employees', { signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(hasPendingApiRequests()).toBe(false)
    controller.abort()
    await rejected

    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchMock).toHaveBeenCalledOnce()
    for (const [event, listener] of addListener.mock.calls) {
      expect(removeListener).toHaveBeenCalledWith(event, listener)
    }
  })

  it.each(['fetch', 'response body'])('still retries a timeout during %s with a fresh signal', async (phase) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const payload = { ok: true, state: {} }
    const fetchMock = vi.fn()
      .mockImplementationOnce((path, options) => phase === 'fetch'
        ? fetchUntilAbort(path, options)
        : Promise.resolve({ ok: true, json: () => fetchUntilAbort(path, options) }))
      .mockResolvedValueOnce({ ok: true, json: async () => payload })
    vi.stubGlobal('fetch', fetchMock)

    const pending = apiGetSystemScreenState('employees', { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(30_250)
    await expect(pending).resolves.toBe(payload)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false)
    expect(controller.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(hasPendingApiRequests()).toBe(false)
  })

  it.each(['success', 'network error'])('cleans up the caller listener and timeout after %s', async (outcome) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const payload = { ok: true, state: {} }
    const fetchMock = outcome === 'success'
      ? vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
      : vi.fn().mockRejectedValue(new TypeError('connection reset'))
    vi.stubGlobal('fetch', fetchMock)

    const pending = apiGetSystemScreenState('employees', { signal: controller.signal, retries: 0 })
    expect(hasPendingApiRequests()).toBe(true)
    if (outcome === 'success') await expect(pending).resolves.toBe(payload)
    else await expect(pending).rejects.toMatchObject({ code: 'NETWORK_ERROR', details: 'connection reset' })

    expect(vi.getTimerCount()).toBe(0)
    expect(hasPendingApiRequests()).toBe(false)
    for (const [event, listener] of addListener.mock.calls) {
      expect(removeListener).toHaveBeenCalledWith(event, listener)
    }
    controller.abort()
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false)
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

    expect(fetchMock).toHaveBeenLastCalledWith('/api/account-avatar/thumbnail', expect.objectContaining({
      method: 'GET',
      cache: 'no-cache',
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

    expect(fetchMock).toHaveBeenLastCalledWith('/api/account-avatars/NV%20KVC%2F001/thumbnail', expect.objectContaining({
      method: 'GET',
      cache: 'no-cache',
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

  it('requests a dedicated store screen API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, projection: 'store', storeId: 'CH 01', screen: 'payroll', state: {} }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiGetStoreScreenState('CH 01', 'payroll')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/store-screens/payroll?storeId=CH+01')
  })

  it('requests a dedicated system screen API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, projection: 'global', screen: 'employees', state: {} }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiGetSystemScreenState('employees')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/system-screens/employees')
  })

  it('requests full-period order totals independently of history pagination', async () => {
    const payload = { totals: { orders: 125, cash: 200_000, transfer: 300_000, revenue: 500_000 }, groups: {} }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiGetOrderSummary({ storeId: 'CH 01', period: '2026-09' })).resolves.toEqual(payload)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/order-summary?storeId=CH+01&period=2026-09')
  })

  it('requests a cursor-paginated store history page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, records: [], page: { hasMore: false, nextCursor: null } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiGetHistory('orders', {
      storeId: 'CH 01', period: '2026-09', cursor: 'next-page', limit: 25,
    })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/history/orders?storeId=CH+01&limit=25&period=2026-09&cursor=next-page')
  })

  it('looks up a linked order across months inside the selected store', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ records: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await apiGetHistory('orders', { storeId: 'S01', orderId: 'OLD/ORDER', limit: 10 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/history/orders?storeId=S01&limit=10&orderId=OLD%2FORDER')
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
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: 12, user: { id: 'admin' } }) })
    await apiGetStateMetadata('global', { restore: true })
    expect(fetchMock.mock.calls[2][0]).toBe('/api/state-metadata?scope=global&restore=1')
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
  it('sends the same exact-money filters to history and summaries, preserving zero and cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const filters = { storeId: 'S01', period: '2026-09', employeeId: 'E01', amount: 0, paymentMethod: 'Tiền mặt', date: '2026-09-01', shiftId: 'night', query: 'Nguyễn Ánh', signal: controller.signal }
    await apiGetHistory('orders', { ...filters, cursor: 'next' })
    await apiGetOrderSummary(filters)
    for (const [path, options] of fetchMock.mock.calls) {
      const url = new URL(path, 'https://idosi.example')
      for (const [key, value] of Object.entries(filters).filter(([key]) => key !== 'signal')) expect(url.searchParams.get(key)).toBe(String(value))
      expect(url.searchParams.has('signal')).toBe(false)
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }
  })

})
