import { describe, expect, it, vi } from 'vitest'
import { createAutomaticRevenueBonusRunner } from './automatic-revenue-bonus-runner.mjs'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('automatic revenue bonus runner', () => {
  it('waits until 22:00 Vietnam time and runs only once per daily cutoff', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-03T14:00:00.000Z'))
      const finalize = vi.fn().mockResolvedValue({ finalized: 1 })
      const runner = createAutomaticRevenueBonusRunner({
        env: { DB: {} },
        finalize,
        logger: null,
      })

      runner.start()
      await flush()
      expect(finalize).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(59 * 60 * 1_000 + 59 * 1_000)
      expect(finalize).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1_000)
      await flush()
      expect(finalize).toHaveBeenCalledTimes(1)
      expect(finalize).toHaveBeenLastCalledWith({ DB: {} }, {
        now: '2026-09-03T15:00:00.000Z',
        trigger: 'daily-cutoff',
      })

      await vi.advanceTimersByTimeAsync(30_000)
      expect(finalize).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1_000 + 59 * 60 * 1_000 + 30 * 1_000)
      expect(finalize).toHaveBeenCalledTimes(2)

      await runner.stop()
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000)
      expect(finalize).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers a missed cutoff once when the VPS starts after 22:00', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-03T15:05:00.000Z'))
      const finalize = vi.fn().mockResolvedValue({ finalized: 1 })
      const runner = createAutomaticRevenueBonusRunner({ env: {}, finalize, logger: null })

      runner.start()
      await flush()
      expect(finalize).toHaveBeenCalledTimes(1)
      expect(finalize).toHaveBeenCalledWith({}, {
        now: '2026-09-03T15:05:00.000Z',
        trigger: 'startup-after-cutoff',
      })

      await vi.advanceTimersByTimeAsync(30_000)
      expect(finalize).toHaveBeenCalledTimes(1)
      await runner.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers on the next trigger after a transient finalization failure', async () => {
    const logger = vi.fn()
    const finalize = vi.fn()
      .mockRejectedValueOnce(new Error('temporary database error'))
      .mockResolvedValueOnce({ finalized: 1, failed: 0 })
    const runner = createAutomaticRevenueBonusRunner({
      env: { DB: {} },
      finalize,
      logger,
    })

    await expect(runner.trigger('manual-retry-1')).resolves.toBeNull()
    await expect(runner.trigger('manual-retry-2')).resolves.toEqual({ finalized: 1, failed: 0 })

    expect(finalize).toHaveBeenCalledTimes(2)
    expect(logger).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event: 'idosi.revenue_bonus.finalizer',
      status: 'failed',
      reason: 'manual-retry-1',
      error: 'temporary database error',
    }))
    expect(logger).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: 'idosi.revenue_bonus.finalizer',
      status: 'completed',
      reason: 'manual-retry-2',
      finalized: 1,
      failed: 0,
    }))

    await runner.stop()
  })

  it('does nothing when disabled', async () => {
    const finalize = vi.fn()
    const runner = createAutomaticRevenueBonusRunner({ env: {}, finalize, enabled: false, logger: null })
    runner.start()
    await runner.trigger('manual')
    expect(finalize).not.toHaveBeenCalled()
    await runner.stop()
  })
})
