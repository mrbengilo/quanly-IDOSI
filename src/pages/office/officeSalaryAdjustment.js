import { parseMoneyInput } from '../../utils'

export const officeSalaryAdjustmentPayload = ({ form = {}, type = 'Thưởng', idempotencyKey } = {}) => ({
  employeeId: form.employeeId,
  period: String(form.date || '').slice(0, 7),
  type: type === 'Phụ cấp' ? 'Phụ cấp khác' : 'Thưởng khác',
  amount: parseMoneyInput(form.amount),
  note: String(form.content || '').trim(),
  idempotencyKey: idempotencyKey || `office-salary-adjustment:${form.employeeId}:${form.date}:${Date.now()}`,
})

export const submitOfficeSalaryAdjustment = async ({ addSalaryAdjustment, form, type, idempotencyKey } = {}) => {
  if (typeof addSalaryAdjustment !== 'function') {
    return { ok: false, message: 'Chức năng thưởng và phụ cấp đang được kết nối.' }
  }
  return addSalaryAdjustment(officeSalaryAdjustmentPayload({ form, type, idempotencyKey }))
}
