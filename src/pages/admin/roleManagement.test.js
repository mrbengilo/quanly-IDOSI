import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficeManagement } from '../office/OfficeManagement'
import { AdminStores } from './AdminPages'
import { SystemEmployees } from './GovernancePages'
import { BusinessSupportManagement, StoreManagerManagement } from './RoleManagement'
import { today } from '../../utils'
import {
  EMPLOYMENT_TYPES,
  ROLE_KEYS,
  STORE_MANAGER_EMPLOYMENT_TYPES,
  emptyRoleProfile,
  formatRoleDate,
  nextRoleCode,
  roleEmploymentType,
  roleProfilePayload,
  roleProfilesFromApp,
  validateRoleProfile,
} from './roleManagementUtils'

const mocked = vi.hoisted(() => ({ app: {} }))

function CurrentRoute() {
  const location = useLocation()
  return createElement('output', { 'data-testid': 'current-route' }, location.pathname)
}

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

afterEach(() => {
  cleanup()
  mocked.app = {}
})

const validForm = (roleKey = ROLE_KEYS.businessSupport) => ({
  ...emptyRoleProfile(roleKey),
  code: roleKey === ROLE_KEYS.storeManager ? 'QLCH-001' : 'HTKD-001',
  name: 'Nguyễn An',
  phone: '0901234567',
  cccd: '012345678901',
  address: '12 Nguyễn Trãi, TP. Hồ Chí Minh',
  startDate: '2026-08-17',
  employmentType: 'Full-Time',
  identityImages: { front: 'data:image/png;base64,front', back: 'data:image/png;base64,back' },
  username: roleKey === ROLE_KEYS.storeManager ? 'ql_ch_01' : 'support_an',
  password: 'SafePass123',
  storeId: roleKey === ROLE_KEYS.storeManager ? 'CH001' : '',
  baseSalary: roleKey === ROLE_KEYS.storeManager ? '12,000,000' : '',
  standardWorkDays: '26',
  requiredMonthlyHours: roleKey === ROLE_KEYS.storeManager ? '208' : '',
})

const baseApp = (role) => ({
  session: { role },
  employees: [],
  businessSupportEmployees: [],
  storeManagers: [],
  deletedEmployees: [],
  stores: [{ id: 'CH001', name: 'SecondMall SM234' }],
  attendance: [],
  policies: {},
  notify: vi.fn(),
})

