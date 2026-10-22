// Loaded only when the user submits a swap, keeping the initial bundle bounded.
export const executeScheduleSwap = async (role, remoteEnabled, command, payload, idempotencyKey) => {
  if (!['admin', 'store_manager', 'business_support'].includes(role)) {
    return { ok: false, code: 'ROLE_FORBIDDEN', message: 'Tài khoản không có quyền đổi ca.' }
  }
  if (!remoteEnabled) {
    return { ok: false, code: 'REMOTE_REQUIRED', message: 'Đổi ca cần kết nối máy chủ để kiểm tra khóa lương và lưu lịch.' }
  }
  try {
    const result = await command('schedule.swap', payload, idempotencyKey, (remote) => {
      const scope = () => [remote.user?.id, remote.user?.role, remote.projection, remote.projectionStoreId, remote.projectionScreen, remote.projectionPeriod].join(':')
      const initialScope = scope()
      return (response) => Number(response.version) >= Number(remote.version) && initialScope === scope()
    })
    return { ok: true, assignments: result.assignments }
  } catch (error) {
    return { ok: false, code: error.code, message: error.code === 'VERSION_CONFLICT'
      ? 'Lịch phân ca đã thay đổi, vui lòng kiểm tra lại.'
      : error.message || 'Không thể đổi ca. Vui lòng thử lại.' }
  }
}

// Existing replace-day behavior, deferred with the schedule editor to preserve the entry budget.
export const executeScheduleDayReplacement = async (context, assignments = [], details = {}) => {
  const { state, apiRef, runRemoteDomainCommand, notify, updateCollection, today, actorSnapshot, uid } = context

  const date = details.date || today()
  const storeId = details.storeId || state.activeStoreId || state.session?.storeId
  if (!storeId || !date || !Array.isArray(assignments)) {
    return { ok: false, message: 'Dữ liệu lịch phân ca không hợp lệ.' }
  }
  if (apiRef.current.enabled) {
    try {
      const result = await runRemoteDomainCommand('schedule.replace_day', {
        storeId,
        date,
        assignments: assignments.map((item) => ({
          id: item.id,
          employeeId: item.employeeId,
          shiftIds: item.shiftIds,
          note: item.note || '',
        })),
      })
      notify('Đã cập nhật lịch phân ca.')
      return { ok: true, assignments: result.assignments || [] }
    } catch (error) {
      notify(error.message || 'Không thể cập nhật lịch phân ca.', 'info')
      return { ok: false, message: error.message }
    }
  }
  const { buildLocalScheduleDayReplacement } = await import('../domain/supportScheduling')
  const { schedule: next, assignments: nextDay, conflict } = buildLocalScheduleDayReplacement(state, {
    assignments,
    storeId,
    date,
    actor: actorSnapshot(state.session),
    createId: () => uid('SCH'),
  })
  if (conflict) {
    const message = conflict.code === 'SCHEDULE_TIME_OVERLAP'
      ? 'Nhân viên đã có ca trùng thời gian trong lịch hiện có.'
      : conflict.code === 'SUPPORT_SCHEDULE_OUTSIDE_WINDOW'
        ? 'Ca hỗ trợ nằm ngoài khoảng ngày điều chuyển đã duyệt.'
        : 'Khung giờ ca làm việc không hợp lệ.'
    notify(message, 'info')
    return { ok: false, code: conflict.code, message }
  }
  updateCollection('schedule', () => next)
  notify('Đã cập nhật lịch phân ca.')
  return { ok: true, assignments: nextDay }
}
