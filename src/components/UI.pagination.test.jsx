import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TableWrap } from './UI'

const rows = (count, prefix = 'Dòng') => Array.from({ length: count }, (_, index) => (
  <tr key={`${prefix}-${index + 1}`}><td>{prefix} {index + 1}</td></tr>
))

describe('TableWrap pagination', () => {
  afterEach(cleanup)

  it('renders at most 20 data rows and exposes numbered pages', () => {
    render(<TableWrap><thead><tr><th>Nội dung</th></tr></thead><tbody>{rows(45)}</tbody></TableWrap>)

    expect(screen.getByText('Dòng 1')).toBeTruthy()
    expect(screen.getByText('Dòng 20')).toBeTruthy()
    expect(screen.queryByText('Dòng 21')).toBeNull()
    expect(screen.getByRole('button', { name: 'Trang 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Trang 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Trang 3' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }))
    expect(screen.queryByText('Dòng 1')).toBeNull()
    expect(screen.getByText('Dòng 21')).toBeTruthy()
    expect(screen.getByText('Dòng 40')).toBeTruthy()
    expect(screen.queryByText('Dòng 41')).toBeNull()
  })

  it('isolates the configured current date on page one without backfilling older rows', () => {
    render(<TableWrap firstPageDates={['2026-09-04']}>
      <thead><tr><th>Nội dung</th></tr></thead>
      <tbody>
        <tr data-page-date="2026-09-04"><td>Hôm nay 1</td></tr>
        <tr data-page-date="2026-09-04"><td>Hôm nay 2</td></tr>
        <tr data-page-date="2026-09-03"><td>Hôm qua</td></tr>
        <tr data-page-date="2026-09-02"><td>Ngày cũ</td></tr>
      </tbody>
    </TableWrap>)

    expect(screen.getByText('Hôm nay 1')).toBeTruthy()
    expect(screen.getByText('Hôm nay 2')).toBeTruthy()
    expect(screen.queryByText('Hôm qua')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }))
    expect(screen.getByText('Hôm qua')).toBeTruthy()
    expect(screen.queryByText('Ngày cũ')).toBeNull()
  })

  it('keeps total rows visible while paging data rows', () => {
    render(<TableWrap><thead><tr><th>Nội dung</th></tr></thead><tbody>{rows(22)}<tr className="total-row"><td>TỔNG CỘNG</td></tr></tbody></TableWrap>)

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(22)
    expect(screen.getByText('TỔNG CỘNG')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }))
    expect(screen.getByText('Dòng 21')).toBeTruthy()
    expect(screen.getByText('TỔNG CỘNG')).toBeTruthy()
  })
})
