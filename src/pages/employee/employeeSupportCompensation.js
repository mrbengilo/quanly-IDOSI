import { formatVietnamTransferDateTime, supportTransferBounds } from '../../domain/supportTransferTime'

const nonNegativeNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const moneyValue = (value) => {
  const parsed = nonNegativeNumber(value)
  return parsed == null ? null : Math.floor(parsed)
}

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = nonNegativeNumber(value)
    if (parsed != null) return parsed
  }
  return null
}

const firstMoney = (...values) => {
  for (const value of values) {
    const parsed = moneyValue(value)
    if (parsed != null) return parsed
  }
  return null
}

const recordEmployeeId = (record = {}) => String(record.employeeId || record.employeeCode || '')
const recordTimeKey = (record = {}) => String(
  record.checkInAt || record.workDate || record.attendanceDate || record.date || record.createdAt || record.id || '',
)

const workedHours = (record = {}) => firstNumber(
  record.supportHours,
  record.supportWorkedHours,
  record.supportCompensation?.hours,
  record.compensation?.support?.hours,
  record.hours,
  Number(record.workedSeconds || 0) / 3_600,
) || 0

const linkedTransfer = (record, transfersById) => {
  const transferId = String(record.supportCompensation?.transferId || record.supportTransferId || '').trim()
  return transferId ? transfersById.get(transferId) || null : null
}

const isAllowanceAttributed = (record = {}) => {
  const support = record.supportCompensation || record.compensation?.support || {}
  for (const value of [
    support.allowanceApplied,
    support.allowanceAttributed,
    record.supportAllowanceApplied,
    record.supportAllowanceAttributed,
  ]) {
    if (typeof value === 'boolean') return value
  }
  return null
}

const transferTimeLabel = (transfer = {}) => {
  const bounds = supportTransferBounds(transfer)
  if (!bounds) return 'Chưa ghi thời gian hỗ trợ'
  return `${formatVietnamTransferDateTime(bounds.startAt)} – ${formatVietnamTransferDateTime(bounds.endAt)}`
}

const storeNameFor = (storeId, storesById, fallback) => (
  storesById.get(String(storeId || ''))?.name || fallback || storeId || '—'
)

