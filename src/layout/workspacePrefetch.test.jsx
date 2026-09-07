import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspacePrefetch, useWorkspacePrefetch } from './workspacePrefetch'

const api = vi.hoisted(() => ({ pending: false }))
vi.mock('../services/idosiApi', () => ({ hasPendingApiRequests: () => api.pending }))

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const paths = ['/admin/overview', '/admin/stores', '/admin/employees', '/admin/reports']
const schedulers = []
const setup = (options = {}) => {
  const preloadModule = vi.fn(() => Promise.resolve())
  const prefetchData = vi.fn(() => Promise.resolve())
  const scheduler = createWorkspacePrefetch({ pathname: paths[0], paths, preloadModule, prefetchData, ...options })
  schedulers.push(scheduler)
  return { scheduler, preloadModule, prefetchData }
}

beforeEach(() => {
  vi.useFakeTimers()
  api.pending = false
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined })
})
afterEach(() => {
  cleanup()
  schedulers.splice(0).forEach((scheduler) => scheduler.cancel())
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete navigator.connection
  delete window.requestIdleCallback
  delete window.cancelIdleCallback
})

describe('workspace prefetch scheduling', () => {
  it('waits after display and then warms at most two following menu screens sequentially', async () => {
    const pending = deferred()
    const prefetchData = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const { preloadModule } = setup({ prefetchData })
    await vi.advanceTimersByTimeAsync(1499)
    expect(preloadModule).not.toHaveBeenCalled()
    expect(prefetchData).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(prefetchData.mock.calls.map(([path]) => path)).toEqual(['/admin/stores'])
    pending.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(prefetchData.mock.calls.map(([path]) => path)).toEqual(['/admin/stores', '/admin/employees'])
    await vi.advanceTimersByTimeAsync(10000)
    expect(prefetchData).toHaveBeenCalledTimes(2)
  })

  it('defers background and intent work until visible-page API requests finish', async () => {
    api.pending = true
    const { scheduler, prefetchData, preloadModule } = setup()
    scheduler.intent('/admin/reports')
    await vi.advanceTimersByTimeAsync(4500)
    expect(prefetchData).not.toHaveBeenCalled()
    expect(preloadModule).not.toHaveBeenCalled()
    api.pending = false
    await vi.advanceTimersByTimeAsync(1500)
    expect(prefetchData.mock.calls.map(([path]) => path)).toEqual(['/admin/reports', '/admin/stores', '/admin/employees'])
  })

  it('rechecks visible-page API activity when an idle callback finally fires', async () => {
    let onIdle
    window.requestIdleCallback = vi.fn((callback) => { onIdle = callback; return 3 })
    const { prefetchData } = setup()
    await vi.advanceTimersByTimeAsync(1500)
    api.pending = true
    onIdle()
    await vi.advanceTimersByTimeAsync(0)
    expect(prefetchData).not.toHaveBeenCalled()
    api.pending = false
    await vi.advanceTimersByTimeAsync(1500)
    onIdle()
    await vi.advanceTimersByTimeAsync(0)
    expect(prefetchData).toHaveBeenCalledTimes(2)
  })

  it('waits for an idle callback after the display delay when the browser supports it', async () => {
    let onIdle
    window.requestIdleCallback = vi.fn((callback) => { onIdle = callback; return 3 })
    window.cancelIdleCallback = vi.fn()
    const { scheduler, prefetchData } = setup()
    await vi.advanceTimersByTimeAsync(1500)
    expect(prefetchData).not.toHaveBeenCalled()
    onIdle()
    await vi.advanceTimersByTimeAsync(0)
    expect(prefetchData).toHaveBeenCalledTimes(2)
    scheduler.cancel()
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(3)
  })

  it('deduplicates hover/focus intent and ignores current and unpermitted paths', async () => {
    const { scheduler, preloadModule, prefetchData } = setup()
    scheduler.intent('/admin/reports')
    scheduler.intent('/admin/reports')
    scheduler.intent('/admin/overview')
    scheduler.intent('/admin/reset')
    await vi.advanceTimersByTimeAsync(0)
    expect(prefetchData.mock.calls.map(([path]) => path)).toEqual(['/admin/reports'])
    expect(preloadModule).toHaveBeenCalledOnce()
  })

  it.each(['hidden', 'offline', 'saveData', '2g', 'slow-2g'])('skips idle and intent work for %s', async (condition) => {
    if (condition === 'hidden') vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    if (condition === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    Object.defineProperty(navigator, 'connection', { configurable: true, value: {
      saveData: condition === 'saveData', effectiveType: condition,
    } })
    const { scheduler, prefetchData, preloadModule } = setup()
    scheduler.intent('/admin/reports')
    await vi.advanceTimersByTimeAsync(10000)
    expect(prefetchData).not.toHaveBeenCalled()
    expect(preloadModule).not.toHaveBeenCalled()
  })

  it('aborts current work and cancels queued screens when the tab becomes hidden', async () => {
    const pending = deferred()
    const prefetchData = vi.fn(() => pending.promise)
    setup({ prefetchData })
    await vi.advanceTimersByTimeAsync(1500)
    const signal = prefetchData.mock.calls[0][1].signal
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(signal.aborted).toBe(true)
    pending.resolve()
    await vi.advanceTimersByTimeAsync(10000)
    expect(prefetchData).toHaveBeenCalledOnce()
  })

  it('continues safely when speculative module or data requests reject', async () => {
    const preloadModule = vi.fn().mockRejectedValue(new Error('Chunk unavailable'))
    const prefetchData = vi.fn().mockRejectedValue(new Error('Network unavailable'))
    setup({ preloadModule, prefetchData })
    await vi.advanceTimersByTimeAsync(1500)
    expect(prefetchData).toHaveBeenCalledTimes(2)
  })

  it('does not start before the current screen commits, and aborts on loading, navigation, or identity changes', async () => {
    const prefetchData = vi.fn((path, { signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', resolve, { once: true })
    }))
    const preloadModule = vi.fn(() => Promise.resolve())
    const { rerender, result } = renderHook((props) => useWorkspacePrefetch({
      pathname: paths[0], paths, preloadModule, prefetchData, ...props,
    }), { initialProps: { ready: false, contextKey: 'admin:S01' } })
    await act(() => vi.advanceTimersByTimeAsync(10000))
    act(() => result.current('/admin/stores'))
    expect(prefetchData).not.toHaveBeenCalled()
    rerender({ ready: true, contextKey: 'admin:S01' })
    await act(() => vi.advanceTimersByTimeAsync(1500))
    const firstSignal = prefetchData.mock.calls[0][1].signal
    rerender({ ready: true, contextKey: 'employee:S02' })
    expect(firstSignal.aborted).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(1500))
    const secondSignal = prefetchData.mock.calls[1][1].signal
    rerender({ ready: false, contextKey: 'employee:S02' })
    expect(secondSignal.aborted).toBe(true)
  })
})
