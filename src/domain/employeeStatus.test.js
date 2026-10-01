import { describe, expect, it } from 'vitest'
import { canonicalEmployeeStatus, employeeStatusChangePermission, employeeStatusLabel, employeeStatusOptions } from './employeeStatus'

describe('store employee status mapping and permissions', () => {
  it('maps labels and legacy values to the existing canonical values', () => {
    expect(['Đã nghỉ làm', 'Đã nghỉ việc', 'inactive', 'DA NGHI VIEC'].map(canonicalEmployeeStatus)).toEqual(Array(4).fill('Đã nghỉ việc'))
    expect(['Tạm nghỉ', 'Tạm ngưng', 'locked'].map(canonicalEmployeeStatus)).toEqual(Array(3).fill('Tạm ngưng'))
    expect(['', undefined, 'active', 'Đang làm việc'].map(canonicalEmployeeStatus)).toEqual(Array(4).fill('Đang làm việc'))
    expect(canonicalEmployeeStatus('Trạng thái lạ')).toBe('Trạng thái lạ')
    expect(employeeStatusLabel('inactive')).toBe('Đã nghỉ làm')
  })
  it('allows HTKD to depart store employees only and keeps restore Admin-only', () => {
    const htkd = (unit, from, to) => employeeStatusChangePermission({ actorRole: 'business_support', unit, from, to })
    expect(htkd('store', 'Đang làm việc', 'Đã nghỉ làm').ok).toBe(true)
    expect(htkd('store_manager', 'Đang làm việc', 'Đã nghỉ việc').code).toBe('EMPLOYEE_DELETE_FORBIDDEN')
    expect(htkd('store', 'Đã nghỉ việc', 'Đang làm việc').code).toBe('EMPLOYEE_REACTIVATE_FORBIDDEN')
    expect(employeeStatusChangePermission({ actorRole: 'store_manager', unit: 'store', from: 'Đang làm việc', to: 'inactive' }).ok).toBe(false)
    expect(employeeStatusChangePermission({ actorRole: 'admin', unit: 'store', from: 'Đã nghỉ việc', to: 'Đang làm việc' }).ok).toBe(true)
    expect(htkd('store', 'Tạm nghỉ', 'Tạm ngưng').ok).toBe(true)
  })
  it('offers legacy paused only to Admin or when it is the current value', () => {
    expect(employeeStatusOptions({ actorRole: 'business_support', current: 'Đang làm việc' }).map((option) => option.label)).toEqual(['Đang làm việc', 'Đã nghỉ làm'])
    expect(employeeStatusOptions({ actorRole: 'business_support', current: 'Tạm nghỉ' }).map((option) => option.value)).toEqual(['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ việc'])
    expect(employeeStatusOptions({ actorRole: 'admin', current: 'Đang làm việc' })).toHaveLength(3)
  })
})
