import {
  employeeUnit,
  entryAmount,
  entryDate,
  entryEmployeeId,
  isVoided,
} from './compensationViewModel'
import {
  operationalIdentifierEntry,
  sameOperationalIdentifier,
} from '../../utils'

const monthLabel = (period) => {
  const [year, month] = String(period || '').split('-')
  return year && month ? `Tháng ${month}/${year}` : 'Không xác định'
}

export const violationStatistics = (entries = []) => {
  const active = entries.filter((entry) => !isVoided(entry))
  const summarize = (keyFor, labelFor) => [...active.reduce((groups, entry) => {
    const key = keyFor(entry)
    const current = groups.get(key) || {
      key,
      label: labelFor(key, entry),
      count: 0,
      amountVnd: 0,
      severity: 'Chưa cấu hình mức độ',
    }
    current.count += 1
    current.amountVnd += Math.abs(entryAmount(entry))
    groups.set(key, current)
    return groups
  }, new Map()).values()].toSorted((left, right) => right.key.localeCompare(left.key))

  return {
    byDay: summarize(entryDate, (date) => date.split('-').reverse().join('/')),
    byMonth: summarize((entry) => entryDate(entry).slice(0, 7), monthLabel),
    byEmployee: summarize(entryEmployeeId, (employeeId, entry) => (
      entry.employeeName || employeeId || 'Không xác định'
    )),
  }
}

const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')
const rewardKind = (task = {}) => normalize(
  task.kind || task.catalogKind || task.catalogSnapshot?.kind || task.catalogSnapshot?.catalogKind,
).replaceAll('-', '_')
const isRewardTask = (task = {}) => rewardKind(task) === 'reward_task'
  || task.rewardEligible === true

const attendanceId = (record = {}) => String(record.id || record.attendanceId || '').trim()
const attendanceDate = (record = {}) => String(
  record.workDate || record.attendanceDate || record.date || record.checkInAt || '',
).slice(0, 10)
const attendanceEmployeeId = (record = {}) => String(record.employeeId || record.employeeCode || '').trim()
const attendanceShiftId = (record = {}) => String(record.shiftId || record.shift || '').trim()
const attendanceShiftName = (record = {}) => String(
  record.shiftName || record.checklistSnapshot?.shiftName || record.shiftId || record.shift || 'Chưa gắn ca',
).trim()
const attendanceIsOpen = (record = {}) => {
  const status = normalize(record.status)
  return !record.checkOut && !record.checkOutAt && !record.closedAt
    && !['closed', 'completed', 'đã kết ca', 'đã đóng'].includes(status)
}
const catalogItemId = (task = {}) => String(
  task.catalogItemId || task.checklistTaskId || task.id || task.catalogSnapshot?.id || '',
).trim()
const progressAttendanceId = (record = {}) => String(
  record.attendanceId || record.checklistAttendanceId || record.sourceAttendanceId || '',
).trim()
const progressCatalogItemId = (record = {}) => String(
  record.catalogItemId || record.workCatalogItemId || record.checklistTaskId || record.taskId || '',
).trim()
const completionState = (record = {}) => {
  const status = normalize(record.status)
  if (record.checked === false || record.completed === false
    || ['void', 'voided', 'cancelled', 'canceled', 'đã hủy'].includes(status)) return false
  if (record.checked === true || record.completed === true || record.done === true || record.claimed === true || record.rewarded === true) return true
  return ['claimed', 'completed', 'complete', 'approved', 'earned', 'hoàn thành', 'đã hoàn thành', 'đã ghi nhận']
    .includes(status)
}
const completionTime = (record = {}) => String(
  record.completedAt || record.rewardedAt || record.claimedAt || record.updatedAt || record.createdAt || '',
)

const employeeIdentifiers = (employee = {}) => [employee.id, employee.code, employee.employeeId]
const distinctIdentifierRecords = (values = []) => [...new Set(values
  .map((value) => String(value || '').trim())
  .filter(Boolean))].map((id) => ({ id }))

const normalizedReference = (value) => String(value ?? '').trim().toLocaleLowerCase('en-US')

