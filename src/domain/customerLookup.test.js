import { expect, it } from 'vitest'
import { customerDirectory, customerHasPurchaseHistory, customerPublicInfo, customerSuggestions, customerHistoryForStore, customerOrderDetails } from './customerLookup'

const order = (id, overrides = {}) => ({ id, storeId: 'S1', customerName: 'Nguyễn Ánh', customerPhone: '090 123 4567', ...overrides })
const directory = () => customerDirectory([
  order('O1'), order('O2', { customerName: 'Ánh Nguyễn', createdAt: '2026-10-30' }),
  order('OTHER', { storeId: 'S2', customerPhone: '0999999999' }),
  order('DELETED', { deletedAt: '2026-10-30', customerPhone: '0111111111' }),
  order('BALANCE', { source: 'legacy-opening-balance', customerPhone: '0222222222' }),
  order('NO-PHONE', { customerPhone: '', customerName: 'Đặng An' }),
], { storeId: 'S1' })

it('suggests by accented/unaccented name aliases or normalized phone, with compact history tags', () => {
  const customers = directory()
  expect(customerSuggestions(customers, 'nguyen anh', 'name')).toEqual([
    { key: 'phone:0901234567', customerName: 'Ánh Nguyễn', customerPhone: '0901234567', hasPurchaseHistory: true },
  ])
  expect(customerSuggestions(customers, 'dang', 'name')[0].customerName).toBe('Đặng An')
  expect(customerSuggestions(customers, '090 123')).toHaveLength(1)
  expect(customerSuggestions(customers, '0')).toEqual([])
  expect(customerSuggestions(customers, 'n', 'name')).toEqual([])
  expect(customerSuggestions(customers, '099')).toEqual([])
  expect(customerSuggestions(customers, '011')).toEqual([])
  expect(customerSuggestions(customers, '022')).toEqual([])
  expect(customerPublicInfo(customers[0]).hasPurchaseHistory).toBe(true)
  expect(customerPublicInfo({ orderCount: 0 }).hasPurchaseHistory).toBe(false)
})

it('classifies only exact contacts independently of truncated suggestions', () => {
  const customers = directory()
  expect(customerHasPurchaseHistory(customers, '090-123-4567')).toBe(true)
  expect(customerHasPurchaseHistory(customers, 'nguyen anh', 'name')).toBe(true)
  expect(customerHasPurchaseHistory(customers, 'dang an', 'name')).toBe(true)
  expect(customerHasPurchaseHistory(customers, 'nguyen', 'name')).toBe(false)
  expect(customerHasPurchaseHistory(customers, '090123')).toBe(false)
  expect(customerHasPurchaseHistory(customers, '')).toBe(false)
  expect(customerHasPurchaseHistory(customers, '0999999999')).toBe(false)
  const many = customerDirectory(Array.from({ length: 15 }, (_, i) => order(`O${i}`, { customerPhone: `09000000${String(i).padStart(2, '0')}` })))
  expect(customerSuggestions(many, '09')).toHaveLength(10)
  const last = many.at(-1)
  expect(customerHasPurchaseHistory(many, last.customerPhone)).toBe(true)
})

it('recognizes purchases across stores while exposing only the selected store history and count', () => {
  const [customer] = customerDirectory([order('S1-ORDER'), order('S2-ORDER', { storeId: 'S2' })])
  expect(customer.orderCount).toBe(2)
  const otherStore = customerHistoryForStore(customer, 'S3')
  expect(customerPublicInfo(otherStore)).toMatchObject({ hasPurchaseHistory: true, orderCount: 0 })
  expect(otherStore.orders).toEqual([])
  const ownStore = customerHistoryForStore(customer, 's1')
  expect(ownStore.orders.map((row) => row.id)).toEqual(['S1-ORDER'])
  expect(customerPublicInfo(ownStore)).toMatchObject({ hasPurchaseHistory: true, orderCount: 1 })
  expect(customerHistoryForStore(customer).orderCount).toBe(2)
})

it('groups the same phone across stores while preserving distinct contacts and missing phones', () => {
  const orders = [order('A'), order('B', { storeId: 'S2', customerPhone: '0901234567' }),
    order('C', { customerPhone: '0999999999' }), order('D', { customerPhone: '' }),
    order('E', { storeId: 'S2', customerPhone: '' }), order('DELETED', { deletedAt: '2026-10-30' }),
    order('BALANCE', { source: 'legacy-opening-balance' })]
  const customers = customerDirectory(orders)
  expect(customers).toHaveLength(4)
  expect(customers.find((row) => row.key === 'phone:0901234567').orderCount).toBe(2)
  expect(customerDirectory(orders, { storeId: 'S1' }).find((row) => row.key === 'phone:0901234567').orderCount).toBe(1)
})

it('resolves directory names and archived seller codes, preserves sale snapshots and handles missing profiles', () => {
  const directories = { stores: [{ id: 'S1', name: 'Cửa hàng Một' }],
    employees: [], deletedEmployees: [{ id: 'E1', code: 'OLD', name: 'Nhân viên cũ', salary: 999 }] }
  expect(customerOrderDetails(order('O', { employeeId: 'old' }), directories)).toMatchObject({
    storeName: 'Cửa hàng Một', employeeName: 'Nhân viên cũ',
  })
  expect(customerOrderDetails(order('O', { employeeId: 'OLD', storeName: 'Tên lúc mua', employeeName: 'Tên lúc bán' }), directories))
    .toMatchObject({ storeName: 'Tên lúc mua', employeeName: 'Tên lúc bán' })
  expect(customerOrderDetails(order('O', { employeeId: 'UNKNOWN', storeId: 'UNKNOWN' }), directories))
    .toMatchObject({ storeName: '', employeeName: '' })
  expect(customerOrderDetails(order('O'), directories).salary).toBeUndefined()
})
