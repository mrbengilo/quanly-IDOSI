import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueBonusPage } from './RevenueBonusPage'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: vi.fn(),
}))

const storesSeed = [
  { id: 'DOSII-NVT', name: 'Dosii Nguyễn Văn Trỗi', code: 'DOSII-NVT' },
  { id: 'DOSII-DI-AN', name: 'Dosii Dĩ An', code: 'DOSII-DI-AN' },
  { id: 'DOSII-CAN-THO', name: 'Dosii Cần Thơ', code: 'DOSII-CAN-THO' },
  { id: 'SM-TNV', name: 'SM TNV', code: 'SM-TNV', type: 'SM' },
]

const managerApp = (store) => {
  const managerId = `${store.id}-QL`
  const employeeId = `${store.id}-NV`
  const employees = [
    { id: managerId, name: `Quản lý ${store.name}`, unit: 'store', storeId: store.id, isStoreManager: true },
    { id: employeeId, name: `Nhân viên ${store.name}`, unit: 'store', storeId: store.id },
  ]
  return {
    session: { role: 'store_manager', employeeId: managerId, storeId: store.id },
    currentEmployee: employees[0],
    activeStoreId: store.id,
    stores: [store],
    employees,
    orders: [{
      id: `${store.id}-ORDER`, storeId: store.id, amount: 2_000_000, status: 'Hoàn tất',
      createdAt: '2026-09-03T10:00:00+07:00',
    }],
    attendance: [{
      id: `${store.id}-ATT-QL`, storeId: store.id, employeeId: managerId, workDate: '2026-09-03',
      workedSeconds: 3_600, checkOutAt: '2026-09-03T10:00:00+07:00',
    }, {
      id: `${store.id}-ATT-NV`, storeId: store.id, employeeId, workDate: '2026-09-03',
      workedSeconds: 3_600, checkOutAt: '2026-09-03T10:00:00+07:00',
    }],
    revenueBonusDaily: [],
    revenueBonusAllocations: [],
    revenueBonusOverrides: [],
    revenueBonuses: [],
    apiStatus: 'local',
    notify: vi.fn(),
  }
}

describe('store-manager automatic daily revenue bonus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-03T11:00:00.000Z'))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each(storesSeed)('shows automatic team allocation without calculate, approval, edit or delete at $name', (store) => {
    mocked.app = managerApp(store)
    render(<RevenueBonusPage storeScoped />)

    expect(screen.getByRole('group', { name: 'Cửa hàng hiện tại' }).textContent).toContain(store.name)
    expect(screen.getAllByText('TỰ ĐỘNG').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /TÍNH THƯỞNG NGÀY/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Duyệt thưởng mốc cao nhất/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull()
    const table = screen.getByRole('heading', { name: 'Phân bổ thưởng tự động theo nhân viên' }).closest('section')
    expect(within(table).getByText(`Quản lý ${store.name}`)).toBeTruthy()
    expect(within(table).getByText(`Nhân viên ${store.name}`)).toBeTruthy()
  })
})
