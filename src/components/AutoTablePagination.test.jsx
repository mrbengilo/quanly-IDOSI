import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AutoTablePagination, { buildTablePages, paginationModeForTable } from './AutoTablePagination'

const row = (date = '') => {
  const element = document.createElement('tr')
  const cell = document.createElement('td')
  cell.textContent = date
  element.append(cell)
  return element
}

const visibleRows = () => [...document.querySelectorAll('tbody tr')].filter((element) => !element.hidden)

const renderTable = ({ path = '/admin/overview', heading = 'Bảng dữ liệu', dates = [] }) => render(
  <MemoryRouter initialEntries={[path]}>
    <div className="workspace-content-region">
      <section className="card">
        <h2>{heading}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {dates.map((date, index) => <tr key={`${date}-${index}`}><td>{date}</td><td>Dòng {index + 1}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
      <AutoTablePagination />
    </div>
  </MemoryRouter>,
)

describe('automatic data-table pagination', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('limits ordinary tables to 20 rows and exposes numbered pages', () => {
    renderTable({ dates: Array.from({ length: 45 }, (_, index) => `Dòng ${index + 1}`) })
    expect(visibleRows()).toHaveLength(20)
    expect(screen.getByRole('navigation', { name: 'Phân trang bảng dữ liệu' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Trang 3' }))
    expect(visibleRows()).toHaveLength(5)
  })

  it('shows today and yesterday together on the first assignment-history page', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T02:00:00Z'))
    renderTable({
      path: '/admin/assignments',
      heading: 'Lịch sử giao việc và tiến độ hoàn thành',
      dates: ['04/09/2026', '03/09/2026', '02/09/2026', '01/09/2026'],
    })
    expect(visibleRows().map((element) => element.textContent)).toEqual([
      expect.stringContaining('04/09/2026'),
      expect.stringContaining('03/09/2026'),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }))
    expect(visibleRows()).toHaveLength(1)
    expect(visibleRows()[0].textContent).toContain('02/09/2026')
  })

  it('shows only the current day first for store order history', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T02:00:00Z'))
    renderTable({
      path: '/store/orders',
      heading: 'Danh sách đơn hàng',
      dates: ['04/09/2026', '04/09/2026', '03/09/2026', '02/09/2026'],
    })
    expect(visibleRows()).toHaveLength(2)
    expect(visibleRows().every((element) => element.textContent.includes('04/09/2026'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }))
    expect(visibleRows()[0].textContent).toContain('03/09/2026')
  })

  it('falls back safely to 20-row pagination when dates cannot be identified', () => {
    const rows = Array.from({ length: 25 }, (_, index) => row(`Không có ngày ${index}`))
    expect(buildTablePages({ rows, mode: 'today-by-day', todayKey: '2026-09-04' })).toHaveLength(2)
    expect(buildTablePages({ rows, mode: 'today-by-day', todayKey: '2026-09-04' })[0]).toHaveLength(20)
  })

  it('selects special modes only for their intended screens and headings', () => {
    expect(paginationModeForTable({
      pathname: '/admin/assignments',
      contextText: 'Lịch sử giao việc và tiến độ hoàn thành',
    })).toBe('assignment-two-days')
    expect(paginationModeForTable({
      pathname: '/store/attendance',
      contextText: 'Lịch sử chấm công của nhân viên',
    })).toBe('today-by-day')
    expect(paginationModeForTable({
      pathname: '/store/rewards',
      contextText: 'Công việc tính thưởng & vi phạm',
    })).toBe('today-by-day')
    expect(paginationModeForTable({ pathname: '/admin/stores', contextText: 'Danh sách cửa hàng' })).toBe('rows-20')
  })
})
