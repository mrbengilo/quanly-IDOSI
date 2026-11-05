// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createSqliteD1 } from './sqlite-d1.mjs'
import worker from '../worker.js'

it.each([false, true])('saves every catalog kind without hydrating operational history (D1 fallback: %s)', async (fallback) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-catalog-save-'))
  const db = createSqliteD1({ databasePath: resolve(directory, 'state.sqlite') })
  const env = { DB: db, BOOTSTRAP_TOKEN: 'catalog-fixture' }
  const post = async (path, body, headers = {}) => {
    const response = await worker.fetch(new Request(`https://idosi.example${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    }), env)
    return { status: response.status, body: await response.json() }
  }
  try {
    const historyKeys = ['attendance', 'tasks', 'taskAssignmentHistory', 'workCatalogProgress', 'schedule',
      'compensationEntries', 'teamRewardClaims', 'storeShiftTaskTemplates']
    const initialState = {
      stores: [{ id: 'S1', name: 'Store one' }, { id: 'S2', name: 'Store two' }],
      employees: [{ id: 'H', name: 'Support', unit: 'business_support', storeId: 'BUSINESS_SUPPORT' }],
      ...Object.fromEntries(historyKeys.map((collection) => [collection, Array.from({ length: 30 }, (_, index) => ({
        id: `${collection}-${index}`, employeeId: 'H', storeId: 'S2', date: '2026-09-01',
        checkOutAt: '2026-09-01T10:00:00Z', detail: 'UNRELATED-HISTORY'.repeat(100),
        checklistSnapshot: { source: 'work-catalog', tasks: [{ id: 'CAPTURED', name: 'Original snapshot', amountVnd: 3000 }] },
      }))])),
    }
    expect((await post('/api/bootstrap', { username: 'catalog.admin', password: 'synthetic-catalog-password', initialState },
      { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN })).status).toBe(201)
    const raw = db.database
    const rows = (collection) => raw.prepare('SELECT value_json FROM state_entities WHERE collection_key=? ORDER BY entity_key')
      .all(collection).map(({ value_json }) => value_json)
    const historyBefore = Object.fromEntries(historyKeys.map((key) => [key, rows(key)]))
    raw.prepare(`INSERT INTO users(id, username, username_normalized, display_name, password_hash, password_salt,
      password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm, ?, 'active', ?, ?,
      password_updated_at, created_at, updated_at FROM users WHERE username='catalog.admin'`)
      .run('UH', 'catalog.support', 'catalog.support', 'Support', 'business_support', 'BUSINESS_SUPPORT', 'H')
    const tokens = {}
    for (const role of ['admin', 'support']) {
      const login = await post('/api/login', { username: `catalog.${role}`, password: 'synthetic-catalog-password' })
      expect(login.status).toBe(200)
      tokens[role] = login.body.token
    }
    const selectedCollections = []
    const readSystem = db.readSystemStateSnapshot.bind(db)
    db.readSystemStateSnapshot = fallback ? undefined : (...args) => {
      selectedCollections.push(...args[1])
      return readSystem(...args)
    }
    const readGlobal = db.readStateSnapshot.bind(db)
    db.readStateSnapshot = () => { throw new Error('Catalog save must not read global history') }
    const readStore = db.readStoreStateSnapshot.bind(db)
    db.readStoreStateSnapshot = (...args) => {
      const snapshot = readStore(...args)
      expect(snapshot.entities.some((row) => historyKeys.includes(row.collection_key))).toBe(false)
      return snapshot
    }
    const command = (role, type, payload, key = crypto.randomUUID(), version) => post('/api/command', {
      type, payload, includeState: false,
      expectedVersion: version ?? raw.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version,
    }, { authorization: `Bearer ${tokens[role]}`, 'idempotency-key': key })
    for (const targetGroup of ['business_support', 'office', 'store']) {
      for (const kind of ['VIOLATION', 'FIXED_TASK', 'REWARD_TASK']) {
        const payload = { code: `${targetGroup}.${kind.toLowerCase()}.test`, targetGroup, kind, name: `${targetGroup} ${kind}`,
          ...(targetGroup === 'store' ? { storeId: 'S1' } : {}),
          ...(kind === 'VIOLATION' ? { violationPoints: 20.5 } : { amountVnd: kind === 'FIXED_TASK' ? 0 : 3000 }) }
        const key = crypto.randomUUID()
        const created = await command('admin', 'work_catalog.create', payload, key)
        expect(created.status, JSON.stringify(created.body)).toBe(201)
        if (kind === 'VIOLATION') expect(created.body.item).toMatchObject({ violationPoints: 20.5, amountVnd: 0 })
        const replay = await command('admin', 'work_catalog.create', payload, key)
        expect(replay.body).toEqual(created.body)
        const id = created.body.item.id
        const updated = await command('admin', 'work_catalog.update', { id, name: 'Updated name', expectedVersion: 1 })
        expect(updated.status, JSON.stringify(updated.body)).toBe(200)
        const stale = await command('admin', 'work_catalog.update', { id, name: 'Stale name', expectedVersion: 1 })
        expect(stale.status).toBe(409)
        const deleted = await command('admin', 'work_catalog.delete', { id, expectedVersion: 2, reason: 'Fixture' })
        expect(deleted.status).toBe(200)
        const restored = await command('admin', 'work_catalog.restore', { id, expectedVersion: 3 })
        expect(restored.status).toBe(200)
        expect(JSON.parse(rows('workCatalogItems').find((json) => JSON.parse(json).id === id)))
          .toMatchObject({ id, name: 'Updated name', active: true, version: 4 })
        const denied = await command('support', 'work_catalog.update', { id, name: 'Forbidden', expectedVersion: 4 })
        expect(denied.status).toBe(targetGroup === 'store' ? 200 : 403)
      }
    }
    expect(selectedCollections.filter((key) => historyKeys.includes(key))).toEqual([])
    expect(Object.fromEntries(historyKeys.map((key) => [key, rows(key)]))).toEqual(historyBefore)
    expect(raw.prepare("SELECT count(*) AS total FROM audit_log WHERE action='work_catalog.create'").get().total).toBe(9)
    db.readStateSnapshot = readGlobal
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
