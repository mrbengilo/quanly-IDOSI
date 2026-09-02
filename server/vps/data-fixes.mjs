import { Buffer } from 'node:buffer'

export const TEST_MANAGER_PURGE_MARKER = 'data-fix:2026-09-02:purge-test-manager-qlch-004-v1'

const TARGET = Object.freeze({
  employeeId: 'QLCH-004',
  employeeName: 'Trần Thị Ngọc Bích',
  storeName: 'SM TNV',
})
const TARGET_STORE_IDENTITIES = new Set([
  'sm tnv',
  'tnv',
  'idosi tnv',
  'idosi to ngoc van',
  'to ngoc van',
])

const PROFILE_COLLECTIONS = new Set(['employees', 'deletedEmployees'])
const STORE_COLLECTIONS = new Set(['stores', 'deletedStores'])
const RECORD_COLLECTIONS = new Set([
  'attendance',
  'schedule',
  'tasks',
  'taskAssignmentHistory',
  'supportWorkAssignments',
  'supportWorkSchedules',
  'supportWorkScheduleHistory',
  'officeAdjustments',
  'notifications',
  'salaryAdjustments',
  'salaryAdvances',
  'payrollPayments',
  'storeEmployeeSalaryConfigs',
  'workCatalogProgress',
  'compensationEntries',
  'violations',
  'violationRefunds',
  'revenueBonusAllocations',
  'teamRewardClaims',
  'teamRewardParticipants',
  'supportTransfers',
  'attendanceAudit',
  'auditLogs',
])
const AGGREGATE_COLLECTIONS = new Set([
  'payrollPeriods',
  'revenueBonusDaily',
  'periodReconciliations',
  'jobRuns',
])
const RELEVANT_COLLECTIONS = new Set([
  ...PROFILE_COLLECTIONS,
  ...STORE_COLLECTIONS,
  ...RECORD_COLLECTIONS,
  ...AGGREGATE_COLLECTIONS,
])

const EMPLOYEE_SCALAR_KEYS = new Set([
  'employeeid',
  'employeecode',
  'staffid',
  'assigneeid',
  'assignedemployeeid',
  'createdbyemployeeid',
  'manageremployeeid',
  'participantemployeeid',
  'targetemployeeid',
  'subjectemployeeid',
  'requestedbyemployeeid',
  'approvedbyemployeeid',
  'updatedbyemployeeid',
])
const EMPLOYEE_ARRAY_KEYS = new Set([
  'employeeids',
  'employeecodes',
  'staffids',
  'assigneeids',
  'assignedemployeeids',
  'participantemployeeids',
])

const compactText = (value) => String(value ?? '').trim().normalize('NFC')
const identifier = (value) => compactText(value).toLocaleUpperCase('en-US')
const normalizedKey = (value) => compactText(value).replace(/[^A-Za-z0-9]/gu, '').toLocaleLowerCase('en-US')
const normalizedText = (value) => compactText(value)
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLocaleLowerCase('en-US')
  .replace(/[-_\s]+/gu, ' ')
const parseJson = (value, fallback = null) => {
  try {
    return JSON.parse(String(value))
  } catch {
    return fallback
  }
}
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const profileId = (profile = {}) => profile.id || profile.code || profile.employeeId || profile.employeeCode
const isTargetIdentifier = (value) => identifier(value) === TARGET.employeeId

const directlyReferencesTarget = (value) => {
  if (!isRecord(value)) return false
  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizedKey(key)
    if (EMPLOYEE_SCALAR_KEYS.has(normalized) && isTargetIdentifier(nested)) return true
    if (EMPLOYEE_ARRAY_KEYS.has(normalized) && Array.isArray(nested)
      && nested.some((entry) => isTargetIdentifier(isRecord(entry) ? entry.employeeId || entry.id : entry))) return true
    if (normalized === 'completedby' && isRecord(nested)
      && Object.keys(nested).some(isTargetIdentifier)) return true
  }
  return false
}

const referencesTarget = (value) => {
  if (Array.isArray(value)) return value.some(referencesTarget)
  if (!isRecord(value)) return false
  if (directlyReferencesTarget(value)) return true
  return Object.values(value).some(referencesTarget)
}

const scrubNestedTargetRows = (value, parentKey = '') => {
  if (Array.isArray(value)) {
    const parentIsEmployeeArray = EMPLOYEE_ARRAY_KEYS.has(normalizedKey(parentKey))
    return value
      .filter((entry) => {
        if (parentIsEmployeeArray) {
          const candidate = isRecord(entry) ? entry.employeeId || entry.id : entry
          if (isTargetIdentifier(candidate)) return false
        }
        return !directlyReferencesTarget(entry)
      })
      .map((entry) => scrubNestedTargetRows(entry, parentKey))
  }
  if (!isRecord(value)) return value

  const result = {}
  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizedKey(key)
    if (normalized === 'completedby' && isRecord(nested)) {
      result[key] = Object.fromEntries(Object.entries(nested).filter(([employeeId]) => !isTargetIdentifier(employeeId)))
      continue
    }
    result[key] = scrubNestedTargetRows(nested, key)
  }
  return result
}

