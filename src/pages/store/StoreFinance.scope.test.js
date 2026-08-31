import { describe, expect, it } from 'vitest'
import { buildStoreFinanceScope } from './StoreFinance'

describe('store finance operational identifier scope', () => {
  it('uses the exact store and employee records when identifiers collide by casing', () => {
    const scope = buildStoreFinanceScope({
      activeStoreId: 'STORE-01',
      session: { role: 'admin' },
      stores: [{ id: 'STORE-01', name: 'Cửa hàng trên' }, { id: 'store-01', name: 'Cửa hàng dưới' }],
      employees: [
        { id: 'E01', unit: 'store', storeId: 'STORE-01', name: 'Nhân viên trên' },
        { id: 'e01', unit: 'store', storeId: 'store-01', name: 'Nhân viên dưới' },
      ],
      attendance: [
        { id: 'A01', employeeId: 'E01', storeId: 'STORE-01' },
        { id: 'a01', employeeId: 'e01', storeId: 'store-01' },
      ],
      imports: [{ id: 'I01', storeId: 'STORE-01' }, { id: 'i01', storeId: 'store-01' }],
    })

    expect(scope.activeStore).toMatchObject({ id: 'STORE-01' })
    expect(scope.employees.map((record) => record.id)).toEqual(['E01'])
    expect(scope.attendance.map((record) => record.id)).toEqual(['A01'])
    expect(scope.imports.map((record) => record.id)).toEqual(['I01'])
  })

  it('fails closed for an ambiguous mixed-case store alias', () => {
    const scope = buildStoreFinanceScope({
      activeStoreId: 'Store-01',
      session: { role: 'admin' },
      stores: [{ id: 'STORE-01' }, { id: 'store-01' }],
      employees: [{ id: 'E01', unit: 'store', storeId: 'STORE-01' }],
      attendance: [{ id: 'A01', employeeId: 'E01', storeId: 'STORE-01' }],
      imports: [{ id: 'I01', storeId: 'STORE-01' }],
    })

    expect(scope.activeStore).toBeNull()
    expect(scope.storeId).toBe('')
    expect(scope.employees).toEqual([])
    expect(scope.attendance).toEqual([])
    expect(scope.imports).toEqual([])
  })
})
