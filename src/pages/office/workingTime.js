export const WORK_TIME_TYPES = Object.freeze({
  fixed: 'Full-Time',
  shifts: 'Part-Time',
})

export const MAX_PROFILE_WORK_SHIFTS = 12

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u

const normalizedEmploymentType = (value = '') => {
  const normalized = String(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').trim().toLocaleLowerCase('vi-VN')
  return normalized.includes('part') || normalized.includes('thuc tap')
    ? WORK_TIME_TYPES.shifts
    : WORK_TIME_TYPES.fixed
}

const shiftId = (value, index) => {
  const safe = String(value || '').trim().replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)
  return safe || `work_${index + 1}`
}

export const createWorkShift = (index = 0, overrides = {}) => ({
  id: shiftId(overrides.id, index),
  name: String(overrides.name || `Ca ${index + 1}`).trim(),
  start: String(overrides.start || '08:00'),
  end: String(overrides.end || '12:00'),
})

export const nextAvailableWorkShift = (workShifts = []) => {
  const usedIds = new Set(workShifts.map(({ id }) => String(id || '')))
  let nextNumber = 1
  while (usedIds.has(`work_${nextNumber}`)) nextNumber += 1
  return createWorkShift(workShifts.length, { id: `work_${nextNumber}`, name: `Ca ${nextNumber}` })
}

export const workTimeTypeForEmployment = normalizedEmploymentType

const candidateShifts = (profile = {}) => {
  if (Array.isArray(profile.workShifts)) return profile.workShifts
  if (Array.isArray(profile.workingTime?.shifts)) return profile.workingTime.shifts
  return []
}

export const normalizeWorkingTimeForm = (profile = {}, employmentType = profile.employmentType) => {
  const workTimeType = normalizedEmploymentType(employmentType || profile.workTimeType)
  const fallbackStart = String(profile.workStart || (workTimeType === WORK_TIME_TYPES.fixed ? '08:00' : '08:00'))
  const fallbackEnd = String(profile.workEnd || (workTimeType === WORK_TIME_TYPES.fixed ? '17:30' : '12:00'))
  const shifts = candidateShifts(profile)
    .slice(0, MAX_PROFILE_WORK_SHIFTS)
    .map((shift, index) => createWorkShift(index, shift))
  const workShifts = shifts.length
    ? shifts
    : [createWorkShift(0, {
        id: workTimeType === WORK_TIME_TYPES.fixed ? 'full_time' : 'work_1',
        name: workTimeType === WORK_TIME_TYPES.fixed ? 'Giờ hành chính' : 'Ca 1',
        start: fallbackStart,
        end: fallbackEnd,
      })]
  const first = workShifts[0]
  return {
    workTimeType,
    workStart: first.start,
    workEnd: first.end,
    workShifts,
  }
}

export const withEmploymentWorkingTime = (form = {}, employmentType) => {
  const nextType = normalizedEmploymentType(employmentType)
  if (nextType === WORK_TIME_TYPES.fixed) {
    const current = normalizeWorkingTimeForm(form, employmentType).workShifts[0]
    const fixed = createWorkShift(0, {
      id: 'full_time',
      name: 'Giờ hành chính',
      start: current?.start || '08:00',
      end: current?.end && current.end > (current?.start || '08:00') ? current.end : '17:30',
    })
    return { ...form, employmentType, workTimeType: nextType, workStart: fixed.start, workEnd: fixed.end, workShifts: [fixed] }
  }
  const current = normalizeWorkingTimeForm(form, employmentType).workShifts
  const flexible = current.map((shift, index) => createWorkShift(index, {
    ...shift,
    id: shift.id === 'full_time' ? `work_${index + 1}` : shift.id,
    name: shift.name === 'Giờ hành chính' ? `Ca ${index + 1}` : shift.name,
  }))
  return { ...form, employmentType, workTimeType: nextType, workStart: flexible[0].start, workEnd: flexible[0].end, workShifts: flexible }
}

export const validateWorkingTime = (form = {}) => {
  const expectedType = normalizedEmploymentType(form.employmentType)
  if (form.workTimeType && form.workTimeType !== expectedType) {
    return ['Loại thời gian làm việc phải khớp với loại nhân viên.']
  }
  const shifts = normalizeWorkingTimeForm(form, form.employmentType).workShifts
  const errors = []
  if (!shifts.length) errors.push('Cần cấu hình ít nhất một ca làm việc.')
  if (shifts.length > MAX_PROFILE_WORK_SHIFTS) errors.push(`Mỗi nhân viên được cấu hình tối đa ${MAX_PROFILE_WORK_SHIFTS} ca làm việc.`)
  if (expectedType === WORK_TIME_TYPES.fixed && shifts.length !== 1) errors.push('Nhân viên Full-Time chỉ dùng một khung giờ cố định.')
  shifts.forEach((shift, index) => {
    const label = expectedType === WORK_TIME_TYPES.fixed ? 'Khung giờ Full-Time' : `Ca ${index + 1}`
    if (!String(shift.name || '').trim()) errors.push(`${label} cần có tên ca.`)
    if (!TIME_PATTERN.test(String(shift.start || '')) || !TIME_PATTERN.test(String(shift.end || '')) || shift.end <= shift.start) {
      errors.push(`${label} phải theo định dạng 24 giờ và giờ kết thúc phải sau giờ bắt đầu.`)
    }
  })
  const names = shifts.map((shift) => String(shift.name || '').trim().toLocaleLowerCase('vi-VN')).filter(Boolean)
  if (new Set(names).size !== names.length) errors.push('Tên các ca làm việc không được trùng nhau.')
  const ids = shifts.map((shift) => String(shift.id || '').trim()).filter(Boolean)
  if (new Set(ids).size !== ids.length) errors.push('Mã các ca làm việc không được trùng nhau.')
  return [...new Set(errors)]
}

export const workingTimePayload = (form = {}) => {
  const normalized = normalizeWorkingTimeForm(form, form.employmentType)
  const workShifts = normalized.workShifts.map((shift, index) => createWorkShift(index, shift))
  const first = workShifts[0]
  return {
    workTimeType: normalized.workTimeType,
    workStart: first.start,
    workEnd: first.end,
    workShifts,
    workingTime: {
      type: normalized.workTimeType,
      mode: normalized.workTimeType === WORK_TIME_TYPES.fixed ? 'fixed' : 'shifts',
      shifts: workShifts,
    },
  }
}