/**
 * Builds the exact-first, case-insensitive lookup once for a collection.
 * The previous reward projection rescanned the complete attendance/employee
 * collection for every progress and task row, which made route rendering grow
 * quadratically with production history. Sets preserve the existing fail-closed
 * behaviour when identifiers collide by casing or exact spelling.
 */
const operationalReferenceIndex = (records = [], identifierValuesOf = (record) => [record?.id]) => {
  const source = Array.isArray(records) ? records : []
  const exact = new Map()
  const folded = new Map()
  const valuesByRecord = new Map()
  const add = (index, key, record) => {
    const matches = index.get(key) || new Set()
    matches.add(record)
    index.set(key, matches)
  }

  source.forEach((record) => {
    const rawValues = identifierValuesOf(record)
    const values = [...new Set((Array.isArray(rawValues) ? rawValues : [rawValues])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean))]
    valuesByRecord.set(record, values)
    values.forEach((value) => {
      add(exact, value, record)
      add(folded, normalizedReference(value), record)
    })
  })

  const resolve = (reference) => {
    const requested = String(reference ?? '').trim()
    if (!requested) return { record: null, ambiguous: false }
    const exactMatches = exact.get(requested) || new Set()
    if (exactMatches.size === 1) return { record: exactMatches.values().next().value, ambiguous: false }
    if (exactMatches.size > 1) return { record: null, ambiguous: true }
    const foldedMatches = folded.get(normalizedReference(requested)) || new Set()
    return foldedMatches.size === 1
      ? { record: foldedMatches.values().next().value, ambiguous: false }
      : { record: null, ambiguous: foldedMatches.size > 1 }
  }

  const key = (reference) => {
    const requested = String(reference ?? '').trim()
    if (!requested) return ''
    const foldedMatches = folded.get(normalizedReference(requested)) || new Set()
    return foldedMatches.size > 1
      ? `exact:${requested}`
      : `folded:${normalizedReference(requested)}`
  }

  const matches = (record, reference) => {
    const requested = String(reference ?? '').trim()
    if (!record || !requested) return false
    const values = valuesByRecord.get(record) || []
    if (values.includes(requested)) return true
    if (!values.some((value) => normalizedReference(value) === normalizedReference(requested))) return false
    const foldedMatches = folded.get(normalizedReference(requested)) || new Set()
    return foldedMatches.size === 1 && foldedMatches.has(record)
  }

  const collisionFor = (reference) => {
    const requested = String(reference ?? '').trim()
    if (!requested) return null
    const collisionKey = normalizedReference(requested)
    const foldedMatches = folded.get(collisionKey) || new Set()
    return foldedMatches.size > 1
      ? { key: collisionKey, records: [...foldedMatches] }
      : null
  }
  const foldedCollisions = [...folded.entries()]
    .filter(([, records]) => records.size > 1)
    .map(([key, records]) => ({ key, records: [...records] }))

  return { collisionFor, foldedCollisions, key, matches, resolve }
}

const rewardReferenceKeyResolver = (attendanceRecords) => {
  const attendanceIndex = operationalReferenceIndex(attendanceRecords, attendanceId)
  const catalogIndexes = new Map()
  const emptyCatalogIndex = operationalReferenceIndex([], catalogItemId)
  const catalogIndexFor = (attendanceRecord) => {
    if (!attendanceRecord) return emptyCatalogIndex
    if (!catalogIndexes.has(attendanceRecord)) {
      const snapshotTasks = Array.isArray(attendanceRecord.checklistSnapshot?.tasks)
        ? attendanceRecord.checklistSnapshot.tasks
        : []
      catalogIndexes.set(attendanceRecord, operationalReferenceIndex(snapshotTasks, catalogItemId))
    }
    return catalogIndexes.get(attendanceRecord)
  }

  return (attendanceReference, catalogReference) => {
    const attendanceKey = attendanceIndex.key(attendanceReference)
    const sourceAttendance = attendanceIndex.resolve(attendanceReference).record
    return `${attendanceKey}:${catalogIndexFor(sourceAttendance).key(catalogReference)}`
  }
}

/**
 * Builds immutable reward rows from the checklist captured at attendance check-in.
 * Current completion is overlaid from the canonical progress collection, with the
 * flat task collection retained only as a compatibility reader for older records.
 */
