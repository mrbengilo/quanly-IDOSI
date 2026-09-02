import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdminSupportAssignmentPage,
  AdminSupportWorkPage,
  SupportAssignedWorkPage,
  SupportWorkInboxPage,
} from './SupportWorkPages'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const supportProfile = { id: 'HTKD-001', code: 'HTKD-001', unit: 'business_support', name: 'Nguyễn Hỗ Trợ' }
const officeProfile = { id: 'VP-001', code: 'VP-001', unit: 'office', name: 'Nguyễn Văn Phòng' }
const supportFixedTask = {
  id: 'work-catalog:business_support:fixed_task:report-check',
  code: 'business-support.fixed.report-check',
  kind: 'FIXED_TASK',
  targetGroup: 'business_support',
  name: 'Kiểm tra báo cáo',
  amountVnd: 0,
  active: true,
  sortOrder: 1,
  version: 3,
}
const supportRewardTask = {
  id: 'work-catalog:business_support:reward_task:store-review',
  code: 'business-support.reward.store-review',
  kind: 'REWARD_TASK',
  targetGroup: 'business_support',
  name: 'Đánh giá trưng bày cửa hàng',
  description: 'Mô tả nội bộ không hiển thị trong danh sách nhân viên',
  amountVnd: 75_000,
  active: true,
  sortOrder: 2,
  version: 4,
}
const officeFixedTask = {
  id: 'work-catalog:office:fixed_task:document-reconcile',
  code: 'office.fixed.document-reconcile',
  kind: 'FIXED_TASK',
  targetGroup: 'office',
  name: 'Đối chiếu hồ sơ văn phòng',
  amountVnd: 0,
  active: true,
  sortOrder: 1,
  version: 2,
}
const officeRewardTask = {
  id: 'work-catalog:office:reward_task:on-time',
  code: 'office.reward.on-time',
  kind: 'REWARD_TASK',
  targetGroup: 'office',
  name: 'Đi làm đúng giờ',
  amountVnd: 3_000,
  active: true,
  sortOrder: 2,
  version: 5,
}

