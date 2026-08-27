import { describe, expect, it } from 'vitest'
import { canonicalEmployeeUnit } from './employeeUnit'

describe('canonical employee unit', () => {
  it.each([
    [{ unit: 'store_manager' }, 'canonical unit'],
    [{ unit: 'store-manager' }, 'hyphenated unit'],
    [{ unit: 'store', isStoreManager: true }, 'legacy boolean'],
    [{ unit: 'store', role: 'store_manager' }, 'canonical role'],
    [{ unit: 'store', roles: ['employee', 'store-manager'] }, 'legacy roles'],
    [{ unit: 'store', role: 'QLCH' }, 'legacy abbreviated role'],
    [{ unit: 'store', position: 'Quản lý cửa hàng' }, 'Vietnamese position'],
    [{ unit: 'store', title: 'QUẢN LÝ CỬA HÀNG' }, 'uppercase Unicode title'],
    [{ unit: 'store', title: 'Quản lý cửa hàng' }, 'decomposed Unicode title'],
  ])('classifies manager marker before generic store (%s)', (record) => {
    expect(canonicalEmployeeUnit(record)).toBe('store_manager')
  })

  it.each([
    [{ unit: 'store' }, 'store'],
    [{ unit: 'store_employee' }, 'store'],
    [{ unit: 'business_support' }, 'business_support'],
    [{ unit: 'HTKD' }, 'business_support'],
    [{ unit: 'office' }, 'office'],
    [{ unit: 'store', role: 'admin' }, 'store'],
  ])('preserves non-manager taxonomy %#', (record, expected) => {
    expect(canonicalEmployeeUnit(record)).toBe(expected)
  })

  it.each([
    { unit: 'office', isStoreManager: true },
    { unit: 'business_support', roles: ['store_manager'] },
    { unit: 'unrecognized_unit' },
  ])('fails closed for conflicting or unknown explicit markers %#', (record) => {
    expect(canonicalEmployeeUnit(record)).toBe('unknown')
  })
})
