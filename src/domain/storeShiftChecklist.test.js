import { describe, expect, it } from 'vitest'
import {
  activeStoreChecklistTasks,
  canCheckoutStoreShift,
  deactivateStoreChecklistTask,
  DEFAULT_STORE_CHECKLIST_TASK_SEEDS,
  resolveStoreChecklistTemplate,
  STORE_CHECKLIST_CHECKOUT_CODE,
  STORE_CHECKLIST_POLICY_VERSION,
  STORE_CHECKLIST_TEMPLATES,
  validateStoreChecklistCheckout,
} from './storeShiftChecklist'

const workbookDescriptions = {
  morning: [
    'Bật đèn, quạt, mở nhạc',
    'Chào khách vào, tư vấn, cảm ơn',
    'Nhập đầy đủ thông tin đơn hàng',
    'Quét nhà, lau nhà',
    'Dọn dẹp nhà vệ sinh',
    'Gom quần áo/móc rơi dưới sàn',
    'Kiểm tra quần áo/ móc trên sào',
    'Gom móc trống trên sào',
    'Treo đồ lên sào',
    'Lọc đồ thành 3 loại: chạy sale, từ thiện, hủy',
    'Chụp hình gửi group zalo KH, tương tác với khách',
    'Phát thẻ tích điểm',
    'Add KH vào group zalo',
    'Cho KH đánh giá gg map',
    'Thanh toán đúng vị trí quy định',
    'Kiểm tra kỹ giao dịch chuyển khoản (màn hình phải hiện “Giao dịch thành công”)',
    'Nhắc khách chính sách “không đổi trả” khi thanh toán',
    'Trông coi xe cho khách',
    'Luôn mang tiền bên mình, phải nhắc khách bảo quản tư trang',
    'Tổng hợp doanh thu => nhập phần mềm => gửi báo cáo zalo => bấm kết ca',
  ],
  afternoon: [
    'Bật đèn, quạt, mở nhạc',
    'Chào khách vào, tư vấn, cảm ơn',
    'Nhập đầy đủ thông tin đơn hàng',
    'Dọn dẹp nhà vệ sinh',
    'Gom quần áo/móc rơi dưới sàn',
    'Kiểm tra quần áo/ móc trên sào',
    'Gom móc trống trên sào',
    'Treo đồ lên sào',
    'Lọc đồ thành 3 loại: chạy sale, từ thiện, hủy',
    'Chụp hình gửi group zalo KH, tương tác với khách',
    'Phát thẻ tích điểm',
    'Add KH vào group zalo',
    'Cho KH đánh giá gg map',
    'Thanh toán đúng vị trí quy định',
    'Kiểm tra kỹ giao dịch chuyển khoản (màn hình phải hiện “Giao dịch thành công”)',
    'Nhắc khách chính sách “không đổi trả” khi thanh toán',
    'Trông coi xe cho khách',
    'Luôn mang tiền bên mình, phải nhắc khách bảo quản tư trang',
    'Tổng hợp doanh thu => nhập phần mềm => gửi báo cáo zalo => bấm kết ca',
  ],
  night: [
    'Bật đèn, quạt, mở nhạc',
    'Chào khách vào, tư vấn, cảm ơn',
    'Nhập đầy đủ thông tin đơn hàng',
    'Dọn dẹp nhà vệ sinh',
    'Gom quần áo/móc rơi dưới sàn',
    'Kiểm tra quần áo/ móc trên sào',
    'Gom móc trống trên sào',
    'Treo đồ lên sào',
    'Lọc đồ thành 3 loại: chạy sale, từ thiện, hủy',
    'Phát thẻ tích điểm',
    'Add KH vào group zalo',
    'Cho KH đánh giá gg map',
    'Thanh toán đúng vị trí quy định',
    'Tổng hợp doanh thu => nhập phần mềm => gửi báo cáo zalo => bấm kết ca => đóng cửa',
    'Đổ rác',
    'Kiểm tra kỹ giao dịch chuyển khoản (màn hình phải hiện “Giao dịch thành công”)',
    'Nhắc khách chính sách “không đổi trả” khi thanh toán',
    'Trông coi xe cho khách',
    'Luôn mang tiền bên mình, phải nhắc khách bảo quản tư trang',
    'Tắt cầu dao/ loa/ nhạc/ điện/ nước => đóng cửa, bảo quản chìa khóa',
  ],
}