describe('support work screens', () => {
  beforeEach(() => {
    mocked.app = {
      session: { role: 'admin', name: 'Admin' },
      employees: [supportProfile, officeProfile],
      workCatalogItems: [supportFixedTask, supportRewardTask, officeFixedTask, officeRewardTask],
      attendance: [],
      workCatalogProgress: [],
      compensationEntries: [],
      violations: [],
      tasks: [],
      supportWorkAssignments: [],
      assignSupportWork: vi.fn().mockResolvedValue({ ok: true }),
      updateSupportWork: vi.fn().mockResolvedValue({ ok: true }),
      setWorkReward: vi.fn().mockResolvedValue({ ok: true }),
      setWorkRewards: vi.fn().mockResolvedValue({ ok: true, rewards: [], entries: [], teamClaims: [] }),
      createViolationBatch: vi.fn().mockResolvedValue({ ok: true, createdCount: 1, existingCount: 0 }),
      voidViolation: vi.fn().mockResolvedValue({ ok: true }),
      updateWorkCatalogItem: vi.fn().mockResolvedValue({ ok: true }),
      createWorkCatalogItem: vi.fn().mockResolvedValue({ ok: true }),
      deleteWorkCatalogItem: vi.fn().mockResolvedValue({ ok: true }),
      restoreWorkCatalogItem: vi.fn().mockResolvedValue({ ok: true }),
      stores: [],
      shiftDefinitions: [],
      apiStatus: 'connected',
      notify: vi.fn(),
    }
  })

  afterEach(cleanup)

  it('shows only the reward and violation tabs while assignment stays on its dedicated page', () => {
    render(<MemoryRouter><AdminSupportWorkPage /></MemoryRouter>)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Thưởng công việc', 'Vi phạm'])
    expect(screen.getByRole('tab', { name: 'Thưởng công việc' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('Tạo danh sách công việc')).toBeNull()
    expect(screen.queryByText('Lịch sử giao việc')).toBeNull()
    expect(screen.queryByLabelText('Nhân viên nhận việc')).toBeNull()
  })

  it('filters HTKD reward history by date and employee and shows the filtered total', () => {
    mocked.app.attendance = [{
      id: 'ATT-CLOSED', employeeId: 'HTKD-001', employeeName: 'Nguyễn Hỗ Trợ', unit: 'business_support', workDate: '2026-08-28',
      shiftId: 'afternoon', shiftName: 'Ca chiều', shiftStart: '13:00', shiftEnd: '17:30', checkOutAt: '2026-08-28T10:30:00Z',
      checklistSnapshot: { tasks: [supportRewardTask] },
    }]
    mocked.app.workCatalogProgress = [{
      attendanceId: 'ATT-CLOSED', catalogItemId: supportRewardTask.id, checked: true, status: 'CLAIMED', completedAt: '2026-08-28T10:00:00Z',
    }]
    render(<MemoryRouter><AdminSupportWorkPage /></MemoryRouter>)

    expect(screen.getByLabelText('Ngày nhận thưởng')).toBeTruthy()
    expect(screen.getByLabelText('Nhân viên nhận thưởng')).toBeTruthy()
    expect(screen.queryByLabelText('Ca nhận thưởng')).toBeNull()
    expect(screen.getByText('Tổng:').parentElement.textContent).toContain('+75,000 đ')
    fireEvent.change(screen.getByLabelText('Ngày nhận thưởng'), { target: { value: '2026-08-29' } })
    expect(screen.getByText('Không có lịch sử phù hợp bộ lọc.')).toBeTruthy()
    expect(screen.getByText('Tổng:').parentElement.textContent).toContain('+0 đ')
  })

  it('lets a HTKD account use the HTKD violation tab and filter its history', async () => {
    mocked.app.session = { role: 'business_support', employeeId: 'HTKD-001', name: 'Nguyễn Hỗ Trợ' }
    mocked.app.employees = [{
      ...supportProfile,
      workShifts: [{ id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' }],
    }]
    mocked.app.workCatalogItems = [{
      id: 'VIO-HTKD-LATE', code: 'htkd.violation.late', kind: 'VIOLATION', targetGroup: 'business_support',
      name: 'HTKD đi trễ', amountVnd: 6_000, active: true, sortOrder: 1, version: 1,
    }]
    mocked.app.violations = [{
      id: 'VIO-HISTORY-1', targetUnit: 'business_support', employeeId: 'HTKD-001', employeeName: 'Nguyễn Hỗ Trợ',
      occurredOn: '2026-08-27', shiftId: 'support_am', shiftName: 'Ca sáng', title: 'HTKD đi trễ',
      amountVnd: 6_000, status: 'ACTIVE', version: 1,
    }]
    render(<MemoryRouter><AdminSupportWorkPage /></MemoryRouter>)

    fireEvent.click(screen.getByRole('tab', { name: 'Vi phạm' }))
    expect(screen.getByText('Ghi nhận vi phạm')).toBeTruthy()
    expect(screen.getByLabelText('Ngày vi phạm')).toBeTruthy()
    expect(screen.getByLabelText('Nhân viên vi phạm')).toBeTruthy()
    expect(screen.getByText('Tổng:').parentElement.textContent).toContain('−6,000 đ')
    fireEvent.change(screen.getByLabelText('Ngày vi phạm'), { target: { value: '2026-08-28' } })
    expect(screen.getByText('Không có lịch sử phù hợp bộ lọc.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Ngày vi phạm'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /HTKD đi trễ/i }))
    fireEvent.click(screen.getByRole('button', { name: 'LƯU VI PHẠM' }))
    await waitFor(() => expect(mocked.app.createViolationBatch).toHaveBeenCalledWith(expect.objectContaining({
      targetUnit: 'business_support',
      employeeId: 'HTKD-001',
      shiftId: 'support_am',
      catalogItemIds: ['VIO-HTKD-LATE'],
    })))
  })

  it('lets Admin enter multiple manual tasks and sends them once to the employee selected in each tab', async () => {
    render(<MemoryRouter><AdminSupportAssignmentPage /></MemoryRouter>)

    expect(screen.getByRole('tab', { name: 'HTKD' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.change(screen.getByLabelText('Nhân viên nhận việc'), { target: { value: 'HTKD-001' } })
    fireEvent.change(screen.getByLabelText('Công việc 1'), { target: { value: 'Kiểm tra doanh thu' } })
    fireEvent.click(screen.getByRole('button', { name: /Thêm công việc/i }))
    fireEvent.change(screen.getByLabelText('Công việc 2'), { target: { value: 'Đối soát báo cáo cuối ngày' } })
    fireEvent.click(screen.getByRole('button', { name: /^LƯU$/i }))

    await waitFor(() => expect(mocked.app.assignSupportWork).toHaveBeenCalledTimes(1))
    expect(mocked.app.assignSupportWork).toHaveBeenLastCalledWith(expect.objectContaining({
      employeeId: 'HTKD-001',
      targetUnit: 'business_support',
      tasks: [
        expect.objectContaining({ name: 'Kiểm tra doanh thu', required: true }),
        expect.objectContaining({ name: 'Đối soát báo cáo cuối ngày', required: true }),
      ],
    }))
    expect(screen.getByLabelText('Nhân viên nhận việc').value).toBe('')
    expect(screen.getByLabelText('Công việc 1').value).toBe('Kiểm tra doanh thu')
    expect(screen.getByLabelText('Công việc 2').value).toBe('Đối soát báo cáo cuối ngày')

    fireEvent.click(screen.getByRole('tab', { name: 'Khối văn phòng' }))
    expect(screen.getByRole('tab', { name: 'Khối văn phòng' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('option', { name: /Nguyễn Văn Phòng/i })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Nguyễn Hỗ Trợ/i })).toBeNull()
  })

  it('loads the latest persisted assignment as a clean reusable list for a later day', () => {
    mocked.app.supportWorkAssignments = [{
      id: 'SWA-PREVIOUS', date: '2026-08-27', targetUnit: 'business_support',
      employeeId: 'HTKD-001', employeeName: 'Nguyễn Hỗ Trợ', assignedAt: '2026-08-27T08:00:00+07:00',
      tasks: [
        { id: 'OLD-1', name: 'Kiểm tra doanh thu', completed: true, employeeNote: 'Đã xong' },
        { id: 'OLD-2', name: 'Đối soát báo cáo', completed: false },
      ],
    }]
    render(<MemoryRouter><AdminSupportAssignmentPage /></MemoryRouter>)

    expect(screen.getByRole('region', { name: 'Danh sách công việc dùng lại' }).textContent).toContain('27/08/26')
    expect(screen.getByRole('region', { name: 'Danh sách công việc dùng lại' }).textContent).toContain('2 công việc')
    fireEvent.click(screen.getByRole('button', { name: 'DÙNG LẠI DANH SÁCH' }))

    expect(screen.getByLabelText('Công việc 1').value).toBe('Kiểm tra doanh thu')
    expect(screen.getByLabelText('Công việc 2').value).toBe('Đối soát báo cáo')
    expect(mocked.app.notify).toHaveBeenCalledWith('Đã tải 2 công việc từ ngày 27/08/26.', 'success')
  })

  it('preserves the unsaved Admin draft when the active assignment tab is clicked again', () => {
    render(<MemoryRouter initialEntries={['/admin/assignments?unit=business_support']}><AdminSupportAssignmentPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Nhân viên nhận việc'), { target: { value: 'HTKD-001' } })
    fireEvent.change(screen.getByLabelText('Công việc 1'), { target: { value: 'Bản nháp cần giữ nguyên' } })
    fireEvent.click(screen.getByRole('tab', { name: 'HTKD' }))

    expect(screen.getByLabelText('Nhân viên nhận việc').value).toBe('HTKD-001')
    expect(screen.getByLabelText('Công việc 1').value).toBe('Bản nháp cần giữ nguyên')
    expect(screen.getByRole('button', { name: /^LƯU$/i }).disabled).toBe(false)
  })

  it('synchronizes the visible Admin tab when a notification changes query params on the mounted route', async () => {
    function AssignmentRouteHarness() {
      const navigate = useNavigate()
      return <>
        <button type="button" onClick={() => navigate('/admin/assignments?unit=office&assignment=SWA-OFFICE')}>Mở kết quả Khối văn phòng</button>
        <AdminSupportAssignmentPage />
      </>
    }

    render(<MemoryRouter initialEntries={['/admin/assignments?unit=business_support']}><AssignmentRouteHarness /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'HTKD' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.change(screen.getByLabelText('Nhân viên nhận việc'), { target: { value: 'HTKD-001' } })
    fireEvent.change(screen.getByLabelText('Công việc 1'), { target: { value: 'Bản nháp HTKD không được mang sang' } })

    fireEvent.click(screen.getByRole('button', { name: 'Mở kết quả Khối văn phòng' }))

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Khối văn phòng' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('option', { name: /Nguyễn Văn Phòng/i })).toBeTruthy()
    expect(screen.getByLabelText('Nhân viên nhận việc').value).toBe('')
    expect(screen.getByLabelText('Công việc 1').value).toBe('')
    expect(screen.getByRole('button', { name: /^LƯU$/i }).disabled).toBe(true)
  })

  it('records every per-task note and requires a reason before submitting an incomplete assignment', async () => {
    mocked.app.session = { role: 'business_support', employeeId: 'HTKD-001', code: 'HTKD-001', name: 'Nguyễn Hỗ Trợ' }
    mocked.app.supportWorkAssignments = [{
      id: 'SWA-1', date: '2026-08-18', employeeId: 'HTKD-001', status: 'assigned', assignedAt: '2026-08-18T08:00:00+07:00', updatedAt: '2026-08-18T08:00:00+07:00',
      tasks: [{ id: 'T1', name: 'Việc một', description: 'Mô tả', completed: false }],
    }]
    render(<MemoryRouter><SupportWorkInboxPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Ghi chú công việc 1'), { target: { value: 'Đã kiểm tra, đang chờ phản hồi' } })

    const submitButton = screen.getByRole('button', { name: /GỬI KẾT QUẢ/i })
    fireEvent.click(submitButton)
    expect(mocked.app.notify).toHaveBeenCalledWith(expect.stringMatching(/nhập lý do/i), 'info')
    expect(mocked.app.updateSupportWork).not.toHaveBeenCalled()
    await waitFor(() => expect(submitButton.disabled).toBe(false))

    fireEvent.change(screen.getByPlaceholderText(/Nhập lý do cụ thể/i), { target: { value: 'Chờ cửa hàng phản hồi' } })
    fireEvent.click(submitButton)
    await waitFor(() => expect(mocked.app.updateSupportWork).toHaveBeenCalledWith({
      assignmentId: 'SWA-1',
      tasks: [{ id: 'T1', completed: false, note: 'Đã kiểm tra, đang chờ phản hồi' }],
      submit: true,
      incompleteReason: 'Chờ cửa hàng phản hồi',
    }))
    expect(mocked.app.updateSupportWork).toHaveBeenCalledTimes(1)
  })

  it('ticks only reward tasks from an open attendance snapshot with the trusted command contract', async () => {
    mocked.app.session = { role: 'business_support', employeeId: 'HTKD-001', code: 'HTKD-001', name: 'Nguyễn Hỗ Trợ' }
    mocked.app.attendance = [{
      id: 'ATT-OPEN', employeeId: 'HTKD-001', unit: 'business_support', workDate: '2026-08-28',
      shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
      checklistSnapshot: {
        tasks: [
          supportRewardTask,
          { ...supportFixedTask, catalogItemId: supportFixedTask.id },
        ],
      },
    }]
    render(<MemoryRouter><SupportAssignedWorkPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Ngày làm việc tính thưởng'), { target: { value: '2026-08-28' } })
    const rewardCheckbox = screen.getByRole('checkbox', { name: /Đánh giá trưng bày cửa hàng \(\+75,000 đ\)/i })
    expect(screen.getByText('Ca sáng')).toBeTruthy()
    expect(screen.getByText('+75,000 đ')).toBeTruthy()
    const taskName = screen.getByText('Đánh giá trưng bày cửa hàng')
    expect(taskName.classList.contains('reward-task-name')).toBe(true)
    expect(taskName.tagName).not.toBe('STRONG')
    expect(screen.getAllByText('Đánh giá trưng bày cửa hàng')).toHaveLength(1)
    expect(screen.queryByText('Mô tả nội bộ không hiển thị trong danh sách nhân viên')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Kiểm tra báo cáo/i })).toBeNull()
    fireEvent.click(rewardCheckbox)
    expect(mocked.app.setWorkRewards).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(() => expect(mocked.app.setWorkRewards).toHaveBeenCalledWith(expect.objectContaining({
      attendanceId: 'ATT-OPEN',
      items: [{ catalogItemId: supportRewardTask.id, checked: true }],
      idempotencyKey: expect.stringMatching(/^work-reward-batch:/u),
    })))
    expect(mocked.app.setWorkRewards).toHaveBeenCalledTimes(1)
    expect(rewardCheckbox.checked).toBe(true)
    expect(rewardCheckbox.disabled).toBe(true)
    expect(screen.getByRole('checkbox', { name: /Đánh giá trưng bày cửa hàng \(\+75,000 đ\)/i })).toBeTruthy()
    expect(rewardCheckbox.closest('label').classList.contains('is-locked')).toBe(true)
    expect(screen.getByText('Đã lưu')).toBeTruthy()
  })

  it('shows the complete store reward checklist immediately for every open checked-in shift', async () => {
    const employee = { id: 'E01', code: 'E01', unit: 'store', storeId: 'S01', name: 'Nhân viên cửa hàng' }
    const rewards = [{
      id: 'ATT-STORE-OPEN_REWARD-ON-TIME',
      catalogItemId: 'work-catalog:store:reward_task:on-time',
      catalogCode: 'store.reward.on-time',
      kind: 'REWARD_TASK',
      name: 'Đi làm đúng giờ',
      amountVnd: 2_000,
      required: false,
    }, {
      id: 'ATT-STORE-OPEN_REWARD-CUSTOMER',
      catalogItemId: 'work-catalog:store:reward_task:customer-care',
      catalogCode: 'store.reward.customer-care',
      kind: 'REWARD_TASK',
      name: 'Chào đón và tư vấn khách',
      amountVnd: 1_000,
      required: false,
    }]
    mocked.app.session = { role: 'employee', employeeId: 'E01', code: 'E01', storeId: 'S01' }
    mocked.app.currentEmployee = employee
    mocked.app.employees = [employee]
    mocked.app.attendance = [{
      id: 'ATT-STORE-OPEN', employeeId: 'E01', unit: 'store', storeId: 'S01', workDate: '2026-08-30',
      shiftId: 'shift-production-flexible', shiftName: 'Ca linh hoạt', shiftStart: '08:00', shiftEnd: '21:00',
      checkIn: '14:05', checklistSnapshot: { tasks: [
        ...rewards,
        {
          id: 'ATT-STORE-OPEN_FIXED', catalogItemId: 'work-catalog:store:fixed_task:afternoon',
          kind: 'FIXED_TASK', name: 'Công việc bắt buộc ca chiều', required: true, amountVnd: 0,
        },
      ] },
    }]

    render(<MemoryRouter><SupportAssignedWorkPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Ngày làm việc tính thưởng'), { target: { value: '2026-08-30' } })

    expect(screen.getByRole('checkbox', { name: /Đi làm đúng giờ \(\+2,000 đ\)/i })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Chào đón và tư vấn khách \(\+1,000 đ\)/i })).toBeTruthy()
    expect(screen.queryByText('Công việc bắt buộc ca chiều')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /Đi làm đúng giờ \(\+2,000 đ\)/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Chào đón và tư vấn khách \(\+1,000 đ\)/i }))
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(() => expect(mocked.app.setWorkRewards).toHaveBeenCalledWith(expect.objectContaining({
      attendanceId: 'ATT-STORE-OPEN',
      items: [
        { catalogItemId: 'work-catalog:store:reward_task:on-time', checked: true },
        { catalogItemId: 'work-catalog:store:reward_task:customer-care', checked: true },
      ],
    })))
    expect(mocked.app.setWorkRewards).toHaveBeenCalledTimes(1)
  })

  it('keeps the whole reward draft actionable after a failed batch and reuses the idempotency key on retry', async () => {
    mocked.app.session = { role: 'business_support', employeeId: 'HTKD-001', code: 'HTKD-001' }
    mocked.app.attendance = [{
      id: 'ATT-RETRY', employeeId: 'HTKD-001', unit: 'business_support', workDate: '2026-08-28',
      shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
      checklistSnapshot: { tasks: [supportRewardTask] },
    }]
    mocked.app.setWorkRewards.mockRejectedValue(new Error('Không thể lưu nguyên lô'))

    render(<MemoryRouter><SupportAssignedWorkPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Ngày làm việc tính thưởng'), { target: { value: '2026-08-28' } })
    const checkbox = screen.getByRole('checkbox', { name: /Đánh giá trưng bày cửa hàng/i })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(() => expect(mocked.app.setWorkRewards).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(checkbox.disabled).toBe(false))
    expect(checkbox.checked).toBe(true)
    const firstIdempotencyKey = mocked.app.setWorkRewards.mock.calls[0][0].idempotencyKey

    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(mocked.app.setWorkRewards).toHaveBeenCalledTimes(2))
    expect(mocked.app.setWorkRewards.mock.calls[1][0].idempotencyKey).toBe(firstIdempotencyKey)
  })

  it('keeps an Office employee reward tick stable while the confirmed server state reloads', async () => {
    mocked.app.session = { role: 'employee', employeeId: 'VP-001', code: 'VP-001', name: 'Nguyễn Văn Phòng', unit: 'office' }
    mocked.app.currentEmployee = officeProfile
    mocked.app.attendance = [{
      id: 'ATT-OFFICE-OPEN', employeeId: 'VP-001', unit: 'office', workDate: '2026-08-28',
      shiftId: 'office-day', shiftName: 'Ca 1', shiftStart: '08:00', shiftEnd: '17:00',
      checklistSnapshot: { tasks: [officeRewardTask] },
    }]
    const view = render(<MemoryRouter><SupportAssignedWorkPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Ngày làm việc tính thưởng'), { target: { value: '2026-08-28' } })
    const rewardCheckbox = screen.getByRole('checkbox', { name: /Đi làm đúng giờ \(\+3,000 đ\)/i })
    fireEvent.click(rewardCheckbox)
    expect(rewardCheckbox.checked).toBe(true)
    expect(mocked.app.setWorkRewards).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(mocked.app.setWorkRewards).toHaveBeenCalledTimes(1))
    expect(rewardCheckbox.checked).toBe(true)
    expect(rewardCheckbox.disabled).toBe(true)

    mocked.app.workCatalogProgress = [{
      attendanceId: 'ATT-OFFICE-OPEN', catalogItemId: officeRewardTask.id, checked: true, status: 'CLAIMED', version: 1,
    }]
    view.rerender(<MemoryRouter><SupportAssignedWorkPage /></MemoryRouter>)
    const syncedCheckbox = await screen.findByRole('checkbox', { name: /Đi làm đúng giờ \(\+3,000 đ\)/i })
    expect(syncedCheckbox.checked).toBe(true)
    expect(syncedCheckbox.disabled).toBe(true)
    expect(syncedCheckbox.closest('label').classList.contains('is-locked')).toBe(true)
  })

  it('keeps closed attendance rewards read-only in employee history and visible in Admin statistics', () => {
    mocked.app.attendance = [{
      id: 'ATT-CLOSED', employeeId: 'HTKD-001', employeeName: 'Nguyễn Hỗ Trợ', unit: 'business_support', workDate: '2026-08-28',
      shiftId: 'afternoon', shiftName: 'Ca chiều', shiftStart: '13:00', shiftEnd: '17:30', checkOutAt: '2026-08-28T10:30:00Z',
      checklistSnapshot: { tasks: [supportRewardTask] },
    }]
    mocked.app.workCatalogProgress = [{
      attendanceId: 'ATT-CLOSED', catalogItemId: supportRewardTask.id, checked: true, status: 'CLAIMED', completedAt: '2026-08-28T10:00:00Z',
    }]

    const { rerender } = render(<MemoryRouter><SupportAssignedWorkPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Ngày làm việc tính thưởng'), { target: { value: '2026-08-28' } })
    const closedReward = screen.getByRole('checkbox', { name: /Đánh giá trưng bày cửa hàng/i })
    expect(closedReward.checked).toBe(true)
    expect(closedReward.disabled).toBe(true)

    mocked.app.session = { role: 'admin', name: 'Admin' }
    rerender(<MemoryRouter><AdminSupportWorkPage /></MemoryRouter>)
    expect(screen.getByText('Lịch sử công việc tính thưởng HTKD')).toBeTruthy()
    expect(screen.getByText('Thống kê đánh giá thưởng theo nhân viên HTKD')).toBeTruthy()
    expect(screen.getAllByText('+75,000 đ').length).toBeGreaterThan(0)
  })

  it('shows complete assigned and replaced task snapshots in the Admin history', () => {
    mocked.app.supportWorkAssignments = [{
      id: 'SWA-1', date: '2026-08-18', employeeId: 'HTKD-001', employeeName: 'Nguyễn Hỗ Trợ', status: 'assigned',
      assignedAt: '2026-08-18T08:00:00+07:00', updatedAt: '2026-08-18T08:30:00+07:00',
      tasks: [{ id: 'T2', name: 'Kiểm tra báo cáo mới', description: 'Đối chiếu toàn hệ thống', completed: false }],
      history: [
        {
          action: 'assigned', at: '2026-08-18T08:00:00+07:00', actor: { name: 'Admin' },
          details: { tasks: [{ id: 'T1', name: 'Kiểm tra báo cáo', description: 'Đối chiếu cửa hàng' }] },
        },
        {
          action: 'replaced', at: '2026-08-18T08:30:00+07:00', actor: { name: 'Admin' },
          details: {
            beforeTasks: [{ id: 'T1', name: 'Kiểm tra báo cáo', description: 'Đối chiếu cửa hàng' }],
            afterTasks: [{ id: 'T2', name: 'Kiểm tra báo cáo mới', description: 'Đối chiếu toàn hệ thống' }],
          },
        },
      ],
    }]

    const { container } = render(<MemoryRouter><AdminSupportAssignmentPage /></MemoryRouter>)
    const history = container.querySelector('.assignment-history')
    expect(history.textContent).toContain('Nội dung đã giao')
    expect(history.textContent).toContain('Danh sách trước')
    expect(history.textContent).toContain('Danh sách sau')
    expect(history.textContent).toContain('Kiểm tra báo cáo')
    expect(history.textContent).toContain('Đối chiếu cửa hàng')
    expect(history.textContent).toContain('Kiểm tra báo cáo mới')
    expect(history.textContent).toContain('Đối chiếu toàn hệ thống')
  })

  it('marks each completed history task green and every incomplete task red', () => {
    mocked.app.supportWorkAssignments = [{
      id: 'SWA-STATUS', date: '2026-08-28', targetUnit: 'business_support', employeeId: 'HTKD-001',
      employeeName: 'Nguyễn Hỗ Trợ', status: 'in_progress', assignedAt: '2026-08-28T08:00:00+07:00',
      updatedAt: '2026-08-28T09:00:00+07:00', history: [],
      tasks: [
        { id: 'DONE', name: 'Đã hoàn thành báo cáo', completed: true },
        { id: 'TODO', name: 'Chưa hoàn thành đối soát', completed: false },
      ],
    }]
    render(<MemoryRouter><AdminSupportAssignmentPage /></MemoryRouter>)

    const completed = screen.getByLabelText('Đã hoàn thành: Đã hoàn thành báo cáo')
    const incomplete = screen.getByLabelText('Chưa hoàn thành: Chưa hoàn thành đối soát')
    expect(completed.closest('li').classList.contains('is-complete')).toBe(true)
    expect(incomplete.closest('li').classList.contains('is-incomplete')).toBe(true)
    expect(completed.querySelector('svg')).toBeTruthy()
    expect(incomplete.querySelector('svg')).toBeTruthy()
  })
})
