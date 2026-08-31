import { describe, expect, it } from 'vitest'
import { storeEmployeesForDate } from './StoreOperations'

describe('store operations employee scope', () => {
  it('uses exact store ownership while accepting only unique employee aliases', () => {
    const stores = [{ id: 'STORE-01' }, { id: 'store-01' }, { id: 'S02' }]
    const employees = [
      { id: 'E01', unit: 'store', storeId: 'STORE-01' },
      { id: 'e01', unit: 'store', storeId: 'store-01' },
      { id: 'OUT', unit: 'store', storeId: 'S02' },
    ]
    const transfers = [{
      id: 'TR-1', employeeId: 'out', fromStoreId: 'S02', toStoreId: 'STORE-01',
      fromDate: '2026-08-01', toDate: '2026-08-31', status: 'Đang hỗ trợ',
    }]

    const rows = storeEmployeesForDate(
      employees,
      transfers,
      stores,
      'STORE-01',
      new Date('2026-08-30T09:00:00+07:00'),
    )

    expect(rows.map((row) => row.id)).toEqual(['E01', 'OUT'])
    expect(rows[1]).toMatchObject({ homeStoreId: 'S02', supportStoreId: 'STORE-01' })
  })

  it('fails closed when a mixed-case store alias identifies multiple stores', () => {
    expect(storeEmployeesForDate(
      [{ id: 'E01', unit: 'store', storeId: 'STORE-01' }],
      [],
      [{ id: 'STORE-01' }, { id: 'store-01' }],
      'Store-01',
      new Date('2026-08-30T09:00:00+07:00'),
    )).toEqual([])
  })
})
