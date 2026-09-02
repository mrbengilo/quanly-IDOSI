const RECOVERY_STORAGE_KEY = 'idosi:stale-release-recovery'
const RECOVERY_WINDOW_MS = 60_000

export const staleReleaseError = (error) => /(?:failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|load failed)/iu
  .test(String(error?.message || error || ''))

export const recoverStaleRelease = (error, {
  storage = globalThis.sessionStorage,
  location = globalThis.location,
  now = Date.now(),
} = {}) => {
  if (!staleReleaseError(error) || typeof location?.reload !== 'function') return false
  let previousAttempt = 0
  try {
    previousAttempt = Number(storage?.getItem(RECOVERY_STORAGE_KEY) || 0)
  } catch {
    // Storage can be blocked; keep the safe default and recover once.
  }
  if (previousAttempt > 0 && now - previousAttempt < RECOVERY_WINDOW_MS) return false
  try {
    storage?.setItem(RECOVERY_STORAGE_KEY, String(now))
  } catch {
    // A one-time reload still repairs a stale release when storage is blocked.
  }
  location.reload()
  return true
}

export const installStaleReleaseRecovery = (target = globalThis.window, recoveryOptions) => {
  if (typeof target?.addEventListener !== 'function') return () => {}
  const recover = (event) => {
    if (!recoverStaleRelease(event?.payload, recoveryOptions)) return
    event.preventDefault?.()
  }
  target.addEventListener('vite:preloadError', recover)
  return () => target.removeEventListener('vite:preloadError', recover)
}