export const supportAttendanceCompensationRows = ({
  attendance = [],
  employeeId,
  supportTransfers = [],
  stores = [],
} = {}) => {
  const transfersById = new Map(supportTransfers.map((transfer) => [String(transfer.id || ''), transfer]))
  const storesById = new Map(stores.map((store) => [String(store.id || ''), store]))
  const ownAttendance = attendance.filter((record) => (
    !record.deletedAt && (!employeeId || recordEmployeeId(record) === String(employeeId))
  ))
  const firstLinkedAttendanceId = new Map()

  const completedAttendance = ownAttendance.filter((record) => (
    record.checkOutAt || record.checkOut || workedHours(record) > 0
  ))
  for (const record of [...completedAttendance].sort((left, right) => recordTimeKey(left).localeCompare(recordTimeKey(right)))) {
    const transfer = linkedTransfer(record, transfersById)
    const transferId = String(transfer?.id || record.supportTransferId || '').trim()
    if (transferId && !firstLinkedAttendanceId.has(transferId)) {
      firstLinkedAttendanceId.set(transferId, String(record.id || recordTimeKey(record)))
    }
  }

  return ownAttendance.map((record) => {
    const transfer = linkedTransfer(record, transfersById)
    const transferId = String(transfer?.id || record.supportTransferId || '').trim()
    if (!transferId) return { record, isSupport: false, actualPay: null }

    const support = record.supportCompensation || record.compensation?.support || {}
    const hours = workedHours(record)
    const hourlyRate = firstMoney(
      support.hourlyRate,
      support.rate,
      record.supportHourlyRateSnapshot,
      record.supportHourlyRate,
      record.hourlySupportRate,
      transfer?.hourlySupportRate,
      transfer?.supportHourlyRate,
    ) || 0
    let hourlyPay = firstMoney(
      support.hourlyPay,
      support.basePay,
      record.supportBasePay,
      record.supportHourlyPay,
    )
    let allowance = firstMoney(
      support.allowance,
      support.allowancePay,
      record.supportAllowance,
      record.supportAllowancePay,
    )
    const explicitTotal = firstMoney(
      support.totalPay,
      support.total,
      support.actualPay,
      record.supportActualPay,
      record.supportTotalPay,
      record.supportPay,
    )
    const attribution = isAllowanceAttributed(record)

    if (hourlyPay == null) hourlyPay = Math.floor(hours * hourlyRate)
    if (allowance == null && explicitTotal != null) allowance = Math.max(0, explicitTotal - hourlyPay)
    if (allowance == null) {
      const currentId = String(record.id || recordTimeKey(record))
      const ownsFallbackAllowance = attribution === true || (
        attribution == null && firstLinkedAttendanceId.get(transferId) === currentId
      )
      allowance = ownsFallbackAllowance
        ? (firstMoney(transfer?.allowance, transfer?.supportAllowance) || 0)
        : 0
    } else if (attribution === false) {
      allowance = 0
    }

    const actualPay = explicitTotal ?? (hourlyPay + allowance)
    const destinationStoreId = String(
      support.supportStoreId || support.storeId || support.destinationStoreId || transfer?.toStoreId || record.storeId || '',
    )

    return {
      record,
      transfer,
      transferId,
      isSupport: true,
      destinationStoreId,
      destinationStoreName: storeNameFor(
        destinationStoreId,
        storesById,
        support.supportStoreName || support.storeName || support.destinationStoreName || transfer?.toStoreName,
      ),
      timeLabel: transferTimeLabel(transfer || {
        startAt: support.transferStartAt,
        endAt: support.transferEndAt,
        fromDate: record.fromDate,
        toDate: record.toDate,
      }),
      hours,
      hourlyRate,
      hourlyPay,
      allowance,
      actualPay,
    }
  })
}

export const supportCompensationTotals = (rows = []) => rows.reduce((totals, row) => {
  if (!row.isSupport) return totals
  totals.hours += row.hours
  totals.hourlyPay += row.hourlyPay
  totals.allowance += row.allowance
  totals.actualPay += row.actualPay
  return totals
}, { hours: 0, hourlyPay: 0, allowance: 0, actualPay: 0 })

const uniqueStrings = (values = []) => [...new Set(values.flat().map((value) => String(value || '').trim()).filter(Boolean))]

const isSupportSnapshotRow = (row = {}) => Boolean(
  row.supportCompensation
  || row.supportActualPay != null
  || row.supportHourlyPay != null
  || row.supportAllowance != null
  || (Array.isArray(row.supportDetails) && row.supportDetails.length)
  || (Array.isArray(row.supportTransferIds) && row.supportTransferIds.length),
)

const supportCoverageFrom = (snapshot = {}) => {
  const details = Array.isArray(snapshot.supportDetails) ? snapshot.supportDetails : []
  return {
    transferIds: new Set(uniqueStrings([
      snapshot.coveredSupportTransferIds || [],
      details.map((detail) => detail.transferId),
    ])),
    attendanceIds: new Set(uniqueStrings([
      snapshot.coveredSupportAttendanceIds || [],
      details.flatMap((detail) => detail.attendanceIds || []),
    ])),
    legacyStoreIds: new Set(uniqueStrings(snapshot.legacyCoveredSupportStoreIds || [])),
  }
}

export const supportRowsUncoveredByPayrollSnapshot = (attendanceRows = [], snapshot = null) => {
  if (!snapshot?.supportSnapshot && !snapshot?.supportDetails?.length) return attendanceRows
  const coverage = supportCoverageFrom(snapshot)
  return attendanceRows.filter((item) => {
    const attendanceId = String(item.record?.id || '').trim()
    const transferId = String(item.transferId || item.record?.supportTransferId || '').trim()
    const storeId = String(item.destinationStoreId || item.record?.storeId || '').trim()
    if (attendanceId && coverage.attendanceIds.has(attendanceId)) return false
    if (transferId && coverage.transferIds.has(transferId)) return false
    return !(storeId && coverage.legacyStoreIds.has(storeId))
  })
}

