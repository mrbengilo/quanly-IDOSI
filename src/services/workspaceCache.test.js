import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let cache
beforeEach(async () => {
  vi.resetModules()
  sessionStorage.clear()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  cache = await import('./workspaceCache')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('restores the last screen after a module reload and retains other visited views', async () => {
  await cache.writeWorkspaceCache('orders', { state: { orders: [{ id: 'O1' }] }, version: 4 })
  await cache.writeWorkspaceCache('tasks', { state: { tasks: [{ id: 'T1' }] }, version: 4 })
  vi.resetModules()
  const restored = await import('./workspaceCache')
  expect(await restored.readWorkspaceCache()).toMatchObject({ state: { tasks: [{ id: 'T1' }] } })
  expect(await restored.readWorkspaceCache('orders')).toMatchObject({ state: { orders: [{ id: 'O1' }] } })
})

it('invalidates pending saves synchronously on logout', async () => {
  const pending = cache.writeWorkspaceCache('orders', { state: { orders: [{ id: 'PRIVATE' }] } })
  await cache.clearWorkspaceCache()
  await pending
  expect(await cache.readWorkspaceCache('orders')).toBeNull()
})

it('does not read another tab/session or expired projections', async () => {
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  await cache.writeWorkspaceCache('orders', { version: 4 })
  Date.now.mockReturnValue(now + 13 * 60 * 60 * 1000)
  expect(await cache.readWorkspaceCache()).toBeNull()
  Date.now.mockReturnValue(now)
  sessionStorage.clear()
  expect(await cache.readWorkspaceCache('orders')).toBeNull()
})

it('bounds the cache and evicts the oldest projection', async () => {
  let time = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => time)
  for (let index = 0; index < 41; index += 1) {
    time += 1
    await cache.writeWorkspaceCache(`view-${index}`, { version: index })
  }
  expect(await cache.readWorkspaceCache('view-0')).toBeNull()
  expect(await cache.readWorkspaceCache('view-1')).toEqual({ version: 1 })
  expect(await cache.readWorkspaceCache()).toEqual({ version: 40 })
})

it('fails open to the server when browser storage is unavailable', async () => {
  vi.stubGlobal('indexedDB', undefined)
  expect(await cache.readWorkspaceCache()).toBeNull()
  expect(await cache.writeWorkspaceCache('orders', { version: 1 })).toBe(false)
})
