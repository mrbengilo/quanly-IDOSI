from __future__ import annotations

from pathlib import Path


class PatchError(RuntimeError):
    pass


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise PatchError(f'{label}: expected exactly one anchor, found {count}')
    return text.replace(old, new, 1)


def main() -> None:
    path = Path('server/worker.js')
    text = path.read_text(encoding='utf-8')

    text = replace_once(
        text,
        """    const projectionTimestamp = new Date().toISOString()
    const inboundTransfers = filterArray(state, 'supportTransfers', (record) => {
      if (!sameIdentifier(record.toStoreId, storeId)) return false
      const openAttendance = openEmployeeAttendanceFor(state, record.employeeId)
      if (!openAttendance) return isSupportTransferActiveAt(record, projectionTimestamp)

      // An already-open shift owns the employee's operational context. A new
      // transfer window must not make the destination store see or operate the
      // employee until the prior shift is closed. An open support shift remains
      // visible at its destination even after the configured transfer end.
      const openContext = String(openAttendance.supportTransferId || '').trim()
        ? openSupportTransferContextFor(state, record.employeeId)
        : null
      if (openContext) {
        return sameIdentifier(openContext.attendance.id, openAttendance.id)
          && sameIdentifier(openContext.attendance.storeId, storeId)
          && sameIdentifier(openContext.transfer.id, record.id)
      }
      return sameIdentifier(openAttendance.storeId, record.toStoreId)
        && isSupportTransferActiveAt(record, projectionTimestamp)
    })""",
        """    const projectionTimestamp = new Date().toISOString()
    const inboundTransfers = filterArray(state, 'supportTransfers', (record) => {
      if (!sameIdentifier(record.toStoreId, storeId)) return false
      const openAttendanceContext = openEmployeeAttendanceContextFor(state, record.employeeId)
      if (!openAttendanceContext.hasOpenAttendance) {
        return isSupportTransferActiveAt(record, projectionTimestamp)
      }

      // An already-open shift owns the employee's operational context. A new
      // transfer window must not make the destination store see or operate the
      // employee until the prior shift is closed. Ambiguous legacy open shifts
      // fail closed here without preventing the employee from logging in.
      const openAttendance = openAttendanceContext.attendance
      if (!openAttendance) return false
      const openContext = String(openAttendance.supportTransferId || '').trim()
        ? openSupportTransferContextFor(state, record.employeeId)
        : null
      if (openContext) {
        return sameIdentifier(openContext.attendance.id, openAttendance.id)
          && sameIdentifier(openContext.attendance.storeId, storeId)
          && sameIdentifier(openContext.transfer.id, record.id)
      }
      return sameIdentifier(openAttendance.storeId, record.toStoreId)
        && isSupportTransferActiveAt(record, projectionTimestamp)
    })""",
        'manager projection collision-safe open attendance context',
    )

    text = replace_once(
        text,
        """const openEmployeeAttendanceFor = (state, employeeId) => {
  const identifier = String(employeeId || '').trim()
  if (!identifier) return null
  const openAttendance = (Array.isArray(state?.attendance) ? state.attendance : []).filter((record) => (
    !record?.deletedAt
    && !record?.checkOut
    && !record?.checkOutAt
    && belongsToEmployee(record, identifier)
  ))
  if (openAttendance.length > 1) {
    throw new ApiError(
      409,
      'OPEN_EMPLOYEE_ATTENDANCE_COLLISION',
      'Nhân viên đang có nhiều ca cùng mở; cần đối soát chấm công trước khi tiếp tục.',
      {
        employeeId: normalizeIdentifierKey(identifier),
        attendanceIds: openAttendance.map((record) => String(record.id || '')).filter(Boolean),
      },
    )
  }
  return openAttendance[0] || null
}""",
        """const openEmployeeAttendanceContextFor = (state, employeeId) => {
  const identifier = String(employeeId || '').trim()
  if (!identifier) {
    return { attendance: null, hasOpenAttendance: false, ambiguous: false }
  }
  const openAttendance = (Array.isArray(state?.attendance) ? state.attendance : []).filter((record) => (
    !record?.deletedAt
    && !record?.checkOut
    && !record?.checkOutAt
    && belongsToEmployee(record, identifier)
  ))
  return {
    attendance: openAttendance.length === 1 ? openAttendance[0] : null,
    hasOpenAttendance: openAttendance.length > 0,
    ambiguous: openAttendance.length > 1,
  }
}""",
        'replace throwing open-attendance resolver with collision-safe context',
    )

    text = replace_once(
        text,
        """  const openAttendance = openEmployeeAttendanceFor(state, user.employee_id)
  if (openAttendance) {
    const openContext = String(openAttendance.supportTransferId || '').trim()
      ? openSupportTransferContextFor(state, user.employee_id)
      : null
    if (openContext && sameIdentifier(openContext.attendance.id, openAttendance.id)) {
      const homeStoreId = String(
        openContext.attendance.homeStoreId
        || openContext.transfer.fromStoreId
        || user.home_store_id
        || user.store_id
        || '',
      ).trim()
      return {
        ...user,
        home_store_id: homeStoreId || null,
        store_id: String(openContext.attendance.storeId || openContext.transfer.toStoreId),
        active_transfer_id: String(openContext.transfer.id || ''),
      }
    }

    const attendanceStoreId = String(openAttendance.storeId || user.store_id || '').trim()
    const homeStoreId = String(openAttendance.homeStoreId || user.home_store_id || '').trim()
    return {
      ...user,
      ...(homeStoreId ? { home_store_id: homeStoreId } : {}),
      store_id: attendanceStoreId || user.store_id || null,
      active_transfer_id: null,
    }
  }""",
        """  const openAttendanceContext = openEmployeeAttendanceContextFor(state, user.employee_id)
  if (openAttendanceContext.hasOpenAttendance) {
    const openAttendance = openAttendanceContext.attendance
    if (!openAttendance) {
      // Legacy duplicate/case-colliding open records must not move the employee
      // to a newly active transfer. Keep the selected role store and allow login
      // so an authorized operator can repair the ambiguous attendance records.
      return {
        ...user,
        active_transfer_id: null,
      }
    }

    const openContext = String(openAttendance.supportTransferId || '').trim()
      ? openSupportTransferContextFor(state, user.employee_id)
      : null
    if (openContext && sameIdentifier(openContext.attendance.id, openAttendance.id)) {
      const homeStoreId = String(
        openContext.attendance.homeStoreId
        || openContext.transfer.fromStoreId
        || user.home_store_id
        || user.store_id
        || '',
      ).trim()
      return {
        ...user,
        home_store_id: homeStoreId || null,
        store_id: String(openContext.attendance.storeId || openContext.transfer.toStoreId),
        active_transfer_id: String(openContext.transfer.id || ''),
      }
    }

    const attendanceStoreId = String(openAttendance.storeId || user.store_id || '').trim()
    const homeStoreId = String(openAttendance.homeStoreId || user.home_store_id || '').trim()
    return {
      ...user,
      ...(homeStoreId ? { home_store_id: homeStoreId } : {}),
      store_id: attendanceStoreId || user.store_id || null,
      active_transfer_id: null,
    }
  }""",
        'employee effective store collision-safe precedence',
    )

    path.write_text(text, encoding='utf-8')
    print('Made open-attendance precedence collision-safe without weakening transfer isolation.')


if __name__ == '__main__':
    try:
        main()
    except PatchError as error:
        raise SystemExit(f'ERROR: {error}') from error
