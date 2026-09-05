// Disposable, tab-scoped copies of server projections. A restored copy must
// pass server session/version checks before it is rendered or used for writes.
const SESSION_KEY = 'idosi-workspace-cache-session-v1'
const LAST_KEY = 'idosi-workspace-cache-last-v1'
const MAX_ENTRIES = 40
const MAX_AGE_MS = 12 * 60 * 60 * 1000
let databasePromise

const sessionId = (create = false) => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id && create) {
      id = crypto.randomUUID()
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id || ''
  } catch { return '' }
}

const database = () => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!databasePromise) databasePromise = new Promise((resolve) => {
    const request = indexedDB.open('idosi-workspace-cache-v1', 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('views', { keyPath: ['sessionId', 'key'] })
      store.createIndex('session', 'sessionId')
      store.createIndex('sessionAge', ['sessionId', 'savedAt'])
      store.createIndex('savedAt', 'savedAt')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = request.onblocked = () => resolve(null)
  })
  return databasePromise
}

export const readWorkspaceCache = async (key = '') => {
  try {
    const id = sessionId()
    const requestedKey = key || sessionStorage.getItem(LAST_KEY)
    if (!id || !requestedKey) return null
    const db = await database()
    if (!db || sessionId() !== id) return null
    return await new Promise((resolve) => {
      const request = db.transaction('views').objectStore('views').get([id, requestedKey])
      request.onsuccess = () => {
        const record = request.result
        resolve(sessionId() === id && record?.savedAt > Date.now() - MAX_AGE_MS ? record.entry : null)
      }
      request.onerror = () => resolve(null)
    })
  } catch { return null }
}

export const writeWorkspaceCache = async (key, entry) => {
  try {
    const id = sessionId(true)
    const db = await database()
    if (!id || !db || sessionId() !== id) return false
    return await new Promise((resolve) => {
      const transaction = db.transaction('views', 'readwrite')
      const store = transaction.objectStore('views')
      store.put({ sessionId: id, key, entry, savedAt: Date.now() })
      // Discard abandoned tabs after twelve hours; keep at most forty views in
      // this tab. Neither quota failures nor eviction can affect server data.
      const expired = store.index('savedAt').openCursor(IDBKeyRange.upperBound(Date.now() - MAX_AGE_MS))
      expired.onsuccess = () => {
        const cursor = expired.result
        if (cursor) { cursor.delete(); cursor.continue() }
      }
      const count = store.index('session').count(id)
      count.onsuccess = () => {
        let remaining = count.result - MAX_ENTRIES
        if (remaining <= 0) return
        const oldest = store.index('sessionAge').openCursor(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
        oldest.onsuccess = () => {
          const cursor = oldest.result
          if (cursor && remaining-- > 0) { cursor.delete(); cursor.continue() }
        }
      }
      transaction.oncomplete = () => {
        try { if (sessionId() === id) sessionStorage.setItem(LAST_KEY, key) } catch { /* Storage may be disabled mid-session. */ }
        resolve(true)
      }
      transaction.onerror = transaction.onabort = () => resolve(false)
    })
  } catch { return false }
}

export const clearWorkspaceCache = async () => {
  const id = sessionId()
  try {
    // Rotate the namespace synchronously so an in-flight save cannot restore
    // data after logout or a role change.
    sessionStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(LAST_KEY)
    const db = await database()
    if (!id || !db) return
    await new Promise((resolve) => {
      const transaction = db.transaction('views', 'readwrite')
      const cursorRequest = transaction.objectStore('views').index('session').openCursor(id)
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (cursor) { cursor.delete(); cursor.continue() }
      }
      transaction.oncomplete = transaction.onerror = transaction.onabort = resolve
    })
  } catch { /* Cache removal must not prevent logout. */ }
}
