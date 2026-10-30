import { apiGetStateMetadata } from './idosiApi'

export const CUSTOMER_SYNC_INTERVAL_MS = 5000
const CHANNEL = 'idosi-customer-orders-v1'
const STORAGE_KEY = 'idosi-customer-orders-changed-v1'

// One lightweight metadata poll per active tab, shared by every customer
// list/history/input. Notifications carry no customer data or credentials.
export function createCustomerLookupSync({ readMetadata, targetWindow, targetDocument, intervalMs = CUSTOMER_SYNC_INTERVAL_MS }) {
  const listeners = new Set()
  let revision = 0, generation = 0, version = null, controller = null, timer = null, channel = null
  const visible = () => !targetDocument.hidden
  const invalidate = () => {
    revision += 1
    for (const listener of listeners) listener()
  }
  const receive = () => {
    if (visible()) invalidate()
  }
  const check = async () => {
    if (!listeners.size || !visible() || controller) return
    const epoch = generation
    const request = new AbortController()
    controller = request
    try {
      const metadata = await readMetadata('global', { customers: true, signal: request.signal })
      if (epoch !== generation || request.signal.aborted) return
      const next = metadata?.customerVersion ?? metadata?.version
      if (Number.isSafeInteger(next) && next >= 0 && next !== version) {
        version = next
        // The first baseline also closes the race between mounting a lookup
        // and an external write that finishes before this metadata response.
        invalidate()
      }
    } catch {
      // Lookups retain their own loading/error handling. Retry metadata on the
      // next interval/foreground event; never treat an offline poll as no change.
    } finally {
      if (epoch === generation) controller = null
    }
  }
  const foreground = () => {
    if (!visible()) return
    // A frozen/background tab may have missed both hints and timer ticks.
    // Verify the visible customer views immediately, even if metadata is slow.
    invalidate()
    void check()
  }
  const message = (event) => { if (event.data?.type === 'orders-changed') receive() }
  const storage = (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try { if (JSON.parse(event.newValue).type === 'orders-changed') receive() } catch { /* Ignore unrelated/corrupt hints. */ }
  }
  const stop = () => {
    generation += 1
    controller?.abort()
    controller = null
    version = null
    targetWindow.clearInterval(timer)
    timer = null
    channel?.close()
    channel = null
    targetWindow.removeEventListener('focus', foreground)
    targetDocument.removeEventListener('visibilitychange', foreground)
    targetWindow.removeEventListener('storage', storage)
  }
  const start = () => {
    if (typeof targetWindow.BroadcastChannel === 'function') {
      try { channel = new targetWindow.BroadcastChannel(CHANNEL); channel.onmessage = message } catch { /* Polling/storage still work. */ }
    }
    targetWindow.addEventListener('focus', foreground)
    targetDocument.addEventListener('visibilitychange', foreground)
    targetWindow.addEventListener('storage', storage)
    timer = targetWindow.setInterval(check, intervalMs)
    void check()
  }
  return {
    getSnapshot: () => revision,
    subscribe: (listener) => {
      listeners.add(listener)
      if (listeners.size === 1) start()
      return () => { listeners.delete(listener); if (!listeners.size) stop() }
    },
    publish: () => {
      receive()
      let sender = channel
      try {
        if (!sender && typeof targetWindow.BroadcastChannel === 'function') sender = new targetWindow.BroadcastChannel(CHANNEL)
        if (sender) sender.postMessage({ type: 'orders-changed' })
        else targetWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: 'orders-changed', nonce: crypto.randomUUID() }))
      } catch { /* Cross-device metadata polling is the authoritative fallback. */ }
      finally { if (sender && sender !== channel) sender.close() }
    },
  }
}

let sync = null
const currentSync = () => {
  if (!sync && typeof window !== 'undefined') sync = createCustomerLookupSync({
    readMetadata: (...args) => apiGetStateMetadata(...args), targetWindow: window, targetDocument: document,
  })
  return sync
}
export const subscribeCustomerChanges = (listener) => currentSync()?.subscribe(listener) || (() => {})
export const customerChangeSnapshot = () => sync?.getSnapshot() || 0
export const publishCustomerOrderChange = () => currentSync()?.publish()
