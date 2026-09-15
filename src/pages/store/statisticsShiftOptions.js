const text = (value) => String(value ?? '').trim()
const nameKey = (value) => text(value).toLocaleLowerCase('vi-VN').replace(/\s+/gu, ' ')

// Older API responses have only the date-prefixed group key. New responses expose shiftKey.
// This is an exact identity, not a guessed assignment to today's shift definition.
export const statisticsShiftKey = (group = {}) => text(group.shiftKey || group.shiftId)
  || text(group.key).replace(/^\d{4}-\d{2}-\d{2}:/u, '')

export function statisticsShiftOptions(definitions = [], groups = []) {
  const configured = new Map(definitions.map((shift) => [text(shift.id), shift]).filter(([id]) => id))
  const recorded = new Map()
  for (const group of groups) {
    const id = statisticsShiftKey(group)
    if (!id || recorded.has(id)) continue
    const definition = configured.get(id)
    recorded.set(id, {
      id,
      name: text(group.shiftName) || text(definition?.name) || (group.shiftId ? `Ca ${group.shiftId}` : 'Chưa gắn ca'),
      start: text(group.shiftStart) || text(definition?.start || definition?.startTime),
      end: text(group.shiftEnd) || text(definition?.end || definition?.endTime),
      recorded: true,
      orders: Number(group.orders || 0),
    })
  }
  const recordedNames = new Set([...recorded.values()].map((shift) => nameKey(shift.name)))
  const emptyConfigured = [...configured.entries()]
    // A renamed/recreated definition must not shadow a recorded historical shift with zero revenue.
    // Recorded groups are never merged by name; each retains its own exact key.
    .filter(([id, shift]) => !recorded.has(id) && !recordedNames.has(nameKey(shift.name)))
    .map(([id, shift]) => ({ ...shift, id, recorded: false, orders: 0 }))
  return [...recorded.values(), ...emptyConfigured].sort((left, right) => (
    Number(right.recorded) - Number(left.recorded)
    || text(left.start || left.startTime).localeCompare(text(right.start || right.startTime))
    || left.id.localeCompare(right.id, 'vi-VN')
  ))
}

export const statisticsShiftLabel = (shift) => {
  const start = text(shift.start || shift.startTime)
  const end = text(shift.end || shift.endTime)
  return `${shift.name || shift.id}${start || end ? ` (${start || '—'}–${end || '—'})` : ''}${shift.recorded ? ` · ${shift.orders} đơn` : ''}`
}
