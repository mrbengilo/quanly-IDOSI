import { workRewardRows, rewardStatistics } from '../src/pages/compensation/compensationStatistics.js'
import { STORE_TASK_ATTENDANCE_FILTER_SQL, storeTaskHistoryEmployeeIds } from './store-task-history.js'

// JSON -> preserves booleans and missing keys. Replacing missing fields with
// null or true/false with 1/0 would change the canonical reward eligibility.
const compactObject = (source, fields) => `(SELECT json_group_object(field.key, ${source} -> ('$.' || field.key))
  FROM json_each(${source}) AS field WHERE field.key IN (${fields.map((key) => `'${key}'`).join(',')}))`
const catalogFields = ['id', 'kind', 'catalogKind', 'violationPoints']
const taskFields = ['id', 'catalogItemId', 'checklistTaskId', 'kind', 'catalogKind', 'rewardEligible', 'amountVnd']
const snapshotTask = `json_set(${compactObject('task.value', taskFields)}, '$.catalogSnapshot', json(${compactObject("task.value -> '$.catalogSnapshot'", catalogFields)}))`
const attendanceFields = ['id', 'attendanceId', 'employeeId', 'employeeCode', 'employeeName', 'storeId', 'unit', 'unitType', 'department', 'workDate', 'attendanceDate', 'date', 'checkInAt', 'shiftId', 'shift', 'deletedAt']
const attendanceProjection = `json_set(${compactObject('value_json', attendanceFields)}, '$.checklistSnapshot',
  json_object('tasks', json((SELECT json_group_array(json(${snapshotTask})) FROM json_each(value_json, '$.checklistSnapshot.tasks') AS task))))`
const completionFields = ['id', 'checklistAttendanceId', 'attendanceId', 'sourceAttendanceId', 'catalogItemId', 'workCatalogItemId', 'checklistTaskId', 'taskId', 'checked', 'completed', 'done', 'claimed', 'rewarded', 'completedBy', 'status', 'compensationEntryId', 'completedAt', 'rewardedAt', 'claimedAt', 'updatedAt', 'createdAt']
const employeeFields = ['id', 'code', 'employeeId', 'storeId', 'unit', 'unitType', 'department', 'name', 'displayName']
const violationFields = ['id', 'occurrenceKey', 'employeeId', 'employeeCode', 'targetEmployeeId', 'status', 'deletedAt', 'voidedAt', 'rejectedAt', 'violationPoints', 'period', 'occurredOn', 'workDate', 'businessDate', 'date', 'occurredAt', 'createdAt']
const caches = new WeakMap()

