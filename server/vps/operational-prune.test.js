// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { pruneOperationalRecords } from '../worker.js'
import { createIdosiServer, createOperationalPruneRunner } from './server.mjs'

const NOW = '2026-09-25T00:00:00.000Z'
const OLD = '2026-08-01T00:00:00.000Z'
const RECENT = '2026-09-20T00:00:00.000Z'

const withDatabase = async (run) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-prune-'))
  const { runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    automaticRevenueBonusEnabled: false,
    operationalPruneEnabled: false,
  })
  try {
    const sqlite = runtime.database.database
    sqlite.prepare(`
      INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, password_updated_at, created_at, updated_at)
      VALUES ('U1', 'prune.admin', 'prune.admin', 'Prune', 'h', 's', 100000, 'PBKDF2-SHA256', 'admin', 'active', ?, ?, ?)
    `).run(OLD, OLD, OLD)
    const session = sqlite.prepare(`
      INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at)
      VALUES (?, ?, 'U1', ?, ?, ?, ?)
    `)
    session.run('expired-old', 'h1', OLD, OLD, '2026-08-02T00:00:00.000Z', null)
    session.run('revoked-old', 'h2', OLD, OLD, '2026-12-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z')
    session.run('expired-recent', 'h3', RECENT, RECENT, '2026-09-21T00:00:00.000Z', null)
    session.run('active', 'h4', RECENT, RECENT, '2026-12-01T00:00:00.000Z', null)
    const receipt = sqlite.prepare(`
      INSERT INTO command_receipts (actor_id, idempotency_key, request_hash, response_json, status_code, created_at)
      VALUES ('U1', ?, 'hash', '{}', 200, ?)
    `)
    for (let index = 0; index < 5; index += 1) receipt.run(`old-${index}`, OLD)
    receipt.run('recent-0', RECENT)
    sqlite.prepare(`
      INSERT INTO command_receipt_chunks (actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at)
      VALUES ('U1', 'old-0', 0, 'x', 1, ?), ('U1', 'recent-0', 0, 'y', 1, ?)
    `).run(OLD, RECENT)
    sqlite.prepare(`
      INSERT INTO audit_log (request_id, actor_id, actor_role, action, entity_type, server_timestamp)
      VALUES ('old-audit', 'U1', 'admin', 'x', 'y', ?)
    `).run(OLD)
    await run({ runtime, sqlite })
  } finally {
    // The HTTP server never listened, so only the database needs closing.
    runtime.database.close()
    await rm(directory, { recursive: true, force: true })
  }
}

const ids = (sqlite, sql) => sqlite.prepare(sql).all().map((row) => Object.values(row)[0]).sort()

it('removes only expired sessions and receipts older than the retention window', async () => {
  await withDatabase(async ({ runtime, sqlite }) => {
    const yields = vi.fn(async () => {})
    const summary = await pruneOperationalRecords(runtime.env, {
      now: NOW, retentionDays: 30, batchSize: 2, yieldControl: yields,
    })
    expect(summary).toMatchObject({ sessions: 2, receipts: 5, receiptsSkipped: false, complete: true })
    expect(yields).toHaveBeenCalled()
    expect(ids(sqlite, 'SELECT id FROM sessions')).toEqual(['active', 'expired-recent'])
    expect(ids(sqlite, 'SELECT idempotency_key FROM command_receipts')).toEqual(['recent-0'])
    expect(ids(sqlite, 'SELECT idempotency_key FROM command_receipt_chunks')).toEqual(['recent-0'])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count).toBe(1)
  })
})

it('keeps receipts while a Reset-all finalizer is still pending', async () => {
  await withDatabase(async ({ runtime, sqlite }) => {
    sqlite.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, updated_at) VALUES ('system:reset_all_pending', '{}', ?)
    `).run(NOW)
    const summary = await pruneOperationalRecords(runtime.env, { now: NOW })
    expect(summary).toMatchObject({ sessions: 2, receipts: 0, receiptsSkipped: true })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM command_receipts').get().count).toBe(6)
  })
})

it('never prunes with a retention shorter than seven days', async () => {
  await withDatabase(async ({ runtime, sqlite }) => {
    const summary = await pruneOperationalRecords(runtime.env, { now: NOW, retentionDays: 1 })
    expect(summary.cutoff).toBe('2026-09-18T00:00:00.000Z')
    expect(ids(sqlite, 'SELECT idempotency_key FROM command_receipts')).toEqual(['recent-0'])
  })
})

it('schedules the prune job and logs its summary', async () => {
  vi.useFakeTimers()
  try {
    const prune = vi.fn().mockResolvedValue({ sessions: 1, receipts: 2 })
    const logger = vi.fn()
    const runner = createOperationalPruneRunner({ env: {}, prune, logger, firstDelayMs: 1_000, intervalMs: 10_000 })
    runner.start()
    await vi.advanceTimersByTimeAsync(999)
    expect(prune).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(prune).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(prune).toHaveBeenCalledTimes(2)
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: 'idosi.operational_prune', sessions: 1 }))
    await runner.stop()
    await vi.advanceTimersByTimeAsync(50_000)
    expect(prune).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
