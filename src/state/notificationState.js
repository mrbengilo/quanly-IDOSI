const notificationId = (item = {}) => String(item.id || item.notificationId || '')

export const mergeNotificationUpdates = (current = [], updates = []) => {
  const updateMap = new Map(updates.filter(Boolean).map((item) => [notificationId(item), item]))
  const seen = new Set()
  const merged = current.map((item) => {
    const id = notificationId(item)
    const update = updateMap.get(id)
    if (!update) return item
    seen.add(id)
    return { ...item, ...update }
  })
  const additions = updates.filter((item) => item && !seen.has(notificationId(item)))
  return [...additions, ...merged]
}

export const applyNotificationCommandResult = (current = [], result = {}, readAt = new Date().toISOString()) => {
  const updates = Array.isArray(result.notifications) && result.notifications.length
    ? result.notifications
    : result.notification
      ? [result.notification]
      : []
  const ids = new Set([
    ...(Array.isArray(result.notificationIds) ? result.notificationIds : []),
    ...updates.map((item) => item.id || item.notificationId),
  ].filter((id) => id != null).map(String))
  return mergeNotificationUpdates(current, updates).map((item) => (
    ids.has(notificationId(item))
      ? { ...item, readAt: item.readAt || readAt }
      : item
  ))
}