const readExternalRows = (database) => {
  const placeholders = [...RELEVANT_COLLECTIONS].map(() => '?').join(', ')
  return database.prepare(`
    SELECT collection_key, entity_key, value_json
    FROM state_entities
    WHERE scope_key = 'global' AND collection_key IN (${placeholders})
    ORDER BY collection_key, entity_order, entity_key
  `).all(...RELEVANT_COLLECTIONS)
}

const logicalRows = (externalRows, compactState, collections) => [
  ...externalRows
    .filter((row) => collections.has(row.collection_key))
    .map((row) => parseJson(row.value_json))
    .filter(isRecord),
  ...[...collections].flatMap((collection) => (
    Array.isArray(compactState?.[collection]) ? compactState[collection].filter(isRecord) : []
  )),
]

const logicalProfileEntries = (externalRows, compactState) => [
  ...externalRows
    .filter((row) => PROFILE_COLLECTIONS.has(row.collection_key))
    .map((row) => ({ collection: row.collection_key, profile: parseJson(row.value_json) }))
    .filter(({ profile }) => isRecord(profile)),
  ...[...PROFILE_COLLECTIONS].flatMap((collection) => (
    Array.isArray(compactState?.[collection])
      ? compactState[collection].filter(isRecord).map((profile) => ({ collection, profile }))
      : []
  )),
]

const isArchivedProfileEntry = ({ collection, profile }) => (
  collection === 'deletedEmployees'
  || Boolean(profile.deletedAt)
  || ['da nghi viec', 'inactive'].includes(normalizedText(profile.status))
)

const isTargetStore = (store, storeId) => (
  identifier(store.id) === identifier(storeId)
  && [store.name, store.code, store.storeCode, store.short, store.employeePrefix]
    .some((value) => TARGET_STORE_IDENTITIES.has(normalizedText(value)))
)

const exactTargetEvidence = (externalRows, compactState) => {
  const identifierMatches = logicalProfileEntries(externalRows, compactState)
    .filter(({ profile }) => isTargetIdentifier(profileId(profile)))
  if (!identifierMatches.length) return null
  if (!identifierMatches.every(isArchivedProfileEntry)) {
    throw new Error('Data-fix QLCH-004 dừng an toàn vì hồ sơ theo mã vẫn còn hoạt động.')
  }

  const storeIds = new Set(identifierMatches.map(({ profile }) => compactText(profile.storeId)).filter(Boolean))
  if (storeIds.size !== 1) {
    throw new Error('Data-fix QLCH-004 dừng an toàn vì hồ sơ không quy về đúng một cửa hàng.')
  }
  const [storeId] = storeIds
  const stores = logicalRows(externalRows, compactState, STORE_COLLECTIONS)
  const exactStore = stores.some((store) => isTargetStore(store, storeId))
  if (!exactStore) {
    throw new Error('Data-fix QLCH-004 dừng an toàn vì cửa hàng đích không khớp SM TNV.')
  }

  return {
    storeId,
  }
}

const updateCompactState = (compactState, targetUserIds) => {
  const next = structuredClone(compactState)
  for (const collection of PROFILE_COLLECTIONS) {
    if (!Array.isArray(next[collection])) continue
    next[collection] = next[collection].filter((record) => !isTargetIdentifier(profileId(record)))
  }
  for (const collection of RECORD_COLLECTIONS) {
    if (!Array.isArray(next[collection])) continue
    next[collection] = next[collection].filter((record) => !referencesTarget(record))
  }
  for (const collection of AGGREGATE_COLLECTIONS) {
    if (!Array.isArray(next[collection])) continue
    next[collection] = next[collection].map((record) => scrubNestedTargetRows(record))
  }
  if (isRecord(next.accountSettings)) {
    next.accountSettings = Object.fromEntries(Object.entries(next.accountSettings).filter(([userId]) => (
      !targetUserIds.has(userId) && !isTargetIdentifier(userId)
    )))
  }
  return next
}

const targetAuditRow = (row, targetUserIds) => (
  isTargetIdentifier(row.entity_id)
  || targetUserIds.has(compactText(row.actor_id))
  || [row.before_json, row.after_json, row.metadata_json]
    .map((value) => parseJson(value))
    .some(referencesTarget)
)

