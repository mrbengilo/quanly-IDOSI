import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreImportsV2 } from './StoreV2Pages'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
const Location = () => <output data-testid="url">{useLocation().search}</output>
const renderPage = (url = '/store/imports') => render(<MemoryRouter initialEntries={[url]}><StoreImportsV2 /><Location /></MemoryRouter>)
const voucher = (id, createdAt, totalAmount) => ({ id, code: `PN-${id}`, storeId: 'S1', createdAt, goodsAmount: totalAmount, shippingAmount: 0, totalAmount, items: [{ name: id, weight: 1, price: totalAmount }] })

describe('store import history filters', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-31T17:30:00Z'))
    mocked.app = {
      session: { role: 'store_manager', storeId: 'S1' },
      stores: [{ id: 'S1', name: 'Cửa hàng thử nghiệm' }], activeStoreId: 'S1',
      importVouchers: [voucher('Tháng trước', '2026-08-31T16:59:59Z', 100), voucher('Đầu tháng', '2026-08-31T17:00:00Z', 200), voucher('Ngày khác', '2026-09-02T01:00:00Z', 300)],
      createImportVoucher: vi.fn(), updateImportVoucher: vi.fn(), deleteImportVoucher: vi.fn(), notify: vi.fn(),
    }
  })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('defaults to the current Vietnam month and compares the previous month', () => {
    renderPage()
    expect(screen.getByLabelText('Tháng xem').value).toBe('2026-09')
    expect(screen.getByLabelText('Kỳ so sánh').value).toBe('2026-08')
    expect(screen.queryByText('Tháng trước')).toBeNull()
    expect(screen.getByText('Đầu tháng')).toBeTruthy()
    expect(screen.getByText('Ngày khác')).toBeTruthy()
    expect(screen.getAllByText('+400%').length).toBeGreaterThan(0)
    expect(mocked.app.createImportVoucher).not.toHaveBeenCalled()
  })

  it('filters by a day, preserves filters on reload and resets to the current month', () => {
    const view = renderPage()
    fireEvent.change(screen.getByLabelText('Hiển thị theo'), { target: { value: 'day' } })
    expect(screen.getByLabelText('Ngày xem').value).toBe('2026-09-01')
    expect(screen.queryByText('Ngày khác')).toBeNull()
    fireEvent.change(screen.getByLabelText('Ngày xem'), { target: { value: '2026-09-02' } })
    fireEvent.change(screen.getByLabelText('Kỳ so sánh'), { target: { value: '2026-08-31' } })
    expect(screen.getByText('Ngày khác')).toBeTruthy()
    expect(screen.queryByText('Đầu tháng')).toBeNull()
    const url = `/store/imports${screen.getByTestId('url').textContent}`
    view.unmount()
    renderPage(url)
    expect(screen.getByLabelText('Ngày xem').value).toBe('2026-09-02')
    expect(screen.getByLabelText('Kỳ so sánh').value).toBe('2026-08-31')
    fireEvent.click(screen.getByRole('button', { name: 'Tháng hiện tại' }))
    expect(screen.getByLabelText('Tháng xem').value).toBe('2026-09')
    expect(screen.getByTestId('url').textContent).toBe('')
  })

  it('shows an empty period and retains denied mutation controls', () => {
    mocked.app.session = { role: 'employee', storeId: 'S1' }
    renderPage('/store/imports?importView=day&importPeriod=2026-10-01&importCompare=2026-09-30')
    expect(screen.getByText('Không có phiếu nhập hàng trong kỳ 01/10/26.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /THÊM PHIẾU NHẬP/u })).toBeNull()
    expect(screen.queryByRole('button', { name: /Sửa/u })).toBeNull()
    expect(screen.queryByRole('button', { name: /Xóa/u })).toBeNull()
  })
})