export const workRewardRows = ({
  attendance = [],
  workCatalogProgress = [],
  compensationEntries = [],
  tasks = [],
  employees = [],
  employeeId = '',
  targetUnit = '',
  storeId = '',
} = {}) => {
  const attendanceRecords = (Array.isArray(attendance) ? attendance : []).filter((record) => !record.deletedAt)
  const employeeRecords = Array.isArray(employees) ? employees : []
  const employeeIndex = operationalReferenceIndex(employeeRecords, employeeIdentifiers)
  const employeeFor = (reference) => employeeIndex.resolve(reference).record
  const employeeFilterSource = employeeRecords.length
    ? employeeRecords
    : distinctIdentifierRecords(attendanceRecords.map(attendanceEmployeeId))
  const employeeFilterIndex = employeeRecords.length
    ? employeeIndex
    : operationalReferenceIndex(employeeFilterSource, (record) => [record.id])
  const employeeFilterMatch = employeeId ? employeeFilterIndex.resolve(employeeId) : null
  if (employeeFilterMatch?.ambiguous || (employeeId && !employeeFilterMatch?.record)) return []
  const storeReferences = distinctIdentifierRecords([
    ...attendanceRecords.map((record) => record.storeId),
    ...employeeRecords.map((employee) => employee.storeId),
  ])
  const storeIndex = operationalReferenceIndex(storeReferences, (record) => [record.id])
  const storeFilterMatch = storeId ? storeIndex.resolve(storeId) : null
  if (storeFilterMatch?.ambiguous || (storeId && !storeFilterMatch?.record)) return []
  const rewardReferenceKey = rewardReferenceKeyResolver(attendanceRecords)
  const progressByKey = new Map((Array.isArray(workCatalogProgress) ? workCatalogProgress : [])
    .map((record) => [rewardReferenceKey(
      progressAttendanceId(record),
      progressCatalogItemId(record),
    ), record])
    .filter(([key]) => !key.startsWith(':') && !key.endsWith(':')))
  const compensationRecords = Array.isArray(compensationEntries) ? compensationEntries : []
  const compensationIndex = operationalReferenceIndex(compensationRecords, (entry) => [entry.id])
  const tasksByKey = new Map((Array.isArray(tasks) ? tasks : [])
    .map((task) => [rewardReferenceKey(
      task.checklistAttendanceId || task.attendanceId,
      catalogItemId(task),
    ), task])
    .filter(([key]) => !key.startsWith(':') && !key.endsWith(':')))

  return attendanceRecords
    .filter((record) => {
      if (!employeeFilterMatch?.record) return true
      if (!employeeRecords.length) {
        return employeeFilterIndex.matches(employeeFilterMatch.record, attendanceEmployeeId(record))
      }
      return employeeFor(attendanceEmployeeId(record)) === employeeFilterMatch.record
    })
    .filter((record) => {
      const employee = employeeFor(attendanceEmployeeId(record))
      return !targetUnit || employeeUnit({ ...employee, ...record }) === targetUnit
    })
    .filter((record) => {
      if (!storeFilterMatch?.record) return true
      const employee = employeeFor(attendanceEmployeeId(record))
      return storeIndex.matches(storeFilterMatch.record, record.storeId || employee?.storeId)
    })
    .flatMap((record) => {
      const snapshotTasks = Array.isArray(record.checklistSnapshot?.tasks) ? record.checklistSnapshot.tasks : []
      return snapshotTasks.filter(isRewardTask).map((task, index) => {
        const sourceAttendanceId = attendanceId(record)
        const sourceCatalogItemId = catalogItemId(task)
        const rewardProgressKey = rewardReferenceKey(sourceAttendanceId, sourceCatalogItemId)
        const progress = progressByKey.get(rewardProgressKey)
        const legacyTask = tasksByKey.get(rewardProgressKey)
        const recordEmployeeId = attendanceEmployeeId(record)
        const completionEntry = legacyTask?.completedBy && typeof legacyTask.completedBy === 'object'
          ? operationalIdentifierEntry(legacyTask.completedBy, recordEmployeeId)
          : { found: false, ambiguous: false, value: false }
        const completedBy = completionEntry.found && !completionEntry.ambiguous
          ? Boolean(completionEntry.value)
          : false
        const completed = progress ? completionState(progress) : completionState(legacyTask) || completedBy
        const compensationEntry = compensationIndex.resolve(progress?.compensationEntryId).record
        const progressStatus = normalize(progress?.status || compensationEntry?.status)
        const payoutStatus = ['pending_team_review', 'pending', 'submitted'].includes(progressStatus)
          ? 'pending'
          : ['void', 'voided', 'cancelled', 'canceled', 'đã hủy'].includes(progressStatus)
            ? 'void'
            : completed ? 'approved' : 'unclaimed'
        const workDate = attendanceDate(record)
        const shiftStart = String(record.shiftStart || '').trim()
        const shiftEnd = String(record.shiftEnd || '').trim()
        const employee = employeeFor(recordEmployeeId)
        return {
          id: `${sourceAttendanceId}:${sourceCatalogItemId || index}`,
          attendanceId: sourceAttendanceId,
          employeeId: recordEmployeeId,
          employeeName: record.employeeName || employee?.name || employee?.displayName || recordEmployeeId || 'Không xác định',
          targetUnit: employeeUnit({ ...employee, ...record }),
          storeId: String(record.storeId || employee?.storeId || '').trim(),
          workDate,
          month: workDate.slice(0, 7),
          shiftId: attendanceShiftId(record),
          shiftName: attendanceShiftName(record),
          shiftTime: shiftStart || shiftEnd ? `${shiftStart || '--:--'}–${shiftEnd || '--:--'}` : '',
          attendanceOpen: attendanceIsOpen(record),
          catalogItemId: sourceCatalogItemId,
          catalogCode: String(task.catalogCode || task.code || '').trim(),
          catalogVersion: Number(task.catalogVersion || task.version || 1),
          title: String(task.name || task.title || task.description || 'Công việc tính thưởng').trim(),
          description: String(task.description || task.detail || '').trim(),
          amountVnd: Math.max(0, Number(task.amountVnd || 0) || 0),
          completed,
          paid: completed && payoutStatus === 'approved',
          payoutStatus,
          progressVersion: Number(progress?.version || 0),
          completedAt: completed ? completionTime(progress || legacyTask) : '',
        }
      })
    })
    .toSorted((left, right) => `${right.workDate} ${right.completedAt} ${right.id}`
      .localeCompare(`${left.workDate} ${left.completedAt} ${left.id}`))
}

