import { act, cleanup, render } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, mergeRecordArrays, STORAGE_KEY, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetAccountAvatar: vi.fn(),
  apiGetState: vi.fn(),
  apiGetStoreWorkspaceState: vi.fn(),
  apiGetSystemScreenState: vi.fn(),
  apiGetStateMetadata: vi.fn(),
  apiLogin: vi.fn(async () => {
    const error = new Error('API unavailable in local fallback test')
    error.code = 'API_UNAVAILABLE'
    throw error
  }),
  apiSelectSessionRole: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  clearApiSession: vi.fn(),
}))

vi.mock('../services/idosiApi', () => ({
  ...api,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  hasApiSession: () => false,
  hasPendingApiRequests: () => false,
  isLocalApiFallbackAllowed: () => true,
}))

const date = '2026-09-08'
const homeAssignment = {
  id: 'S-HOME', employeeId: 'E1', storeId: 'A', date,
  shiftId: 'HOME-AM', shiftIds: ['HOME-AM'],
  shiftSnapshots: [{ id: 'HOME-AM', name: 'Ca chính', start: '08:00', end: '12:00' }],
}
const fixture = () => ({
  ...createInitialState(),
  activeStoreId: 'A',
  stores: [{ id: 'A', name: 'Cửa hàng A' }, { id: 'B', name: 'Cửa hàng B' }],
  employees: [{
    id: 'E1', code: 'E1', employeeCode: 'E1', name: 'Nhân viên 1', unit: 'store',
    unitType: 'store', storeId: 'A', status: 'Đang làm việc', employmentType: 'Full-Time',
  }],
  shiftDefinitions: [
    { id: 'HOME-AM', storeId: 'A', name: 'Ca chính', start: '08:00', end: '12:00', active: true, version: 1 },
    { id: 'HOST-PM', storeId: 'B', name: 'Ca hỗ trợ liền kề', start: '12:00', end: '16:00', active: true, version: 1 },
    { id: 'HOST-OVERLAP', storeId: 'B', name: 'Ca hỗ trợ trùng', start: '10:00', end: '14:00', active: true, version: 1 },
  ],
  schedule: [homeAssignment],
  supportTransfers: [{
    id: 'TR-1', employeeId: 'E1', fromStoreId: 'A', toStoreId: 'B',
    fromDate: date, toDate: date, status: 'Đã duyệt', hourlySupportRate: 35_000,
  }],
})

let appRef
const Probe = forwardRef(function Probe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return null
})

const renderLocalAdmin = async (initialState = fixture()) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState))
  render(<AppProvider><Probe ref={appRef} /></AppProvider>)
  await act(async () => {
    expect((await appRef.current.login('admin', 'idosi123')).ok).toBe(true)
  })
}

const employeeSchedule = () => appRef.current.schedule.filter((record) => record.employeeId === 'E1'
  && record.date === date)

describe('AppContext local schedule fallback', () => {
  beforeEach(() => {
    appRef = createRef()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('keeps home and host records separate, allows adjacency and rejects overlap/outside-grant', async () => {
    await renderLocalAdmin()
    let adjacent
    await act(async () => {
      adjacent = await appRef.current.saveScheduleMultiple(['E1'], ['HOST-PM'], { storeId: 'B', date })
    })

    expect(adjacent.ok).toBe(true)
    expect(employeeSchedule()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'S-HOME', storeId: 'A', shiftIds: ['HOME-AM'] }),
      expect.objectContaining({ storeId: 'B', shiftIds: ['HOST-PM'] }),
    ]))
    expect(employeeSchedule()).toHaveLength(2)

    let overlap
    await act(async () => {
      overlap = await appRef.current.saveScheduleMultiple(['E1'], ['HOST-OVERLAP'], { storeId: 'B', date })
    })
    expect(overlap).toMatchObject({ ok: false, code: 'SCHEDULE_TIME_OVERLAP' })
    expect(employeeSchedule().find((record) => record.storeId === 'B')?.shiftIds).toEqual(['HOST-PM'])

    let outsideGrant
    await act(async () => {
      outsideGrant = await appRef.current.saveScheduleMultiple(['E1'], ['HOST-PM'], { storeId: 'B', date: '2026-09-09' })
    })
    expect(outsideGrant).toMatchObject({ ok: false, code: 'SUPPORT_SCHEDULE_OUTSIDE_WINDOW' })
    expect(appRef.current.schedule.some((record) => record.storeId === 'B' && record.date === '2026-09-09')).toBe(false)
  })

  it('validates replace-day against other stores before replacing the scoped store day', async () => {
    await renderLocalAdmin()
    let adjacent
    await act(async () => {
      adjacent = await appRef.current.replaceScheduleDay([
        { employeeId: 'E1', shiftIds: ['HOST-PM'], note: '' },
      ], { storeId: 'B', date })
    })
    expect(adjacent.ok).toBe(true)
    expect(employeeSchedule()).toHaveLength(2)

    let overlap
    await act(async () => {
      overlap = await appRef.current.replaceScheduleDay([
        { employeeId: 'E1', shiftIds: ['HOST-OVERLAP'], note: '' },
      ], { storeId: 'B', date })
    })
    expect(overlap).toMatchObject({ ok: false, code: 'SCHEDULE_TIME_OVERLAP' })
    expect(employeeSchedule().find((record) => record.storeId === 'B')?.shiftIds).toEqual(['HOST-PM'])
    expect(employeeSchedule().find((record) => record.storeId === 'A')?.shiftIds).toEqual(['HOME-AM'])
  })

  it('keeps idless records for different stores separate during a state rebase', () => {
    const home = { employeeId: 'E1', storeId: 'A', date, shiftIds: ['HOME-AM'] }
    const host = { employeeCode: 'e1', storeId: 'b', date, shiftIds: ['HOST-PM'] }

    expect(mergeRecordArrays([home], [host], 'schedule')).toEqual([home, host])
    expect(mergeRecordArrays([home], [{ ...home, employeeId: undefined, employeeCode: 'e1', storeId: 'a', note: 'newer' }], 'schedule'))
      .toEqual([expect.objectContaining({ note: 'newer' })])
  })

  it('assigns an id when updating a legacy idless schedule without validating unrelated idless rows', async () => {
    const initialState = fixture()
    initialState.schedule = [
      homeAssignment,
      {
        employeeId: 'E1', storeId: 'B', date,
        shiftId: 'HOST-PM', shiftIds: ['HOST-PM'],
        shiftSnapshots: [{ id: 'HOST-PM', name: 'Ca hỗ trợ liền kề', start: '12:00', end: '16:00' }],
      },
      {
        employeeId: 'LEGACY-UNRELATED', storeId: 'A', date,
        shiftId: 'MISSING-SHIFT', shiftIds: ['MISSING-SHIFT'],
      },
    ]
    await renderLocalAdmin(initialState)

    let result
    await act(async () => {
      result = await appRef.current.saveScheduleMultiple(['E1'], ['HOST-PM'], { storeId: 'B', date })
    })

    expect(result.ok).toBe(true)
    const host = employeeSchedule().find((record) => record.storeId === 'B')
    expect(host.id).toMatch(/^SCH/u)
    expect(appRef.current.schedule.find((record) => record.employeeId === 'LEGACY-UNRELATED')).not.toHaveProperty('id')
  })
})
