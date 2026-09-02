import { describe, expect, it, vi } from 'vitest'
import {
  installStaleReleaseRecovery,
  recoverStaleRelease,
  staleReleaseError,
} from './runtimeRecovery'

describe('stale release recovery', () => {
  it('recognizes a missing lazy chunk without treating ordinary render errors as stale releases', () => {
    expect(staleReleaseError(new Error('Failed to fetch dynamically imported module'))).toBe(true)
    expect(staleReleaseError(new Error('Cannot read properties of undefined'))).toBe(false)
  })

  it('reloads once and suppresses a reload loop within the recovery window', () => {
    const values = new Map()
    const storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    }
    const location = { reload: vi.fn() }
    const error = new Error('Error loading dynamically imported module')

    expect(recoverStaleRelease(error, { storage, location, now: 100_000 })).toBe(true)
    expect(recoverStaleRelease(error, { storage, location, now: 120_000 })).toBe(false)
    expect(location.reload).toHaveBeenCalledOnce()
  })

  it('prevents Vite from surfacing the stale chunk error after scheduling recovery', () => {
    const listeners = new Map()
    const target = {
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name) => listeners.delete(name),
    }
    const preventDefault = vi.fn()
    const reload = vi.fn()
    const cleanup = installStaleReleaseRecovery(target, {
      location: { reload },
      storage: { getItem: () => null, setItem: vi.fn() },
      now: 100_000,
    })
    listeners.get('vite:preloadError')({
      payload: new Error('Failed to fetch dynamically imported module'),
      preventDefault,
    })
    expect(reload).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
    cleanup()
    expect(listeners.has('vite:preloadError')).toBe(false)
  })
})
