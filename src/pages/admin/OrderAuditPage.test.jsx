import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderAuditPage } from './GovernancePages'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const audit = ({ id, date, orderCode, action = 'Sửa', before, after }) => ({
  id,
  orderCode,
  orderId: id,
  storeId: 'S01',
  action,
  actor: { name: 'Admin IDOSI' },
  before,
  after,
  createdAt: `${date}T10:15:00+07:00`,
})

describe('OrderAuditPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-04T03:00:00.000Z'))
    mocked.app = {
      stores: [{ id: 'S01', name: 'Dosii Dĩ An' }],
      orderAudit: [
        audit({
          id: 'A-TODAY', date: '2026-09-04', orderCode: 'DIAN-0003',
          before: { amount: 120_000 }, after: { amount: 150_000 },
        }),
        audit({
          id: 'A-YESTERDAY', date: '2026-09-03', orderCode: 'DIAN-0002',
          before: { customerName: 'Lan' }, after: { customerName: 'Linh' },
        }),
        audit({
          id: 'A-OLDER', date: '2026-09-01', orderCode: 'DIAN-0001', action: 'Xóa',
          before: { amount: 80_000 }, after: null,
        }),
      ],
    }
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows only the current business day on the first page and pages older days', () => {
    render(<OrderAuditPage />)

    expect(screen.getByText('DIAN-0003')).toBeTruthy()
    expect(screen.queryByText('DIAN-0002')).toBeNull()
    expect(screen.queryByText('DIAN-0001')).toBeNull()
    expect(screen.getByText(/Ngày 04\/09\/26 · 1 bản ghi/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ngày chỉnh sửa cũ hơn' }))
    expect(screen.getByText('DIAN-0002')).toBeTruthy()
    expect(screen.queryByText('DIAN-0003')).toBeNull()
    expect(screen.getByText('Lan')).toBeTruthy()
    expect(screen.getByText('Linh')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ngày chỉnh sửa cũ hơn' }))
    expect(screen.getByText('DIAN-0001')).toBeTruthy()
    expect(screen.queryByText('DIAN-0002')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ngày chỉnh sửa cũ hơn' }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Ngày chỉnh sửa mới hơn' }))
    expect(screen.getByText('DIAN-0002')).toBeTruthy()
  })

  it('keeps before and after payloads visible inside the selected day', () => {
    render(<OrderAuditPage />)
    expect(screen.getByText('120,000 đ')).toBeTruthy()
    expect(screen.getByText('150,000 đ')).toBeTruthy()
  })
})
