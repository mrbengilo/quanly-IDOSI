import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  const value = new Date()
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
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
})
