import { uid } from '../utils'
import { employeeProfileKey } from '../domain/employeeAccountIdentity'

// Load this mutation only when requested; keep the initial application bundle
// within its budget while using the same policy for API and demo mode.
export const deleteEmployeeProfile = async ({
  id, previous, actorRole, remote, runRemoteDomainCommand, setState, notify,
  actorSnapshot, countStoreEmployees,
}) => {
  if (!previous || previous.deletedAt) return { ok: false, message: 'Không tìm thấy hồ sơ nhân viên.' }
  if (actorRole !== 'admin' && (
    actorRole !== 'business_support' || !['store', 'store_manager'].includes(previous.unit)
  )) return { ok: false, message: 'Hỗ trợ KD chỉ được xóa nhân viên cửa hàng và Quản lý cửa hàng.' }
  if (actorRole !== 'admin' && ['đã nghỉ việc', 'inactive'].includes(String(previous.status || '').trim().toLowerCase())) {
    return { ok: false, message: 'Chỉ Admin được xử lý nhân viên đã nghỉ việc.' }
  }
  if (remote) {
    try {
      const result = await runRemoteDomainCommand('employee.delete', { employeeId: id })
      notify('Đã xóa nhân viên.', 'info')
      return { ok: true, employee: result.employee }
    } catch (error) {
      notify(error.message || 'Không thể vô hiệu hóa tài khoản nhân viên.', 'info')
      return { ok: false, message: error.message }
    }
  }
  setState((current) => {
    const employees = current.employees.filter((employee) => employeeProfileKey(employee) !== String(id))
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(current.session)
    return {
      ...current,
      employees,
      stores: countStoreEmployees(current.stores, employees),
      schedule: current.schedule.filter((item) => item.employeeId !== id),
      deletedEmployees: [{ ...previous, password: undefined, deletedAt: timestamp, deletedBy: actor }, ...current.deletedEmployees],
      auditLogs: [{ id: uid('AUD'), entity: 'employee', entityId: id, action: 'delete', before: { ...previous, password: undefined }, after: null, actor, createdAt: timestamp }, ...current.auditLogs],
    }
  })
  notify('Đã xóa nhân viên.', 'info')
  return { ok: true, employee: previous }
}