export const supportPayrollDetailRows = ({ snapshotDetails = [], snapshot = null, attendanceRows = [], stores = [] } = {}) => {
  const storesById = new Map(stores.map((store) => [String(store.id || ''), store]))
  const details = snapshotDetails.length ? snapshotDetails : (snapshot?.supportDetails || [])
  const uncoveredAttendance = supportRowsUncoveredByPayrollSnapshot(attendanceRows, {
    ...snapshot,
    supportDetails: details,
  })
  const liveDetails = uncoveredAttendance.map((item) => ({
      ...item,
      key: String(item.record?.id || item.transferId || ''),
      date: recordTimeKey(item.record).slice(0, 10),
      shiftLabel: `Ca ${item.record?.shiftStart || '--:--'}–${item.record?.shiftEnd || '--:--'}`,
    }))

  const closedDetails = details.map((detail, index) => {
    const hourlyPay = firstMoney(detail.basePay, detail.hourlyPay) || 0
    const allowance = firstMoney(detail.allowance) || 0
    const startAt = detail.startAt || detail.transferStartAt
    const endAt = detail.endAt || detail.transferEndAt
    const attendanceCount = Array.isArray(detail.attendanceIds) ? detail.attendanceIds.length : 0
    return {
      key: `${detail.transferId || 'support'}-${index}`,
      date: String(startAt || '').slice(0, 10),
      destinationStoreName: storeNameFor(
        detail.supportStoreId,
        storesById,
        detail.supportStoreName || detail.destinationStoreName,
      ),
      timeLabel: transferTimeLabel({ startAt, endAt }),
      shiftLabel: attendanceCount ? `${attendanceCount} ca đã chốt` : 'Theo bản chốt kỳ lương',
      hours: firstNumber(detail.hours) || 0,
      hourlyRate: firstMoney(detail.hourlyRate) || 0,
      hourlyPay,
      allowance,
      actualPay: firstMoney(detail.totalPay) ?? (hourlyPay + allowance),
      lockedSnapshot: true,
    }
  })
  return [...closedDetails, ...liveDetails]
}

