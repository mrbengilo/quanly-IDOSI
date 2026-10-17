import { act, cleanup, render } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, STORAGE_KEY, useApp } from './AppContext'

vi.mock('../services/idosiApi', async (original) => ({
  ...await original(),
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => true,
  apiLogin: async () => { throw Object.assign(new Error('Local fixture'), { code: 'NETWORK_ERROR' }) },
}))

const Probe = forwardRef(function Probe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return null
})

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear() })

describe('local personnel deletion', () => {
  it.each(['business_support', 'manager', 'store_manager', 'employee', 'admin'])('enforces the same target matrix for actor %s', async (role) => {
    const appRef = createRef()
    const initial = createInitialState()
    const actor = { id: 'ACTOR', name: 'Tài khoản thử', username: 'local.actor', password: 'local-test-password', status: 'Đang làm việc', storeId: 'S01', role }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...initial,
      stores: [{ id: 'S01', name: 'Một' }, { id: 'S02', name: 'Hai' }],
      adminAccounts: role === 'admin' ? [actor] : [],
      managerAccounts: ['business_support', 'manager'].includes(role) ? [actor] : [],
      employees: [
        ...(['store_manager', 'employee'].includes(role) ? [{ ...actor, unit: role === 'store_manager' ? 'store_manager' : 'store' }] : []),
        { id: 'STAFF', name: 'Nhân viên', unit: 'store', storeId: 'S02', status: 'Đang làm việc' },
        { id: 'MANAGER', name: 'Quản lý', unit: 'store_manager', storeId: 'S02', status: 'Đang làm việc' },
        { id: 'OFFICE', name: 'Văn phòng', unit: 'office', storeId: 'OFFICE', status: 'Đang làm việc' },
        { id: 'SUPPORT', name: 'HTKD', unit: 'business_support', storeId: 'BUSINESS_SUPPORT', status: 'Đang làm việc' },
      ],
      attendance: [{ id: 'HISTORY', employeeId: 'STAFF', hours: 8 }],
      schedule: [{ id: 'SCHEDULE', employeeId: 'STAFF' }],
    }))
    render(<AppProvider><Probe ref={appRef} /></AppProvider>)
    await act(async () => { expect(await appRef.current.login('local.actor', 'local-test-password')).toMatchObject({ ok: true }) })
    for (const id of ['STAFF', 'MANAGER', 'OFFICE', 'SUPPORT']) {
      const allowed = role === 'admin' || (['business_support', 'manager'].includes(role) && ['STAFF', 'MANAGER'].includes(id))
      await act(async () => { expect(await appRef.current.deleteEmployee(id)).toMatchObject({ ok: allowed }) })
      expect(appRef.current.employees.some((employee) => employee.id === id)).toBe(!allowed)
      expect(appRef.current.deletedEmployees.some((employee) => employee.id === id)).toBe(allowed)
    }
    expect(appRef.current.attendance.some(({ id }) => id === 'HISTORY')).toBe(true)
    await act(async () => { expect(await appRef.current.deleteEmployee('MISSING')).toMatchObject({ ok: false }) })
  })
})
