import { storeViolationPointAssessment } from '../src/domain/violationPoints.js'

// Read one bounded page of immutable shift snapshots and its reward overlays.
// Shared by SQLite/VPS and D1. Reports never trigger checklist repairs.
export async function readStoreTaskHistory({ db, storeId, employeeId = '', date = '', shiftId = '', assignmentId = '', cursor, ApiError, maxEntityBytes }) {
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
  const head = () => db.prepare("SELECT version FROM app_state WHERE scope_key='global'").first()
  const version = Number((await head())?.version || 0)
  const { beforeOccurredOn, beforeOrder, beforeKey } = cursor
  const limit = 10
  const filterIds = await storeTaskHistoryEmployeeIds({ db, employeeId, ApiError })
  const rows = await all(`
    SELECT entity_key, entity_order, value_json, value_bytes, COALESCE(occurred_on, '') AS occurred_on
    FROM state_entities
    WHERE scope_key = 'global' AND collection_key = 'attendance'
      AND ${STORE_TASK_ATTENDANCE_FILTER_SQL}
      AND (? IS NULL OR COALESCE(occurred_on, '') < ?
        OR (COALESCE(occurred_on, '') = ? AND entity_order < ?)
        OR (COALESCE(occurred_on, '') = ? AND entity_order = ? AND entity_key < ?))
    ORDER BY COALESCE(occurred_on, '') DESC, entity_order DESC, entity_key DESC
    LIMIT ?`, storeId, employeeId, JSON.stringify(filterIds), date, date, shiftId, shiftId,
  beforeOccurredOn, beforeOccurredOn, beforeOccurredOn, beforeOrder, beforeOccurredOn, beforeOrder, beforeKey, limit + 1)
  const decode = (row) => {
    if (new TextEncoder().encode(String(row.value_json)).byteLength !== Number(row.value_bytes) || Number(row.value_bytes) > maxEntityBytes) {
      throw new ApiError(500, 'STATE_ENTITY_CORRUPT', 'Bản ghi lịch sử không hợp lệ.')
    }
    return JSON.parse(row.value_json)
  }
  const page = rows.slice(0, limit)
  const attendance = page.map(decode)
  const attendanceIds = attendance.map((row) => String(row.id || row.attendanceId || '').toLowerCase())
  const related = attendanceIds.length ? await all(`
    SELECT collection_key, value_json, value_bytes FROM state_entities
    WHERE scope_key = 'global' AND collection_key IN ('tasks', 'workCatalogProgress', 'compensationEntries')
      AND (store_id = ? COLLATE NOCASE OR store_id IS NULL)
      AND lower(CASE WHEN collection_key = 'tasks' THEN COALESCE(NULLIF(json_extract(value_json, '$.checklistAttendanceId'), ''), json_extract(value_json, '$.attendanceId'), '') ELSE COALESCE(NULLIF(json_extract(value_json, '$.attendanceId'), ''), NULLIF(json_extract(value_json, '$.checklistAttendanceId'), ''), json_extract(value_json, '$.sourceAttendanceId'), '') END)
        IN (SELECT value FROM json_each(?))
    ORDER BY entity_order, entity_key`, storeId, JSON.stringify(attendanceIds)) : []
  const state = { attendance, tasks: [], workCatalogProgress: [], compensationEntries: [], taskAssignmentHistory: [] }
  for (const row of related) state[row.collection_key].push(decode(row))
  const entryIds = state.workCatalogProgress.map((row) => row.compensationEntryId).filter(Boolean)
  if (entryIds.length) {
    const entries = await all(`SELECT value_json, value_bytes FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'compensationEntries'
        AND (store_id = ? COLLATE NOCASE OR store_id IS NULL)
        AND record_id IN (SELECT value COLLATE NOCASE FROM json_each(?))`, storeId, JSON.stringify(entryIds))
    state.compensationEntries = [...new Map([...state.compensationEntries, ...entries.map(decode)].map((row) => [row.id, row])).values()]
  }
  const periods = [...new Set(attendance.map((row) => String(row.workDate || row.attendanceDate || row.date || row.checkInAt || '').slice(0, 7)))]
  const attendanceEmployeeIds = [...new Set(attendance.map((row) => String(row.employeeId || row.employeeCode || '').toLowerCase()))]
  const employees = attendanceEmployeeIds.length ? await all(`SELECT value_json, value_bytes FROM state_entities
    WHERE scope_key = 'global' AND collection_key = 'employees'
      AND EXISTS (SELECT 1 FROM json_each(json_array(json_extract(value_json, '$.id'), json_extract(value_json, '$.code'), json_extract(value_json, '$.employeeId'))) AS identifier
        WHERE lower(CAST(identifier.value AS TEXT)) IN (SELECT value FROM json_each(?)))`, JSON.stringify(attendanceEmployeeIds)) : []
  state.employees = employees.map(decode)
  const employeeIds = [...new Set([...attendanceEmployeeIds, ...state.employees.flatMap((row) => [row.id, row.code, row.employeeId].filter(Boolean).map((id) => String(id).toLowerCase()))])]
  // Monthly point eligibility includes the employee's support-store violations.
  const violations = periods.length ? await all(`SELECT value_json, value_bytes FROM state_entities
    WHERE scope_key = 'global' AND collection_key = 'violations'
      AND employee_id IN (SELECT value COLLATE NOCASE FROM json_each(?))
      AND period_key IN (SELECT value FROM json_each(?))`, JSON.stringify(employeeIds), JSON.stringify(periods)) : []
  const pointViolations = violations.map(decode)
  state.violationPointSummaries = state.employees.flatMap((employee) => periods.map((period) => ({
    id: `${employee.id || employee.code}:${period}`,
    ...storeViolationPointAssessment(pointViolations, {
      employeeId: employee.id || employee.code, employeeIdentifiers: [employee.id, employee.code, employee.employeeId].filter(Boolean), period,
    }),
  })))
  // Return assessments, not the details of violations recorded at other stores.
  state.violations = pointViolations.filter((row) => String(row.storeId || '').toLowerCase() === storeId.toLowerCase())
  if (assignmentId) {
    const assignments = await all(`SELECT value_json, value_bytes FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'taskAssignmentHistory' AND store_id = ? COLLATE NOCASE
        AND (record_id = ? COLLATE NOCASE OR json_extract(value_json, '$.assignmentId') = ? COLLATE NOCASE)
      LIMIT 2`, storeId, assignmentId, assignmentId)
    state.taskAssignmentHistory = assignments.map(decode)
  }
  if (Number((await head())?.version || 0) !== version) {
    throw new ApiError(409, 'STATE_READ_CONFLICT', 'Dữ liệu vừa được cập nhật; vui lòng thử lại.')
  }
  return { state, page: { limit, hasMore: rows.length > limit }, lastRow: page.at(-1) }
}