export const rewardStatistics = (rows = []) => {
  const completed = rows.filter((row) => row.paid || (row.completed && row.payoutStatus !== 'pending' && row.payoutStatus !== 'void'))
  const summarize = (keyFor, labelFor) => [...completed.reduce((groups, row) => {
    const key = keyFor(row)
    const current = groups.get(key) || { key, label: labelFor(key, row), count: 0, amountVnd: 0 }
    current.count += 1
    current.amountVnd += Math.max(0, Number(row.amountVnd || 0) || 0)
    groups.set(key, current)
    return groups
  }, new Map()).values()].toSorted((left, right) => right.key.localeCompare(left.key))

  return {
    byDay: summarize((row) => row.workDate, (date) => String(date || '').split('-').reverse().join('/')),
    byMonth: summarize((row) => row.month || String(row.workDate || '').slice(0, 7), monthLabel),
    byEmployee: summarize((row) => row.employeeId, (id, row) => row.employeeName || id || 'Không xác định'),
  }
}

const revenueDailyId = (record = {}) => String(record.id || record.calculationId || '').trim()
const revenueAllocationDailyId = (record = {}) => String(
  record.revenueBonusDailyId || record.calculationId || '',
).trim()
const revenueBusinessDate = (record = {}) => String(
  record.businessDate || record.date || record.calculationDate || record.createdAt || '',
).slice(0, 10)
const revenueAmount = (record = {}) => {
  const amount = Number(
    record.amountVnd ?? record.allocatedVnd ?? record.amount ?? record.bonusVnd ?? 0,
  )
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0
}
const isSuperseded = (record = {}) => Boolean(record.supersededAt)
  || normalize(record.status) === 'superseded'
const isEffectiveRevenueRecord = (record = {}) => !isVoided(record) && !isSuperseded(record)

