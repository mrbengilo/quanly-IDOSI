from __future__ import annotations

import argparse
from pathlib import Path


BASE_SHA = "70f7ddfa212696e8b5a91a3863a9609ee5bc9469"


class PatchError(RuntimeError):
    pass


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise PatchError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def patch_worker(text: str) -> str:
    text = replace_once(
        text,
        """    const projectionTimestamp = new Date().toISOString()
    const inboundTransfers = filterArray(state, 'supportTransfers', (record) => {
      if (!sameIdentifier(record.toStoreId, storeId)) return false
      if (isSupportTransferActiveAt(record, projectionTimestamp)) return true
      const openContext = openSupportTransferContextFor(state, record.employeeId)
      return Boolean(openContext && sameIdentifier(openContext.transfer.id, record.id))
    })""",
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
        "destination transfer projection honors open attendance",
    )

    text = replace_once(
        text,
        """const openSupportTransferContextFor = (state, employeeId) => {""",
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
}

const openSupportTransferContextFor = (state, employeeId) => {""",
        "add unique open employee attendance resolver",
    )

    text = replace_once(
        text,
        """const resolveEffectiveEmployeeStore = async (db, user, now, preloadedState = null) => {
  if (user?.role !== 'employee' || !user?.employee_id) return user
  const state = preloadedState == null
    ? parseStoredJson((await loadState(db, 'global'))?.value_json, {})
    : preloadedState
  const openContext = openSupportTransferContextFor(state, user.employee_id)
  const transfer = openContext?.transfer || activeSupportTransferFor(state, user.employee_id, now)
  if (!transfer?.toStoreId) return user
  const homeStoreId = String(
    openContext?.attendance?.homeStoreId
    || transfer.fromStoreId
    || user.home_store_id
    || user.store_id
    || '',
  ).trim()
  return {
    ...user,
    home_store_id: homeStoreId || null,
    store_id: String(openContext?.attendance?.storeId || transfer.toStoreId),
    active_transfer_id: String(transfer.id || ''),
  }
}""",
        """const resolveEffectiveEmployeeStore = async (db, user, now, preloadedState = null) => {
  if (user?.role !== 'employee' || !user?.employee_id) return user
  const state = preloadedState == null
    ? parseStoredJson((await loadState(db, 'global'))?.value_json, {})
    : preloadedState

  // Operational precedence is intentionally strict:
  //   open attendance > active support-transfer window > home assignment.
  // This prevents a scheduled transfer from moving the UI or authorization
  // context away from a shift that the employee has not checked out yet.
  const openAttendance = openEmployeeAttendanceFor(state, user.employee_id)
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
  }

  const transfer = activeSupportTransferFor(state, user.employee_id, now)
  if (!transfer?.toStoreId) return user
  const homeStoreId = String(
    transfer.fromStoreId
    || user.home_store_id
    || user.store_id
    || '',
  ).trim()
  return {
    ...user,
    home_store_id: homeStoreId || null,
    store_id: String(transfer.toStoreId),
    active_transfer_id: String(transfer.id || ''),
  }
}""",
        "effective employee store honors any open attendance",
    )
    return text


def patch_worker_test(text: str) -> str:
    start_marker = "  it('does not complete an active transfer when closing a pre-existing home attendance', async () => {"
    start = text.find(start_marker)
    if start < 0:
        raise PatchError("home attendance transfer precedence test not found")
    end = text.find("\n  it(", start + len(start_marker))
    if end < 0:
        raise PatchError("next test boundary after home attendance precedence test not found")
    section = text[start:end]

    section = replace_once(
        section,
        "      const { env, employeeAuthorization } = await setupSupportTransferRuntime({",
        "      const { env, employeeAuthorization, managerAuthorization } = await setupSupportTransferRuntime({",
        "expose destination manager session in precedence test",
    )

    section = replace_once(
        section,
        """      })
      const blockedDestinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {""",
        """      })

      const stateBeforeHomeCheckoutResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      expect(stateBeforeHomeCheckoutResponse.status).toBe(200)
      const stateBeforeHomeCheckout = await stateBeforeHomeCheckoutResponse.json()
      expect(stateBeforeHomeCheckout).toMatchObject({
        user: { storeId: 'S01' },
        state: { activeStoreId: 'S01', activeAttendanceId: 'ATT-HOME-OPEN' },
      })
      expect(stateBeforeHomeCheckout.user).not.toHaveProperty('activeTransferId')

      const destinationBeforeHomeCheckout = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: managerAuthorization,
      }), env)
      expect(destinationBeforeHomeCheckout.status).toBe(200)
      expect((await destinationBeforeHomeCheckout.json()).state.employees.some(({ id }) => id === 'E01')).toBe(false)

      const blockedDestinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {""",
        "assert home context before checkout",
    )

    section = replace_once(
        section,
        """      expect(unchangedTransfer).toMatchObject({ status: 'Đã duyệt' })
      expect(unchangedTransfer).not.toHaveProperty('completedAt')

      const destinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {""",
        """      expect(unchangedTransfer).toMatchObject({ status: 'Đã duyệt' })
      expect(unchangedTransfer).not.toHaveProperty('completedAt')

      const stateAfterHomeCheckoutResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      expect(stateAfterHomeCheckoutResponse.status).toBe(200)
      expect(await stateAfterHomeCheckoutResponse.json()).toMatchObject({
        user: { storeId: 'S02', homeStoreId: 'S01', activeTransferId: transfer.id },
        state: { activeStoreId: 'S02', activeAttendanceId: null },
      })

      const destinationAfterHomeCheckout = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: managerAuthorization,
      }), env)
      expect(destinationAfterHomeCheckout.status).toBe(200)
      expect((await destinationAfterHomeCheckout.json()).state.employees.some(({ id }) => id === 'E01')).toBe(true)

      const destinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {""",
        "assert destination context only after home checkout",
    )
    return text[:start] + section + text[end:]


def patch_readme(text: str) -> str:
    return replace_once(
        text,
        """  Nhân viên cửa hàng đang trong thời gian điều chuyển có thể điểm danh trực tiếp
  tại cửa hàng nhận mà không cần lịch phân ca; server tạo snapshot ca hỗ trợ từ
  giờ hoạt động cửa hàng. Ca hỗ trợ đang mở tiếp tục giữ session tại cửa hàng nhận
  dù phiếu đã hết giờ; sau khi kết ca hỗ trợ, session tự trở lại cửa hàng gốc.""",
        """  Nhân viên cửa hàng đang trong thời gian điều chuyển có thể điểm danh trực tiếp
  tại cửa hàng nhận mà không cần lịch phân ca; server tạo snapshot ca hỗ trợ từ
  giờ hoạt động cửa hàng. Nếu nhân viên vẫn còn một ca đang mở tại cửa hàng hiện
  tại, ca đó tiếp tục khóa session và lịch điều chuyển không được chuyển giao diện
  hoặc quyền thao tác sang cửa hàng nhận. Chỉ sau khi kết ca, nếu phiếu điều chuyển
  vẫn còn hiệu lực, session mới chuyển sang cửa hàng nhận để nhân viên điểm danh.
  Ca hỗ trợ đã mở tiếp tục giữ session tại cửa hàng nhận dù phiếu đã hết giờ; sau
  khi kết ca hỗ trợ, session tự trở lại cửa hàng gốc.""",
        "document open-attendance precedence over scheduled transfer",
    )


def patch(root: Path, write: bool) -> None:
    targets = {
        Path('server/worker.js'): patch_worker,
        Path('server/worker.test.js'): patch_worker_test,
        Path('server/README.md'): patch_readme,
    }
    updates: dict[Path, str] = {}
    for relative, transform in targets.items():
        path = root / relative
        if not path.exists():
            raise PatchError(f'missing source file: {relative}')
        original = path.read_text(encoding='utf-8')
        updated = transform(original)
        if updated == original:
            raise PatchError(f'no changes produced for {relative}')
        updates[path] = updated

    if not write:
        print(
            f'All reviewed anchors match base {BASE_SHA}. '
            f'{len(updates)} files would be updated.'
        )
        return

    for path, content in updates.items():
        path.write_text(content, encoding='utf-8')
    print(f'Updated {len(updates)} files.')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='.')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    if args.check == args.write:
        parser.error('choose exactly one of --check or --write')
    patch(Path(args.root).resolve(), write=args.write)


if __name__ == '__main__':
    try:
        main()
    except PatchError as error:
        raise SystemExit(f'ERROR: {error}') from error