describe('admin role management helpers', () => {
  it('exports both route-ready screens', () => {
    expect(BusinessSupportManagement).toBeTypeOf('function')
    expect(StoreManagerManagement).toBeTypeOf('function')
  })

  it('selects support and manager profiles without mixing office employees', () => {
    const app = {
      employees: [
        { id: 'HTKD-001', unit: 'business_support' },
        { id: 'QLCH-001', unit: 'store_manager' },
        { id: 'VP001', unit: 'office' },
      ],
    }

    expect(roleProfilesFromApp(app, ROLE_KEYS.businessSupport).map((item) => item.id)).toEqual(['HTKD-001'])
    expect(roleProfilesFromApp(app, ROLE_KEYS.storeManager).map((item) => item.id)).toEqual(['QLCH-001'])
  })

  it('previews server-style sequential HTKD and QLCH codes without reusing deleted codes', () => {
    const profiles = [
      { id: 'HTKD-001' },
      { id: 'HTKD-004', deletedAt: '2026-08-01' },
      { id: 'QLCH-003' },
      { id: 'QLCH-008', deletedAt: '2026-08-02' },
    ]

    expect(nextRoleCode(profiles, ROLE_KEYS.businessSupport)).toBe('HTKD-005')
    expect(nextRoleCode(profiles, ROLE_KEYS.storeManager)).toBe('QLCH-009')
  })

  it('normalizes legacy employee types and displays dates as dd/mm/yy', () => {
    expect(roleEmploymentType({ employmentType: 'Chính thức' })).toBe('Full-Time')
    expect(roleEmploymentType({ employmentType: 'Part-Time' })).toBe('Part-Time')
    expect(roleEmploymentType({ employmentType: 'Thực tập sinh' })).toBe('Thực Tập Sinh')
    expect(formatRoleDate('2026-08-17')).toBe('17/08/26')
  })

  it('requires a start date and immutable assignment target for a new store manager', () => {
    const form = { ...validForm(ROLE_KEYS.storeManager), startDate: '', storeId: '' }
    const errors = validateRoleProfile({ form, profiles: [], roleKey: ROLE_KEYS.storeManager })

    expect(errors).toContain('Ngày bắt đầu làm là trường bắt buộc.')
    expect(errors).toContain('Cửa hàng quản lý là trường bắt buộc.')
  })

  it('validates the exact phone and CCCD formats and allowed employee types', () => {
    const errors = validateRoleProfile({
      form: { ...validForm(), phone: '912345678', cccd: '123', employmentType: 'Thử việc' },
      profiles: [],
      roleKey: ROLE_KEYS.businessSupport,
    })

    expect(errors).toContain('Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0.')
    expect(errors).toContain('CCCD phải gồm đúng 12 chữ số.')
    expect(errors).toContain('Loại nhân viên không hợp lệ.')
    expect(EMPLOYMENT_TYPES).toEqual(['Full-Time', 'Part-Time', 'Thực Tập Sinh'])
    expect(STORE_MANAGER_EMPLOYMENT_TYPES).toEqual(['Full-Time', 'Part-Time'])
  })

  it('allows duplicate personal information across job accounts but not duplicate usernames', () => {
    const form = validForm(ROLE_KEYS.storeManager)
    const profiles = [{ id: 'HTKD-001', cccd: form.cccd, phone: form.phone, username: 'another-role' }]
    expect(validateRoleProfile({ form, profiles, roleKey: ROLE_KEYS.storeManager })).toEqual([])
    expect(validateRoleProfile({ form: { ...form, username: 'another-role' }, profiles, roleKey: ROLE_KEYS.storeManager }))
      .toContain('Tên đăng nhập đã tồn tại.')
  })

  it('keeps store-manager pay allowance-only while validating the allowed employee types', () => {
    const errors = validateRoleProfile({
      form: {
        ...validForm(ROLE_KEYS.storeManager),
        employmentType: 'Thực Tập Sinh',
        baseSalary: '0',
        standardWorkDays: '32',
        requiredMonthlyHours: '0',
      },
      profiles: [],
      roleKey: ROLE_KEYS.storeManager,
    })

    expect(errors).toContain('Loại nhân viên không hợp lệ.')
    expect(errors).not.toContain('Lương cơ bản phải là số lớn hơn 0.')
    expect(errors).not.toContain('Số ngày công quy định/tháng phải là số nguyên từ 1 đến 31.')
    expect(errors).not.toContain('Số giờ làm quy định/tháng phải lớn hơn 0 và không vượt quá 744 giờ.')
  })

  it('requires a fresh password when reissuing a purged login for an existing profile', () => {
    const errors = validateRoleProfile({
      form: { ...validForm(), password: '' },
      profiles: [],
      editingKey: 'HTKD-001',
      requiresPassword: true,
      roleKey: ROLE_KEYS.businessSupport,
    })

    expect(errors).toContain('Mật khẩu phải có ít nhất 8 ký tự.')
  })

  it('builds a minimal server-owned identity payload including both CCCD images', () => {
    const supportPayload = roleProfilePayload(validForm(), ROLE_KEYS.businessSupport)
    const managerPayload = roleProfilePayload(validForm(ROLE_KEYS.storeManager), ROLE_KEYS.storeManager)

    expect(supportPayload).toMatchObject({
      unit: 'business_support',
      storeId: 'BUSINESS_SUPPORT',
      startDate: '2026-08-17',
      employmentType: 'Full-Time',
      position: 'NV hỗ trợ KD',
      identityImages: { front: 'data:image/png;base64,front', back: 'data:image/png;base64,back' },
    })
    expect(managerPayload).toMatchObject({
      unit: 'store_manager',
      storeId: 'CH001',
      position: 'Quản lý cửa hàng',
      identityImages: { front: 'data:image/png;base64,front', back: 'data:image/png;base64,back' },
    })
    expect(managerPayload).not.toHaveProperty('baseSalary')
    expect(managerPayload).not.toHaveProperty('standardWorkDays')
    expect(managerPayload).not.toHaveProperty('requiredMonthlyHours')
    expect(supportPayload).not.toHaveProperty('id')
    expect(supportPayload).not.toHaveProperty('code')
    expect(supportPayload).not.toHaveProperty('salary')
    expect(supportPayload).not.toHaveProperty('status')
    expect(supportPayload).toMatchObject({
      workTimeType: 'Full-Time', workStart: '08:00', workEnd: '17:30',
      workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }],
      workingTime: { type: 'Full-Time', mode: 'fixed' },
    })
    expect(supportPayload).not.toHaveProperty('standardWorkDays')
    expect(Object.keys(supportPayload).sort()).toEqual([
      'address', 'cccd', 'employmentType', 'identityImages', 'name', 'password', 'phone', 'position', 'startDate', 'storeId', 'unit', 'username',
      'workTimeType', 'workStart', 'workEnd', 'workShifts', 'workingTime',
    ].sort())
  })

  it('does not resubmit persisted R2 image metadata while editing', () => {
    const payload = roleProfilePayload({
      ...validForm(),
      password: '',
      identityImages: {
        front: { key: 'private/front.webp', contentType: 'image/webp' },
        back: { key: 'private/back.webp', contentType: 'image/webp' },
      },
    }, ROLE_KEYS.businessSupport)

    expect(payload).not.toHaveProperty('identityImages')
    expect(payload).not.toHaveProperty('password')
  })

  it('keeps the structured province, ward and street while also sending the full address', () => {
    const payload = roleProfilePayload({
      ...validForm(),
      address: '',
      province: 'Hồ Chí Minh',
      ward: 'Hiệp Bình',
      street: '12 Phạm Văn Đồng',
    }, ROLE_KEYS.businessSupport)

    expect(payload.address).toBe('12 Phạm Văn Đồng, Hiệp Bình, Hồ Chí Minh')
    expect(payload.addressDetails).toEqual({ province: 'Hồ Chí Minh', ward: 'Hiệp Bình', street: '12 Phạm Văn Đồng' })
  })
})