/**
 * Projects effective daily revenue-bonus calculations into immutable history
 * rows. Store/date scopes with more than one effective daily record are excluded
 * in full: choosing either record would double-count money or silently invent a
 * winner. Collision metadata lets callers surface the data-integrity problem.
 *
 * Allocation snapshots retain historical employee names after a profile leaves
 * the active directory. Separate allocation collections remain supported for
 * backend state, while AppContext's nested allocation projection is preferred
 * when present.
 */
export const revenueBonusHistoryProjection = ({
  revenueBonusDaily = [],
  revenueBonusAllocations = [],
  employees = [],
  storeId = '',
} = {}) => {
  const dailyRecords = Array.isArray(revenueBonusDaily) ? revenueBonusDaily : []
  const allocationRecords = Array.isArray(revenueBonusAllocations) ? revenueBonusAllocations : []
  const employeeIndex = operationalReferenceIndex(
    Array.isArray(employees) ? employees : [],
    employeeIdentifiers,
  )
  const employeeCollisionByKey = new Map()
  const employeeCollisionsByRecord = employeeIndex.foldedCollisions.reduce((index, collision) => {
    collision.records.forEach((record) => {
      const collisions = index.get(record) || []
      collisions.push(collision)
      index.set(record, collisions)
    })
    return index
  }, new Map())
  const dailyIndex = operationalReferenceIndex(dailyRecords, (record) => [revenueDailyId(record)])
  const effectiveDailyRecords = dailyRecords
    .filter(isEffectiveRevenueRecord)
    .filter((daily) => !storeId || sameOperationalIdentifier(daily.storeId, storeId))
  const dailyByScope = effectiveDailyRecords.reduce((groups, daily) => {
    const storeKey = normalizedReference(daily.storeId)
    const businessDate = revenueBusinessDate(daily)
    const scopeKey = JSON.stringify([storeKey, businessDate])
    const records = groups.get(scopeKey) || []
    records.push(daily)
    groups.set(scopeKey, records)
    return groups
  }, new Map())
  const collidingDailyRecords = new Set()
  const collisions = [...dailyByScope.values()]
    .filter((records) => records.length > 1)
    .map((records) => {
      records.forEach((record) => collidingDailyRecords.add(record))
      return {
        storeId: String(records[0]?.storeId || '').trim(),
        storeKey: normalizedReference(records[0]?.storeId),
        businessDate: revenueBusinessDate(records[0]),
        recordIds: records.map(revenueDailyId).filter(Boolean).toSorted(),
        recordCount: records.length,
      }
    })
    .toSorted((left, right) => `${right.businessDate} ${right.storeKey}`
      .localeCompare(`${left.businessDate} ${left.storeKey}`))

  const rows = effectiveDailyRecords
    .filter((daily) => !collidingDailyRecords.has(daily))
    .flatMap((daily) => {
      const dailyId = revenueDailyId(daily)
      const dailyStoreId = String(daily.storeId || '').trim()
      const businessDate = revenueBusinessDate(daily)
      const nestedAllocations = Array.isArray(daily.allocations) ? daily.allocations : []
      const linkedAllocations = nestedAllocations.length
        ? nestedAllocations
        : allocationRecords.filter((allocation) => (
            dailyIndex.resolve(revenueAllocationDailyId(allocation)).record === daily
          ))

      return linkedAllocations
        .filter(isEffectiveRevenueRecord)
        .filter((allocation) => (
          !allocation.storeId
          || !dailyStoreId
          || sameOperationalIdentifier(allocation.storeId, dailyStoreId)
        ))
        .flatMap((allocation, index) => {
          const allocationEmployeeId = entryEmployeeId(allocation)
          const employeeResolution = employeeIndex.resolve(allocationEmployeeId)
          const directEmployeeCollision = employeeIndex.collisionFor(allocationEmployeeId)
          const relevantEmployeeCollisions = new Map([
            ...(directEmployeeCollision ? [[directEmployeeCollision.key, directEmployeeCollision]] : []),
            ...((employeeResolution.record && employeeCollisionsByRecord.get(employeeResolution.record)) || [])
              .map((collision) => [collision.key, collision]),
          ])
          if (relevantEmployeeCollisions.size) {
            relevantEmployeeCollisions.forEach((employeeCollision) => {
              if (employeeCollisionByKey.has(employeeCollision.key)) return
              employeeCollisionByKey.set(employeeCollision.key, {
                employeeKey: employeeCollision.key,
                employeeIds: [...new Set(employeeCollision.records
                  .map((record) => String(record.id || record.code || record.employeeId || '').trim())
                  .filter(Boolean))].toSorted(),
                recordCount: employeeCollision.records.length,
              })
            })
            return []
          }
          const employee = employeeResolution.record
          const employeeId = String(
            employee?.id || employee?.code || employee?.employeeId || allocationEmployeeId,
          ).trim()
          const workedSeconds = Math.max(0, Number(
            allocation.workedSeconds ?? allocation.weightUnits ?? 0,
          ) || 0)
          const approvedSalesHours = Math.max(0, Number(
            allocation.approvedSalesHours
              ?? allocation.workedHours
              ?? allocation.hours
              ?? (workedSeconds / 3_600),
          ) || 0)

          return [{
            id: String(allocation.id || `${dailyId || businessDate}:${employeeId || 'unknown'}:${index}`),
            revenueBonusDailyId: dailyId,
            storeId: dailyStoreId || String(allocation.storeId || '').trim(),
            storeName: String(daily.storeName || allocation.storeName || '').trim(),
            businessDate,
            month: String(daily.period || allocation.period || businessDate.slice(0, 7)).slice(0, 7),
            employeeId,
            employeeName: String(
              allocation.employeeName
                || employee?.name
                || employee?.displayName
                || allocationEmployeeId
                || 'Không xác định',
            ).trim(),
            workedSeconds,
            approvedSalesHours,
            weightPercent: allocation.weightPercent == null ? null : Number(allocation.weightPercent),
            amountVnd: revenueAmount(allocation),
            status: allocation.status || daily.status || 'APPROVED',
            recordedAt: String(
              allocation.approvedAt
                || allocation.createdAt
                || daily.calculatedAt
                || daily.createdAt
                || '',
            ),
          }]
        })
    })
    .toSorted((left, right) => `${right.businessDate} ${right.recordedAt} ${right.id}`
      .localeCompare(`${left.businessDate} ${left.recordedAt} ${left.id}`))

  return {
    rows,
    collisions,
    employeeCollisions: [...employeeCollisionByKey.values()]
      .toSorted((left, right) => left.employeeKey.localeCompare(right.employeeKey)),
  }
}

