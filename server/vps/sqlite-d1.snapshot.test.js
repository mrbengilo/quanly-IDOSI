// @vitest-environment node

import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteD1, runWithSqliteMetrics } from './sqlite-d1.mjs'

const temporaryDirectories = []
const timestamp = '2026-08-31T08:00:00.000Z'

const emptyMetrics = () => ({
  statements: 0,
  reads: 0,
  writes: 0,
  batches: 0,
  totalMs: 0,
  maxMs: 0,
})

const createSnapshotDatabase = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-snapshot-'))
  temporaryDirectories.push(directory)
  const database = createSqliteD1({ databasePath: resolve(directory, 'idosi.sqlite') })
  const firstEntity = JSON.stringify({ id: 'ORDER-01', label: 'Đơn đầu tiên' })
  const secondEntity = JSON.stringify({ id: 'ORDER-02', label: 'Đơn thứ hai' })
  await database.batch([
    database.prepare(`
      INSERT INTO app_state (
        scope_key, value_json, version, updated_at, updated_by, last_request_id
      ) VALUES (?, ?, ?, ?, NULL, ?)
    `).bind('global', JSON.stringify({ schemaVersion: 2 }), 7, timestamp, 'request-version-7'),
    database.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).bind('global', 'orders', timestamp, timestamp),
    database.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).bind('global', 'emptyCollection', timestamp, timestamp),
    database.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order,
        value_json, value_bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      'global',
      'orders',
      'entity-second',
      20,
      secondEntity,
      Buffer.byteLength(secondEntity),
      timestamp,
      timestamp,
    ),
    database.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order,
        value_json, value_bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      'global',
      'orders',
      'entity-first',
      10,
      firstEntity,
      Buffer.byteLength(firstEntity),
      timestamp,
      timestamp,
    ),
  ])
  return { database, firstEntity, secondEntity }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('SQLite state snapshots', () => {
  it('reads the state shell, empty collections, and ordered entities in one measured query', async () => {
    const { database, firstEntity, secondEntity } = await createSnapshotDatabase()
    const metrics = emptyMetrics()
    try {
      const snapshot = runWithSqliteMetrics(metrics, () => database.readStateSnapshot('global'))

      expect(snapshot).toEqual({
        unchanged: false,
        row: {
          scope_key: 'global',
          value_json: JSON.stringify({ schemaVersion: 2 }),
          version: 7,
          updated_at: timestamp,
          updated_by: null,
          last_request_id: 'request-version-7',
        },
        manifests: [
          { collection_key: 'emptyCollection', created_at: timestamp, updated_at: timestamp },
          { collection_key: 'orders', created_at: timestamp, updated_at: timestamp },
        ],
        entities: [
          {
            collection_key: 'orders',
            entity_key: 'entity-first',
            entity_order: 10,
            value_json: firstEntity,
            value_bytes: Buffer.byteLength(firstEntity),
            created_at: timestamp,
            updated_at: timestamp,
          },
          {
            collection_key: 'orders',
            entity_key: 'entity-second',
            entity_order: 20,
            value_json: secondEntity,
            value_bytes: Buffer.byteLength(secondEntity),
            created_at: timestamp,
            updated_at: timestamp,
          },
        ],
      })
      expect(metrics).toMatchObject({ statements: 1, reads: 1, writes: 0, batches: 0 })
      expect(metrics.totalMs).toBeGreaterThanOrEqual(0)
      expect(metrics.maxMs).toBeGreaterThanOrEqual(0)
    } finally {
      database.close()
    }
  })

  it('uses one head query only for an exact version and request id cache key', async () => {
    const { database } = await createSnapshotDatabase()
    try {
      const warmMetrics = emptyMetrics()
      const unchanged = runWithSqliteMetrics(warmMetrics, () => database.readStateSnapshot('global', {
        version: 7,
        lastRequestId: 'request-version-7',
      }))
      expect(unchanged).toEqual({ unchanged: true })
      expect(warmMetrics).toMatchObject({ statements: 1, reads: 1, writes: 0, batches: 0 })

      for (const known of [
        { version: 6, lastRequestId: 'request-version-7' },
        { version: 7, lastRequestId: 'different-request' },
      ]) {
        const refreshMetrics = emptyMetrics()
        const refreshed = runWithSqliteMetrics(refreshMetrics, () => (
          database.readStateSnapshot('global', known)
        ))
        expect(refreshed).toMatchObject({
          unchanged: false,
          row: { version: 7, last_request_id: 'request-version-7' },
        })
        expect(refreshMetrics).toMatchObject({ statements: 2, reads: 2, writes: 0, batches: 0 })
      }
    } finally {
      database.close()
    }
  })
})
