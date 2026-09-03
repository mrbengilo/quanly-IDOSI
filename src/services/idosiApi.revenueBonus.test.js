import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiGetRevenueBonusLive, clearApiSession } from './idosiApi'

afterEach(() => {
  clearApiSession()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('IDOSI revenue bonus live reads', () => {
  it('retries one transient network failure and returns the matching store-day snapshot', async () => {
    vi.useFakeTimers()
    const payload = {
      ok: true,
      snapshot: {
        storeId: 'DI-AN',
        businessDate: '2026-09-02',
        calculationEligibility: { allowed: true, code: 'READY' },
      },
    }
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce({ ok: true, json: async () => payload })
    vi.stubGlobal('fetch', fetchMock)

    const pending = apiGetRevenueBonusLive({ storeId: 'DI-AN', businessDate: '2026-09-02' })
    await vi.advanceTimersByTimeAsync(250)

    await expect(pending).resolves.toBe(payload)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/revenue-bonus/live?storeId=DI-AN&businessDate=2026-09-02',
      '/api/revenue-bonus/live?storeId=DI-AN&businessDate=2026-09-02',
    ])
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true)
  })

  it('does not retry a server validation response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        error: { code: 'REVENUE_BONUS_DAILY_ALREADY', message: 'Ngày này đã được tính thưởng.' },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiGetRevenueBonusLive({ storeId: 'DI-AN', businessDate: '2026-09-02' }))
      .rejects.toMatchObject({ code: 'REVENUE_BONUS_DAILY_ALREADY', status: 409 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