export const revenueBonusHistoryRows = (options = {}) => (
  revenueBonusHistoryProjection(options).rows
)

export const revenueBonusStatistics = (rows = [], { month = '' } = {}) => {
  const effective = (Array.isArray(rows) ? rows : []).filter(isEffectiveRevenueRecord)
  const summarize = (keyFor, labelFor, groupKeyFor = keyFor) => [...effective.reduce((groups, row) => {
    const key = String(keyFor(row) || '')
    const groupKey = String(groupKeyFor(row) || key)
    const current = groups.get(groupKey) || {
      key,
      label: labelFor(key, row),
      count: 0,
      amountVnd: 0,
    }
    current.count += 1
    current.amountVnd += revenueAmount(row)
    groups.set(groupKey, current)
    return groups
  }, new Map()).values()].toSorted((left, right) => right.key.localeCompare(left.key))
  const requestedMonth = /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(String(month || '').trim())
    ? String(month).trim()
    : ''

  return {
    byDay: summarize(
      (row) => revenueBusinessDate(row),
      (date) => date ? date.split('-').reverse().join('/') : 'Không xác định',
    ),
    byEmployee: summarize(
      (row) => entryEmployeeId(row),
      (employeeId, row) => row.employeeName || employeeId || 'Không xác định',
      (row) => normalize(entryEmployeeId(row)),
    ),
    byMonth: summarize(
      (row) => row.month || revenueBusinessDate(row).slice(0, 7),
      monthLabel,
    ),
    requestedMonth,
    monthlyTotalVnd: requestedMonth
      ? effective
          .filter((row) => (row.month || revenueBusinessDate(row).slice(0, 7)) === requestedMonth)
          .reduce((total, row) => total + revenueAmount(row), 0)
      : 0,
  }
}