describe('role management permissions and form', () => {
  it('lets Business Support inspect the list but hides every account mutation control', () => {
    mocked.app = {
      ...baseApp('business_support'),
      businessSupportEmployees: [{
        id: 'HTKD-001',
        name: 'Nguyễn An',
        phone: '0901234567',
        cccd: '012345678901',
        address: 'TP. Hồ Chí Minh',
        startDate: '2026-08-17',
        employmentType: 'Full-Time',
        position: 'NV hỗ trợ KD',
        username: 'support_an',
        identityImages: {
          front: 'data:image/png;base64,support-front',
          back: 'data:image/png;base64,support-back',
        },
      }],
    }

    render(createElement(BusinessSupportManagement))

    expect(screen.getByText('Nguyễn An')).toBeTruthy()
    expect(screen.getByText('Chỉ Admin được quản lý tài khoản; Admin và Hỗ trợ KD được cấu hình thời gian làm việc.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Thêm tài khoản/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Sửa Nguyễn An/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Xóa Nguyễn An/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Cài giờ làm Nguyễn An/i })).toBeTruthy()
    const viewFront = screen.getByRole('button', { name: /Xem mặt trước CCCD Nguyễn An/i })
    expect(viewFront.closest('.identity-image-actions--stable')).toBeTruthy()
    fireEvent.click(viewFront)
    expect(screen.getByRole('img', { name: /Nguyễn An · Mặt trước CCCD/i }).closest('.identity-document-viewer__frame')).toBeTruthy()
  })

  it('submits an effective-dated working-time command when Business Support configures another support profile', async () => {
    const setEmployeeWorkingTime = vi.fn().mockResolvedValue({ ok: true })
    mocked.app = {
      ...baseApp('business_support'),
      setEmployeeWorkingTime,
      businessSupportEmployees: [{
        id: 'HTKD-002', name: 'Hỗ trợ ca', employmentType: 'Part-Time',
        workShifts: [
          { id: 'ca_sang', name: 'Ca sáng', start: '08:00', end: '12:00' },
          { id: 'ca_chieu', name: 'Ca chiều', start: '13:00', end: '17:30' },
        ],
      }],
    }

    render(createElement(BusinessSupportManagement))
    fireEvent.click(screen.getByRole('button', { name: 'Cài giờ làm Hỗ trợ ca' }))
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(() => expect(setEmployeeWorkingTime).toHaveBeenCalledTimes(1))
    const [employeeId, payload] = setEmployeeWorkingTime.mock.calls[0]
    expect(employeeId).toBe('HTKD-002')
    expect(Object.keys(payload).sort()).toEqual(['effectiveFrom', 'workEnd', 'workShifts', 'workStart', 'workTimeType', 'workingTime'].sort())
    expect(payload.effectiveFrom).toBe(today())
    expect(payload).toMatchObject({ workTimeType: 'Part-Time', workStart: '08:00', workEnd: '12:00' })
    expect(payload).not.toHaveProperty('username')
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('salary')
  })

  it('omits working-time fields from generic Business Support profile edits', () => {
    const payload = roleProfilePayload({
      ...emptyRoleProfile(ROLE_KEYS.businessSupport),
      name: 'Hỗ trợ ca', phone: '0901234567', cccd: '079123456789', startDate: '2026-08-01',
      employmentType: 'Part-Time', position: 'NV hỗ trợ KD', username: 'support.shift',
      workTimeType: 'Part-Time', workStart: '08:00', workEnd: '12:00',
      workShifts: [{ id: 'ca_sang', name: 'Ca sáng', start: '08:00', end: '12:00' }],
    }, ROLE_KEYS.businessSupport, { includeWorkingTime: false })

    expect(payload).not.toHaveProperty('workTimeType')
    expect(payload).not.toHaveProperty('workStart')
    expect(payload).not.toHaveProperty('workEnd')
    expect(payload).not.toHaveProperty('workShifts')
    expect(payload).not.toHaveProperty('workingTime')
  })

  it('shows Business Support attendance locations only as safe Google Maps buttons', () => {
    mocked.app = {
      ...baseApp('admin'),
      businessSupportEmployees: [{
        id: 'HTKD-001', code: 'HTKD-001', unit: 'business_support', name: 'Nguyễn An',
        employmentType: 'Full-Time', workStart: '08:00', workEnd: '17:30',
      }],
      attendance: [{
        id: 'CC-HTKD-001', employeeId: 'HTKD-001', date: today(), shiftStart: '08:00', shiftEnd: '17:30',
        checkIn: '08:15', checkOut: '17:30', hours: 9.25, arrivalTag: 'Đi trễ', minutesLate: 15,
        checkInLocation: { latitude: 10.8577553, longitude: 106.7499427, label: 'Trụ sở IDOSI' },
      }],
      policies: { attendanceEvaluation: { maintainMaxLateCount: 1, improveMinLateCount: 3, improveMinLateMinutes: 30 } },
    }

    render(createElement(BusinessSupportManagement))
    fireEvent.click(screen.getByRole('button', { name: 'Chấm công' }))

    const link = screen.getByRole('link', { name: /Xem vị trí điểm danh của Nguyễn An trên Google Maps/i })
    expect(link.textContent).toBe('Xem vị trí')
    expect(link.href).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/)
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noreferrer')
    expect(screen.queryByText('Trụ sở IDOSI')).toBeNull()
    expect(screen.queryByText(/10\.8577553|106\.7499427/)).toBeNull()
  })

  it('shows Admin the store-manager assignment and dual-role selection form', () => {
    mocked.app = baseApp('admin')
    render(createElement(StoreManagerManagement))

    fireEvent.click(screen.getAllByRole('button', { name: /Thêm tài khoản/i })[0])

    const dialog = screen.getByRole('dialog')
    const labels = [...dialog.querySelectorAll('.field__label')].map((label) => label.textContent.trim().replace(/\s*\*$/u, ''))
    expect(labels.slice(0, 4)).toEqual(['Cửa hàng quản lý', 'Cách tạo Quản lý cửa hàng', 'Mã nhân viên', 'Tên nhân viên'])
    expect(screen.getByDisplayValue('QLCH-001').readOnly).toBe(true)
    expect(screen.getByDisplayValue('Quản lý cửa hàng').readOnly).toBe(true)
    expect(screen.getByLabelText('Mặt trước CCCD')).toBeTruthy()
    expect(screen.getByLabelText('Mặt sau CCCD')).toBeTruthy()
    expect(screen.getByLabelText(/Cách tạo quản lý/i)).toBeTruthy()
    expect(labels).not.toContain('Lương cơ bản')
    expect(labels).not.toContain('Số ngày công quy định/tháng')
    expect(labels).not.toContain('Số giờ làm quy định/tháng')
    expect([...screen.getByLabelText(/Loại nhân viên/i).options].map((option) => option.textContent)).toEqual(['Full-Time', 'Part-Time'])
    expect(labels).not.toContain('Trạng thái')
    expect(labels).not.toContain('Giờ bắt đầu')
    expect(labels).not.toContain('Giới tính')
    expect(labels).not.toContain('Ngày sinh')
  })

  it('lets Business Support create and edit a store manager while keeping delete Admin-only', () => {
    mocked.app = {
      ...baseApp('business_support'),
      storeManagers: [{ id: 'QLCH-001', unit: 'store_manager', storeId: 'CH001', name: 'Quản lý một', employmentType: 'Full-Time' }],
      addStoreManager: vi.fn(),
    }
    render(createElement(StoreManagerManagement))

    expect(screen.getAllByRole('button', { name: /Thêm tài khoản/i }).length).toBeGreaterThan(0)
    expect(screen.getByText(/Hỗ trợ KD được tạo hoặc sửa Quản lý cửa hàng/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sửa Quản lý một/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Xóa Quản lý một/i })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: /Thêm tài khoản/i })[0])
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(screen.queryByLabelText(/Lương cơ bản/i)).toBeNull()
    expect(screen.queryByLabelText(/Số ngày công quy định\/tháng/i)).toBeNull()
    expect(screen.queryByLabelText(/Số giờ làm quy định\/tháng/i)).toBeNull()
    expect([...screen.getByLabelText(/Loại nhân viên/i).options].map((option) => option.textContent)).toEqual(['Full-Time', 'Part-Time'])
  })
})