// Both list and summary must apply exactly the same employee/date/shift filters.
export const STORE_TASK_ATTENDANCE_FILTER_SQL = `store_id = ? COLLATE NOCASE
      AND json_extract(value_json, '$.deletedAt') IS NULL
      AND (? = '' OR employee_id IN (SELECT value COLLATE NOCASE FROM json_each(?)))
      AND (? = '' OR substr(COALESCE(NULLIF(json_extract(value_json, '$.workDate'), ''), NULLIF(json_extract(value_json, '$.attendanceDate'), ''), NULLIF(json_extract(value_json, '$.date'), ''), NULLIF(json_extract(value_json, '$.checkInAt'), ''), ''), 1, 10) = ?)
      AND (? = '' OR COALESCE(NULLIF(json_extract(value_json, '$.shiftId'), ''), json_extract(value_json, '$.shift'), '') = ? COLLATE NOCASE)`

export async function storeTaskHistoryEmployeeIds({ db, employeeId = '', ApiError }) {
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
  const filterEmployees = employeeId ? await all(`SELECT value_json FROM state_entities
    WHERE scope_key = 'global' AND collection_key = 'employees'
      AND EXISTS (SELECT 1 FROM json_each(json_array(json_extract(value_json, '$.id'), json_extract(value_json, '$.code'), json_extract(value_json, '$.employeeId'))) AS identifier
        WHERE CAST(identifier.value AS TEXT) = ? COLLATE NOCASE)`, employeeId) : []
  const exact = filterEmployees.filter(({ value_json }) => {
    const row = JSON.parse(value_json)
    return [row.id, row.code, row.employeeId].includes(employeeId)
  })
  const matches = exact.length ? exact : filterEmployees
  if (matches.length > 1) throw new ApiError(409, 'TASK_EMPLOYEE_AMBIGUOUS', 'Không xác định được duy nhất nhân viên cần lọc.')
  const filterEmployee = matches.length ? JSON.parse(matches[0].value_json) : {}
  const filterIds = [employeeId, filterEmployee.id, filterEmployee.code, filterEmployee.employeeId].filter(Boolean)
  return filterIds
}
