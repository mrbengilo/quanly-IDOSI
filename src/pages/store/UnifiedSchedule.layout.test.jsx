import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UnifiedSchedule from './UnifiedSchedule'

const mocked = vi.hoisted(() => ({ app: {}, downloadCsv: vi.fn() }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

vi.mock('../../utils', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadCsv: mocked.downloadCsv,
}))

const localDate = () => {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

const previousLocalDate = () => {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() - 1)
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
}

const store = { id: 'CH-TNV', name: 'Dosii TNV' }
const employee = {
  id: 'DOSII-TNV-001',
  code: 'DOSII-TNV-001',
  name: 'Nguyễn Minh Anh',
  unit: 'store',
  storeId: store.id,
  status: 'Đang làm việc',
  position: 'Nhân viên bán hàng',
}
const shift = {
  id: 'CA-SANG',
  storeId: store.id,
  name: 'Ca sáng',
  start: '08:00',
  end: '12:00',
  active: true,
  color: '#18a558',
  updatedAt: '2026-08-20T07:30:00+07:00',
}

const makeApp = () => ({
  session: { role: 'admin', employeeId: 'ADMIN' },
  activeStore: store,
  activeStoreId: store.id,
  stores: [store],
  employees: [employee],
  supportTransfers: [],
  shiftDefinitions: [shift],
  schedule: [{
    id: 'LICH-001',
    storeId: store.id,
    employeeId: employee.id,
    date: localDate(),
    shiftIds: [shift.id],
    shiftSnapshots: [shift],
    note: 'Quầy chính',
  }],
  notify: vi.fn(),
  createShiftDefinition: vi.fn().mockResolvedValue({ ok: true, shift: { ...shift, id: 'CA-MOI' } }),
  updateShiftDefinition: vi.fn(),
  deleteShiftDefinition: vi.fn(),
  saveScheduleMultiple: vi.fn(),
  replaceScheduleDay: vi.fn(),
})

const renderSchedule = () => render(<MemoryRouter><UnifiedSchedule /></MemoryRouter>)
const scheduleStyles = readFileSync(resolve(cwd(), 'src/pages/store/UnifiedSchedule.css'), 'utf8')

