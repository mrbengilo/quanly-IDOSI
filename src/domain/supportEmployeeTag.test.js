import { describe, expect, it } from 'vitest'
import {
  resolveSupportEmployeeTagContext,
  SUPPORT_EMPLOYEE_TAG_EFFECTIVE_DATE,
} from './supportEmployeeTag'

const stores = [
  { id: 'HOME', name: 'Dosii Cần Thơ' },
  { id: 'SUPPORT', name: 'SM TNV' },
]
const employee = { id: 'EMP-01', name: 'Nhân viên hỗ trợ', storeId: 'HOME' }
const transfer = {
  id: 'TR-01', employeeId: employee.id, fromStoreId: 'HOME', toStoreId: 'SUPPORT',
  startAt: '2026-09-01T00:00:00+07:00', endAt: '2026-09-05T00:00:00+07:00',
  status: 'Hoàn tất',
}

const resolve = (overrides = {}) => resolveSupportEmployeeTagContext({
  record: {
    employeeId: employee.id,
    storeId: 'SUPPORT',
    businessDate: SUPPORT_EMPLOYEE_TAG_EFFECTIVE_DATE,
    supportTransferId: transfer.id,
  },
  employee,
  employees: [employee],
  stores,
  supportTransfers: [transfer],
  ...overrides,
})

describe('support employee tag context', () => {
  it('accepts null records without crashing or creating a tag', () => {
    expect(resolveSupportEmployeeTagContext({
      record: null,
      employee: null,
      employees: [],
      stores,
      supportTransfers: [],
    })).toBeNull()
  })

  it('keeps records before 01/09/2026 untagged', () => {
    expect(resolve({
      businessDate: '2026-08-31',
      record: {
        employeeId: employee.id,
        storeId: 'SUPPORT',
        supportTransferId: transfer.id,
      },
    })).toBeNull()
  })

  it('starts tagging exactly on 01/09/2026 and resolves the home store', () => {
    expect(resolve()).toEqual(expect.objectContaining({
      employeeId: employee.id,
      businessDate: '2026-09-01',
      homeStoreId: 'HOME',
      homeStoreName: 'Dosii Cần Thơ',
      supportStoreId: 'SUPPORT',
      supportStoreName: 'SM TNV',
      transferId: transfer.id,
    }))
  })

  it('keeps completed transfers available for historical tags', () => {
    expect(resolve({
      businessDate: '2026-09-03',
      record: { employeeId: employee.id, storeId: 'SUPPORT' },
    })).toMatchObject({ homeStoreName: 'Dosii Cần Thơ', supportStoreName: 'SM TNV' })
  })

  it('uses immutable snapshot support fields without requiring a live transfer', () => {
    expect(resolveSupportEmployeeTagContext({
      businessDate: '2026-09-01',
      storeId: 'SUPPORT',
      record: {
        employeeCode: employee.id.toLowerCase(),
        isSupportEmployee: true,
        supportHomeStoreId: 'HOME',
        supportHomeStoreName: 'Dosii Cần Thơ snapshot',
        supportStoreId: 'SUPPORT',
      },
      employees: [employee],
      stores,
      supportTransfers: [],
    })).toMatchObject({
      employeeId: employee.id,
      homeStoreName: 'Dosii Cần Thơ snapshot',
      supportStoreName: 'SM TNV',
    })
  })

  it('does not tag the employee while viewing the home store', () => {
    expect(resolve({ storeId: 'HOME' })).toBeNull()
  })

  it('fails closed when multiple transfer ids are explicitly attached', () => {
    expect(resolveSupportEmployeeTagContext({
      businessDate: '2026-09-02',
      storeId: 'SUPPORT',
      record: {
        employeeId: employee.id,
        storeId: 'SUPPORT',
        supportTransferIds: ['TR-01', 'TR-02'],
      },
      employee,
      employees: [employee],
      stores,
      supportTransfers: [transfer, { ...transfer, id: 'TR-02' }],
    })).toBeNull()
  })

  it('does not trust a cancelled transfer even when its id is present', () => {
    expect(resolve({
      businessDate: '2026-09-02',
      supportTransfers: [{ ...transfer, status: 'Đã hủy' }],
    })).toBeNull()
  })

  it('does not use an explicit transfer linked to another destination store', () => {
    expect(resolve({
      businessDate: '2026-09-02',
      supportTransfers: [{ ...transfer, toStoreId: 'OTHER' }],
    })).toBeNull()
  })
})
