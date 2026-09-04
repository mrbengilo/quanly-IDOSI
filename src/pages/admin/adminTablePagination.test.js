import { describe, expect, it } from 'vitest'
import { paginateRows, paginateRowsByDate } from './adminTablePagination'

describe('admin table pagination', () => {
  it('uses 20 rows per page and clamps an invalid requested page', () => {
    const rows = Array.from({ length: 45 }, (_, index) => index + 1)
    expect(paginateRows(rows, 1)).toMatchObject({
      page: 1, pageCount: 3, totalRows: 45, rows: rows.slice(20, 40),
    })
    expect(paginateRows(rows, 99)).toMatchObject({ page: 2, rows: rows.slice(40) })
  })

  it('keeps the focus date first, then paginates previous dates newest first', () => {
    const rows = [
      ...Array.from({ length: 22 }, (_, index) => ({ id: `today-${index}`, date: '2026-09-04' })),
      { id: 'oldest', date: '2026-09-02' },
      { id: 'previous', date: '2026-09-03' },
    ]
    const first = paginateRowsByDate({ rows, dateOf: (row) => row.date, focusDate: '2026-09-04' })
    const second = paginateRowsByDate({ rows, dateOf: (row) => row.date, focusDate: '2026-09-04', requestedPage: 1 })
    const third = paginateRowsByDate({ rows, dateOf: (row) => row.date, focusDate: '2026-09-04', requestedPage: 2 })
    expect(first).toMatchObject({ pageCount: 4, date: '2026-09-04', datePage: 0 })
    expect(first.rows).toHaveLength(20)
    expect(second).toMatchObject({ date: '2026-09-04', datePage: 1 })
    expect(second.rows).toHaveLength(2)
    expect(third).toMatchObject({ date: '2026-09-03', rows: [{ id: 'previous', date: '2026-09-03' }] })
  })

  it('still creates an empty first page for the requested current date', () => {
    const result = paginateRowsByDate({
      rows: [{ id: 'old', date: '2026-09-03' }],
      dateOf: (row) => row.date,
      focusDate: '2026-09-04',
    })
    expect(result).toMatchObject({ page: 0, pageCount: 2, date: '2026-09-04', rows: [] })
  })
})
