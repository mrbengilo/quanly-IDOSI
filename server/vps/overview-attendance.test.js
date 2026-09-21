// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { projectSharedState } from '../worker.js'

it('excludes closed attendance from overview before hydration but preserves overdue shifts and attendance history', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-overview-attendance-'))
  const { server, runtime } = createIdosiServer({ databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'), bootstrapToken: 'overview-attendance', automaticRevenueBonusEnabled: false })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const state = {
    stores: [{ id: 'S1', name: 'Store 1' }], employees: [{ id: 'E1', storeId: 'S1', unit: 'store', name: 'Employee' }],
    attendance: [
      ...Array.from({ length: 300 }, (_, index) => ({ id: `C${index}`, storeId: 'S1', employeeId: 'E1', date: '2026-08-01', checkInAt: '2026-08-01T01:00:00Z', checkOutAt: '2026-08-01T05:00:00Z', note: 'x'.repeat(4000) })),
      { id: 'LEGACY-CLOSED', storeId: 'S1', employeeId: 'E1', date: '2026-08-01', checkOut: '12:00' },
      { id: 'OPEN', storeId: 'S1', employeeId: 'E1', date: '2026-08-01', checkInAt: '2026-08-01T01:00:00Z' },
      { id: 'DELETED', storeId: 'S1', employeeId: 'E1', deletedAt: '2026-08-01' },
    ],
  }
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bootstrap`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-idosi-bootstrap-token': 'overview-attendance' },
      body: JSON.stringify({ username: 'overview.fixture', password: 'synthetic-overview-password', initialState: state }),
    })
    expect(response.status, await response.text()).toBe(201)
    const overview = runtime.database.readStoreStateSnapshot('global', 'S1', '', 'overview', '2026-09')
    const history = runtime.database.readStoreStateSnapshot('global', 'S1', '', 'attendance')
    const attendanceRows = (snapshot) => snapshot.entities.filter((row) => row.collection_key === 'attendance')
    expect(attendanceRows(overview).map((row) => JSON.parse(row.value_json).id)).toEqual(['OPEN'])
    expect(attendanceRows(history).length).toBeGreaterThanOrEqual(302)
    expect(JSON.stringify(overview).length).toBeLessThan(JSON.stringify(history).length / 10)
    // Shared Worker/D1 projection preserves the same response contract without mutating storage.
    expect(projectSharedState(state, { role: 'admin' }, { storeId: 'S1', screen: 'overview' }).attendance.map(({ id }) => id)).toEqual(['OPEN'])
    expect(state.attendance).toHaveLength(303)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
})
