import { act, cleanup, render, waitFor } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, useApp } from './AppContext'
import { scheduleSwapRevision } from '../domain/scheduleSwap'

const api = vi.hoisted(() => Object.fromEntries(['apiBootstrapState', 'apiCommand', 'apiGetAccountAvatar', 'apiGetState',
  'apiGetStoreWorkspaceState', 'apiGetSystemScreenState', 'apiGetStateMetadata', 'apiLogin', 'apiSelectSessionRole', 'apiListUsers',
  'apiLogout', 'clearApiSession'].map((name) => [name, vi.fn()])))
vi.mock('../services/idosiApi', () => ({ ...api, apiPolicyEntries: () => [], apiPolicyMap: () => ({}),
  hasApiSession: () => false, hasPendingApiRequests: () => false, isLocalApiFallbackAllowed: () => false }))
const admin = { id: 'ADMIN', username: 'admin', role: 'admin', status: 'active', version: 1 }
let appRef, remoteState, remoteVersion
const Probe = forwardRef(function Probe(_props, ref) {
  const app = useApp(); useImperativeHandle(ref, () => app, [app]); return null
})
const payload = () => ({ storeId: 'STORE', date: '2026-10-22', ...Object.fromEntries(['a', 'b'].map((side, index) => {
  const row = appRef.current.schedule[index]
  return [side, { assignmentId: row.id, employeeId: row.employeeId, shiftId: row.shiftIds[0], revision: scheduleSwapRevision(row) }]
})) })
beforeEach(async () => {
  appRef = createRef(); localStorage.clear(); sessionStorage.clear(); remoteVersion = 1
  const shifts = [{ id: 'AM', name: 'Ca sáng', storeId: 'STORE', start: '08:00', end: '12:00' },
    { id: 'PM', name: 'Ca chiều', storeId: 'STORE', start: '12:00', end: '16:00' }]
  remoteState = { ...createInitialState(), activeStoreId: 'STORE', stores: [{ id: 'STORE', name: 'Fixture' }],
    employees: ['A', 'B'].map((id) => ({ id, code: id, name: id, unit: 'store', storeId: 'STORE', status: 'Đang làm việc' })),
    shiftDefinitions: shifts, attendance: [], tasks: [], orders: [], supportTransfers: [],
    schedule: ['A', 'B'].map((employeeId, index) => ({ id: `ASS-${employeeId}`, employeeId, storeId: 'STORE', date: '2026-10-22', shiftIds: [shifts[index].id], shiftSnapshots: [shifts[index]] })) }
  const read = async () => ({ user: admin, state: remoteState, policies: [], version: remoteVersion })
  api.apiLogin.mockResolvedValue({ user: admin }); api.apiBootstrapState.mockImplementation(read)
  api.apiGetState.mockImplementation(read); api.apiGetSystemScreenState.mockImplementation(read)
  api.apiGetStoreWorkspaceState.mockImplementation(read); api.apiListUsers.mockResolvedValue({ users: [admin] })
  api.apiGetStateMetadata.mockImplementation(async () => ({ version: remoteVersion }))
  api.apiLogout.mockResolvedValue({ ok: true })
  render(<AppProvider><Probe ref={appRef} /></AppProvider>)
  await act(async () => { expect((await appRef.current.login('admin', 'synthetic')).ok).toBe(true) })
})
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.resetAllMocks() })

