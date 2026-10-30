// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { runWithSqliteMetrics } from './sqlite-d1.mjs'

it('keeps health and real login responsive during a long read-only SQLite query', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-background-snapshot-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'background-test', automaticRevenueBonusEnabled: false,
    backgroundSnapshotReads: true,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    expect(response.ok).toBe(true)
    return response.json()
  }
  try {
    await post('/api/bootstrap', {
      username: 'background.admin', password: 'synthetic-background-test-password',
      initialState: { stores: [{ id: 'S1' }, { id: 'S2' }],
        employees: [{ id: 'E1', storeId: 'S1' }, { id: 'E2', storeId: 'S2' }],
        tasks: [{ id: 'T1', storeId: 'S1', employeeId: 'E1' }, { id: 'T2', storeId: 'S2', employeeId: 'E2' }],
      },
    }, { 'x-idosi-bootstrap-token': 'background-test' })
    const db = runtime.database
    let finished = false
    const slow = db.snapshotReader.query(`WITH RECURSIVE n(x) AS (
      VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x < 8000000
    ) SELECT sum(x) AS total FROM n`, []).then((rows) => { finished = true; return rows })
    const health = await fetch(`${base}/api/health`)
    expect(health.status).toBe(200)
    await health.arrayBuffer()
    const login = await post('/api/login', { username: 'background.admin', password: 'synthetic-background-test-password' })
    expect(login.token).toBeTruthy()
    expect(finished, 'authentication must finish while the SQL worker is still busy').toBe(false)
    expect((await slow)[0].total).toBe(32000004000000)

    // Exactly the same SQL projection, including isolation, manifests and order.
    const background = await db.readStoreStateSnapshot('global', 'S1')
    const taskScreen = await db.readStoreStateSnapshot('global', 'S1', '', 'tasks')
    const reader = db.snapshotReader
    db.snapshotReader = null
    const synchronous = db.readStoreStateSnapshot('global', 'S1')
    const synchronousTaskScreen = db.readStoreStateSnapshot('global', 'S1', '', 'tasks')
    db.snapshotReader = reader
    expect(background).toEqual(synchronous)
    expect(taskScreen).toEqual(synchronousTaskScreen)
    expect(background.entities.filter((row) => row.collection_key === 'tasks')
      .map((row) => JSON.parse(row.value_json).id)).toEqual(['T1'])

    const metrics = { statements: 0, reads: 0, writes: 0, batches: 0, totalMs: 0, maxMs: 0 }
    const global = await runWithSqliteMetrics(metrics, () => db.readStateSnapshot('global'))
    expect(global.row).toBeTruthy()
    expect(metrics.reads).toBe(1)
    expect(metrics.maxStatement).toBe('readStateSnapshot:background')
    const version = Number(global.row.version)
    expect(await db.readStateSnapshot('global', { version, lastRequestId: global.row.last_request_id })).toEqual({ unchanged: true })
    db.database.prepare("UPDATE app_state SET version = version + 1 WHERE scope_key = 'global'").run()
    expect(Number((await db.readStateSnapshot('global')).row.version)).toBe(version + 1)
    await expect(reader.query("DELETE FROM app_state", [])).rejects.toThrow(/readonly|read-only/iu)
    expect(db.database.prepare('SELECT count(*) AS n FROM app_state').get().n).toBe(1)
    // A failed query must not poison subsequent reads.
    expect((await reader.query('SELECT 42 AS value', []))[0].value).toBe(42)
    reader.close()
    await expect(reader.query('SELECT 1', [])).rejects.toThrow(/closed/iu)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
