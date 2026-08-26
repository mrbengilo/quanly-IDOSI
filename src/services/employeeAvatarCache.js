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

  const promise = apiGetEmployeeAvatar(id).then((blob) => {
    const url = URL.createObjectURL(blob)
    const previous = employeeAvatarCache.get(id)
    if (previous?.url && previous.url !== url) revokeEntry(previous)
    employeeAvatarCache.set(id, { url })
    return url
  }).catch((error) => {
    employeeAvatarCache.delete(id)
    throw error
  })
  employeeAvatarCache.set(id, { promise })
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
