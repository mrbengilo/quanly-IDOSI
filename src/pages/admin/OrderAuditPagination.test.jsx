import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { today } from '../../utils'
import { OrderAuditPage } from './GovernancePages'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const addDays = (date, amount) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

describe('OrderAuditPage pagination', () => {
  afterEach(cleanup)

  it('shows only the current date first and pages older dates after current-day chunks', () => {
    const current = today()
    const previous = addDays(current, -1)
    mocked.app = {
      stores: [{ id: 'S01', name: 'Dosii Dĩ An' }],
      orderAudit: [
        ...Array.from({ length: 22 }, (_, index) => ({
id: `CURRENT-${index}`,
orderCode: `CURRENT-${index}`,
storeId: 'S01', action: 'Sửa', reason: 'Cập nhật',
actor: { name: 'Admin', role: 'admin' },
createdAt: `${current}T${String(index % 20).padStart(2, '0')}:00:00+07:00`,
before: {}, after: {}, revenueBefore: 1000, revenueAfter: 1000,
        })),
        { id: 'PREVIOUS', orderCode: 'PREVIOUS-DAY', storeId: 'S01', action: 'Xóa', reason: 'Sai đơn', actor: { name: 'Admin', role: 'admin' }, createdAt: `${previous}T12:00:00+07:00`, before: {}, after: {}, revenueBefore: 1000, revenueAfter: 0 },
      ],
    }
    render(<OrderAuditPage />)

    expect(screen.getAllByText(/CURRENT-/u)).toHaveLength(20)
    expect(screen.queryByText('PREVIOUS-DAY')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'SAU' }))
    expect(screen.getAllByText(/CURRENT-/u)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'SAU' }))
    expect(screen.getByText('PREVIOUS-DAY')).toBeTruthy()
    expect(screen.getByText((_, element) => element?.classList.contains('admin-table-page-context') && element.textContent.includes(previous.slice(8, 10)))).toBeTruthy()
  })
})
