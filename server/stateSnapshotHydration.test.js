import { describe, expect, it } from 'vitest'
import { hydrateStateSnapshot } from './worker.js'

const byteLength = (value) => new TextEncoder().encode(value).byteLength
const entity = (collectionKey, entityKey, value, valueJson = JSON.stringify(value)) => ({
  collection_key: collectionKey,
  entity_key: entityKey,
  entity_order: 0,
  value_json: valueJson,
  value_bytes: byteLength(valueJson),
  created_at: '2026-10-17T00:00:00.000Z',
  updated_at: '2026-10-17T00:00:00.000Z',
})

describe('state snapshot hydration', () => {
  it('serializes the hydrated state equivalently without re-stringifying every entity', () => {
    const row = {
      scope_key: 'global',
      version: 7,
      // A legacy inline array is replaced by its manifest collection.
      value_json: JSON.stringify({ stateVersion: 3, tasks: [{ id: 'inline-legacy' }], settings: { bio: 'Cửa hàng' } }),
    }
    const manifests = ['tasks', 'notifications', 'emptyCollection'].map((collectionKey) => ({
      collection_key: collectionKey, created_at: null, updated_at: null,
    }))
    const entities = [
      entity('tasks', 'ent_1', { id: 'T1', title: 'Lau kệ – “đầu ca”', employeeIds: ['E01'] }),
      // Stored text keeps its own formatting and escapes; it is still the same value.
      entity('tasks', 'ent_2', { id: 'T2', note: 'é' }, '{ "id": "T2", "note": "\\u00e9" }'),
      entity('notifications', 'ent_3', null, 'null'),
    ]

    const hydrated = hydrateStateSnapshot(row, manifests, entities)
    const expected = {
      stateVersion: 3,
      tasks: [
        { id: 'T1', title: 'Lau kệ – “đầu ca”', employeeIds: ['E01'] },
        { id: 'T2', note: 'é' },
      ],
      settings: { bio: 'Cửa hàng' },
      notifications: [null],
      emptyCollection: [],
    }
    expect(JSON.parse(hydrated.value_json)).toEqual(expected)
    expect(hydrated.value_json).not.toContain('inline-legacy')
    expect(JSON.parse(hydrated.value_json)).toEqual(JSON.parse(JSON.stringify(hydrated._hydratedState)))
    expect(hydrated._externalCollections.get('tasks').rows.map(({ entityKey }) => entityKey)).toEqual(['ent_1', 'ent_2'])
  })

  it('serializes collections alone when the state shell is empty', () => {
    const hydrated = hydrateStateSnapshot(
      { scope_key: 'global', version: 1, value_json: '{}' },
      [{ collection_key: 'stores', created_at: null, updated_at: null }],
      [entity('stores', 'ent_s1', { id: 'S01', name: 'Cửa hàng 01' })],
    )
    expect(JSON.parse(hydrated.value_json)).toEqual({ stores: [{ id: 'S01', name: 'Cửa hàng 01' }] })
  })
})