describe('store schedule visual flow', () => {
  beforeEach(() => {
    mocked.app = makeApp()
    mocked.downloadCsv.mockReset()
  })

  afterEach(cleanup)

  it('renders the toolbar, reusable shift cards, metrics, views and daily matrix in screenshot order', () => {
    const { container } = renderSchedule()

    expect(screen.getByRole('heading', { level: 1, name: 'Lịch phân ca' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tạo ca làm việc' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'PHÂN CA' })).toBeTruthy()
    expect(screen.getByText('Tạo lịch phân ca')).toBeTruthy()

    const shiftCards = screen.getByRole('region', { name: 'Ca làm việc dùng chung' })
    expect(within(shiftCards).getByText('08:00 - 12:00')).toBeTruthy()
    expect(within(shiftCards).getByRole('button', { name: 'Sửa Ca sáng' })).toBeTruthy()
    expect(within(shiftCards).getByRole('button', { name: 'Xóa Ca sáng' })).toBeTruthy()

    const metrics = screen.getByRole('region', { name: 'Thống kê lịch phân ca' })
    expect(within(metrics).getByText('Nhân viên đã xếp')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Theo ngày' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Theo tuần' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Theo tháng' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Theo nhân viên' })).toBeTruthy()
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0)

    const toolbar = container.querySelector('.schedule-toolbar-card')
    const cards = container.querySelector('.schedule-shift-card-grid')
    const stats = container.querySelector('.schedule-stat-strip')
    const board = container.querySelector('.schedule-board')
    expect(toolbar.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cards.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(stats.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('exports the selected day with the store employee and shift snapshot', () => {
    renderSchedule()
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }))

    expect(mocked.downloadCsv).toHaveBeenCalledWith(
      `lich-phan-ca-${localDate()}.csv`,
      [expect.objectContaining({
        Ngày: expect.any(String),
        'Mã nhân viên': employee.code,
        'Tên nhân viên': employee.name,
        Ca: shift.name,
        'Giờ bắt đầu': shift.start,
        'Giờ kết thúc': shift.end,
      })],
    )
  })

  it('tags a transferred employee in the daily matrix and daily history', () => {
    const homeStore = { id: 'CH-KVC', name: 'Dosii KVC' }
    const supportEmployee = {
      ...employee,
      id: 'DOSII-KVC-SUPPORT',
      code: 'DOSII-KVC-SUPPORT',
      name: 'Nhân viên hỗ trợ lịch',
      storeId: homeStore.id,
    }
    mocked.app = {
      ...makeApp(),
      stores: [store, homeStore],
      employees: [supportEmployee],
      supportTransfers: [{
        id: 'TR-SCHEDULE', employeeId: supportEmployee.id,
        fromStoreId: homeStore.id, toStoreId: store.id,
        fromDate: localDate(), toDate: localDate(),
      }],
      schedule: [{
        id: 'LICH-SUPPORT', storeId: store.id, employeeId: supportEmployee.id,
        date: localDate(), shiftIds: [shift.id], shiftSnapshots: [shift],
      }],
    }

    renderSchedule()

    expect(screen.getAllByText('Nhân viên hỗ trợ • Từ Dosii KVC')).toHaveLength(2)
  })

  it('shows a future support roster employee and disables a conflicting home-store time', () => {
    const supportEmployee = { ...employee, id: 'GUEST', storeId: 'HOME', name: 'Khách hỗ trợ' }
    mocked.app.employees = []
    mocked.app.supportRoster = [supportEmployee]
    mocked.app.schedule = [{ id: 'HOME-BUSY', storeId: 'HOME', employeeId: 'GUEST', date: localDate(),
      shiftIds: ['HOME-AM'], shiftSnapshots: [{ id: 'HOME-AM', start: '09:00', end: '13:00' }] }]
    mocked.app.supportTransfers = [{ id: 'GRANT', employeeId: 'GUEST', fromStoreId: 'HOME', toStoreId: store.id,
      fromDate: localDate(), toDate: localDate() }]
    renderSchedule()
    fireEvent.click(screen.getByRole('button', { name: 'PHÂN CA' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Chọn Ca sáng/ }))
    expect(within(dialog).getByRole('checkbox', { name: 'Chọn nhân viên Khách hỗ trợ' }).disabled).toBe(true)
    expect(within(dialog).getByText(/Bận tại HOME/)).toBeTruthy()
    expect(within(dialog).getByText(/Nhân viên hỗ trợ/)).toBeTruthy()
  })

  it('keeps the home employee selectable for time outside an assigned support shift', () => {
    mocked.app.schedule = [{ id: 'HOST-BUSY', storeId: 'HOST', employeeId: employee.id, date: localDate(),
      shiftIds: ['HOST-PM'], shiftSnapshots: [{ id: 'HOST-PM', start: '12:00', end: '16:00' }] }]
    mocked.app.supportTransfers = [{ id: 'GRANT', employeeId: employee.id, fromStoreId: store.id, toStoreId: 'HOST',
      fromDate: localDate(), toDate: localDate() }]
    renderSchedule()
    fireEvent.click(screen.getByRole('button', { name: 'PHÂN CA' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Chọn Ca sáng/ }))
    expect(within(dialog).getByRole('checkbox', { name: `Chọn nhân viên ${employee.name}` }).disabled).toBe(false)
  })

  it('creates a reusable shift without reintroducing a required date', async () => {
    renderSchedule()
    fireEvent.click(screen.getByRole('button', { name: 'Tạo ca làm việc' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Ví dụ: Ca sáng'), { target: { value: 'Ca chiều' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'LƯU' }))

    await waitFor(() => expect(mocked.app.createShiftDefinition).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ca chiều',
      storeId: store.id,
    })))
    const payload = mocked.app.createShiftDefinition.mock.calls[0][0]
    expect(payload).not.toHaveProperty('date')
  })

  it('keeps a legacy snapshot-only overnight shift visible in day, week and month views', () => {
    mocked.app.shiftDefinitions = [
      shift,
      { id: 'CA-DEM-OLD', storeId: 'OTHER', name: 'Sai cửa hàng', start: '09:00', end: '17:00', active: true, color: '#000000' },
      { id: 'CA-DEM-OLD', storeId: store.id, name: 'Ca đêm đã xóa', start: '22:00', end: '06:00', active: false, deletedAt: '2026-08-20T00:00:00Z' },
    ]
    mocked.app.schedule = [{
      id: 'LICH-LEGACY',
      storeId: store.id,
      employeeId: employee.id,
      date: localDate(),
      shiftId: 'CA-DEM-OLD',
      shiftSnapshots: [{ id: 'CA-DEM-OLD', name: 'Ca đêm lịch sử' }],
      note: 'Ca qua đêm',
    }]

    const { container } = renderSchedule()
    const board = container.querySelector('.schedule-board')
    expect(within(board).getAllByText('Ca đêm lịch sử').length).toBeGreaterThan(0)
    expect(within(board).getAllByText('22:00 - 06:00 (+1 ngày)').length).toBeGreaterThan(0)

    fireEvent.click(within(board).getByRole('button', { name: 'Theo tuần' }))
    expect(within(board).getByText('Ca đêm lịch sử')).toBeTruthy()
    expect(within(board).getByText('22:00 - 06:00 (+1 ngày)')).toBeTruthy()
    expect(board.querySelector('.schedule-matrix--week')).toBeTruthy()

    fireEvent.click(within(board).getByRole('button', { name: 'Theo tháng' }))
    expect(within(board).getByText('Ca đêm lịch sử')).toBeTruthy()
    expect(board.querySelector('.schedule-matrix--month')).toBeTruthy()
  })

  it('shows an outbound support mirror at the home store without exposing it to edit, delete or export', () => {
    const hostStore = { id: 'CH-HOST', name: 'Dosii Host' }
    const aliasedEmployee = {
      ...employee,
      id: 'PROFILE-MIRROR-01',
      code: 'NV-MIRROR-01',
      employeeId: 'EMPLOYEE-MIRROR-01',
      employeeCode: 'LEGACY-MIRROR-01',
    }
    const supportShift = {
      id: 'CA-HO-TRO', storeId: hostStore.id, name: 'Ca hỗ trợ', start: '12:00', end: '16:00', color: '#7c3aed',
    }
    mocked.app = {
      ...makeApp(),
      stores: [store, hostStore],
      employees: [aliasedEmployee],
      schedule: [{
        id: 'LICH-MIRROR',
        storeId: ' ch-host ',
        storeName: hostStore.name,
        employeeCode: ' nv-mirror-01 ',
        date: localDate(),
        shiftIds: ['ca-ho-tro'],
        shiftSnapshots: [{ ...supportShift, id: 'Ca-Ho-Tro' }],
        projectionMirror: 'support',
        projectionReadOnly: true,
      }],
    }

    const { container } = renderSchedule()
    const employeeRow = container.querySelector('.schedule-matrix--day tbody tr')

    expect(within(employeeRow).getByText('Ca hỗ trợ')).toBeTruthy()
    expect(within(employeeRow).getByText('Hỗ trợ tại Dosii Host')).toBeTruthy()
    expect(within(employeeRow).getByText('Chỉ xem')).toBeTruthy()
    const metrics = screen.getByRole('region', { name: 'Thống kê lịch phân ca' })
    expect(within(metrics).getByText('Nhân viên đã xếp').previousElementSibling.textContent).toBe('1')
    expect(within(metrics).getByText('Chưa phân ca').previousElementSibling.textContent).toBe('0')
    expect(screen.queryByRole('button', { name: 'Sửa lịch Ca hỗ trợ' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xóa lịch Ca hỗ trợ' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }))
    expect(mocked.downloadCsv).not.toHaveBeenCalled()
    expect(mocked.app.notify).toHaveBeenCalledWith('Ngày đang chọn chưa có lịch phân ca để xuất.', 'info')
    expect(mocked.app.replaceScheduleDay).not.toHaveBeenCalled()
  })

  it('keeps a support employee and the host-owned shift visible at the host store', () => {
    const homeStore = { id: 'CH-HOME', name: 'Dosii Home' }
    const hostStore = { id: 'CH-HOST', name: 'Dosii Host' }
    const supportEmployee = {
      ...employee,
      id: 'PROFILE-HOST-42',
      code: 'NV-HO-TRO',
      employeeId: 'EMPLOYEE-HOST-42',
      employeeCode: 'LEGACY-HOST-42',
      name: 'Nhân viên sang hỗ trợ',
      storeId: homeStore.id,
    }
    const hostShift = {
      id: 'HOST-PM', storeId: hostStore.id, name: 'Ca tại cửa hàng hỗ trợ', start: '12:00', end: '16:00', active: true, color: '#7c3aed',
    }
    mocked.app = {
      ...makeApp(),
      activeStore: hostStore,
      activeStoreId: hostStore.id,
      stores: [homeStore, hostStore],
      employees: [supportEmployee],
      shiftDefinitions: [hostShift],
      supportTransfers: [{
        id: 'TR-HOST', employeeCode: 'legacy-host-42', fromStoreId: 'ch-home', toStoreId: 'ch-host',
        fromDate: localDate(), toDate: localDate(),
      }],
      schedule: [{
        id: 'LICH-HOST', storeId: ' ch-host ', employee_id: ' employee-host-42 ', date: localDate(),
        shiftIds: ['host-pm'], shiftSnapshots: [{ ...hostShift, id: 'Host-Pm', storeId: 'Ch-Host' }],
      }],
      replaceScheduleDay: vi.fn().mockResolvedValue({ ok: true }),
    }

    const { container } = renderSchedule()
    const employeeRow = container.querySelector('.schedule-matrix--day tbody tr')

    expect(within(employeeRow).getByText(supportEmployee.name)).toBeTruthy()
    expect(within(employeeRow).getByText(hostShift.name)).toBeTruthy()
    expect(within(employeeRow).queryByText(/^Hỗ trợ tại /)).toBeNull()
    expect(screen.getByRole('button', { name: `Sửa lịch ${hostShift.name}` })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: `Sửa lịch ${hostShift.name}` }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('checkbox', { name: `Chọn ${supportEmployee.name} cho ${hostShift.name}` }).checked).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'LƯU LỊCH' }))
    expect(mocked.app.replaceScheduleDay).toHaveBeenCalledWith(
      [expect.objectContaining({ employeeId: supportEmployee.id, shiftIds: ['host-pm'] })],
      { storeId: hostStore.id, date: localDate() },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }))
    expect(mocked.downloadCsv).toHaveBeenCalledWith(
      `lich-phan-ca-${localDate()}.csv`,
      [expect.objectContaining({
        'Mã nhân viên': supportEmployee.code,
        'Tên nhân viên': supportEmployee.name,
        Ca: hostShift.name,
      })],
    )
  })

  it('renders adjacent home and host shifts together in day, week, month and employee views', () => {
    const hostStore = { id: 'CH-HOST', name: 'Dosii Host' }
    const hostShift = {
      id: 'HOST-PM', storeId: hostStore.id, name: 'Ca hỗ trợ chiều', start: '12:00', end: '16:00', color: '#7c3aed',
    }
    mocked.app = {
      ...makeApp(),
      stores: [store, hostStore],
      schedule: [
        ...makeApp().schedule,
        {
          id: 'LICH-HOST-MIRROR', storeId: hostStore.id, storeName: hostStore.name,
          employeeId: employee.id, date: localDate(), shiftIds: [hostShift.id], shiftSnapshots: [hostShift],
          projectionMirror: 'support', projectionReadOnly: true,
        },
      ],
    }

    const { container } = renderSchedule()
    const board = container.querySelector('.schedule-board')
    const expectBothShiftsIn = (selector) => {
      const row = container.querySelector(`${selector} tbody tr`)
      expect(within(row).getByText(shift.name)).toBeTruthy()
      expect(within(row).getByText(hostShift.name)).toBeTruthy()
      expect(within(row).getByText(`Hỗ trợ tại ${hostStore.name}`)).toBeTruthy()
    }

    expectBothShiftsIn('.schedule-matrix--day')
    fireEvent.click(within(board).getByRole('button', { name: 'Theo tuần' }))
    expectBothShiftsIn('.schedule-matrix--week')
    fireEvent.click(within(board).getByRole('button', { name: 'Theo tháng' }))
    expectBothShiftsIn('.schedule-matrix--month')
    fireEvent.click(within(board).getByRole('button', { name: 'Theo nhân viên' }))
    expectBothShiftsIn('.schedule-matrix--employee')

    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }))
    expect(mocked.downloadCsv).toHaveBeenCalledWith(
      `lich-phan-ca-${localDate()}.csv`,
      [expect.objectContaining({ Ca: shift.name })],
    )
    expect(mocked.downloadCsv.mock.calls[0][1]).toHaveLength(1)
  })

  it('shows a completed support employee on the historical host schedule without reopening scheduling or edit', () => {
    const historyDate = previousLocalDate()
    const homeStore = { id: 'CH-HOME', name: 'Dosii Home' }
    const hostStore = { id: 'CH-HOST', name: 'Dosii Host' }
    const supportEmployee = {
      ...employee,
      id: 'NV-HO-TRO-CU',
      code: 'NV-HO-TRO-CU',
      name: 'Nhân viên hỗ trợ đã hoàn tất',
      storeId: homeStore.id,
    }
    const hostShift = {
      id: 'HOST-HISTORY', storeId: hostStore.id, name: 'Ca hỗ trợ lịch sử', start: '09:00', end: '13:00', active: true, color: '#7c3aed',
    }
    mocked.app = {
      ...makeApp(),
      activeStore: hostStore,
      activeStoreId: hostStore.id,
      stores: [homeStore, hostStore],
      employees: [],
      supportRoster: [supportEmployee],
      shiftDefinitions: [hostShift],
      supportTransfers: [{
        id: 'TR-COMPLETED', employeeId: supportEmployee.id, fromStoreId: homeStore.id, toStoreId: hostStore.id,
        fromDate: historyDate, toDate: historyDate, status: 'Hoàn tất',
      }],
      schedule: [{
        id: 'LICH-HOST-HISTORY', storeId: hostStore.id, employeeId: supportEmployee.id, date: historyDate,
        shiftIds: [hostShift.id], shiftSnapshots: [{ ...hostShift, supportTransferId: 'TR-COMPLETED' }],
      }],
    }

    const { container } = renderSchedule()
    fireEvent.change(screen.getByLabelText('Ngày phân ca'), { target: { value: historyDate } })

    const employeeRow = container.querySelector('.schedule-matrix--day tbody tr')
    expect(within(employeeRow).getByText(supportEmployee.name)).toBeTruthy()
    expect(within(employeeRow).getByText(hostShift.name)).toBeTruthy()
    expect(screen.getByText('Chỉ xem · Thời gian hỗ trợ đã kết thúc.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: `Sửa lịch ${hostShift.name}` })).toBeNull()
    expect(screen.queryByRole('button', { name: `Xóa lịch ${hostShift.name}` })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'PHÂN CA' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Chọn Ca hỗ trợ lịch sử/ }))
    expect(within(dialog).getByRole('checkbox', { name: `Chọn nhân viên ${supportEmployee.name}` }).disabled).toBe(true)
    expect(within(dialog).getByText('Ca nằm ngoài thời gian hỗ trợ được phép.')).toBeTruthy()
  })

  it('overrides the shared 33px row-action size for the Today button', () => {
    const selector = '.unified-schedule-page .schedule-board > .card__subheader .row-actions > .schedule-today-button'
    const start = scheduleStyles.indexOf(selector)
    const rule = scheduleStyles.slice(start, scheduleStyles.indexOf('}', start))

    renderSchedule()
    expect(screen.getByRole('button', { name: 'Hôm nay' }).classList.contains('schedule-today-button')).toBe(true)
    expect(rule).toContain('width: auto')
    expect(rule).toContain('height: auto')
    expect(rule).toContain('min-height: 44px')
    expect(rule).toContain('white-space: nowrap')
    expect(rule).not.toContain('width: 33px')
    expect(rule).not.toContain('height: 33px')
  })
})
