import { apiGetEmployeeAvatar } from './idosiApi'

const MAX_CONCURRENT_AVATAR_REQUESTS = 3
const MISSING_AVATAR_TTL_MS = 10 * 60 * 1_000
const TRANSIENT_FAILURE_COOLDOWN_MS = 15 * 1_000

const employeeAvatarCache = new Map()
const subscribers = new Set()
const requestQueue = []
const keyGenerations = new Map()
let globalGeneration = 0
let activeRequests = 0

const normalizedKey = (employeeId) => String(employeeId || '')
  .trim()
  .toLocaleLowerCase('en-US')

const generationFor = (key) => `${globalGeneration}:${keyGenerations.get(key) || 0}`

const revokeEntry = (entry) => {
  if (entry?.url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(entry.url)
  }
}

const drainQueue = () => {
  while (activeRequests < MAX_CONCURRENT_AVATAR_REQUESTS && requestQueue.length) {
    const request = requestQueue.shift()
    activeRequests += 1
    Promise.resolve()
      .then(request.task)
      .then(request.resolve, () => request.resolve(''))
      .finally(() => {
        activeRequests -= 1
        drainQueue()
      })
  }
}

const enqueueRequest = (task) => new Promise((resolve) => {
  requestQueue.push({ task, resolve })
  drainQueue()
})

const unavailableAvatar = (error) => (
  Number(error?.status) === 404
  || ['EMPLOYEE_AVATAR_NOT_FOUND', 'HTTP_404'].includes(String(error?.code || ''))
)

export const loadEmployeeAvatarUrl = (employeeId) => {
  const id = String(employeeId || '').trim()
  const key = normalizedKey(id)
  if (!key) return Promise.resolve('')

  const cached = employeeAvatarCache.get(key)
  const now = Date.now()
  if (cached?.url) return Promise.resolve(cached.url)
  if (cached?.promise) return cached.promise
  if (Number(cached?.missingUntil || 0) > now || Number(cached?.retryAfter || 0) > now) {
    return Promise.resolve('')
  }

  const requestGeneration = generationFor(key)
  let promise
  promise = enqueueRequest(async () => {
    try {
      const blob = await apiGetEmployeeAvatar(id)
      if (generationFor(key) !== requestGeneration) return ''
      const url = URL.createObjectURL(blob)
      const previous = employeeAvatarCache.get(key)
      if (previous?.url && previous.url !== url) revokeEntry(previous)
      employeeAvatarCache.set(key, { url })
      return url
    } catch (error) {
      if (generationFor(key) !== requestGeneration) return ''
      employeeAvatarCache.set(key, unavailableAvatar(error)
        ? { missingUntil: Date.now() + MISSING_AVATAR_TTL_MS }
        : { retryAfter: Date.now() + TRANSIENT_FAILURE_COOLDOWN_MS })
      return ''
    }
  }).finally(() => {
    const current = employeeAvatarCache.get(key)
    if (current?.promise === promise) employeeAvatarCache.delete(key)
  })
  employeeAvatarCache.set(key, { promise })
  return promise
}

export const invalidateEmployeeAvatarCache = (employeeId = '') => {
  const key = normalizedKey(employeeId)
  if (key) {
    keyGenerations.set(key, (keyGenerations.get(key) || 0) + 1)
    revokeEntry(employeeAvatarCache.get(key))
    employeeAvatarCache.delete(key)
  } else {
    globalGeneration += 1
    employeeAvatarCache.forEach(revokeEntry)
    employeeAvatarCache.clear()
  }
  subscribers.forEach((subscriber) => subscriber(key))
}

export const subscribeEmployeeAvatarUpdates = (subscriber) => {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}
