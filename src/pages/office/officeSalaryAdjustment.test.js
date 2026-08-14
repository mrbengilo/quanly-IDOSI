import { describe, expect, it, vi } from 'vitest'
import { submitOfficeSalaryAdjustment } from './officeSalaryAdjustment'

describe('Office salary adjustment submission', () => {
  it('maps the Office reward to the salary domain and returns a failed save to the modal', async () => {
    const addSalaryAdjustment = vi.fn().mockResolvedValue({ ok: false, message: 'Kỳ lương đã khóa.' })
    const result = await submitOfficeSalaryAdjustment({
      addSalaryAdjustment,
      type: 'Thưởng',
      idempotencyKey: 'office-adjustment-test',
      form: {
        employeeId: 'VP001',
        date: '2026-08-14',
        amount: '500,000',
        content: '  Hoàn thành tốt  ',
      },
    })

    expect(addSalaryAdjustment).toHaveBeenCalledWith({
      employeeId: 'VP001',
      period: '2026-08',
      type: 'Thưởng khác',
      amount: 500_000,
      note: 'Hoàn thành tốt',
      idempotencyKey: 'office-adjustment-test',
    })
    expect(result).toEqual({ ok: false, message: 'Kỳ lương đã khóa.' })
  })

  it('maps an Office allowance to the accepted backend type', async () => {
    const addSalaryAdjustment = vi.fn().mockResolvedValue({ ok: true })
    await submitOfficeSalaryAdjustment({
      addSalaryAdjustment,
      type: 'Phụ cấp',
      idempotencyKey: 'office-allowance-test',
      form: { employeeId: 'VP002', date: '2026-09-01', amount: '200,000', content: 'Gửi xe' },
    })
    expect(addSalaryAdjustment).toHaveBeenCalledWith(expect.objectContaining({ type: 'Phụ cấp khác' }))
  })
})
