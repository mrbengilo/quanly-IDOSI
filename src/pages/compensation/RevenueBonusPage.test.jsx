import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueBonusPage } from './RevenueBonusPage'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

describe('RevenueBonusPage employee attendance aliases', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-26T05:00:00.000Z'))
    mocked.app = {
      session: { role: 'employee', employeeId: 'NV-01' },
      currentEmployee: {
        id: 'PROFILE-NV-01',
        code: 'CODE-NV-01',
        employeeId: 'NV-01',
        employeeCode: 'STAFF-NV-01',
        storeId: 'CH001',
      },
      stores: [{ id: 'CH001', name: 'Dosii NTL' }],
      employees: [],
      revenueBonuses: [],
      storeDailyRevenue: [],
      teamRewardClaims: [],
      orders: [],
      attendance: [
        {
          id: 'ATT-PROFILE-ID', employeeId: 'PROFILE-NV-01', storeId: 'CH001', date: '2026-08-26',
          checkInAt: '2026-08-26T00:00:00.000Z', checkOutAt: '2026-08-26T01:00:00.000Z', workedSeconds: 3_600,
        },
        {
          id: 'ATT-PROFILE-CODE', employeeId: 'CODE-NV-01', storeId: 'CH001', date: '2026-08-26',
          checkInAt: '2026-08-26T01:00:00.000Z', checkOutAt: '2026-08-26T02:00:00.000Z', workedSeconds: 3_600,
        },
        {
          id: 'ATT-EMPLOYEE-ID', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-26',
          checkInAt: '2026-08-26T02:00:00.000Z', checkOutAt: '2026-08-26T03:00:00.000Z', workedSeconds: 3_600,
        },
        {
          id: 'ATT-SNAKE-CASE', employee_id: 'NV-01', storeId: 'CH001', date: '2026-08-26',
          checkInAt: '2026-08-26T02:00:00.000Z', checkOutAt: '2026-08-26T03:00:00.000Z', workedSeconds: 3_600,
        },
        {
          id: 'ATT-EMPLOYEE-CODE-OPEN', employeeCode: 'STAFF-NV-01', storeId: 'CH001', date: '2026-08-26',
          checkInAt: '2026-08-26T03:00:00.000Z', checkOutAt: null, workedSeconds: 0, hours: 0,
        },
        {
          id: 'ATT-OTHER', employeeId: 'NV-02', storeId: 'CH001', date: '2026-08-26',
          checkInAt: '2026-08-26T00:00:00.000Z', checkOutAt: '2026-08-26T05:00:00.000Z', workedSeconds: 18_000,
        },
      ],
      notify: vi.fn(),
    }
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('sums historical and open attendance through every strict employee profile alias', () => {
    render(<RevenueBonusPage />)

    const hoursMetric = screen.getByText('TỔNG GIỜ LÀM CỦA TÔI').closest('.metric')
    expect(within(hoursMetric).getByText('6.00 giờ')).toBeTruthy()
  })
})