describe('mandatory store checklist templates', () => {
  it('preserves the exact workbook task lists and shift intervals', () => {
    expect(STORE_CHECKLIST_TEMPLATES.map(({ key, start, end, tasks }) => ({
      key,
      start,
      end,
      descriptions: tasks.map((task) => task.description),
    }))).toEqual([
      { key: 'morning', start: '08:00', end: '12:00', descriptions: workbookDescriptions.morning },
      { key: 'afternoon', start: '12:00', end: '17:00', descriptions: workbookDescriptions.afternoon },
      { key: 'night', start: '17:00', end: '21:00', descriptions: workbookDescriptions.night },
    ])
    expect(STORE_CHECKLIST_TEMPLATES.map((template) => template.tasks.length)).toEqual([20, 19, 20])
    expect(workbookDescriptions.afternoon).not.toContain('Quét nhà, lau nhà')
    expect(workbookDescriptions.night).toContain('Đổ rác')
  })

  it('creates unique deterministic active versioned seed records', () => {
    expect(DEFAULT_STORE_CHECKLIST_TASK_SEEDS).toHaveLength(59)
    expect(new Set(DEFAULT_STORE_CHECKLIST_TASK_SEEDS.map((task) => task.id)).size).toBe(59)
    expect(DEFAULT_STORE_CHECKLIST_TASK_SEEDS[0]).toEqual(expect.objectContaining({
      id: 'STORE-CHECKLIST-MORNING-01',
      templateId: 'STORE-CHECKLIST-MORNING',
      position: 1,
      required: true,
      active: true,
      version: STORE_CHECKLIST_POLICY_VERSION,
      deletedAt: null,
    }))
    expect(DEFAULT_STORE_CHECKLIST_TASK_SEEDS.at(-1).id).toBe('STORE-CHECKLIST-NIGHT-20')
  })
})

describe('store checklist template resolution', () => {
  it.each([
    [{ start: '8:00', end: '12:00' }, 'morning'],
    [{ shiftStart: '12:00', shiftEnd: '17:00' }, 'afternoon'],
    [{ time: '17:00 – 21:00' }, 'night'],
    ['Ca sáng (08:00-12:00)', 'morning'],
  ])('resolves exact workbook intervals from %j', (shift, key) => {
    expect(resolveStoreChecklistTemplate(shift)?.key).toBe(key)
  })

  it.each([
    ['ca1', 'morning'],
    ['Ca 1', 'morning'],
    ['ca_sang', 'morning'],
    ['SHIFT-MORNING', 'morning'],
    ['ca2', 'afternoon'],
    ['Ca Chiều', 'afternoon'],
    ['SHIFT-AFTERNOON', 'afternoon'],
    ['ca3', 'night'],
    ['Ca Tối', 'night'],
    ['evening', 'night'],
  ])('resolves legacy name %s', (name, key) => {
    expect(resolveStoreChecklistTemplate(name)?.key).toBe(key)
  })

  it('uses a legacy name when old shift hours differ from the workbook policy', () => {
    expect(resolveStoreChecklistTemplate({ id: 'ca1', name: 'Ca 1', start: '07:00', end: '12:00' })?.key).toBe('morning')
    expect(resolveStoreChecklistTemplate({ id: 'ca3', name: 'Ca 3', start: '17:00', end: '23:00' })?.key).toBe('night')
  })

  it('does not misclassify near-boundary or unnamed overnight shifts', () => {
    expect(resolveStoreChecklistTemplate({ start: '08:01', end: '12:00' })).toBeNull()
    expect(resolveStoreChecklistTemplate({ start: '08:00', end: '11:59' })).toBeNull()
    expect(resolveStoreChecklistTemplate({ start: '21:00', end: '05:00' })).toBeNull()
    expect(resolveStoreChecklistTemplate('Ca sáng mới')).toBeNull()
  })

  it('prefers an exact canonical interval over a conflicting legacy label', () => {
    expect(resolveStoreChecklistTemplate({ name: 'Ca 1', start: '12:00', end: '17:00' })?.key).toBe('afternoon')
  })

  it('ignores a newer inactive template version', () => {
    const morning = STORE_CHECKLIST_TEMPLATES[0]
    expect(resolveStoreChecklistTemplate('morning', [
      morning,
      { ...morning, version: 2, active: false, deletedAt: '2026-08-26T00:00:00.000Z' },
    ])).toBeNull()
  })
})

