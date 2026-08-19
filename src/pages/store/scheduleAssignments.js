const uniqueStrings = (values = []) => [...new Set(values.map(String).filter(Boolean))]

const assignmentValue = (record = {}) => ({
  id: record.id,
  employeeId: String(record.employeeId || ''),
  shiftIds: uniqueStrings(record.shiftIds || (record.shiftId ? [record.shiftId] : [])),
  note: String(record.note || ''),
})

export const replaceShiftAssignees = (records = [], shiftId, employeeIds = [], note = '') => {
  const targetShiftId = String(shiftId || '')
  const selected = new Set(uniqueStrings(employeeIds))
  const byEmployee = new Map(records.map((record) => [String(record.employeeId || ''), assignmentValue(record)]))

  selected.forEach((employeeId) => {
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, { employeeId, shiftIds: [], note: '' })
  })

  return [...byEmployee.values()].map((assignment) => {
    const nextShiftIds = assignment.shiftIds.filter((id) => id !== targetShiftId)
    if (selected.has(assignment.employeeId)) nextShiftIds.push(targetShiftId)
    return {
      ...assignment,
      shiftIds: uniqueStrings(nextShiftIds),
      note: selected.has(assignment.employeeId) ? String(note || '').trim() : assignment.note,
    }
  }).filter((assignment) => assignment.employeeId && assignment.shiftIds.length)
}

export const removeShiftAssignments = (records = [], shiftId) => replaceShiftAssignees(records, shiftId, [])

