import { apiGetEmployeeAvatar } from './idosiApi'

const employeeAvatarCache = new Map()
const subscribers = new Set()

const revokeEntry = (entry) => {
  if (entry?.url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(entry.url)
  }
}

export const loadEmployeeAvatarUrl = (employeeId) => {
  const id = String(employeeId || '').trim()
  const cached = employeeAvatarCache.get(id)
  if (cached?.url) return Promise.resolve(cached.url)
  if (cached?.promise) return cached.promise

  const entry = {}
  const promise = apiGetEmployeeAvatar(id).then((blob) => {
    // A response from an old account/context must never repopulate its cache.
    if (employeeAvatarCache.get(id) !== entry) return ''
    const url = URL.createObjectURL(blob)
    entry.url = url
    return url
  }).catch((error) => {
    if (employeeAvatarCache.get(id) === entry) employeeAvatarCache.delete(id)
    throw error
  })
  entry.promise = promise
  employeeAvatarCache.set(id, entry)
  return promise
}

export const invalidateEmployeeAvatarCache = (employeeId = '') => {
  const id = String(employeeId || '').trim()
  if (id) {
    revokeEntry(employeeAvatarCache.get(id))
    employeeAvatarCache.delete(id)
  } else {
    employeeAvatarCache.forEach(revokeEntry)
    employeeAvatarCache.clear()
  }
  subscribers.forEach((subscriber) => subscriber(id))
}

export const subscribeEmployeeAvatarUpdates = (subscriber) => {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}