describe('store checklist checkout policy', () => {
  const morning = STORE_CHECKLIST_TEMPLATES[0]
  const morningIds = morning.tasks.map((task) => task.id)

  it('allows checkout only when every active task is ticked', () => {
    const ready = validateStoreChecklistCheckout({ shift: 'morning', checkedTaskIds: morningIds })
    expect(ready).toMatchObject({
      allowed: true,
      canCheckout: true,
      code: STORE_CHECKLIST_CHECKOUT_CODE.READY,
      activeTaskCount: 20,
      completedTaskCount: 20,
      missingTaskIds: [],
    })
    expect(canCheckoutStoreShift({ shift: 'morning', checkedTaskIds: morningIds })).toBe(true)
  })

  it('blocks checkout for one missing task even when a reason is supplied', () => {
    const result = validateStoreChecklistCheckout({
      shift: 'morning',
      checkedTaskIds: morningIds.slice(0, -1),
      reason: 'Khách đông nên chưa hoàn thành',
    })
    expect(result).toMatchObject({
      allowed: false,
      code: STORE_CHECKLIST_CHECKOUT_CODE.INCOMPLETE,
      activeTaskCount: 20,
      completedTaskCount: 19,
      missingTaskIds: ['STORE-CHECKLIST-MORNING-20'],
    })
    expect(canCheckoutStoreShift({ shift: 'morning', reason: 'Có lý do' })).toBe(false)
  })

  it('accepts explicit checked completion records but not unchecked records', () => {
    const completionRecords = morning.tasks.map((task, index) => ({
      taskId: task.id,
      checked: index !== morning.tasks.length - 1,
    }))
    expect(validateStoreChecklistCheckout({ shift: morning, completionRecords }).missingTaskIds)
      .toEqual(['STORE-CHECKLIST-MORNING-20'])
    completionRecords.at(-1).checked = true
    expect(validateStoreChecklistCheckout({ shift: morning, completionRecords }).allowed).toBe(true)
  })

  it('requires only the latest active task versions for the resolved template', () => {
    const first = morning.tasks[0]
    const second = morning.tasks[1]
    const records = [
      first,
      second,
      { ...second, version: 2, active: false, deletedAt: '2026-08-26T01:00:00.000Z' },
      ...STORE_CHECKLIST_TEMPLATES[1].tasks,
    ]
    expect(activeStoreChecklistTasks(morning, records).map((task) => task.id)).toEqual([first.id])
    expect(validateStoreChecklistCheckout({
      shift: morning,
      taskRecords: records,
      checkedTaskIds: [first.id],
    })).toMatchObject({ allowed: true, activeTaskCount: 1, completedTaskCount: 1 })
  })

  it('allows a deliberately empty active policy but fails closed for missing templates or malformed tasks', () => {
    expect(validateStoreChecklistCheckout({ shift: 'morning', taskRecords: [] })).toMatchObject({
      allowed: true,
      activeTaskCount: 0,
    })
    expect(validateStoreChecklistCheckout({ shift: { start: '21:00', end: '05:00' } })).toMatchObject({
      allowed: false,
      code: STORE_CHECKLIST_CHECKOUT_CODE.TEMPLATE_NOT_FOUND,
    })
    expect(validateStoreChecklistCheckout({
      shift: 'morning',
      taskRecords: [{ templateId: morning.id, active: true, description: 'Thiếu ID' }],
    })).toMatchObject({
      allowed: false,
      code: STORE_CHECKLIST_CHECKOUT_CODE.INVALID_CONFIGURATION,
    })
  })
})

describe('store checklist task lifecycle', () => {
  it('deactivates instead of hard-deleting and records an auditable version change', () => {
    const original = DEFAULT_STORE_CHECKLIST_TASK_SEEDS[0]
    const deactivated = deactivateStoreChecklistTask(original, {
      at: '2026-08-26T09:30:00+07:00',
      by: { id: 'ADMIN-01' },
      reason: 'Ngừng áp dụng',
    })

    expect(deactivated).toMatchObject({
      id: original.id,
      description: original.description,
      active: false,
      version: 2,
      deletedAt: '2026-08-26T02:30:00.000Z',
      deletedBy: { id: 'ADMIN-01' },
      deleteReason: 'Ngừng áp dụng',
    })
    expect(original).toMatchObject({ active: true, version: 1, deletedAt: null })
    expect(deactivateStoreChecklistTask(deactivated, { at: '2026-08-27T00:00:00Z' })).toBe(deactivated)
  })

  it('rejects an unauditable deactivation', () => {
    expect(() => deactivateStoreChecklistTask({ id: '' }, { at: '2026-08-26T00:00:00Z' })).toThrow(TypeError)
    expect(() => deactivateStoreChecklistTask({ id: 'TASK-1', active: true }, { at: 'not-a-date' })).toThrow(TypeError)
  })
})