export const applyVpsDataFixes = (database, now = new Date().toISOString()) => {
  const existingMarker = database.prepare('SELECT value_json FROM system_metadata WHERE meta_key = ?')
    .get(TEST_MANAGER_PURGE_MARKER)
  if (existingMarker) return { status: 'already_applied', marker: parseJson(existingMarker.value_json, {}) }

  const appStateRow = database.prepare("SELECT value_json, version FROM app_state WHERE scope_key = 'global'").get()
  if (!appStateRow) return { status: 'not_applicable' }
  const compactState = parseJson(appStateRow.value_json, {})
  const externalRows = readExternalRows(database)
  const evidence = exactTargetEvidence(externalRows, compactState)
  if (!evidence) return { status: 'not_applicable' }

  database.exec('BEGIN IMMEDIATE')
  try {
    const markerInsideTransaction = database.prepare('SELECT value_json FROM system_metadata WHERE meta_key = ?')
      .get(TEST_MANAGER_PURGE_MARKER)
    if (markerInsideTransaction) {
      database.exec('COMMIT')
      return { status: 'already_applied', marker: parseJson(markerInsideTransaction.value_json, {}) }
    }

    const targetUsers = database.prepare(`
      SELECT id FROM users
      WHERE UPPER(TRIM(COALESCE(employee_id, ''))) = ? AND role <> 'admin'
    `).all(TARGET.employeeId)
    const targetUserIds = new Set(targetUsers.map(({ id }) => compactText(id)).filter(Boolean))
    const deletedByCollection = {}
    const changedCollections = new Set()

    for (const row of externalRows) {
      const value = parseJson(row.value_json)
      let remove = false
      let nextValue = value
      if (PROFILE_COLLECTIONS.has(row.collection_key)) {
        remove = isTargetIdentifier(profileId(value))
      } else if (RECORD_COLLECTIONS.has(row.collection_key)) {
        remove = referencesTarget(value)
      } else if (AGGREGATE_COLLECTIONS.has(row.collection_key)) {
        nextValue = scrubNestedTargetRows(value)
      }

      if (remove) {
        database.prepare(`
          DELETE FROM state_entities
          WHERE scope_key = 'global' AND collection_key = ? AND entity_key = ?
        `).run(row.collection_key, row.entity_key)
        deletedByCollection[row.collection_key] = Number(deletedByCollection[row.collection_key] || 0) + 1
        changedCollections.add(row.collection_key)
        continue
      }
      const serialized = JSON.stringify(nextValue)
      if (serialized !== row.value_json) {
        database.prepare(`
          UPDATE state_entities
          SET value_json = ?, value_bytes = ?, updated_at = ?
          WHERE scope_key = 'global' AND collection_key = ? AND entity_key = ?
        `).run(serialized, Buffer.byteLength(serialized), now, row.collection_key, row.entity_key)
        changedCollections.add(row.collection_key)
      }
    }

    const nextCompactState = updateCompactState(compactState, targetUserIds)
    const compactJson = JSON.stringify(nextCompactState)
    const compactChanged = compactJson !== appStateRow.value_json
    if (compactChanged || changedCollections.size) {
      database.prepare(`
        UPDATE app_state
        SET value_json = ?, version = version + 1, updated_at = ?, last_request_id = ?
        WHERE scope_key = 'global'
      `).run(compactJson, now, TEST_MANAGER_PURGE_MARKER)
    }
    for (const collection of changedCollections) {
      database.prepare(`
        UPDATE state_collections SET updated_at = ?
        WHERE scope_key = 'global' AND collection_key = ?
      `).run(now, collection)
    }

    const auditRows = database.prepare(`
      SELECT id, actor_id, entity_id, before_json, after_json, metadata_json FROM audit_log
    `).all()
    const targetAuditIds = auditRows.filter((row) => targetAuditRow(row, targetUserIds)).map(({ id }) => id)
    for (const id of targetAuditIds) database.prepare('DELETE FROM audit_log WHERE id = ?').run(id)

    let deletedUsers = 0
    for (const { id } of targetUsers) {
      deletedUsers += Number(database.prepare("DELETE FROM users WHERE id = ? AND role <> 'admin'").run(id).changes || 0)
    }

    const marker = {
      status: 'applied',
      employeeId: TARGET.employeeId,
      storeId: evidence.storeId,
      appliedAt: now,
      deletedByCollection,
      deletedUsers,
      deletedAuditRows: targetAuditIds.length,
    }
    database.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
      VALUES (?, ?, 1, ?)
    `).run(TEST_MANAGER_PURGE_MARKER, JSON.stringify(marker), now)

    const violations = database.prepare('PRAGMA foreign_key_check').all()
    if (violations.length) throw new Error(`Data-fix QLCH-004 tạo ${violations.length} lỗi khóa ngoại.`)
    database.exec('COMMIT')
    return { status: 'applied', marker }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
