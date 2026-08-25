import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BusinessSupportManagement } from '../admin/RoleManagement'
import { OfficeManagement } from './OfficeManagement'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

describe('working-time management entry points', () => {
  beforeEach(() => {
    mocked.app = {
      session: { role: 'admin' },
      employees: [{
        id: 'VP-001', code: 'VP-001', unit: 'office', storeId: 'OFFICE', isOffice: true,
        name: 'Nhân viên văn phòng', status: 'Đang làm việc', employmentType: 'Full-Time',
        position: 'Kế Toán', startDate: '2026-08-01', workStart: '08:00', workEnd: '17:30',
      }, {
        id: 'HTKD-001', code: 'HTKD-001', unit: 'business_support', storeId: 'BUSINESS_SUPPORT',
        name: 'Nhân viên hỗ trợ', status: 'Đang làm việc', employmentType: 'Part-Time',
        position: 'NV hỗ trợ KD', startDate: '2026-08-01', workStart: '08:00', workEnd: '12:00',
      }],
      deletedEmployees: [], attendance: [], stores: [], officeAdjustments: [], policies: {}, supportWorkAssignments: [],
      addEmployee: vi.fn(), updateEmployee: vi.fn(), deleteEmployee: vi.fn(),
      addBusinessSupport: vi.fn(), updateBusinessSupport: vi.fn(), deleteBusinessSupport: vi.fn(),
      setEmployeeWorkingTime: vi.fn(), notify: vi.fn(),
    }
  })

  afterEach(cleanup)

  it.each(['admin', 'business_support'])('hides effective-dated settings actions from %s', (role) => {
    mocked.app.session = { role }
    const officeView = render(<OfficeManagement />)
    expect(screen.queryByRole('button', { name: 'Cài đặt thời gian làm việc' })).toBeNull()
    officeView.unmount()

    render(<BusinessSupportManagement />)
    expect(screen.queryByRole('button', { name: 'Cài đặt thời gian làm việc' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Cài giờ làm/u })).toBeNull()
  })

  it('keeps initial working-time fields when Admin creates Office and Business Support profiles', () => {
    const officeView = render(<OfficeManagement />)
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhân viên/u }))
    expect(within(screen.getByRole('dialog')).getByText('Thời gian làm việc')).toBeTruthy()
    officeView.unmount()

    render(<BusinessSupportManagement />)
    fireEvent.click(screen.getAllByRole('button', { name: /Thêm tài khoản/u })[0])
    expect(within(screen.getByRole('dialog')).getByText('Thời gian làm việc')).toBeTruthy()
  })

  it('keeps Office profile edits separate from effective-dated working-time settings', () => {
    render(<OfficeManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên văn phòng' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('Thời gian làm việc')).toBeNull()
    expect(within(dialog).getByText('Thời gian làm việc hiện tại được giữ nguyên khi cập nhật hồ sơ.')).toBeTruthy()
  })

  it('keeps Business Support profile edits separate from effective-dated working-time settings', () => {
    render(<BusinessSupportManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên hỗ trợ' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('Thời gian làm việc')).toBeNull()
    expect(within(dialog).getByText('Thời gian làm việc hiện tại được giữ nguyên khi cập nhật hồ sơ.')).toBeTruthy()
  })
})
