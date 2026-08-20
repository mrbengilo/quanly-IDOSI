import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BusinessSupportManagement } from '../admin/RoleManagement'
import { OfficeManagement } from './OfficeManagement'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

describe('working-time settings entry points', () => {
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

  it('exposes a clearly labelled action in Khối văn phòng', () => {
    render(<OfficeManagement />)
    expect(screen.getByRole('button', { name: 'Cài đặt thời gian làm việc' })).toBeTruthy()
  })

  it('exposes a clearly labelled action for Nhân viên hỗ trợ KD', () => {
    render(<BusinessSupportManagement />)
    expect(screen.getByRole('button', { name: 'Cài đặt thời gian làm việc' })).toBeTruthy()
  })

  it('keeps Office profile edits separate from effective-dated working-time settings', () => {
    render(<OfficeManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên văn phòng' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('Thời gian làm việc')).toBeNull()
    expect(within(dialog).getByText(/Dùng chức năng “Cài đặt thời gian làm việc”/)).toBeTruthy()
  })

  it('keeps Business Support profile edits separate from effective-dated working-time settings', () => {
    render(<BusinessSupportManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên hỗ trợ' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('Thời gian làm việc')).toBeNull()
    expect(within(dialog).getByText(/Dùng chức năng “Cài đặt thời gian làm việc”/)).toBeTruthy()
  })
})
