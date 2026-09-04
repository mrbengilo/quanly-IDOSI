import { describe, expect, it } from 'vitest'
import {
  buildPaginatedPages,
  paginationSequence,
  shiftBusinessDate,
} from './tablePagination'

describe('table pagination helpers', () => {
  it('caps ordinary pages at 20 records', () => {
    const pages = buildPaginatedPages(Array.from({ length: 45 }, (_, index) => index + 1))
    expect(pages.map((page) => page.length)).toEqual([20, 20, 5])
  })

  it('keeps the requested current-date bucket alone on page one', () => {
    const rows = [
      { id: 'today-1', date: '2026-09-04' },
      { id: 'today-2', date: '2026-09-04' },
      { id: 'yesterday-1', date: '2026-09-03' },
      { id: 'older-1', date: '2026-09-02' },
    ]
    const pages = buildPaginatedPages(rows, {
      getDate: (row) => row.date,
      firstPageDates: ['2026-09-04'],
      groupRemainingByDate: true,
    })

    expect(pages.map((page) => page.map((row) => row.id))).toEqual([
      ['today-1', 'today-2'],
      ['yesterday-1'],
      ['older-1'],
    ])
  })

  it('orders older date pages from newest to oldest even when input is unsorted', () => {
    const rows = [
      { id: 'oldest', date: '2026-09-01' },
      { id: 'today', date: '2026-09-04' },
      { id: 'middle', date: '2026-09-02' },
      { id: 'yesterday', date: '2026-09-03' },
    ]
    const pages = buildPaginatedPages(rows, {
      getDate: (row) => row.date,
      firstPageDates: ['2026-09-04'],
      groupRemainingByDate: true,
    })

    expect(pages.map((page) => page.map((row) => row.id))).toEqual([
      ['today'],
      ['yesterday'],
      ['middle'],
      ['oldest'],
    ])
  })

  it('allows today and yesterday to share the recent assignment-history bucket', () => {
    const rows = [
      { id: 'today', date: '2026-09-04' },
      { id: 'yesterday', date: '2026-09-03' },
      { id: 'older', date: '2026-09-02' },
    ]
    const pages = buildPaginatedPages(rows, {
      getDate: (row) => row.date,
      firstPageDates: ['2026-09-04', '2026-09-03'],
      groupRemainingByDate: true,
    })

    expect(pages[0].map((row) => row.id)).toEqual(['today', 'yesterday'])
    expect(pages[1].map((row) => row.id)).toEqual(['older'])
  })

  it('shifts ISO business dates without local-time drift', () => {
    expect(shiftBusinessDate('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftBusinessDate('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('uses compact numbered controls for long histories', () => {
    expect(paginationSequence(1, 12)).toEqual([1, 2, 3, 4, 'end-ellipsis', 12])
    expect(paginationSequence(6, 12)).toEqual([1, 'start-ellipsis', 5, 6, 7, 'end-ellipsis', 12])
  })
})
