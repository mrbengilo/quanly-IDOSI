import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminSupportWorkPage, SupportAssignedWorkPage } from './SupportWorkPages'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const supportProfile = { id: 'HTKD-001', code: 'HTKD-001', unit: 'business_support', name: 'Nguyễn Hỗ Trợ' }

describe('support work screens', () => {
  beforeEach(() => {
    mocked.app = {
      session: { role: 'admin', name: 'Admin' },
      employees: [supportProfile],
      supportWorkAssignments: [],
      assignSupportWork: vi.fn().mockResolvedValue({ ok: true }),
      updateSupportWork: vi.fn().mockResolvedValue({ ok: true }),
      notify: vi.fn(),
    }
  })

  afterEach(cleanup)

  it('sends the selected date, support employee, task name and description', async () => {
    render(<MemoryRouter><AdminSupportWorkPage /></MemoryRouter>)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'HTKD-001' } })
    fireEvent.change(screen.getByLabelText('Tên công việc 1'), { target: { value: 'Kiểm tra báo cáo' } })
    fireEvent.change(screen.getByLabelText('Mô tả công việc 1'), { target: { value: 'Đối chiếu doanh thu các cửa hàng' } })
    fireEvent.click(screen.getByRole('button', { name: /^GỬI$/i }))

    await waitFor(() => expect(mocked.app.assignSupportWork).toHaveBeenCalledTimes(1))
    expect(mocked.app.assignSupportWork.mock.calls[0][0]).toMatchObject({
      employeeId: 'HTKD-001',
      tasks: [{ name: 'Kiểm tra báo cáo', description: 'Đối chiếu doanh thu các cửa hàng' }],
    })
  })

  it('requires a reason before submitting an incomplete assignment', async () => {
    mocked.app.session = { role: 'business_support', employeeId: 'HTKD-001', code: 'HTKD-001', name: 'Nguyễn Hỗ Trợ' }
    mocked.app.supportWorkAssignments = [{
      id: 'SWA-1', date: '2026-08-18', employeeId: 'HTKD-001', status: 'assigned', assignedAt: '2026-08-18T08:00:00+07:00', updatedAt: '2026-08-18T08:00:00+07:00',
      tasks: [{ id: 'T1', name: 'Việc một', description: 'Mô tả', completed: false }],
    }]
    render(<MemoryRouter><SupportAssignedWorkPage /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /GỬI KẾT QUẢ/i }))
    expect(mocked.app.notify).toHaveBeenCalledWith(expect.stringMatching(/nhập lý do/i), 'info')
    expect(mocked.app.updateSupportWork).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText(/Nhập lý do cụ thể/i), { target: { value: 'Chờ cửa hàng phản hồi' } })
    fireEvent.click(screen.getByRole('button', { name: /GỬI KẾT QUẢ/i }))
    await waitFor(() => expect(mocked.app.updateSupportWork).toHaveBeenCalledWith({
      assignmentId: 'SWA-1',
      tasks: [{ id: 'T1', completed: false }],
      submit: true,
      incompleteReason: 'Chờ cửa hàng phản hồi',
    }))
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

    const { container } = render(<MemoryRouter><AdminSupportWorkPage /></MemoryRouter>)
    const history = container.querySelector('.assignment-history')
    expect(history.textContent).toContain('Nội dung đã giao')
    expect(history.textContent).toContain('Danh sách trước')
    expect(history.textContent).toContain('Danh sách sau')
    expect(history.textContent).toContain('Kiểm tra báo cáo')
    expect(history.textContent).toContain('Đối chiếu cửa hàng')
    expect(history.textContent).toContain('Kiểm tra báo cáo mới')
    expect(history.textContent).toContain('Đối chiếu toàn hệ thống')
  })
})