export const employeePayrollSnapshotSummary = ({ payrollPeriods = [], employeeId, period } = {}) => {
  const periods = payrollPeriods.filter((item) => (
    String(item.period || '') === String(period || '')
    && item.rows?.some((row) => recordEmployeeId(row) === String(employeeId || ''))
  ))
  const rows = periods.flatMap((item) => item.rows
    .filter((row) => recordEmployeeId(row) === String(employeeId || ''))
    .map((row) => {
      // Old locked rows remain readable, but the retired KPI amount is deliberately
      // excluded instead of being silently reclassified as another bonus source.
      const legacyKpiBonus = firstMoney(row.kpiBonus) || 0
      const normalized = {
        ...row,
        gross: Math.max(0, (firstMoney(row.gross) || 0) - legacyKpiBonus),
        remaining: Math.max(0, (firstMoney(row.remaining) || 0) - legacyKpiBonus),
        payrollStoreId: item.storeId,
        payrollStatus: item.status,
      }
      delete normalized.kpiBonus
      return normalized
    }))
  if (!rows.length) return null

  const homeRows = rows.filter((row) => !isSupportSnapshotRow(row))
  const supportRows = rows.filter(isSupportSnapshotRow)
  const sumRows = (sourceRows, field) => sourceRows.reduce((total, row) => total + (firstMoney(row[field]) || 0), 0)
  const sum = (field) => sumRows(rows, field)
  const supportHourlyPay = supportRows.reduce((total, row) => total + (
    firstMoney(row.supportCompensation?.basePay, row.supportHourlyPay) || 0
  ), 0)
  const supportAllowance = supportRows.reduce((total, row) => total + (
    firstMoney(row.supportCompensation?.allowance, row.supportAllowance) || 0
  ), 0)
  const supportActualPay = supportRows.reduce((total, row) => total + (
    firstMoney(row.supportCompensation?.totalPay, row.supportActualPay)
      ?? ((firstMoney(row.supportCompensation?.basePay, row.supportHourlyPay) || 0)
        + (firstMoney(row.supportCompensation?.allowance, row.supportAllowance) || 0))
  ), 0)
  const supportHours = supportRows.reduce((total, row) => total + (
    firstNumber(row.supportCompensation?.hours)
      ?? (Array.isArray(row.supportDetails)
        ? row.supportDetails.reduce((sum, detail) => sum + (firstNumber(detail.hours) || 0), 0)
        : 0)
  ), 0)
  const supportDetails = supportRows.flatMap((row) => Array.isArray(row.supportDetails) ? row.supportDetails : [])
    .filter((detail, index, details) => {
      const transferId = String(detail.transferId || '').trim()
      if (transferId) return details.findIndex((candidate) => String(candidate.transferId || '').trim() === transferId) === index
      const attendanceKey = uniqueStrings(detail.attendanceIds || []).join('|')
      return !attendanceKey || details.findIndex((candidate) => uniqueStrings(candidate.attendanceIds || []).join('|') === attendanceKey) === index
    })
  const coveredSupportTransferIds = uniqueStrings([
    supportRows.flatMap((row) => row.supportCompensation?.transferIds || row.supportTransferIds || []),
    supportDetails.map((detail) => detail.transferId),
  ])
  const coveredSupportAttendanceIds = uniqueStrings(supportDetails.flatMap((detail) => detail.attendanceIds || []))
  const legacyCoveredSupportStoreIds = uniqueStrings(supportRows
    .filter((row) => {
      const rowTransferIds = uniqueStrings([
        row.supportCompensation?.transferIds || row.supportTransferIds || [],
        (row.supportDetails || []).map((detail) => detail.transferId),
      ])
      const rowAttendanceIds = uniqueStrings((row.supportDetails || []).flatMap((detail) => detail.attendanceIds || []))
      return !rowTransferIds.length && !rowAttendanceIds.length
    })
    .map((row) => row.payrollStoreId))
  const baseSalary = sum('baseSalary')
  const gross = sum('gross')
  const advancesPaid = rows.reduce((total, row) => total + (firstMoney(row.advancesPaid) || 0), 0)
  const remaining = rows.reduce((total, row) => total + (
    firstMoney(row.remaining) ?? Math.max(0, (firstMoney(row.gross) || 0) - (firstMoney(row.advancesPaid) || 0))
  ), 0)

  return {
    periods,
    rows,
    baseSalary,
    homeBaseSalary: sumRows(homeRows, 'baseSalary'),
    homeSnapshot: homeRows.length ? {
      rows: homeRows,
      baseSalary: sumRows(homeRows, 'baseSalary'),
      gross: sumRows(homeRows, 'gross'),
      advancesPaid: sumRows(homeRows, 'advancesPaid'),
      remaining: sumRows(homeRows, 'remaining'),
    } : null,
    supportSnapshot: supportRows.length ? {
      rows: supportRows,
      hours: supportHours,
      hourlyPay: supportHourlyPay,
      allowance: supportAllowance,
      pay: supportActualPay,
      gross: sumRows(supportRows, 'gross'),
      remaining: sumRows(supportRows, 'remaining'),
    } : null,
    supportHours,
    supportHourlyPay,
    supportAllowance,
    supportPay: supportActualPay,
    supportDetails,
    coveredSupportTransferIds,
    coveredSupportAttendanceIds,
    legacyCoveredSupportStoreIds,
    gross,
    advancesPaid,
    remaining,
    statuses: [...new Set(periods.map((item) => item.status).filter(Boolean))],
    closedAt: periods.map((item) => item.closedAt).filter(Boolean).sort().at(-1) || null,
    locked: periods.some((item) => item.status === 'Đã khóa' || item.lockedAt),
  }
}
