import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MyViolationsPage, ViolationManagementPage } from './ViolationManagementPage'
import { MyCompensationPage } from './MyCompensationPage'
import { WorkCatalogSettingsPage } from '../admin/WorkCatalogSettingsPage'
const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
const employee = { id: 'E1', code: 'NV01', name: 'Nhân viên Nguyễn Văn A', unit: 'store', storeId: 'S1' }
const entry = (points, status = 'ACTIVE') => ({ id: 'V1', targetUnit: 'store', employeeId: 'E1', storeId: 'S1', title: 'Vi phạm đã ghi nhận', occurredOn: '2026-09-02', period: '2026-09', violationPoints: points, amountVnd: 0, status })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-09T03:00:00Z'))
  mocked.app = { session: { role: 'employee', employeeId: 'E1', storeId: 'S1' }, currentEmployee: employee, employees: [employee], stores: [{ id: 'S1', name: 'Cửa hàng một' }], violations: [], notify: vi.fn() }
})
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('violation point user flows', () => {
  it('always shows milestones, highlights each reached threshold, and resets the assessment for another month', () => {
    const { container, rerender } = render(<MyViolationsPage />)
    expect(screen.getByRole('table', { name: 'Các mốc đánh giá trong kỳ' })).toBeTruthy()
    expect(container.querySelector('[aria-current="step"]')).toBeNull()
    for (const points of [3, 5, 6, 6.5]) {
      mocked.app = { ...mocked.app, violations: [entry(points), { ...entry(10), id: 'VOID', status: 'VOID' }, { ...entry(10), id: 'OTHER', employeeId: 'OTHER' }] }
      rerender(<MyViolationsPage />)
      expect(container.querySelector('[aria-current="step"]').textContent).toContain(`≥ ${Math.min(Math.floor(points), 6)}`)
      expect(screen.getByRole('alert').textContent).toContain(`${String(points).replace('.', ',')} điểm`)
      expect(screen.queryByText('OTHER')).toBeNull()
    }
    fireEvent.change(screen.getByLabelText('Kỳ đánh giá vi phạm'), { target: { value: '2026-10' } })
    expect(container.querySelector('[aria-current="step"]')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(/0 điểm/)).toBeTruthy()
  })
  it('uses the authorized store summary even when peer violation details are private', () => {
    mocked.app = { ...mocked.app, session: { role: 'store_manager', storeId: 'S1' }, violationPointSummaries: [{ employeeId: 'E1', period: '2026-09', count: 3, points: 5, threshold: 5, label: 'Không nhận thưởng', tone: 'red', workBonusBlocked: true }] }
    render(<ViolationManagementPage targetUnit="store" storeId="S1" embedded />)
    const table = screen.getByRole('table', { name: 'Đánh giá điểm vi phạm từng nhân viên' })
    expect(within(table).getByText('5 điểm')).toBeTruthy()
    expect(within(table).getByText('Thưởng doanh thu: 0 đ · Thưởng công việc: 0 đ')).toBeTruthy()
  })
  it('retains the assessment of a former employee with violations in the selected period', () => {
    mocked.app = { ...mocked.app, session: { role: 'store_manager', storeId: 'S1' }, employees: [{ ...employee, status: 'Đã nghỉ việc' }], violations: [entry(5)] }
    render(<ViolationManagementPage targetUnit="store" storeId="S1" embedded />)
    const table = screen.getByRole('table', { name: 'Đánh giá điểm vi phạm từng nhân viên' })
    expect(within(table).getByText(employee.name)).toBeTruthy()
    expect(within(table).getByText('5 điểm')).toBeTruthy()
  })
  it('displays both zero bonuses while retaining original awards and other income', () => {
    mocked.app = { ...mocked.app, violations: [entry(5)], compensationEntries: ['WORK', 'REVENUE', 'MANUAL', 'ALLOWANCE'].map((type) => ({ id: type, type, employeeId: 'E1', period: '2026-09', effectiveDate: '2026-09-02', status: 'APPROVED', amountVnd: 5000 })) }
    render(<MyCompensationPage />)
    const card = screen.getByRole('heading', { name: 'Tóm tắt quyết toán' }).closest('section')
    for (const label of ['Thưởng doanh thu', 'Thưởng công việc']) expect(within(card).getByText(label).parentElement.textContent).toContain('0 đ')
    for (const label of ['Thưởng thủ công', 'Phụ cấp']) expect(within(card).getByText(label).parentElement.textContent).toContain('5,000 đ')
    const awardNotes = screen.getAllByText('Trước áp dụng điểm: 5,000 đ')
    expect(awardNotes).toHaveLength(2)
    for (const note of awardNotes) expect(within(note.closest('td')).getByText('0 đ')).toBeTruthy()
  })
  it('saves decimal comma points with zero money and accessible icon-only actions', async () => {
    const updateWorkCatalogItem = vi.fn().mockResolvedValue({ ok: true })
    mocked.app = { ...mocked.app, session: { role: 'admin' }, updateWorkCatalogItem, workCatalogItems: [{ id: 'CAT', code: 'store.violation.late', targetGroup: 'store', kind: 'VIOLATION', name: 'Đi trễ', amountVnd: 0, violationPoints: 1, version: 1 }] }
    render(<WorkCatalogSettingsPage />)
    const edit = screen.getByRole('button', { name: 'Sửa Đi trễ' })
    expect(edit.textContent).toBe('')
    expect(screen.getByRole('button', { name: 'Ngừng sử dụng Đi trễ' }).textContent).toBe('')
    fireEvent.click(edit)
    fireEvent.change(screen.getByLabelText('Điểm vi phạm'), { target: { value: '10,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU', exact: true }))
    expect(updateWorkCatalogItem).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'LƯU', exact: true }).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('Điểm vi phạm'), { target: { value: '0,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU', exact: true }))
    await waitFor(() => expect(updateWorkCatalogItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'CAT', violationPoints: 0.5, amountVnd: 0, expectedVersion: 1 })))
  })
})
