import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiAddressSuggestions, apiGetAccountAvatar, apiGetIdentityImage, apiGetStateMetadata, apiLogin, apiPolicyEntries, apiPolicyMap, clearApiSession } from './idosiApi'

afterEach(() => {
  clearApiSession()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('IDOSI policy API mapping', () => {
  it('round-trips all attendance evaluation thresholds', () => {
    const policies = {
      lateToleranceMinutes: 10,
      earlyCheckInLimitMinutes: 120,
      employeeKpiRates: { from30000: 5, from15000: 3, from7000: 1 },
      attendanceEvaluation: { maintainMaxLateCount: 2, improveMinLateCount: 4, improveMinLateMinutes: 45 },
    }
    const records = apiPolicyEntries(policies).map(([key, value]) => ({ key, value }))
    expect(apiPolicyMap(records)).toMatchObject({
      attendanceEvaluation: { maintainMaxLateCount: 2, improveMinLateCount: 4, improveMinLateMinutes: 45 },
    })
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
})

describe('IDOSI lightweight state synchronization', () => {
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
