import { operationalIdentifierRecordMatch } from '../../utils'

const shiftAliases = (record = {}) => [record.id, record.code]
  .map((value) => String(value || '').trim())
  .filter(Boolean)

const shiftIdOf = (record = {}) => String(record.shiftId || record.shift || '').trim()

export const referenceMatchesAttendanceShift = ({
  attendance,
  reference,
  shiftDefinitions = [],
} = {}) => {
  const attendanceShiftId = shiftIdOf(attendance)
  const referenceShiftId = String(reference || '').trim()
  if (!attendanceShiftId || !referenceShiftId) return false

  let candidates = Array.isArray(shiftDefinitions) ? shiftDefinitions : []
  let attendanceResolution = operationalIdentifierRecordMatch(
    candidates,
    attendanceShiftId,
    shiftAliases,
  )
  if (attendanceResolution.ambiguous) return false

  if (!attendanceResolution.record) {
    // Support attendance uses an immutable synthetic shift ID instead of a
    // persisted shift definition. Add that exact ID only for this comparison;
    // exact-match precedence still prevents folded identifier collisions.
    candidates = [...candidates, { id: attendanceShiftId }]
    attendanceResolution = operationalIdentifierRecordMatch(
      candidates,
      attendanceShiftId,
      shiftAliases,
    )
  }

  const referenceResolution = operationalIdentifierRecordMatch(
    candidates,
    referenceShiftId,
    shiftAliases,
  )
  return !attendanceResolution.ambiguous
    && !referenceResolution.ambiguous
    && Boolean(attendanceResolution.record)
    && referenceResolution.record === attendanceResolution.record
}