export async function readStoreTaskSummary({ db, storeId, employeeId = '', date = '', shiftId = '', ApiError, maxEntityBytes }) {
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
  const head = () => db.prepare("SELECT version FROM app_state WHERE scope_key='global'").first()
  const version = Number((await head())?.version || 0)
  const cacheKey = JSON.stringify([version, storeId, employeeId, date, shiftId])
  const cache = caches.get(db) || new Map()
  caches.set(db, cache)
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  const filterIds = await storeTaskHistoryEmployeeIds({ db, employeeId, ApiError })
  const decode = (row) => {
    if (Number(row.value_bytes) !== Number(row.actual_bytes) || Number(row.value_bytes) > maxEntityBytes) {
      throw new ApiError(500, 'STATE_ENTITY_CORRUPT', 'Bản ghi tổng hợp thưởng không hợp lệ.')
    }
    return JSON.parse(row.value_json)
  }
  // SQL discards checklist descriptions, evidence/images and required-task
  // payloads before they enter JS. No full state/history snapshot is hydrated.
  const projected = async (collection, projection, where = '', bindings = []) => (await all(`
    SELECT ${projection} AS value_json, value_bytes, length(CAST(value_json AS BLOB)) AS actual_bytes
    FROM state_entities WHERE scope_key = 'global' AND collection_key = ? ${where}
    ORDER BY entity_order, entity_key`, collection, ...bindings)).map(decode)
  const attendance = await projected('attendance', attendanceProjection,
    `AND ${STORE_TASK_ATTENDANCE_FILTER_SQL}`, [storeId, employeeId, JSON.stringify(filterIds), date, date, shiftId, shiftId])
  const attendanceIds = attendance.map((row) => String(row.id || row.attendanceId || '').trim().toLowerCase())
  const employees = await projected('employees', compactObject('value_json', employeeFields))
  const attendanceMatch = `AND (store_id = ? COLLATE NOCASE OR store_id IS NULL)
    AND lower(COALESCE(NULLIF(json_extract(value_json, '$.attendanceId'), ''), NULLIF(json_extract(value_json, '$.checklistAttendanceId'), ''), json_extract(value_json, '$.sourceAttendanceId'), '')) IN (SELECT value FROM json_each(?))`
  const progress = attendanceIds.length ? await projected('workCatalogProgress', compactObject('value_json', completionFields), attendanceMatch, [storeId, JSON.stringify(attendanceIds)]) : []
  const legacyProjection = `json_set(${compactObject('value_json', completionFields)}, '$.catalogSnapshot', json(${compactObject("value_json -> '$.catalogSnapshot'", catalogFields)}))`
  const tasks = attendanceIds.length ? await projected('tasks', legacyProjection,
    `AND (store_id = ? COLLATE NOCASE OR store_id IS NULL)
      AND lower(COALESCE(NULLIF(json_extract(value_json, '$.checklistAttendanceId'), ''), json_extract(value_json, '$.attendanceId'), '')) IN (SELECT value FROM json_each(?))`, [storeId, JSON.stringify(attendanceIds)]) : []
  const entryIds = progress.map((row) => row.compensationEntryId).filter(Boolean)
  const compensationEntries = entryIds.length ? await projected('compensationEntries', compactObject('value_json', ['id', 'status']),
    `AND (store_id = ? COLLATE NOCASE OR store_id IS NULL) AND record_id IN (SELECT value COLLATE NOCASE FROM json_each(?))`, [storeId, JSON.stringify(entryIds)]) : []
  const staff = new Set(attendance.map((row) => String(row.employeeId || row.employeeCode || '').trim().toLowerCase()))
  const employeeIds = [...new Set([...staff, ...employees.filter((row) => [row.id, row.code, row.employeeId].some((id) => staff.has(String(id || '').trim().toLowerCase())))
    .flatMap((row) => [row.id, row.code, row.employeeId].filter(Boolean).map((id) => String(id).trim().toLowerCase()))])]
  const violationProjection = `json_set(${compactObject('value_json', violationFields)}, '$.catalogSnapshot', json(${compactObject("value_json -> '$.catalogSnapshot'", ['violationPoints'])}))`
  // Eligibility is monthly per employee, including violations at support stores;
  // a date/shift filter must never restrict the point assessment itself.
  const violations = employeeIds.length ? await projected('violations', violationProjection,
    'AND employee_id IN (SELECT value COLLATE NOCASE FROM json_each(?))', [JSON.stringify(employeeIds)]) : []
  const rows = workRewardRows({ attendance, workCatalogProgress: progress, tasks, employees, compensationEntries, violations, targetUnit: 'store', storeId })
  const history = rows.filter((row) => row.completed && row.payoutStatus !== 'void')
  const result = { version, summary: {
    count: history.length,
    totalAmountVnd: history.reduce((sum, row) => sum + Math.max(0, Number(row.amountVnd) || 0), 0),
    statistics: rewardStatistics(rows),
  } }
  if (Number((await head())?.version || 0) !== version) {
    throw new ApiError(409, 'STATE_READ_CONFLICT', 'Dữ liệu vừa được cập nhật; vui lòng thử lại.')
  }
  cache.set(cacheKey, result)
  while (cache.size > 16) cache.delete(cache.keys().next().value)
  return result
}