it('sends one command and applies both saved assignments together before authoritative refresh', async () => {
  const intent = payload(); const before = structuredClone(appRef.current.schedule)
  api.apiCommand.mockImplementation(async () => {
    remoteVersion = 2
    remoteState = { ...remoteState, schedule: before.map((row, index) => ({ ...row,
      shiftIds: before[1 - index].shiftIds, shiftSnapshots: before[1 - index].shiftSnapshots })) }
    return { version: 2, assignments: remoteState.schedule }
  })
  await act(async () => { expect((await appRef.current.swapScheduleShifts(intent, 'stable-key')).ok).toBe(true) })
  expect(api.apiCommand).toHaveBeenCalledWith('schedule.swap', intent, { expectedVersion: 1, idempotencyKey: 'stable-key', includeState: false })
  expect(appRef.current.schedule.map((row) => row.shiftIds)).toEqual([['PM'], ['AM']])
  await waitFor(() => expect(api.apiGetState.mock.calls.length + api.apiGetSystemScreenState.mock.calls.length).toBeGreaterThan(0))
  expect(appRef.current.attendance).toEqual([])
})
it('never falls back to local success on remote failure and forwards the same retry key', async () => {
  const before = structuredClone(appRef.current.schedule); const intent = payload()
  api.apiCommand.mockRejectedValue(new Error('Network unavailable'))
  await act(async () => {
    expect(await appRef.current.swapScheduleShifts(intent, 'retry-key')).toMatchObject({ ok: false, message: 'Network unavailable' })
    expect(await appRef.current.swapScheduleShifts(intent, 'retry-key')).toMatchObject({ ok: false })
  })
  expect(appRef.current.schedule).toEqual(before)
  expect(api.apiCommand.mock.calls.map((call) => call[2].idempotencyKey)).toEqual(['retry-key', 'retry-key'])
})
it('refreshes on version conflict, returns actionable error and does not retry the old intent', async () => {
  api.apiCommand.mockRejectedValue(Object.assign(new Error('stale'), { code: 'VERSION_CONFLICT' }))
  const beforeReads = api.apiGetState.mock.calls.length
  await act(async () => {
    expect(await appRef.current.swapScheduleShifts(payload(), 'conflict-key')).toMatchObject({ ok: false, code: 'VERSION_CONFLICT', message: 'Lịch phân ca đã thay đổi, vui lòng kiểm tra lại.' })
  })
  expect(api.apiCommand).toHaveBeenCalledTimes(1)
  expect(api.apiGetState.mock.calls.length).toBeGreaterThan(beforeReads)
  expect(appRef.current.schedule.map((row) => row.shiftIds)).toEqual([['AM'], ['PM']])
})

it('does not overwrite a newer schedule delta with a late swap receipt', async () => {
  const before = structuredClone(appRef.current.schedule)
  let finish
  api.apiCommand.mockImplementation((type) => type === 'schedule.swap'
    ? new Promise((resolve) => { finish = resolve })
    : Promise.resolve({ version: 3, assignments: before.map((row) => ({ ...row, note: 'Newer edit' })) }))
  let pending
  await act(async () => { pending = appRef.current.swapScheduleShifts(payload(), 'late-key') })
  await act(async () => { await appRef.current.saveScheduleMultiple(['A'], ['AM'], { storeId: 'STORE', date: '2026-10-22' }) })
  await act(async () => { finish({ version: 2, assignments: before }); await pending })
  expect(appRef.current.schedule.map((row) => row.note)).toEqual(['Newer edit', 'Newer edit'])
})

it('does not merge a prior account response after login under another account in the same scope', async () => {
  const previous = structuredClone(appRef.current.schedule)
  let finish
  api.apiCommand.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  let pending
  await act(async () => { pending = appRef.current.swapScheduleShifts(payload(), 'previous-account') })
  await act(async () => { appRef.current.logout() })
  const other = { ...admin, id: 'SECOND-ADMIN', username: 'second' }
  const read = async () => ({ user: other, state: remoteState, policies: [], version: 1 })
  api.apiLogin.mockResolvedValue({ user: other }); api.apiBootstrapState.mockImplementation(read); api.apiGetState.mockImplementation(read)
  await act(async () => { expect((await appRef.current.login('second', 'synthetic')).ok).toBe(true) })
  await act(async () => {
    finish({ version: 2, assignments: previous.map((row) => ({ ...row, note: 'Old account response' })) })
    await pending
  })
  expect(appRef.current.schedule.some((row) => row.note === 'Old account response')).toBe(false)
})
