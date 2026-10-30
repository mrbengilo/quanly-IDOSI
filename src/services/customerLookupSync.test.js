import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCustomerLookupSync, CUSTOMER_SYNC_INTERVAL_MS } from './customerLookupSync'

const cleanups = []
function tab(readMetadata, hub = new Set(), broadcast = true) {
  const doc = Object.assign(new EventTarget(), { hidden: false })
  const win = Object.assign(new EventTarget(), {
    setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window),
    localStorage: { setItem: vi.fn() },
  })
  if (broadcast) win.BroadcastChannel = class {
    constructor(name) { this.name = name; hub.add(this) }
    postMessage(data) { for (const peer of hub) if (peer !== this && peer.name === this.name) peer.onmessage?.({ data }) }
    close() { hub.delete(this) }
  }
  const sync = createCustomerLookupSync({ readMetadata, targetWindow: win, targetDocument: doc })
  const listen = (callback = vi.fn()) => { const off = sync.subscribe(callback); cleanups.push(off); return callback }
  return { sync, win, doc, listen }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => vi.useFakeTimers())
afterEach(() => { for (const off of cleanups.splice(0)) off(); vi.useRealTimers() })

it('shares one metadata request/timer across all customer consumers and ignores unrelated store activity', async () => {
  const read = vi.fn().mockResolvedValue({ version: 10, scopeVersion: 1, customerVersion: 2 })
  const view = tab(read)
  for (let i = 0; i < 5; i += 1) view.listen()
  await flush()
  expect(read).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenLastCalledWith('global', { customers: true, signal: expect.any(AbortSignal) })
  const before = view.sync.getSnapshot()
  read.mockResolvedValue({ version: 99, scopeVersion: 1, customerVersion: 2 })
  await vi.advanceTimersByTimeAsync(CUSTOMER_SYNC_INTERVAL_MS)
  expect(read).toHaveBeenCalledTimes(2)
  expect(view.sync.getSnapshot()).toBe(before)
  read.mockResolvedValue({ version: 100, scopeVersion: 1, customerVersion: 100 })
  await vi.advanceTimersByTimeAsync(CUSTOMER_SYNC_INTERVAL_MS)
  expect(view.sync.getSnapshot()).toBe(before + 1)
})

it('invalidates separate same-browser tabs immediately without sharing customer data', async () => {
  const hub = new Set()
  const read = vi.fn().mockResolvedValue({ customerVersion: 1 })
  const a = tab(read, hub), b = tab(read, hub)
  a.listen(); const changed = b.listen()
  await flush()
  const before = b.sync.getSnapshot()
  changed.mockClear()
  a.sync.publish()
  expect(b.sync.getSnapshot()).toBe(before + 1)
  expect(changed).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(2)
})

it('detects another device by polling the global customer token even when its own store token stays fixed', async () => {
  let customerVersion = 1
  const read = vi.fn(async () => ({ version: customerVersion, scopeVersion: 1, customerVersion }))
  const a = tab(read), b = tab(read)
  a.listen(); b.listen()
  await flush()
  const before = b.sync.getSnapshot()
  customerVersion = 2
  a.sync.publish() // Separate devices have no shared BroadcastChannel hub.
  expect(b.sync.getSnapshot()).toBe(before)
  await vi.advanceTimersByTimeAsync(CUSTOMER_SYNC_INTERVAL_MS)
  expect(b.sync.getSnapshot()).toBe(before + 1)
})

it('pauses background polling and catches up on foreground without a page reload', async () => {
  const hub = new Set()
  let version = 1
  const read = vi.fn(async () => ({ customerVersion: version }))
  const a = tab(read, hub), b = tab(read, hub)
  a.listen(); b.listen()
  await flush()
  b.doc.hidden = true
  const before = b.sync.getSnapshot()
  version = 2
  a.sync.publish()
  expect(b.sync.getSnapshot()).toBe(before)
  read.mockClear()
  await vi.advanceTimersByTimeAsync(CUSTOMER_SYNC_INTERVAL_MS)
  expect(read).toHaveBeenCalledTimes(1) // Only the visible writer tab polls.
  b.doc.hidden = false
  b.doc.dispatchEvent(new Event('visibilitychange'))
  await flush()
  expect(b.sync.getSnapshot()).toBeGreaterThan(before)
  expect(read).toHaveBeenCalledTimes(2)
})

it('uses a data-free storage hint when BroadcastChannel is unavailable and ignores corrupt hints', async () => {
  const read = vi.fn().mockResolvedValue({ customerVersion: 1 })
  const a = tab(read, new Set(), false), b = tab(read, new Set(), false)
  a.win.localStorage.setItem.mockImplementation((key, newValue) => b.win.dispatchEvent(new StorageEvent('storage', { key, newValue })))
  a.listen(); b.listen()
  await flush()
  const before = b.sync.getSnapshot()
  a.sync.publish()
  expect(b.sync.getSnapshot()).toBe(before + 1)
  const [key, body] = a.win.localStorage.setItem.mock.calls[0]
  expect(Object.keys(JSON.parse(body))).toEqual(['type', 'nonce'])
  b.win.dispatchEvent(new StorageEvent('storage', { key, newValue: '{broken' }))
  expect(b.sync.getSnapshot()).toBe(before + 1)
})

it('aborts/stops after the last consumer leaves and ignores late metadata from the previous session', async () => {
  let finishOld
  const read = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    .mockResolvedValue({ customerVersion: 2 })
  const hub = new Set(), view = tab(read, hub)
  const off = view.sync.subscribe(vi.fn())
  const signal = read.mock.calls[0][1].signal
  off()
  expect(signal.aborted).toBe(true)
  expect(hub.size).toBe(0)
  view.listen()
  await flush()
  const before = view.sync.getSnapshot()
  finishOld({ customerVersion: 999 })
  await flush()
  expect(view.sync.getSnapshot()).toBe(before)
})

it('retries an offline baseline and supports the global-version fallback of older servers', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ version: 4 })
  const view = tab(read)
  view.listen()
  await flush()
  expect(view.sync.getSnapshot()).toBe(0)
  await vi.advanceTimersByTimeAsync(CUSTOMER_SYNC_INTERVAL_MS)
  expect(view.sync.getSnapshot()).toBe(1)
})