describe('Business Support read-only system views', () => {
  it('can inspect stores without store mutation controls', () => {
    mocked.app = {
      ...baseApp('business_support'),
      stores: [{ id: 'CH001', name: 'SecondMall SM234', location: 'TP. HCM', address: '234 Phạm Văn Đồng', employees: 2, status: 'Đang hoạt động' }],
      orders: [],
      expenses: [],
      inventoryImports: [],
      salaryRecords: [],
      setActiveStoreId: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(AdminStores)))

    expect(screen.getAllByText('SecondMall SM234').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Thêm cửa hàng/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Sửa SecondMall SM234/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Xóa SecondMall SM234/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Đang hoạt động' })).toBeNull()
    expect(screen.getByText('Đang hoạt động')).toBeTruthy()
    const openStore = screen.getByRole('button', { name: /Mở cửa hàng SecondMall SM234/i })
    expect(openStore.closest('.store-directory-card')).toBeTruthy()
    expect(document.querySelector('.store-directory-card-grid')).toBeTruthy()
  })

  it('derives store employee totals from active profiles and opens the selected store directly', () => {
    const setActiveStoreId = vi.fn(() => true)
    mocked.app = {
      ...baseApp('business_support'),
      stores: [{ id: 'CH001', name: 'SecondMall SM234', location: 'TP. HCM', address: '234 Phạm Văn Đồng', status: 'Đang hoạt động' }],
      employees: [
        { id: 'NV-001', unit: 'store', storeId: 'CH001', status: 'Đang làm việc' },
        { id: 'NV-002', unit: 'store', storeId: 'CH001', status: 'Tạm ngưng' },
        { id: 'NV-003', unit: 'store', storeId: 'CH001', status: 'Đã nghỉ việc' },
        { id: 'NV-004', unit: 'store', storeId: 'CH001', status: 'Đang làm việc', deletedAt: '2026-08-18T00:00:00Z' },
      ],
      orders: [],
      expenseEntries: [],
      fixedExpenses: [],
      importVouchers: [],
      salaryAdjustments: [],
      setActiveStoreId,
    }

    render(createElement(MemoryRouter, { initialEntries: ['/admin/stores'] }, createElement(AdminStores), createElement(CurrentRoute)))

    expect(screen.getByText('Tổng nhân viên').closest('.metric').textContent).toContain('2')
    fireEvent.click(screen.getByRole('button', { name: /Mở cửa hàng SecondMall SM234/i }))
    expect(setActiveStoreId).toHaveBeenCalledWith('CH001')
    expect(screen.getByTestId('current-route').textContent).toBe('/store/overview')
  })

  it('can inspect store employees without status, password, or delete controls', () => {
    mocked.app = {
      ...baseApp('business_support'),
      employees: [{
        id: 'SM234-001', unit: 'store', storeId: 'CH001', name: 'Nhân viên cửa hàng', status: 'Đang làm việc',
        employmentType: 'Full-Time', phone: '0901234567', cccd: '012345678901', salary: 8_000_000,
      }],
    }

    render(createElement(SystemEmployees))

    expect(screen.getByText('Nhân viên cửa hàng')).toBeTruthy()
    expect(screen.queryByLabelText(/Trạng thái Nhân viên cửa hàng/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Đặt lại mật khẩu/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Xóa Nhân viên cửa hàng/i })).toBeNull()
  })

  it('can create and edit Office employees without delete or payroll mutation controls', () => {
    mocked.app = {
      ...baseApp('business_support'),
      employees: [{
        id: 'VP001', unit: 'office', storeId: 'OFFICE', isOffice: true, name: 'Nhân viên văn phòng',
        status: 'Đang làm việc', officeEmployeeType: 'Chính thức', phone: '0901234567', cccd: '012345678901', salary: 8_000_000,
      }],
      salaryAdjustments: [],
      officeAdjustments: [],
      payrollPeriods: [],
    }

    render(createElement(OfficeManagement))

    expect(screen.getByText('Nhân viên văn phòng')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Thêm nhân viên/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sửa Nhân viên văn phòng/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Xóa Nhân viên văn phòng/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Tạo thưởng|Tạo phụ cấp/i })).toBeNull()
  })
})
