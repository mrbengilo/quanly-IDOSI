import { describe, expect, it, vi } from 'vitest'
import { createAutomaticRevenueBonusRunner } from './automatic-revenue-bonus-runner.mjs'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('automatic revenue bonus runner', () => {
  it('runs on startup and periodically without overlapping executions', async () => {
    vi.useFakeTimers()
    try {
      let release
      const first = new Promise((resolve) => { release = resolve })
      const finalize = vi.fn()
        .mockImplementationOnce(() => first)
        .mockResolvedValue({ finalized: 1 })
      const runner = createAutomaticRevenueBonusRunner({
        env: { DB: {} },
        finalize,
        intervalMs: 5_000,
        logger: null,
      })

      runner.start()
      await flush()
      expect(finalize).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(15_000)
      expect(finalize).toHaveBeenCalledTimes(1)

      release({ finalized: 1 })
      await flush()
      await vi.advanceTimersByTimeAsync(5_000)
      await flush()
      expect(finalize).toHaveBeenCalledTimes(2)

      await runner.stop()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(finalize).toHaveBeenCalledTimes(2)
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

    await expect(runner.trigger('startup')).resolves.toBeNull()
    await expect(runner.trigger('interval')).resolves.toEqual({ finalized: 1, failed: 0 })

    expect(finalize).toHaveBeenCalledTimes(2)
    expect(logger).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event: 'idosi.revenue_bonus.finalizer',
      status: 'failed',
      reason: 'startup',
      error: 'temporary database error',
    }))
    expect(logger).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: 'idosi.revenue_bonus.finalizer',
      status: 'completed',
      reason: 'interval',
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
