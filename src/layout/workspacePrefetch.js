import { useCallback, useEffect, useRef } from 'react'
import { storeScreenForPath, systemScreenForPath } from '../domain/workspaceScreens'
import { hasPendingApiRequests } from '../services/idosiApi'

// These directory/configuration profiles omit order, attendance and payroll history in
// SYSTEM_SCREEN_COLLECTIONS and STORE_SCREEN_COLLECTIONS. Store order history
// is cursor-paginated separately. Keep history/attendance screens demand-loaded:
// aborting a browser fetch cannot interrupt synchronous server snapshot work.
const DATA_PREFETCH_SYSTEM_SCREENS = new Set([
  'stores', 'employees', 'settings', 'account-settings', 'policies',
  'order-information-settings', 'work-catalog',
])
const DATA_PREFETCH_STORE_SCREENS = new Set(['orders', 'statistics', 'employees', 'salary-settings', 'settings'])
const canPrefetchData = (pathname) => {
  const path = String(pathname || '').split(/[?#]/u)[0]
  return path.startsWith('/store/')
    ? DATA_PREFETCH_STORE_SCREENS.has(storeScreenForPath(path))
    : DATA_PREFETCH_SYSTEM_SCREENS.has(systemScreenForPath(path))
}

export const canPrefetchWorkspace = () => {
  const connection = navigator.connection
  return document.visibilityState !== 'hidden'
    && navigator.onLine !== false
    && !connection?.saveData
    && !['slow-2g', '2g'].includes(connection?.effectiveType)
}

export const createWorkspacePrefetch = ({ pathname, paths, preloadModule, prefetchData }) => {
  const permittedPaths = [...new Set(paths)].filter((path) => path !== pathname)
  const currentIndex = paths.indexOf(pathname)
  const nextPaths = currentIndex < 0
    ? permittedPaths.slice(0, 2)
    : [...paths.slice(currentIndex + 1), ...paths.slice(0, currentIndex)]
      .filter((path) => path !== pathname).slice(0, 2)
  const requested = new Set()
  const queue = []
  let cancelled = false
  let running = false
  let current = null
  let idleId
  let timer
  let retryTimer

  const scheduleDrain = () => {
    if (retryTimer !== undefined) return
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined
      void drain()
    }, 1500)
  }
  const drain = async () => {
    if (running || cancelled || !canPrefetchWorkspace()) return
    if (hasPendingApiRequests()) {
      scheduleDrain()
      return
    }
    running = true
    while (queue.length && !cancelled && canPrefetchWorkspace() && !hasPendingApiRequests()) {
      const { path, intent } = queue.shift()
      const controller = new AbortController()
      current = { controller, intent }
      await Promise.allSettled([
        Promise.resolve().then(() => !controller.signal.aborted && preloadModule(path)),
        Promise.resolve().then(() => !controller.signal.aborted && canPrefetchData(path)
          && prefetchData?.(path, { signal: controller.signal })),
      ])
      current = null
    }
    running = false
    if (queue.length && !cancelled) scheduleDrain()
  }

  const enqueue = (path, intent = false) => {
    if (cancelled || !canPrefetchWorkspace() || !permittedPaths.includes(path) || requested.has(path)) return
    requested.add(path)
    if (intent) {
      queue.unshift({ path, intent })
      if (current && !current.intent) current.controller.abort()
    } else queue.push({ path, intent })
    void drain()
  }

  // This scheduler is created only after the current Outlet commits. Leave its
  // first paint and immediate interaction alone before warming adjacent screens.
  const warmNext = () => {
    if (cancelled || !canPrefetchWorkspace()) return
    if (hasPendingApiRequests()) {
      timer = window.setTimeout(scheduleIdle, 1500)
      return
    }
    nextPaths.forEach((path) => enqueue(path))
  }
  const scheduleIdle = () => {
    if (cancelled || !canPrefetchWorkspace()) return
    if (window.requestIdleCallback) idleId = window.requestIdleCallback(warmNext, { timeout: 2000 })
    else warmNext()
  }
  timer = window.setTimeout(scheduleIdle, 1500)

  const cancel = () => {
    cancelled = true
    window.clearTimeout(timer)
    window.clearTimeout(retryTimer)
    if (idleId !== undefined) window.cancelIdleCallback?.(idleId)
    current?.controller.abort()
    queue.length = 0
  }
  const onEnvironmentChange = () => {
    if (!canPrefetchWorkspace()) cancel()
  }
  document.addEventListener('visibilitychange', onEnvironmentChange)
  window.addEventListener('offline', onEnvironmentChange)
  navigator.connection?.addEventListener?.('change', onEnvironmentChange)

  return {
    intent: (path) => enqueue(path, true),
    cancel: () => {
      cancel()
      document.removeEventListener('visibilitychange', onEnvironmentChange)
      window.removeEventListener('offline', onEnvironmentChange)
      navigator.connection?.removeEventListener?.('change', onEnvironmentChange)
    },
  }
}

export const useWorkspacePrefetch = ({ ready, contextKey, pathname, paths, preloadModule, prefetchData }) => {
  const scheduler = useRef(null)
  const pathsKey = paths.join('\n')
  useEffect(() => {
    if (!ready) return undefined
    const current = createWorkspacePrefetch({ pathname, paths: pathsKey.split('\n'), preloadModule, prefetchData })
    scheduler.current = current
    return () => {
      current.cancel()
      if (scheduler.current === current) scheduler.current = null
    }
  }, [ready, contextKey, pathname, pathsKey, preloadModule, prefetchData])
  return useCallback((path) => scheduler.current?.intent(path), [])
}
