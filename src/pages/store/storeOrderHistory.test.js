import { describe, expect, it, vi } from 'vitest'
import {
  buildStoreOrderPages,
  loadInitialStoreOrderHistory,
} from './storeOrderHistory'

const order = (id, date) => ({ id, code: id, createdAt: `${date}T09:00:00+07:00` })

describe('store order history', () => {
  it('keeps every current-day order together on the first page', () => {
    const currentOrders = Array.from({ length: 49 }, (_, index) => order(`TODAY-${index + 1}`, '2026-09-04'))
    const pages = buildStoreOrderPages([
      ...currentOrders,
      order('YESTERDAY', '2026-09-03'),
      order('OLDER', '2026-09-02'),
    ], { currentDay: '2026-09-04', pageSize: 20 })

    expect(pages[0]).toHaveLength(49)
    expect(pages[0].every((record) => record.id.startsWith('TODAY-'))).toBe(true)
    expect(pages.slice(1).map((page) => page.map(({ id }) => id))).toEqual([
      ['YESTERDAY'],
      ['OLDER'],
    ])
  })

  it('loads subsequent history chunks until the current business day is complete', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        records: [order('TODAY-3', '2026-09-04'), order('TODAY-2', '2026-09-04')],
        page: { hasMore: true, nextCursor: 'next-current-day' },
      })
      .mockResolvedValueOnce({
        records: [order('TODAY-2', '2026-09-04'), order('TODAY-1', '2026-09-04'), order('YESTERDAY', '2026-09-03')],
        page: { hasMore: true, nextCursor: 'next-history' },
      })

    const result = await loadInitialStoreOrderHistory({
      fetchPage,
      query: { storeId: 'DOSII-NTL' },
      currentDay: '2026-09-04',
      pageSize: 2,
    })

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      storeId: 'DOSII-NTL', cursor: 'next-current-day', limit: 2,
    }))
    expect(result.records.map(({ id }) => id)).toEqual(['TODAY-3', 'TODAY-2', 'TODAY-1', 'YESTERDAY'])
    expect(result.page).toEqual({ hasMore: true, nextCursor: 'next-history' })
  })

  it('does not download more history when the first page already reaches an older day', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      records: [order('TODAY', '2026-09-04'), order('YESTERDAY', '2026-09-03')],
      page: { hasMore: true, nextCursor: 'next-history' },
    })

    await loadInitialStoreOrderHistory({
      fetchPage,
      query: { storeId: 'DOSII-NTL' },
      currentDay: '2026-09-04',
    })

    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})
