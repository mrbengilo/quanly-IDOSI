// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { deflateSync } from 'node:zlib'
import worker, {
  canReadScope,
  canUseCounter,
  canWriteScope,
  hashPassword,
  monthFromRecord,
  isSupportTransferActiveAt,
  projectSharedState,
  normalizeFixedExpenseItems,
  supportCompensationForAttendance,
  supportTransferPayFor,
  supportTransferTimeBounds,
  verifyPassword,
} from './worker'
import { workCatalogClaimKey, workCatalogProgressKey } from '../src/domain/workCatalog'

const TEST_IDENTITY_IMAGE = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`
const testIdentityImages = () => ({ front: TEST_IDENTITY_IMAGE, back: TEST_IDENTITY_IMAGE })

const testCrc32 = (bytes) => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (type, data = Buffer.alloc(0)) => {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(testCrc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return chunk
}

const validPngBytes = (targetBytes) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const chunks = [pngChunk('IHDR', header)]
  const imageData = pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0])))
  const imageEnd = pngChunk('IEND')
  const baseBytes = signature.length + chunks[0].length + imageData.length + imageEnd.length
  const paddingBytes = targetBytes - baseBytes
  if (paddingBytes !== 0) {
    if (paddingBytes < 12) throw new Error(`PNG test fixture cannot fit ${targetBytes} bytes`)
    chunks.push(pngChunk('vpAg', Buffer.alloc(paddingBytes - 12, 0x41)))
  }
  return Buffer.concat([signature, ...chunks, imageData, imageEnd])
}

const jpegSegment = (marker, data) => {
  const segment = Buffer.alloc(4 + data.length)
  segment.set([0xff, marker], 0)
  segment.writeUInt16BE(data.length + 2, 2)
  data.copy(segment, 4)
  return segment
}

const validJpegBytes = (targetBytes) => {
  const quantizationTable = jpegSegment(0xdb, Buffer.from([0, ...Array(64).fill(1)]))
  const frame = jpegSegment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]))
  const oneSymbolTable = (descriptor) => Buffer.from([descriptor, 1, ...Array(15).fill(0), 0])
  const huffmanTables = jpegSegment(0xc4, Buffer.concat([oneSymbolTable(0), oneSymbolTable(0x10)]))
  const scan = jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0]))
  const fixedParts = [Buffer.from([0xff, 0xd8]), quantizationTable, frame, huffmanTables]
  const suffix = [scan, Buffer.from([0x3f, 0xff, 0xd9])]
  const baseBytes = [...fixedParts, ...suffix].reduce((total, part) => total + part.length, 0)
  let remaining = targetBytes - baseBytes
  if (remaining !== 0 && remaining < 4) throw new Error(`JPEG test fixture cannot fit ${targetBytes} bytes`)
  const comments = []
  while (remaining > 0) {
    let segmentBytes = Math.min(remaining, 65537)
    if (remaining - segmentBytes > 0 && remaining - segmentBytes < 4) segmentBytes -= 4
    comments.push(jpegSegment(0xfe, Buffer.alloc(segmentBytes - 4, 0x41)))
    remaining -= segmentBytes
  }
  return Buffer.concat([...fixedParts, ...comments, ...suffix])
}

const validWebpBytes = (targetBytes) => {
  const minimal = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=', 'base64')
  if (targetBytes === minimal.length) return minimal
  const paddingBytes = targetBytes - minimal.length
  if (paddingBytes < 8 || paddingBytes % 2 !== 0) throw new Error(`WebP test fixture cannot fit ${targetBytes} bytes`)
  const padding = Buffer.alloc(paddingBytes)
  Buffer.from('JUNK').copy(padding, 0)
  padding.writeUInt32LE(paddingBytes - 8, 4)
  padding.fill(0x41, 8)
  const result = Buffer.concat([minimal.subarray(0, 12), minimal.subarray(12), padding])
  result.writeUInt32LE(result.length - 8, 4)
  return result
}

const VALID_GIF_AVATAR = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkwBADs=', 'base64')
const testGifAvatarDataUrl = () => `data:image/gif;base64,${VALID_GIF_AVATAR.toString('base64')}`
const ANIMATED_GIF_AVATAR = Buffer.concat([
  VALID_GIF_AVATAR.subarray(0, -1),
  VALID_GIF_AVATAR.subarray(19, -1),
  Buffer.from([0x3b]),
])
const animatedGifAvatarDataUrl = () => `data:image/gif;base64,${ANIMATED_GIF_AVATAR.toString('base64')}`

const generatedStaticGifAvatar = (width, height) => {
  const minimumCodeSize = 2
  const clearCode = 1 << minimumCodeSize
  const endCode = clearCode + 1
  let available = endCode + 1
  let codeSize = minimumCodeSize + 1
  let codeSizeIncreasePending = false
  let bitBuffer = 0
  let bitCount = 0
  const compressed = []
  const dictionary = new Map()
  const emit = (code) => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      compressed.push(bitBuffer & 0xff)
      bitBuffer >>>= 8
      bitCount -= 8
    }
    if (codeSizeIncreasePending) {
      codeSize += 1
      codeSizeIncreasePending = false
    }
  }
  const resetDictionary = () => {
    dictionary.clear()
    available = endCode + 1
    codeSize = minimumCodeSize + 1
    codeSizeIncreasePending = false
  }
  emit(clearCode)
  let prefix = 0
  for (let pixel = 1; pixel < width * height; pixel += 1) {
    const key = `${prefix}:0`
    const existing = dictionary.get(key)
    if (existing !== undefined) {
      prefix = existing
      continue
    }
    emit(prefix)
    if (available < 4096) {
      dictionary.set(key, available)
      available += 1
      if (available === (1 << codeSize) && codeSize < 12) codeSizeIncreasePending = true
    } else {
      emit(clearCode)
      resetDictionary()
    }
    prefix = 0
  }
  emit(prefix)
  emit(endCode)
  if (bitCount) compressed.push(bitBuffer & 0xff)
  const imageData = []
  for (let offset = 0; offset < compressed.length; offset += 255) {
    const block = compressed.slice(offset, offset + 255)
    imageData.push(block.length, ...block)
  }
  const le16 = (value) => [value & 0xff, (value >>> 8) & 0xff]
  return Buffer.from([
    ...Buffer.from('GIF89a'),
    ...le16(width), ...le16(height), 0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
    0x2c, 0x00, 0x00, 0x00, 0x00, ...le16(width), ...le16(height), 0x00,
    minimumCodeSize, ...imageData, 0x00, 0x3b,
  ])
}

const generatedStaticGifAvatarDataUrl = (width, height) => {
  const bytes = generatedStaticGifAvatar(width, height)
  return `data:image/gif;base64,${bytes.toString('base64')}`
}
const legacyFakeWebpDataUrl = (bytes = 128) => {
  const buffer = Buffer.alloc(bytes, 0x41)
  Buffer.from('RIFF').copy(buffer, 0)
  Buffer.from('WEBP').copy(buffer, 8)
  return `data:image/webp;base64,${buffer.toString('base64')}`
}

const testAvatarDataUrl = (mimeType, bytes, encodedMimeType = mimeType) => {
  const builders = { 'image/jpeg': validJpegBytes, 'image/png': validPngBytes, 'image/webp': validWebpBytes }
  const buffer = builders[mimeType]?.(bytes)
  if (!buffer) throw new Error(`Unsupported avatar test MIME: ${mimeType}`)
  return `data:${encodedMimeType};base64,${buffer.toString('base64')}`
}

class MemoryD1Statement {
  constructor(database, sql, bindings = [], onQuery = () => {}) {
    this.database = database
    this.sql = sql
    this.bindings = bindings
    this.onQuery = onQuery
  }

  bind(...bindings) {
    return new MemoryD1Statement(this.database, this.sql, bindings, this.onQuery)
  }

  async first() {
    this.onQuery()
    return this.database.prepare(this.sql).get(...this.bindings) || null
  }

  async all() {
    this.onQuery()
    return { results: this.database.prepare(this.sql).all(...this.bindings) }
  }

  async run() {
    this.onQuery()
    const result = this.database.prepare(this.sql).run(...this.bindings)
    return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }
  }
}

class MemoryD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:')
    this.queryCount = 0
    for (const file of [
      'drizzle/0000_idosi_core.sql',
      'drizzle/0001_manager_role.sql',
      'drizzle/0002_attendance_evaluation_policies.sql',
      'drizzle/0003_state_entities.sql',
      'drizzle/0004_operational_roles.sql',
      'drizzle/0005_admin_only_accounts.sql',
      'drizzle/0006_recursive_profile_secret_scrub.sql',
      'drizzle/0007_session_roles.sql',
      'drizzle/0008_order_information_options.sql',
    ]) {
      const migration = readFileSync(file, 'utf8').replaceAll('--> statement-breakpoint', '')
      this.database.exec(migration)
    }
  }

  prepare(sql) {
    return new MemoryD1Statement(this.database, sql, [], () => { this.queryCount += 1 })
  }

  async batch(statements) {
    if (this.beforeBatch) {
      const beforeBatch = this.beforeBatch
      this.beforeBatch = null
      await beforeBatch(this, statements)
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

class MemoryR2 {
  constructor() {
    this.objects = new Map()
    this.deletedKeys = []
    this.pageSize = Number.POSITIVE_INFINITY
    this.failDeleteKeys = new Set()
    this.beforeDelete = null
    this.repeatCursor = false
  }

  async put(key, value, options = {}) {
    const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value)
    this.objects.set(key, {
      bytes,
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    })
    return { key }
  }

  async get(key) {
    const stored = this.objects.get(key)
    if (!stored) return null
    return {
      body: stored.bytes.slice(),
      size: stored.bytes.byteLength,
      etag: `etag-${key}`,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
    }
  }

  async list({ prefix = '', cursor = '' } = {}) {
    const start = Number(cursor || 0)
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort()
    const pageSize = Number.isFinite(this.pageSize) ? Math.max(1, this.pageSize) : keys.length || 1
    const objects = keys.slice(start, start + pageSize).map((key) => ({ key }))
    const truncated = start + pageSize < keys.length
    return {
      objects,
      truncated,
      ...(truncated ? { cursor: this.repeatCursor && cursor ? cursor : String(start + pageSize) } : {}),
    }
  }

  async delete(key) {
    if (this.beforeDelete) await this.beforeDelete(key)
    if (this.failDeleteKeys.has(key)) throw new Error(`delete failed for ${key}`)
    this.deletedKeys.push(key)
    this.objects.delete(key)
  }
}

const readHydratedState = (database, scope = 'global') => {
  const row = database.prepare('SELECT value_json FROM app_state WHERE scope_key = ?').get(scope)
  const state = JSON.parse(row?.value_json || '{}')
  const collections = database.prepare(`
    SELECT collection_key FROM state_collections WHERE scope_key = ? ORDER BY collection_key
  `).all(scope)
  for (const { collection_key: collectionKey } of collections) {
    state[collectionKey] = database.prepare(`
      SELECT value_json FROM state_entities
      WHERE scope_key = ? AND collection_key = ?
      ORDER BY entity_order, entity_key
    `).all(scope, collectionKey).map(({ value_json: valueJson }) => JSON.parse(valueJson))
  }
  return state
}

const replaceStateCollection = (database, collectionKey, values, scope = 'global') => {
  const timestamp = '2026-08-14T00:00:00.000Z'
  database.prepare(`
    INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope_key, collection_key) DO UPDATE SET updated_at = excluded.updated_at
  `).run(scope, collectionKey, timestamp, timestamp)
  database.prepare('DELETE FROM state_entities WHERE scope_key = ? AND collection_key = ?')
    .run(scope, collectionKey)
  const insert = database.prepare(`
    INSERT INTO state_entities (
      scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  values.forEach((value, index) => {
    const valueJson = JSON.stringify(value)
    insert.run(
      scope,
      collectionKey,
      `test:${String(index).padStart(12, '0')}`,
      (index + 1) * 1_000_000,
      valueJson,
      Buffer.byteLength(valueJson),
      timestamp,
      timestamp,
    )
  })
}

const jsonRequest = (url, body, headers = {}) => new Request(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

const setupSupportTransferRuntime = async ({
  token,
  transfer,
  attendance = [],
  payrollPeriods = [],
  schedule = [],
  shiftDefinitions = [],
  orders = [],
  notifications = [],
  tasks = [],
  taskAssignmentHistory = [],
  expenseEntries = [],
  cashTransactions = [],
} = {}) => {
  const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: token }
  const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
    username: 'admin', password: 'transfer-runtime-admin-password',
    initialState: {
      stores: [
        { id: 'S01', short: 'HOME', name: 'IDOSI Home', status: 'Đang hoạt động' },
        { id: 'S02', short: 'DEST', name: 'IDOSI Destination', status: 'Đang hoạt động' },
      ],
      employees: [{
        id: 'E01', name: 'Nhân viên hỗ trợ', storeId: 'S01', unit: 'store', status: 'Đang làm việc',
        employmentType: 'Part-Time', hourlyRate: 30_000,
      }, {
        id: 'QL02', name: 'Quản lý đích', storeId: 'S02', unit: 'store_manager', status: 'Đang làm việc',
      }, {
        id: 'HTKD-TRANSFER', name: 'Hỗ trợ vận hành', storeId: 'BUSINESS_SUPPORT',
        unit: 'business_support', status: 'Đang làm việc',
      }],
      supportTransfers: [transfer],
      attendance,
      payrollPeriods,
      schedule,
      shiftDefinitions,
      orders,
      notifications,
      tasks, taskAssignmentHistory, orderAudit: [], expenseEntries, fixedExpenses: [],
      cashTransactions, salaryAdjustments: [], salaryAdvances: [], payrollPayments: [],
    },
  }, { 'x-idosi-bootstrap-token': token }), env)
  expect(bootstrap.status).toBe(201)
  const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
    username: 'admin', password: 'transfer-runtime-admin-password',
  }), env)
  expect(adminLogin.status).toBe(200)
  const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
  const employeeUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
    type: 'user.create',
    payload: {
      username: 'transfer.employee', password: 'transfer-employee-password', displayName: 'Nhân viên hỗ trợ',
      role: 'employee', storeId: 'S01', employeeId: 'E01',
    },
  }, { ...adminAuthorization, 'idempotency-key': `transfer-runtime-user-${token}` }), env)
  expect(employeeUser.status).toBe(201)
  const managerUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
    type: 'user.create',
    payload: {
      username: 'transfer.manager', password: 'transfer-manager-password', displayName: 'Quản lý đích',
      role: 'store_manager', storeId: 'S02', employeeId: 'QL02',
    },
  }, { ...adminAuthorization, 'idempotency-key': `transfer-runtime-manager-${token}` }), env)
  expect(managerUser.status).toBe(201)
  const supportUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
    type: 'user.create',
    payload: {
      username: 'transfer.support', password: 'transfer-support-password', displayName: 'Hỗ trợ vận hành',
      role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-TRANSFER',
    },
  }, { ...adminAuthorization, 'idempotency-key': `transfer-runtime-support-${token}` }), env)
  expect(supportUser.status).toBe(201)
  const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
    username: 'transfer.employee', password: 'transfer-employee-password',
  }), env)
  expect(employeeLogin.status).toBe(200)
  const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
  const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
    username: 'transfer.manager', password: 'transfer-manager-password',
  }), env)
  expect(managerLogin.status).toBe(200)
  const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
  const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
    username: 'transfer.support', password: 'transfer-support-password',
  }), env)
  expect(supportLogin.status).toBe(200)
  const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
  return { env, adminAuthorization, employeeAuthorization, managerAuthorization, supportAuthorization }
}

describe('IDOSI Worker security primitives', () => {
  it('hashes passwords with salted PBKDF2 and verifies without storing plaintext', async () => {
    const record = await hashPassword('idosi-test-password', { iterations: 100_000 })

    expect(record.algorithm).toBe('PBKDF2-SHA256')
    expect(record.iterations).toBe(100_000)
    expect(record.hash).not.toContain('idosi-test-password')
    expect(record.salt).toBeTruthy()
    await expect(verifyPassword('idosi-test-password', record)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', record)).resolves.toBe(false)
  })

  it('assigns ISO timestamps to the Vietnamese business month', () => {
    expect(monthFromRecord({ createdAt: '2026-08-31T17:30:00.000Z' })).toBe('2026-09')
    expect(monthFromRecord({ period: '2026-10', createdAt: '2026-08-31T17:30:00.000Z' })).toBe('2026-10')
    expect(monthFromRecord({ workDate: '2026-11-01', createdAt: '2026-10-31T17:30:00.000Z' })).toBe('2026-11')
  })

  it('uses exact start-inclusive and end-exclusive support-transfer boundaries with legacy compatibility', () => {
    const exact = {
      status: 'Đã duyệt',
      startAt: '2026-08-20T07:00:00.000Z',
      endAt: '2026-08-20T14:00:00.000Z',
    }
    expect(supportTransferTimeBounds(exact)).toMatchObject({
      startAt: '2026-08-20T07:00:00.000Z',
      endAt: '2026-08-20T14:00:00.000Z',
    })
    expect(isSupportTransferActiveAt(exact, '2026-08-20T06:59:59.999Z')).toBe(false)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T07:00:00.000Z')).toBe(true)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T10:30:00.000Z')).toBe(true)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T14:00:00.000Z')).toBe(false)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T14:00:00.001Z')).toBe(false)

    const legacy = { status: 'Đã duyệt', fromDate: '2026-08-20', toDate: '2026-08-21' }
    expect(supportTransferTimeBounds(legacy)).toMatchObject({
      startAt: '2026-08-19T17:00:00.000Z',
      endAt: '2026-08-21T17:00:00.000Z',
    })
    expect(isSupportTransferActiveAt(legacy, '2026-08-21T16:59:59.999Z')).toBe(true)
    expect(isSupportTransferActiveAt(legacy, '2026-08-21T17:00:00.000Z')).toBe(false)
  })

  it('enforces the admin, business-support, store-manager, and employee scope model', () => {
    const admin = { role: 'admin', user_id: 'admin-1' }
    const manager = { role: 'business_support', user_id: 'manager-1' }
    const storeManager = { role: 'store_manager', user_id: 'store-manager-1', store_id: 'store-01' }
    const employee = { role: 'employee', user_id: 'user-1', employee_id: 'employee-01', store_id: 'store-01' }

    expect(canReadScope(admin, 'store:store-02')).toBe(true)
    expect(canWriteScope(admin, 'global')).toBe(true)
    expect(canReadScope(manager, 'global')).toBe(true)
    expect(canReadScope(manager, 'store:store-01')).toBe(false)
    expect(canReadScope(manager, 'employee:employee-01')).toBe(false)
    expect(canWriteScope(manager, 'global')).toBe(false)
    expect(canReadScope(storeManager, 'global')).toBe(true)
    expect(canReadScope(storeManager, 'store:store-01')).toBe(true)
    expect(canReadScope(storeManager, 'store:store-02')).toBe(false)
    expect(canReadScope(employee, 'global')).toBe(true)
    expect(canReadScope(employee, 'employee:employee-01')).toBe(true)
    expect(canReadScope(employee, 'employee:employee-02')).toBe(false)
    expect(canWriteScope(employee, 'global')).toBe(false)
  })

  it('keeps generic counters admin-only because business codes use domain commands', () => {
    const admin = { role: 'admin', user_id: 'admin-1' }
    const employee = { role: 'employee', user_id: 'user-1', employee_id: 'employee-01', store_id: 'store-01' }

    expect(canUseCounter(admin, 'system:sessions')).toBe(true)
    expect(canUseCounter(employee, 'employee:employee-01:tasks')).toBe(false)
    expect(canUseCounter(employee, 'store:store-01:orders')).toBe(false)
    expect(canUseCounter(employee, 'store:store-02:orders')).toBe(false)
  })

  it('atomically persists occupation and payment defaults during an empty bootstrap', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-order-defaults' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin.defaults', password: 'order-defaults-password', initialState: {},
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)

    const rows = env.DB.database.prepare(`
      SELECT value_json, value_bytes
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orderInformationOptions'
      ORDER BY entity_order, entity_key
    `).all()
    const options = rows.map(({ value_json: valueJson }) => JSON.parse(valueJson))
    expect(options).toHaveLength(17)
    expect(options.filter(({ kind }) => kind === 'occupation')).toHaveLength(15)
    expect(options.filter(({ kind }) => kind === 'payment_method')).toEqual([
      expect.objectContaining({ id: 'order-payment-001', code: 'PAY-001', label: 'Tiền mặt', active: true, system: true }),
      expect.objectContaining({ id: 'order-payment-002', code: 'PAY-002', label: 'Chuyển khoản', active: true, system: true }),
    ])
    expect(rows.every(({ value_json: valueJson, value_bytes: valueBytes }) => Buffer.byteLength(valueJson) === valueBytes)).toBe(true)
    expect(JSON.parse(env.DB.database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get().value_json))
      .not.toHaveProperty('orderInformationOptions')

    const bootstrapAudit = env.DB.database.prepare(`
      SELECT after_json, metadata_json FROM audit_log WHERE action = 'system.bootstrap'
    `).get()
    expect(JSON.parse(bootstrapAudit.after_json)).toMatchObject({
      initialized: true,
      orderInformationDefaults: { persisted: true, canonicalSeedCount: 17, occupationSeedCount: 15, paymentMethodSeedCount: 2 },
    })
    expect(JSON.parse(bootstrapAudit.metadata_json)).toMatchObject({
      source: 'bootstrap-api',
      orderInformationDefaults: { persisted: true, canonicalSeedCount: 17 },
    })

    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin.defaults', password: 'order-defaults-password',
    }), env)
    const state = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: { authorization: `Bearer ${(await login.json()).token}` },
    }), env)
    expect(state.status).toBe(200)
    expect((await state.json()).state.orderInformationOptions).toEqual(options)
  })

  it('purges non-admin credentials while preserving profiles, history, and atomic account reissue', async () => {
    const database = new DatabaseSync(':memory:')
    const adminPassword = await hashPassword('legacy-admin-password')
    const employeePassword = await hashPassword('legacy-employee-password')
    const managerPassword = await hashPassword('legacy-manager-password')
    database.exec(readFileSync('drizzle/0000_idosi_core.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
    database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, version,
        password_updated_at, created_at, updated_at
      ) VALUES ('admin-legacy', 'admin', 'admin', 'Admin', 'hash', 'salt',
        100000, 'PBKDF2-SHA256', 'admin', 'active', 1,
        '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')
    `).run()
    database.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?
      WHERE id = 'admin-legacy'
    `).run(adminPassword.hash, adminPassword.salt, adminPassword.iterations, adminPassword.algorithm)
    database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, version, store_id, employee_id,
        password_updated_at, created_at, updated_at
      ) VALUES ('employee-legacy', 'employee', 'employee', 'Employee', 'hash', 'salt',
        100000, 'PBKDF2-SHA256', 'employee', 'active', 4, 'S01', 'E01',
        '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')
    `).run()
    database.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?
      WHERE id = 'employee-legacy'
    `).run(employeePassword.hash, employeePassword.salt, employeePassword.iterations, employeePassword.algorithm)
    database.prepare(`
      INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at)
      VALUES ('session-legacy', 'token-hash-legacy', 'admin-legacy',
        '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-15T00:00:00.000Z')
    `).run()
    const legacyState = {
      stores: [{ id: 'S01', name: 'Legacy', short: 'S01' }, { id: 'S01', name: 'Duplicate', short: 'DUP' }],
      employees: [
        {
          id: 'E01', code: 'E01', name: 'Legacy employee', phone: '0900000001',
          storeId: 'S01', unit: 'store', employmentType: 'Full-Time', monthlySalary: 8_000_000,
          username: 'employee', authUserId: 'employee-legacy', authVersion: 4,
        },
        {
          id: 'HTKD777', code: 'HTKD777', name: 'Legacy support', phone: '0900000002',
          storeId: 'BUSINESS_SUPPORT', unit: 'business_support', employmentType: 'Chính thức',
          payBasis: 'monthly', monthlySalary: 12_000_000, workStart: '08:00', workEnd: '17:00',
          standardWorkDays: 26, startDate: '2026-01-01', status: 'Đang làm việc',
          username: 'manager', authUserId: 'manager-new', authVersion: 2,
        },
      ],
      attendance: [{
        id: 'ATT-LEGACY-SUPPORT', employeeId: 'HTKD777', storeId: 'BUSINESS_SUPPORT',
        date: '2026-08-01', checkInAt: '2026-08-01T01:00:00.000Z', checkOutAt: '2026-08-01T10:00:00.000Z',
        workedSeconds: 32_400,
      }],
      accountSettings: {
        'admin-legacy': { name: 'Admin preference', notifications: { tasks: true } },
        'manager-new': { name: 'Deleted manager preference', avatar: 'private-avatar-data' },
      },
      mixed: ['x', null, true, 7, { id: 'M1' }],
      empty: [],
      scalar: 'kept',
    }
    database.prepare(`
      INSERT INTO app_state (
        scope_key, value_json, version, updated_at, updated_by, last_request_id
      ) VALUES ('global', ?, 3, '2026-08-14T00:00:00.000Z', 'admin-legacy', 'state-request-legacy')
    `).run(JSON.stringify(legacyState))
    database.exec(`
      INSERT INTO policies (
        policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
      ) VALUES (
        'late_tolerance_minutes', '10', 2, '2026-08-01T00:00:00.000Z',
        '2026-08-14T00:00:00.000Z', 'admin-legacy', 'policy-request-legacy'
      );
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        metadata_json, server_timestamp
      ) VALUES (
        'audit-request-legacy', 'admin-legacy', 'admin', 'legacy.action', 'state', 'global',
        '{"preserved":true}', '2026-08-14T00:00:00.000Z'
      );
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      ) VALUES (
        'admin-legacy', 'legacy-command-0001', 'request-hash-legacy', '{"ok":true}', 200,
        '2026-08-14T00:00:00.000Z'
      );
    `)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(readFileSync('drizzle/0001_manager_role.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec(`
        INSERT INTO users (
          id, username, username_normalized, display_name, password_hash, password_salt,
          password_iterations, password_algorithm, role, status, version,
          password_updated_at, created_at, updated_at
        ) VALUES ('manager-new', 'manager', 'manager', 'Manager Legacy', 'hash', 'salt',
          100000, 'PBKDF2-SHA256', 'manager', 'active', 2,
          '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z');
        INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at)
        VALUES ('session-manager', 'token-hash-manager', 'manager-new',
          '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-15T00:00:00.000Z');
      `)
      database.prepare(`
        UPDATE users
        SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?
        WHERE id = 'manager-new'
      `).run(managerPassword.hash, managerPassword.salt, managerPassword.iterations, managerPassword.algorithm)
      database.exec(readFileSync('drizzle/0002_attendance_evaluation_policies.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec(readFileSync('drizzle/0003_state_entities.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        ) VALUES (
          'manager-new', 'manager-command-0001', 'manager-request-hash',
          '{"chunked":true,"chunkCount":1,"totalBytes":11}', 200, '2026-08-14T00:00:00.000Z'
        );
        INSERT INTO command_receipt_chunks (
          actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
        ) VALUES (
          'manager-new', 'manager-command-0001', 0, '{"ok":true}', 11, '2026-08-14T00:00:00.000Z'
        );
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          metadata_json, server_timestamp
        ) VALUES (
          'audit-request-manager', 'manager-new', 'manager', 'legacy.manager.action', 'state', 'global',
          '{"history":"preserved"}', '2026-08-14T00:00:00.000Z'
        );
      `)
      database.exec(readFileSync('drizzle/0004_operational_roles.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }

    expect(database.prepare('SELECT id, role, version FROM users ORDER BY id').all()).toEqual([
      { id: 'admin-legacy', role: 'admin', version: 1 },
    ])
    expect(database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT id, token_hash, user_id FROM sessions WHERE id = 'session-legacy'").get()).toEqual({
      id: 'session-legacy', token_hash: 'token-hash-legacy', user_id: 'admin-legacy',
    })
    expect(database.prepare("SELECT id FROM sessions WHERE id = 'session-manager'").get()).toBeUndefined()
    expect(database.prepare('SELECT COUNT(*) AS count FROM command_receipts').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT actor_id, request_hash, response_json FROM command_receipts WHERE idempotency_key = 'legacy-command-0001'").get()).toEqual({
      actor_id: 'admin-legacy', request_hash: 'request-hash-legacy', response_json: '{"ok":true}',
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM command_receipt_chunks').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM app_state').get()).toEqual({ count: 1 })
    const migratedAppState = database.prepare(
      "SELECT value_json, version, updated_by FROM app_state WHERE scope_key = 'global'",
    ).get()
    expect({ version: migratedAppState.version, updated_by: migratedAppState.updated_by }).toEqual({
      version: 4, updated_by: 'admin-legacy',
    })
    const compactState = JSON.parse(migratedAppState.value_json)
    expect(compactState.stores).toEqual(legacyState.stores)
    expect(compactState.attendance).toEqual(legacyState.attendance)
    expect(compactState.scalar).toBe('kept')
    expect(compactState.accountSettings).toEqual({
      'admin-legacy': { name: 'Admin preference', notifications: { tasks: true } },
    })
    expect(JSON.stringify(compactState)).not.toContain('private-avatar-data')
    expect(compactState.employees.map(({ id }) => id)).toEqual(['E01', 'HTKD777'])
    expect(JSON.stringify(compactState.employees)).not.toMatch(/username|authUserId|authVersion/u)
    expect(database.prepare('SELECT collection_key FROM state_collections ORDER BY collection_key').all()).toEqual([
      { collection_key: 'attendance' },
      { collection_key: 'employees' },
      { collection_key: 'empty' },
      { collection_key: 'mixed' },
      { collection_key: 'stores' },
    ])
    const migratedProfiles = database.prepare(`
      SELECT value_json, value_bytes FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'employees'
      ORDER BY entity_order
    `).all().map(({ value_json: valueJson, value_bytes: valueBytes }) => ({
      profile: JSON.parse(valueJson), valueJson, valueBytes,
    }))
    expect(migratedProfiles.map(({ profile }) => profile.id)).toEqual(['E01', 'HTKD777'])
    expect(JSON.stringify(migratedProfiles)).not.toMatch(/username|authUserId|authVersion/u)
    expect(migratedProfiles.every(({ valueJson, valueBytes }) => Buffer.byteLength(valueJson) === valueBytes)).toBe(true)
    expect(database.prepare(`
      SELECT json_extract(value_json, '$.id') AS id
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'attendance'
    `).all()).toEqual([{ id: 'ATT-LEGACY-SUPPORT' }])
    const migratedMixed = database.prepare(`
      SELECT entity_order, value_json, value_bytes
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'mixed'
      ORDER BY entity_order
    `).all()
    expect(migratedMixed.map(({ entity_order, value_json }) => ({ entity_order, value: JSON.parse(value_json) }))).toEqual([
      { entity_order: 1_000_000, value: 'x' },
      { entity_order: 2_000_000, value: null },
      { entity_order: 3_000_000, value: true },
      { entity_order: 4_000_000, value: 7 },
      { entity_order: 5_000_000, value: { id: 'M1' } },
    ])
    expect(migratedMixed.every(({ value_json, value_bytes }) => Buffer.byteLength(value_json) === value_bytes)).toBe(true)
    expect(database.prepare('SELECT COUNT(*) AS count FROM policies').get()).toEqual({ count: 4 })
    expect(database.prepare("SELECT value_json, version, updated_by FROM policies WHERE policy_key = 'late_tolerance_minutes'").get()).toEqual({
      value_json: '10', version: 2, updated_by: 'admin-legacy',
    })
    expect(database.prepare(`
      SELECT policy_key, value_json, version, updated_by
      FROM policies
      WHERE policy_key LIKE 'attendance_%'
      ORDER BY policy_key
    `).all()).toEqual([
      { policy_key: 'attendance_improve_min_late_count', value_json: '3', version: 1, updated_by: null },
      { policy_key: 'attendance_improve_min_late_minutes', value_json: '30', version: 1, updated_by: null },
      { policy_key: 'attendance_maintain_max_late_count', value_json: '2', version: 1, updated_by: null },
    ])
    expect(database.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 2 })
    expect(database.prepare("SELECT request_id, actor_id, metadata_json FROM audit_log WHERE request_id = 'audit-request-legacy'").get()).toEqual({
      request_id: 'audit-request-legacy', actor_id: 'admin-legacy', metadata_json: '{"preserved":true}',
    })
    expect(database.prepare("SELECT request_id, actor_id, metadata_json FROM audit_log WHERE request_id = 'audit-request-manager'").get()).toEqual({
      request_id: 'audit-request-manager', actor_id: null, metadata_json: '{"history":"preserved"}',
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    // The runtime exercised below represents the current deployed Worker, so
    // apply the later session-role schema without altering the historical 0004
    // data assertions above.
    database.exec(readFileSync('drizzle/0007_session_roles.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))

    const migratedD1 = new MemoryD1()
    migratedD1.database.close()
    migratedD1.database = database
    const env = { DB: migratedD1, IDENTITY_IMAGES: new MemoryR2() }
    const oldManagerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager', password: 'legacy-manager-password',
    }), env)
    expect(oldManagerLogin.status).toBe(401)
    const oldEmployeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee', password: 'legacy-employee-password',
    }), env)
    expect(oldEmployeeLogin.status).toBe(401)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'legacy-admin-password',
    }), env)
    expect(adminLogin.status).toBe(200)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const supportReissued = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 4,
      payload: {
        employeeId: 'HTKD777', username: 'support.reissued', password: 'support-reissued-password',
        cccd: '079123456789', address: 'TP.HCM', employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
        identityImages: testIdentityImages(),
      },
    }, { ...adminAuthorization, 'idempotency-key': 'migration-support-reissue-0001' }), env)
    expect(supportReissued.status).toBe(200)
    expect(await supportReissued.json()).toMatchObject({
      version: 5,
      employee: { id: 'HTKD777', username: 'support.reissued', authUserId: expect.any(String), authVersion: 1 },
      user: {
        role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD777',
        username: 'support.reissued', status: 'active', version: 1,
      },
    })
    const reissuedLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.reissued', password: 'support-reissued-password',
    }), env)
    expect(reissuedLogin.status).toBe(200)
    const hydratedAfterReissue = readHydratedState(database)
    expect(hydratedAfterReissue.employees.map(({ id }) => id)).toEqual(['E01', 'HTKD777'])
    expect(hydratedAfterReissue.attendance).toEqual([expect.objectContaining({
      id: 'ATT-LEGACY-SUPPORT', employeeId: 'HTKD777',
    })])
    expect(database.prepare("SELECT role, employee_id FROM users WHERE username_normalized = 'support.reissued'").get()).toEqual({
      role: 'business_support', employee_id: 'HTKD777',
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    database.close()
  })

  it('re-purges live non-admin accounts while preserving profiles and history', () => {
    const database = new DatabaseSync(':memory:')
    for (const file of [
      'drizzle/0000_idosi_core.sql',
      'drizzle/0001_manager_role.sql',
      'drizzle/0002_attendance_evaluation_policies.sql',
      'drizzle/0003_state_entities.sql',
      'drizzle/0004_operational_roles.sql',
    ]) {
      database.exec(readFileSync(file, 'utf8').replaceAll('--> statement-breakpoint', ''))
    }

    const timestamp = '2026-08-17T12:00:00.000Z'
    const insertUser = database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, version, store_id,
        employee_id, password_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'hash', 'salt', 100000, 'PBKDF2-SHA256', ?, 'active', 1, ?, ?, ?, ?, ?)
    `)
    insertUser.run('admin-live', 'admin', 'admin', 'Admin', 'admin', null, null, timestamp, timestamp, timestamp)
    insertUser.run(
      'support-live', 'htkd-ben', 'htkd-ben', 'Hỗ trợ Bến', 'business_support',
      'BUSINESS_SUPPORT', 'HTKD-002', timestamp, timestamp, timestamp,
    )
    insertUser.run(
      'manager-live', 'clct-diemthuy', 'clct-diemthuy', 'Quản lý Diễm Thúy', 'store_manager',
      'CH001', 'QLCH-002', timestamp, timestamp, timestamp,
    )
    insertUser.run(
      'employee-live', 'employee-live', 'employee-live', 'Nhân viên', 'employee',
      'CH001', 'SM234-099', timestamp, timestamp, timestamp,
    )

    for (const [id, userId] of [
      ['SESSION-ADMIN', 'admin-live'],
      ['SESSION-SUPPORT', 'support-live'],
      ['SESSION-MANAGER', 'manager-live'],
      ['SESSION-EMPLOYEE', 'employee-live'],
    ]) {
      database.prepare(`
        INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at)
        VALUES (?, ?, ?, ?, ?, '2026-08-18T12:00:00.000Z')
      `).run(id, `hash-${id}`, userId, timestamp, timestamp)
    }
    for (const [actorId, key] of [
      ['admin-live', 'receipt-admin'],
      ['support-live', 'receipt-support'],
      ['manager-live', 'receipt-manager'],
    ]) {
      database.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        ) VALUES (?, ?, 'request-hash', '{"chunked":true,"chunkCount":1,"totalBytes":2}', 200, ?)
      `).run(actorId, key, timestamp)
      database.prepare(`
        INSERT INTO command_receipt_chunks (
          actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
        ) VALUES (?, ?, 0, '{}', 2, ?)
      `).run(actorId, key, timestamp)
    }

    const liveProfiles = [{
      id: 'HTKD-002', name: 'Hỗ trợ Bến', phone: '0900000002', unit: 'business_support',
      username: 'htkd-ben', authUserId: 'support-live', authVersion: 1,
      password: 'plain', passwordHash: 'hash', passwordResetToken: 'reset',
    }, {
      id: 'QLCH-002', name: 'Quản lý Diễm Thúy', phone: '0900000003', unit: 'store_manager',
      Username: 'clct-diemthuy', auth_user_id: 'manager-live', auth_version: 1,
      passwordSalt: 'salt', password_hint: 'hint',
    }]
    const deletedProfiles = [{
      id: 'SM234-099', name: 'Nhân viên đã nghỉ', storeId: 'CH001', unit: 'store',
      username: 'employee-live', authUserId: 'employee-live', authVersion: 1,
      passwordLegacy: 'legacy',
    }]
    const compactState = {
      stateVersion: 12,
      employees: liveProfiles,
      deletedEmployees: deletedProfiles,
      attendance: [{ id: 'ATT-HISTORY', employeeId: 'HTKD-002', checkInAt: timestamp }],
      accountSettings: {
        'admin-live': { name: 'Admin preference' },
        'support-live': { name: 'Support private preference' },
        'manager-live': { name: 'Manager private preference' },
        orphan: { name: 'Orphan private preference' },
      },
    }
    database.prepare(`
      INSERT INTO app_state (
        scope_key, value_json, version, updated_at, updated_by, last_request_id
      ) VALUES ('global', ?, 12, ?, 'support-live', 'live-request')
    `).run(JSON.stringify(compactState), timestamp)
    replaceStateCollection(database, 'employees', liveProfiles)
    replaceStateCollection(database, 'deletedEmployees', deletedProfiles)
    replaceStateCollection(database, 'attendance', compactState.attendance)

    database.exec(`
      INSERT INTO policies (
        policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
      ) VALUES
        ('live_support_policy', '1', 1, '${timestamp}', '${timestamp}', 'support-live', 'policy-support'),
        ('live_admin_policy', '2', 1, '${timestamp}', '${timestamp}', 'admin-live', 'policy-admin');
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id, server_timestamp
      ) VALUES
        ('audit-live-employee', 'employee-live', 'employee', 'history.employee', 'employee', 'SM234-099', '${timestamp}'),
        ('audit-live-admin', 'admin-live', 'admin', 'history.admin', 'state', 'global', '${timestamp}');
    `)

    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(readFileSync('drizzle/0005_admin_only_accounts.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }

    expect(database.prepare('SELECT id, username, role FROM users ORDER BY id').all()).toEqual([
      { id: 'admin-live', username: 'admin', role: 'admin' },
    ])
    expect(database.prepare('SELECT id, user_id FROM sessions ORDER BY id').all()).toEqual([
      { id: 'SESSION-ADMIN', user_id: 'admin-live' },
    ])
    expect(database.prepare('SELECT actor_id, idempotency_key FROM command_receipts ORDER BY actor_id').all()).toEqual([
      { actor_id: 'admin-live', idempotency_key: 'receipt-admin' },
    ])
    expect(database.prepare('SELECT actor_id, idempotency_key FROM command_receipt_chunks ORDER BY actor_id').all()).toEqual([
      { actor_id: 'admin-live', idempotency_key: 'receipt-admin' },
    ])
    expect(database.prepare(`
      SELECT policy_key, updated_by FROM policies
      WHERE policy_key LIKE 'live_%' ORDER BY policy_key
    `).all()).toEqual([
      { policy_key: 'live_admin_policy', updated_by: 'admin-live' },
      { policy_key: 'live_support_policy', updated_by: null },
    ])
    expect(database.prepare(`
      SELECT request_id, actor_id FROM audit_log
      WHERE request_id LIKE 'audit-live-%' ORDER BY request_id
    `).all()).toEqual([
      { request_id: 'audit-live-admin', actor_id: 'admin-live' },
      { request_id: 'audit-live-employee', actor_id: null },
    ])

    const migratedCompactRow = database.prepare(`
      SELECT value_json, version, updated_by, last_request_id
      FROM app_state WHERE scope_key = 'global'
    `).get()
    expect({
      version: migratedCompactRow.version,
      updated_by: migratedCompactRow.updated_by,
      last_request_id: migratedCompactRow.last_request_id,
    }).toEqual({
      version: 13,
      updated_by: null,
      last_request_id: 'migration:0005:admin-only-accounts',
    })
    const migratedCompact = JSON.parse(migratedCompactRow.value_json)
    expect(migratedCompact.employees.map(({ id }) => id)).toEqual(['HTKD-002', 'QLCH-002'])
    expect(migratedCompact.deletedEmployees.map(({ id }) => id)).toEqual(['SM234-099'])
    expect(migratedCompact.attendance).toEqual(compactState.attendance)
    expect(migratedCompact.accountSettings).toEqual({ 'admin-live': { name: 'Admin preference' } })
    expect(JSON.stringify([migratedCompact.employees, migratedCompact.deletedEmployees]))
      .not.toMatch(/username|auth_?user_?id|auth_?version|password/iu)

    const migratedProfiles = database.prepare(`
      SELECT collection_key, value_json, value_bytes
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key IN ('employees', 'deletedEmployees')
      ORDER BY collection_key, entity_order
    `).all()
    expect(migratedProfiles.map(({ collection_key: collectionKey, value_json: valueJson }) => ({
      collectionKey, id: JSON.parse(valueJson).id,
    }))).toEqual([
      { collectionKey: 'deletedEmployees', id: 'SM234-099' },
      { collectionKey: 'employees', id: 'HTKD-002' },
      { collectionKey: 'employees', id: 'QLCH-002' },
    ])
    expect(JSON.stringify(migratedProfiles.map(({ value_json: valueJson }) => JSON.parse(valueJson))))
      .not.toMatch(/username|auth_?user_?id|auth_?version|password/iu)
    expect(migratedProfiles.every(({ value_json: valueJson, value_bytes: valueBytes }) => (
      Buffer.byteLength(valueJson) === valueBytes
    ))).toBe(true)
    expect(database.prepare(`
      SELECT json_extract(value_json, '$.id') AS id
      FROM state_entities WHERE collection_key = 'attendance'
    `).all()).toEqual([{ id: 'ATT-HISTORY' }])
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    database.close()
  })

  it('recursively scrubs profile secrets in split and compact storage without disturbing safe data', () => {
    const database = new DatabaseSync(':memory:')
    for (const file of [
      'drizzle/0000_idosi_core.sql',
      'drizzle/0001_manager_role.sql',
      'drizzle/0002_attendance_evaluation_policies.sql',
      'drizzle/0003_state_entities.sql',
      'drizzle/0004_operational_roles.sql',
      'drizzle/0005_admin_only_accounts.sql',
    ]) {
      database.exec(readFileSync(file, 'utf8').replaceAll('--> statement-breakpoint', ''))
    }

    const credentialEnvelope = (prefix) => ({
      hash: `${prefix}-HASH-SENTINEL`,
      salt: `${prefix}-SALT-SENTINEL`,
      iterations: 210_000,
      algorithm: 'PBKDF2-SHA256',
    })
    const compactState = {
      stateVersion: 41,
      employees: [{
        id: 'COMPACT-ACTIVE-1',
        name: 'Compact Active One',
        accessToken: 'COMPACT-ROOT-TOKEN-SENTINEL',
        tokenCount: 7,
        nested: {
          safeLabel: 'compact-safe-label',
          api_key: 'COMPACT-NESTED-APIKEY-SENTINEL',
          safeEnvelope: credentialEnvelope('COMPACT-NESTED-CREDENTIAL'),
        },
        orderedItems: [
          { id: 'compact-before' },
          credentialEnvelope('COMPACT-ARRAY-CREDENTIAL'),
          { id: 'compact-after', safe: true },
        ],
      }, credentialEnvelope('COMPACT-ROOT-CREDENTIAL'), {
        id: 'COMPACT-ACTIVE-2',
        name: 'Compact Active Two',
      }],
      deletedEmployees: [{
        id: 'COMPACT-DELETED-1',
        name: 'Compact Deleted One',
        nested: {
          refresh_token: 'COMPACT-DELETED-TOKEN-SENTINEL',
          disguisedCredential: 'COMPACT-DELETED-CREDENTIAL-SENTINEL',
          safeValue: 42,
        },
      }],
      attendance: [{ id: 'ATT-UNCHANGED', employeeId: 'COMPACT-ACTIVE-1' }],
    }
    database.prepare(`
      INSERT INTO app_state (
        scope_key, value_json, version, updated_at, updated_by, last_request_id
      ) VALUES ('global', ?, 41, '2026-08-19T12:00:00.000Z', NULL, 'before-0006')
    `).run(JSON.stringify(compactState))

    replaceStateCollection(database, 'employees', [{
      id: 'SPLIT-ACTIVE-1',
      name: 'Split Active One',
      tokenHash: 'SPLIT-ROOT-TOKEN-SENTINEL',
      tokenCount: 9,
      nested: {
        apiKey: 'SPLIT-NESTED-APIKEY-SENTINEL',
        safeLabel: 'split-safe-label',
      },
      orderedItems: [
        { id: 'split-before' },
        credentialEnvelope('SPLIT-ARRAY-CREDENTIAL'),
        { id: 'split-after' },
      ],
    }, credentialEnvelope('SPLIT-ROOT-CREDENTIAL'), {
      id: 'SPLIT-ACTIVE-2',
      name: 'Split Active Two',
    }])
    replaceStateCollection(database, 'deletedEmployees', [{
      id: 'SPLIT-DELETED-1',
      name: 'Split Deleted One',
      nested: {
        authorization_header: 'SPLIT-DELETED-TOKEN-SENTINEL',
        safeEnvelope: credentialEnvelope('SPLIT-NESTED-CREDENTIAL'),
        safeValue: 'split-deleted-safe',
      },
    }])

    const applySecretScrubMigration = () => {
      database.exec('BEGIN IMMEDIATE')
      try {
        database.exec(readFileSync('drizzle/0006_recursive_profile_secret_scrub.sql', 'utf8')
          .replaceAll('--> statement-breakpoint', ''))
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    }
    applySecretScrubMigration()

    const isSecretKey = (key) => {
      const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/gu, '')
      return [
        'password', 'passwordhash', 'passwordsalt', 'passworditerations',
        'legacypassword', 'token', 'tokenhash', 'accesstoken', 'refreshtoken',
        'apikey', 'secret', 'credential', 'credentials', 'authorization',
        'cookie', 'setcookie',
      ].includes(normalized)
        || normalized.includes('password')
        || normalized.endsWith('token')
        || normalized.endsWith('tokenhash')
        || normalized.includes('accesstoken')
        || normalized.includes('refreshtoken')
        || normalized.includes('apikey')
        || normalized.includes('secret')
        || normalized.includes('credential')
        || normalized.includes('authorization')
        || normalized.includes('cookie')
    }
    const expectSanitized = (value) => {
      expect(JSON.stringify(value)).not.toContain('SENTINEL')
      const visit = (item) => {
        if (Array.isArray(item)) {
          item.forEach(visit)
          return
        }
        if (!item || typeof item !== 'object') return
        const keys = Object.keys(item)
        const normalizedKeys = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/gu, '')))
        expect(['hash', 'salt', 'iterations', 'algorithm'].every((key) => normalizedKeys.has(key))).toBe(false)
        keys.forEach((key) => {
          expect(isSecretKey(key)).toBe(false)
          visit(item[key])
        })
      }
      visit(value)
    }

    const compactRow = database.prepare(`
      SELECT value_json, version, updated_by, last_request_id
      FROM app_state WHERE scope_key = 'global'
    `).get()
    expect({
      version: compactRow.version,
      updated_by: compactRow.updated_by,
      last_request_id: compactRow.last_request_id,
    }).toEqual({
      version: 42,
      updated_by: null,
      last_request_id: 'migration:0006:recursive-profile-secret-scrub',
    })
    const migratedCompact = JSON.parse(compactRow.value_json)
    expect(migratedCompact.employees.map(({ id }) => id)).toEqual([
      'COMPACT-ACTIVE-1', 'COMPACT-ACTIVE-2',
    ])
    expect(migratedCompact.deletedEmployees.map(({ id }) => id)).toEqual(['COMPACT-DELETED-1'])
    expect(migratedCompact.employees[0]).toMatchObject({
      id: 'COMPACT-ACTIVE-1',
      name: 'Compact Active One',
      tokenCount: 7,
      nested: { safeLabel: 'compact-safe-label' },
      orderedItems: [{ id: 'compact-before' }, { id: 'compact-after', safe: true }],
    })
    expect(migratedCompact.deletedEmployees[0].nested).toEqual({ safeValue: 42 })
    expect(migratedCompact.attendance).toEqual(compactState.attendance)
    expectSanitized([migratedCompact.employees, migratedCompact.deletedEmployees])

    const splitRows = database.prepare(`
      SELECT collection_key, entity_order, value_json, value_bytes
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key IN ('employees', 'deletedEmployees')
      ORDER BY collection_key, entity_order, entity_key
    `).all()
    expect(splitRows.map(({ collection_key: collectionKey, entity_order: entityOrder, value_json: valueJson }) => ({
      collectionKey,
      entityOrder,
      id: JSON.parse(valueJson).id,
    }))).toEqual([
      { collectionKey: 'deletedEmployees', entityOrder: 1_000_000, id: 'SPLIT-DELETED-1' },
      { collectionKey: 'employees', entityOrder: 1_000_000, id: 'SPLIT-ACTIVE-1' },
      { collectionKey: 'employees', entityOrder: 3_000_000, id: 'SPLIT-ACTIVE-2' },
    ])
    const migratedSplit = splitRows.map(({ value_json: valueJson }) => JSON.parse(valueJson))
    expect(migratedSplit.find(({ id }) => id === 'SPLIT-ACTIVE-1')).toMatchObject({
      name: 'Split Active One',
      tokenCount: 9,
      nested: { safeLabel: 'split-safe-label' },
      orderedItems: [{ id: 'split-before' }, { id: 'split-after' }],
    })
    expect(migratedSplit.find(({ id }) => id === 'SPLIT-DELETED-1').nested)
      .toEqual({ safeValue: 'split-deleted-safe' })
    expectSanitized(migratedSplit)
    expect(splitRows.every(({ value_json: valueJson, value_bytes: valueBytes }) => (
      Buffer.byteLength(valueJson) === valueBytes
    ))).toBe(true)
    const replaySnapshot = {
      appState: database.prepare(`
        SELECT value_json, version, updated_at, updated_by, last_request_id
        FROM app_state WHERE scope_key = 'global'
      `).get(),
      profiles: database.prepare(`
        SELECT collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
        FROM state_entities
        WHERE scope_key = 'global' AND collection_key IN ('employees', 'deletedEmployees')
        ORDER BY collection_key, entity_order, entity_key
      `).all(),
    }
    applySecretScrubMigration()
    expect({
      appState: database.prepare(`
        SELECT value_json, version, updated_at, updated_by, last_request_id
        FROM app_state WHERE scope_key = 'global'
      `).get(),
      profiles: database.prepare(`
        SELECT collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
        FROM state_entities
        WHERE scope_key = 'global' AND collection_key IN ('employees', 'deletedEmployees')
        ORDER BY collection_key, entity_order, entity_key
      `).all(),
    }).toEqual(replaySnapshot)
    expect(database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_0006_profile_scrub'
    `).all()).toEqual([])
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    database.close()
  })

  it('projects only an employee own records and strips privileged legacy fields', () => {
    const state = {
      schemaVersion: 2,
      stateVersion: 7,
      adminAccounts: [{ username: 'admin', passwordHash: 'secret' }],
      managerAccounts: [{ username: 'manager', passwordHash: 'secret' }],
      managerPayroll: [{ id: 'pay-manager' }],
      profitShares: [{ id: 'share-manager' }],
      integration: {
        label: 'safe-value',
        accessToken: 'access-token-secret',
        refresh_token: 'refresh-token-secret',
        apiKey: 'api-key-secret',
        client_secret_key: 'client-secret-value',
        authorization_header: 'Bearer hidden',
        cookie_jar: 'session=hidden',
        disguisedCredential: {
          hash: 'credential-hash',
          salt: 'credential-salt',
          iterations: 210_000,
          algorithm: 'PBKDF2-SHA256',
        },
        list: [{ hash: 'h', salt: 's', iterations: 210_000, algorithm: 'PBKDF2-SHA256' }, { safe: true }],
      },
      policies: { late_tolerance_minutes: 99 },
      policyHistory: [{ id: 'policy-history-1', key: 'late_tolerance_minutes' }],
      orderCounters: { S01: 12 },
      stores: [{ id: 'S01', name: 'Cửa hàng 1', revenue: 9_000_000, expense: 2_000_000, profit: 7_000_000 }, { id: 'S02' }],
      employees: [
        { id: 'E01', storeId: 'S01', name: 'Nhân viên 1', passwordHash: 'secret' },
        { id: 'E02', storeId: 'S01', name: 'Nhân viên 2' },
        { id: 'VP001', storeId: 'OFFICE', unit: 'office', name: 'Nhân viên văn phòng' },
      ],
      orders: [
        { id: 'O01', employeeId: 'E01', createdByEmployeeId: 'E01', storeId: 'S01', shiftId: 'CA-SAME', attendanceId: 'A01' },
        { id: 'O02', employeeId: 'E02', createdByEmployeeId: 'E02', storeId: 'S01', shiftId: 'CA-SAME', attendanceId: 'A02' },
        {
          id: 'O03', employeeId: 'E02', createdByEmployeeId: 'E02', storeId: 'S01', shiftId: 'CA-SAME',
          updatedBy: { employeeId: 'E01' },
        },
        { id: 'O04', employeeId: 'E01', createdBy: { id: 'ADMIN-01', role: 'admin' }, storeId: 'S01', shiftId: 'CA-SAME' },
      ],
      officeAdjustments: [{ id: 'OA01', employeeId: 'VP001', amount: 500_000 }],
      supportTransfers: [
        { id: 'ST01', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02' },
        { id: 'ST02', employeeId: 'VP001', fromStoreId: 'OFFICE', toStoreId: 'S01' },
        { id: 'ST03', employeeId: 'E02', fromStoreId: 'S01', toStoreId: 'OFFICE' },
      ],
      cashTransactions: [
        { id: 'C01', storeId: 'S01', employeeId: 'E02', amount: 1_000_000 },
      ],
      notifications: [
        { id: 'N01', employeeId: 'E01' },
        { id: 'N02', employeeId: 'E02' },
      ],
      attendance: [
        { id: 'A01', employeeId: 'E01', checkInAt: '2026-08-14T01:00:00.000Z', checkOutAt: null },
        { id: 'A02', employeeId: 'E02', checkInAt: '2026-08-14T01:00:00.000Z', checkOutAt: null },
      ],
      tasks: [
        { id: 'T-store', storeId: 'S01', title: 'Công việc chung' },
        { id: 'T-own', storeId: 'S01', employeeId: 'E01' },
        { id: 'T-other', storeId: 'S01', employeeId: 'E02' },
        {
          id: 'T-mixed', storeId: 'S01', employeeIds: ['E01', 'E02'],
          assignees: [{ id: 'E01', name: 'Own' }, { id: 'E02', name: 'Peer secret' }],
          participants: [{ id: 'E01' }, { id: 'E02' }], completedBy: { E01: true, E02: false },
        },
        {
          id: 'T-nested', storeId: 'S01', employeeId: 'E01',
          before: { employeeId: 'E02', salary: 99_000_001, name: 'Nested peer secret' },
        },
      ],
      payrollPeriods: [{
        id: 'P01',
        period: '2026-08',
        financeSnapshot: { profit: 9_000_000 },
        kpiSnapshot: { results: [{ id: 'E01' }, { id: 'E02' }] },
        closedBy: { id: 'admin-1', name: 'Admin' },
        rows: [
          { employeeId: 'E01', gross: 5_000_000 },
          { employeeId: 'E02', gross: 6_000_000 },
        ],
      }],
      storeEmployeeSalaryConfigs: [
        {
          id: 'CFG-E01', employeeId: 'E01', storeId: 'S01', effectiveFrom: '2026-08',
          standardHourlyRateVnd: 30_000, createdBy: { employeeId: 'HTKD001' },
        },
        { id: 'CFG-E02', employeeId: 'E02', storeId: 'S01', effectiveFrom: '2026-08', standardHourlyRateVnd: 31_000 },
        { id: 'CFG-OTHER', employeeId: 'E01', storeId: 'S02', effectiveFrom: '2026-08', standardHourlyRateVnd: 99_000 },
      ],
    }

    const projection = projectSharedState(state, {
      role: 'employee',
      user_id: 'user-1',
      employee_id: 'E01',
      store_id: 'S01',
    })

    expect(projection.stores).toEqual([{ id: 'S01', name: 'Cửa hàng 1' }])
    expect(projection.employees).toEqual([{ id: 'E01', storeId: 'S01', name: 'Nhân viên 1' }])
    expect(projection.orders).toEqual([{
      id: 'O01', employeeId: 'E01', createdByEmployeeId: 'E01', storeId: 'S01', shiftId: 'CA-SAME', attendanceId: 'A01',
    }])
    expect(projection.notifications).toEqual([{ id: 'N01', employeeId: 'E01', readAt: null }])
    expect(projection.tasks.map(({ id }) => id)).toEqual(['T-store', 'T-own', 'T-mixed', 'T-nested'])
    expect(projection.tasks[2]).toMatchObject({
      employeeIds: ['E01'], assignees: [{ id: 'E01', name: 'Own' }],
      participants: [{ id: 'E01' }], completedBy: { E01: true },
    })
    expect(projection.tasks.find(({ id }) => id === 'T-nested')).not.toHaveProperty('before')
    expect(JSON.stringify(projection.tasks)).not.toMatch(/E02|Peer secret|Nested peer secret|99000001/u)
    expect(projection.payrollPeriods).toEqual([{
      id: 'P01',
      period: '2026-08',
      rows: [{ employeeId: 'E01', gross: 5_000_000 }],
    }])
    expect(projection.storeEmployeeSalaryConfigs).toEqual([
      expect.objectContaining({ id: 'CFG-E01', employeeId: 'E01', storeId: 'S01' }),
    ])
    expect(projection.activeAttendanceId).toBe('A01')
    expect(projection.checkedInAt).toBe('2026-08-14T01:00:00.000Z')
    expect(projection.finishedShift).toBe(false)
    expect(projection).not.toHaveProperty('cashTransactions')
    for (const key of ['adminAccounts', 'managerAccounts', 'managerPayroll', 'profitShares', 'policies', 'orderCounters']) {
      expect(projection).not.toHaveProperty(key)
    }
    expect(projectSharedState(state, { role: 'admin' }).policyHistory).toEqual(state.policyHistory)
    const adminProjection = projectSharedState(state, { role: 'admin' })
    expect(adminProjection.integration).toEqual({ label: 'safe-value', list: [{ safe: true }] })
    expect(JSON.stringify(adminProjection)).not.toMatch(/access-token-secret|refresh-token-secret|api-key-secret|client-secret-value|credential-hash|Bearer hidden|session=hidden/u)
    const managerProjection = projectSharedState(state, { role: 'business_support', user_id: 'manager-1' })
    expect(managerProjection.orders).toEqual(state.orders)
    expect(managerProjection.employees.map(({ id }) => id)).toEqual(['E01', 'E02', 'VP001'])
    expect(managerProjection.supportTransfers.map(({ id }) => id)).toEqual(['ST01', 'ST02', 'ST03'])
    expect(managerProjection.officeAdjustments).toEqual(state.officeAdjustments)
  })

  it('projects aggregate daily store revenue without exposing coworker orders', () => {
    const state = {
      schemaVersion: 2,
      stateVersion: 1,
      stores: [{ id: 'S01', name: 'Dosii S01' }],
      employees: [
        { id: 'E01', storeId: 'S01', unit: 'store', name: 'Nhân viên 1' },
        { id: 'E02', storeId: 'S01', unit: 'store', name: 'Nhân viên 2' },
      ],
      attendance: [], schedule: [], tasks: [], notifications: [], payrollPeriods: [],
      orders: [{
        id: 'ORDER-OWN', storeId: 'S01', employeeId: 'E01', createdByEmployeeId: 'E01',
        amount: 1_200_000, status: 'Hoàn tất', createdAt: '2026-08-26T02:00:00.000Z',
      }, {
        id: 'ORDER-COWORKER', storeId: 'S01', employeeId: 'E02', createdByEmployeeId: 'E02',
        amount: 3_300_000, status: 'Hoàn tất', createdAt: '2026-08-26T03:00:00.000Z',
      }, {
        id: 'ORDER-DELETED', storeId: 'S01', employeeId: 'E02', createdByEmployeeId: 'E02',
        amount: 99_000_000, status: 'Đã xóa', createdAt: '2026-08-26T04:00:00.000Z',
      }],
    }

    const projection = projectSharedState(state, {
      role: 'employee', user_id: 'U01', employee_id: 'E01', store_id: 'S01',
    })

    expect(projection.orders.map(({ id }) => id)).toEqual(['ORDER-OWN'])
    expect(projection.storeDailyRevenue).toEqual([{
      id: 'store-revenue:S01:2026-08-26', storeId: 'S01', businessDate: '2026-08-26',
      revenueVnd: 4_500_000, orderCount: 2,
    }])
    expect(JSON.stringify(projection.orders)).not.toContain('ORDER-COWORKER')
  })

  it('keeps canonical reward lineage visible to the historical store through employee aliases', () => {
    const state = {
      schemaVersion: 2,
      stateVersion: 1,
      stores: [{ id: 'S01', name: 'Store lịch sử' }, { id: 'S02', name: 'Store hiện tại' }],
      employees: [{
        id: 'M-S01', name: 'Quản lý S01', unit: 'store_manager', storeId: 'S01',
      }, {
        id: 'PROFILE-E01', code: 'E01', employeeId: 'LEGACY-E01', name: 'Nhân viên điều chuyển',
        unit: 'store', storeId: 'S02', status: 'Đang làm việc', salary: 99_000_000,
      }],
      attendance: [{
        id: 'ATT-HISTORICAL', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftId: 'SHIFT-AM',
      }],
      schedule: [], tasks: [], taskAssignmentHistory: [], notifications: [], payrollPeriods: [],
      workCatalogProgress: [{
        id: 'PROGRESS-CANONICAL', employeeId: 'PROFILE-E01', storeId: 'S01', workDate: '2026-08-20',
        shiftId: 'SHIFT-AM', catalogItemId: 'CAT-REWARD', completed: true,
      }],
      compensationEntries: [{
        id: 'CLAIM-CANONICAL', employeeId: 'PROFILE-E01', storeId: 'S01', effectiveDate: '2026-08-20',
        shiftId: 'SHIFT-AM', catalogItemId: 'CAT-REWARD', sourceType: 'work-catalog-reward', status: 'ACTIVE',
      }],
      violations: [],
    }

    const projection = projectSharedState(state, {
      role: 'store_manager', user_id: 'U-M-S01', employee_id: 'M-S01', store_id: 'S01',
    })

    expect(projection.employees).toEqual([
      expect.objectContaining({ id: 'M-S01' }),
      expect.objectContaining({ id: 'PROFILE-E01', code: 'E01', historicalStoreId: 'S01', historicalOnly: true }),
    ])
    expect(projection.employees[1]).not.toHaveProperty('salary')
    expect(projection.workCatalogProgress).toEqual([
      expect.objectContaining({ id: 'PROGRESS-CANONICAL', employeeId: 'PROFILE-E01', storeId: 'S01' }),
    ])
    expect(projection.compensationEntries).toEqual([
      expect.objectContaining({ id: 'CLAIM-CANONICAL', employeeId: 'PROFILE-E01', storeId: 'S01' }),
    ])
  })

  it('projects only the signed-in actor canonical linked profile for account settings', () => {
    const state = {
      schemaVersion: 2,
      stateVersion: 1,
      stores: [{ id: 'S01', name: 'Store 01' }],
      employees: [
        {
          id: 'HTKD-CANONICAL', unit: 'business_support', storeId: 'BUSINESS_SUPPORT',
          name: 'Hồ sơ HTKD gốc', email: 'support@idosi.vn', phone: '0901234567',
          cccd: '079123456789', birthday: '1995-04-12T00:00:00.000Z', gender: 'Nữ',
          street: '12 Nguyễn Huệ', ward: 'Bến Nghé', province: 'TP. Hồ Chí Minh',
          position: 'NV hỗ trợ KD', salary: 99_000_000,
          identityImages: { front: 'private-front', back: 'private-back' }, authUserId: 'U-MANAGER',
        },
        {
          id: 'QLCH-LINKED', unit: 'store_manager', storeId: 'S01', name: 'Snapshot quản lý',
          linkedEmployeeId: 'HTKD-CANONICAL', authUserId: 'U-MANAGER',
          avatarImage: {
            key: 'account-avatars/U-MANAGER/avatar-v3.png', contentType: 'image/png', size: 128, version: 3,
          },
        },
        { id: 'E-PEER', unit: 'store', storeId: 'S01', name: 'Nhân viên cùng cửa hàng' },
        {
          id: 'HTKD-FOREIGN', unit: 'business_support', storeId: 'BUSINESS_SUPPORT',
          name: 'Hồ sơ HTKD khác', cccd: '000000000000', salary: 88_000_000,
        },
        {
          id: 'VP-CANONICAL', unit: 'office', storeId: 'OFFICE', name: 'Hồ sơ KVP gốc',
          phone: '0912345678', cccd: '012345678901', address: '1 Võ Văn Tần, Quận 3',
          position: 'Kế toán', salary: 77_000_000, authUserId: 'U-EMPLOYEE',
        },
        {
          id: 'E-LINKED', unit: 'store', storeId: 'S01', name: 'Snapshot nhân viên',
          sourceEmployeeId: 'VP-CANONICAL', authUserId: 'U-EMPLOYEE',
        },
      ],
      attendance: [], schedule: [], tasks: [], notifications: [], orders: [], expenseEntries: [],
      supportTransfers: [], payrollPeriods: [],
    }

    const managerProjection = projectSharedState(state, {
      role: 'store_manager', user_id: 'U-MANAGER', employee_id: 'QLCH-LINKED', store_id: 'S01',
    })
    expect(managerProjection.employees.map(({ id }) => id)).toEqual(['QLCH-LINKED', 'E-PEER', 'E-LINKED'])
    expect(managerProjection.accountProfile).toEqual({
      code: 'HTKD-CANONICAL',
      name: 'Hồ sơ HTKD gốc',
      email: 'support@idosi.vn',
      phone: '0901234567',
      cccd: '079123456789',
      birthday: '1995-04-12',
      gender: 'Nữ',
      address: '12 Nguyễn Huệ, Bến Nghé, TP. Hồ Chí Minh',
      position: 'NV hỗ trợ KD',
    })
    expect(managerProjection.accountProfile).not.toHaveProperty('salary')
    expect(managerProjection.accountProfile).not.toHaveProperty('identityImages')
    expect(managerProjection.settings.avatar).toMatchObject({
      key: 'account-avatars/U-MANAGER/avatar-v3.png', version: 3,
    })
    expect(JSON.stringify(managerProjection)).not.toMatch(/Hồ sơ HTKD khác|000000000000|99000000|88000000|private-front/u)

    const employeeProjection = projectSharedState(state, {
      role: 'employee', user_id: 'U-EMPLOYEE', employee_id: 'E-LINKED', store_id: 'S01',
    })
    expect(employeeProjection.employees.map(({ id }) => id)).toEqual(['E-LINKED'])
    expect(employeeProjection.accountProfile).toEqual({
      code: 'VP-CANONICAL',
      name: 'Hồ sơ KVP gốc',
      email: '',
      phone: '0912345678',
      cccd: '012345678901',
      birthday: '',
      gender: '',
      address: '1 Võ Văn Tần, Quận 3',
      position: 'Kế toán',
    })
    expect(employeeProjection.accountProfile).not.toHaveProperty('salary')
    expect(JSON.stringify(employeeProjection)).not.toMatch(/77000000|Hồ sơ HTKD gốc|Hồ sơ HTKD khác/u)
  })

  it('preserves SPA fallback and exposes a no-cache API health response', async () => {
    const html = '<!doctype html><div id="root"></div>'
    const env = {
      ASSETS: {
        async fetch(request) {
          return new URL(request.url).pathname === '/index.html'
            ? new Response(html, { headers: { 'content-type': 'text/html' } })
            : new Response('Not found', { status: 404 })
        },
      },
    }

    const page = await worker.fetch(new Request('https://idosi.example/admin/overview'), env)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('id="root"')

    const health = await worker.fetch(new Request('https://idosi.example/api/health'), env)
    expect(health.status).toBe(200)
    expect(health.headers.get('cache-control')).toBe('no-store')
    expect(await health.json()).toMatchObject({ ok: true, service: 'idosi-api', databaseConfigured: false })
  })

  it('gives business support the full safe Admin projection while keeping store managers scoped', () => {
    const state = {
      schemaVersion: 2,
      stateVersion: 9,
      stores: [{ id: 'S01', name: 'Store 01' }],
      employees: [
        { id: 'E01', storeId: 'S01', unit: 'store', name: 'Store employee' },
        { id: 'HTKD001', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'Support one', salary: 10_000_000 },
        { id: 'HTKD002', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'Support two', salary: 11_000_000 },
        { id: 'QL-S01-001', storeId: 'S01', unit: 'store_manager', name: 'Manager one', salary: 15_000_000 },
        { id: 'QL-S01-002', storeId: 'S01', unit: 'store_manager', name: 'Manager two', salary: 16_000_000 },
        { id: 'VP001', storeId: 'OFFICE', unit: 'office', name: 'Office employee', salary: 12_000_000 },
      ],
      attendance: [
        { id: 'A-E01', storeId: 'S01', employeeId: 'E01' },
        { id: 'A-S1', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', employeeId: 'HTKD001' },
        { id: 'A-S2', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', employeeId: 'HTKD002' },
        { id: 'A-M1', storeId: 'S01', unit: 'store_manager', employeeId: 'QL-S01-001' },
        { id: 'A-M2', storeId: 'S01', unit: 'store_manager', employeeId: 'QL-S01-002' },
        { id: 'A-VP', storeId: 'OFFICE', unit: 'office', employeeId: 'VP001' },
        { id: 'A-E-DELETED', storeId: 'S01', employeeId: 'E-DELETED' },
        { id: 'A-M-DELETED', storeId: 'S01', unit: 'store_manager', employeeId: 'QL-S01-002' },
      ],
      schedule: [
        { id: 'SCH-E', storeId: 'S01', employeeId: 'E01' },
        { id: 'SCH-E-DELETED', storeId: 'S01', employeeId: 'E-DELETED' },
        { id: 'SCH-M1', storeId: 'S01', employeeId: 'QL-S01-001' },
        { id: 'SCH-MIX', storeId: 'S01', employeeIds: ['E01', 'QL-S01-002'] },
      ],
      tasks: [
        { id: 'TASK-STORE', storeId: 'S01', title: 'Store-wide task' },
        { id: 'TASK-E', storeId: 'S01', participants: [{ id: 'E01' }] },
        { id: 'TASK-MIX', storeId: 'S01', employeeIds: ['E01', 'QL-S01-002'] },
        { id: 'TASK-NESTED', storeId: 'S01', before: { employeeId: 'HTKD002', salary: 11_000_000 } },
      ],
      salaryAdjustments: [
        { id: 'ADJ-E', storeId: 'S01', employeeId: 'E01', amount: 100_000 },
        { id: 'ADJ-M1', storeId: 'S01', employeeId: 'QL-S01-001', amount: 900_000 },
      ],
      salaryAdvances: [
        { id: 'ADV-E', storeId: 'S01', employeeId: 'E01', amount: 100_000 },
        { id: 'ADV-M1', storeId: 'S01', employeeId: 'QL-S01-001', amount: 900_000 },
      ],
      payrollPayments: [
        { id: 'PAY-E', storeId: 'S01', employeeId: 'E01', amount: 8_000_000 },
        { id: 'PAY-M1', storeId: 'S01', employeeId: 'QL-S01-001', amount: 15_000_000 },
      ],
      storeEmployeeSalaryConfigs: [
        {
          id: 'CFG-E', storeId: 'S01', employeeId: 'E01', effectiveFrom: '2026-08',
          standardHourlyRateVnd: 30_000, createdBy: { employeeId: 'HTKD001' },
        },
        { id: 'CFG-M', storeId: 'S01', employeeId: 'QL-S01-001', effectiveFrom: '2026-08', standardHourlyRateVnd: 31_000 },
        { id: 'CFG-OTHER-STORE', storeId: 'S02', employeeId: 'E01', effectiveFrom: '2026-08', standardHourlyRateVnd: 99_000 },
        { id: 'CFG-OTHER-EMPLOYEE', storeId: 'S01', employeeId: 'HTKD001', effectiveFrom: '2026-08', standardHourlyRateVnd: 98_000 },
      ],
      expenseEntries: [
        { id: 'EXP-E', storeId: 'S01', employeeId: 'E01', amount: 50_000 },
        { id: 'EXP-E-DELETED', storeId: 'S01', employeeId: 'E-DELETED', amount: 70_000 },
        { id: 'EXP-M-DELETED', storeId: 'S01', employeeId: 'QL-S01-002', amount: 98_000_000 },
        { id: 'EXP-NESTED', storeId: 'S01', after: { employeeId: 'HTKD002', amount: 99_000_000 } },
      ],
      orders: [
        { id: 'O-E', storeId: 'S01', employeeId: 'E01', total: 100_000 },
        { id: 'O-E-DELETED', storeId: 'S01', employeeId: 'E-DELETED', total: 200_000 },
        { id: 'O-M-DELETED', storeId: 'S01', employeeId: 'QL-S01-002', total: 97_000_000 },
      ],
      orderAudit: [{ id: 'OA-SECRET', storeId: 'S01', before: { customerName: 'Private customer' } }],
      auditLogs: [{ id: 'AL-SECRET', storeId: 'S01', metadata: { customerName: 'Private audit' } }],
      payrollPeriods: [
        {
          id: 'P-S01', storeId: 'S01', period: '2026-08', rows: [
            { employeeId: 'E01', gross: 8_000_000, hours: 10, kpiBonus: 1_000_000 },
            { employeeId: 'E-DELETED', gross: 7_000_000, hours: 7, kpiBonus: 700_000 },
            { employeeId: 'QL-S01-001', gross: 15_000_000, hours: 8, kpiBonus: 800_000 },
            { employeeId: 'QL-S01-002', gross: 16_000_000, hours: 12, kpiBonus: 1_200_000 },
          ],
          financeSnapshot: { profit: 9_000_000 },
          kpiSnapshot: {
            eligible: true, profit: 9_000_000, totalHours: 30, profitPerHour: 300_000,
            employeeTier: { ratePercent: 5 }, totalBonus: 3_000_000,
            results: [
              { id: 'E01', role: 'employee', hours: 10, ratePercent: 5, amount: 1_000_000 },
              { id: 'E-DELETED', role: 'employee', hours: 7, ratePercent: 5, amount: 700_000 },
              { id: 'QL-S01-001', role: 'store_manager', hours: 8, ratePercent: 5, amount: 800_000 },
              { id: 'QL-S01-002', role: 'store_manager', hours: 12, ratePercent: 5, amount: 1_200_000 },
            ],
          },
        },
        {
          id: 'P-SUPPORT', storeId: 'BUSINESS_SUPPORT', period: '2026-08', rows: [
            { employeeId: 'HTKD001', gross: 10_000_000 },
            { employeeId: 'HTKD002', gross: 11_000_000 },
          ],
          kpiSnapshot: {
            eligible: true, profit: 2_000_000, totalHours: 20, profitPerHour: 100_000,
            employeeTier: { ratePercent: 5 }, totalBonus: 1_000_000,
            results: [
              { id: 'HTKD001', role: 'business_support', hours: 9, ratePercent: 5, amount: 450_000 },
              { id: 'HTKD002', role: 'business_support', hours: 11, ratePercent: 5, amount: 550_000 },
            ],
          },
        },
      ],
      deletedEmployees: [
        { id: 'E-DELETED', code: 'E-DELETED', storeId: 'S01', unit: 'store', name: 'Former store employee' },
        { id: 'QL-S01-002', code: 'QL-S01-002', storeId: 'S01', unit: 'store_manager', name: 'Former peer manager' },
      ],
      notifications: [
        { id: 'N-E01', storeId: 'S01', employeeId: 'E01' },
        { id: 'N-S1', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD001' },
        { id: 'N-S2', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD002' },
        { id: 'N-M1', storeId: 'S01', employeeId: 'QL-S01-001' },
        { id: 'N-M2', storeId: 'S01', employeeId: 'QL-S01-002' },
      ],
      accountSettings: {
        'U-S1': { name: 'Support one settings' },
        'U-S2': { name: 'Private peer settings', bio: 'must-not-leak' },
      },
    }

    const supportProjection = projectSharedState(state, {
      role: 'business_support', user_id: 'U-S1', employee_id: 'HTKD001', store_id: 'BUSINESS_SUPPORT',
    })
    expect(supportProjection.employees).toEqual(state.employees)
    expect(supportProjection.attendance).toEqual(state.attendance)
    expect(supportProjection.notifications.map(({ id }) => id)).toEqual(state.notifications.map(({ id }) => id))
    expect(supportProjection.schedule).toEqual(state.schedule)
    expect(supportProjection.tasks).toEqual(state.tasks)
    expect(supportProjection.orders).toEqual(state.orders)
    expect(supportProjection.expenseEntries).toEqual(state.expenseEntries)
    expect(supportProjection.orderAudit).toEqual(state.orderAudit)
    expect(supportProjection.auditLogs).toEqual(state.auditLogs)
    expect(supportProjection.payrollPeriods.map(({ id }) => id)).toEqual(state.payrollPeriods.map(({ id }) => id))
    expect(JSON.stringify(supportProjection.payrollPeriods)).not.toMatch(/kpiBonus|kpiSnapshot/u)
    expect(supportProjection).not.toHaveProperty('accountSettings')
    expect(supportProjection.settings.name).toBe('Support one settings')
    expect(JSON.stringify(supportProjection)).not.toContain('must-not-leak')

    const managerProjection = projectSharedState(state, {
      role: 'store_manager', user_id: 'U-M1', employee_id: 'QL-S01-001', store_id: 'S01',
    })
    expect(managerProjection.employees.map(({ id }) => id)).toEqual(['E01', 'QL-S01-001'])
    expect(managerProjection.attendance.map(({ id }) => id)).toEqual(['A-E01', 'A-M1', 'A-E-DELETED'])
    expect(managerProjection.notifications.map(({ id }) => id)).toEqual(['N-E01', 'N-M1'])
    expect(managerProjection.schedule.map(({ id }) => id)).toEqual(['SCH-E'])
    expect(managerProjection.tasks.map(({ id }) => id)).toEqual(['TASK-STORE', 'TASK-E'])
    expect(managerProjection.salaryAdjustments.map(({ id }) => id)).toEqual(['ADJ-E'])
    expect(managerProjection.salaryAdvances.map(({ id }) => id)).toEqual(['ADV-E'])
    expect(managerProjection.payrollPayments.map(({ id }) => id)).toEqual(['PAY-E'])
    expect(managerProjection.storeEmployeeSalaryConfigs.map(({ id }) => id)).toEqual(['CFG-E'])
    expect(managerProjection.orders.map(({ id }) => id)).toEqual(['O-E', 'O-E-DELETED'])
    expect(managerProjection.expenseEntries.map(({ id }) => id)).toEqual(['EXP-E', 'EXP-E-DELETED'])
    expect(managerProjection).not.toHaveProperty('orderAudit')
    expect(managerProjection).not.toHaveProperty('auditLogs')
    expect(managerProjection.payrollPeriods[0].rows).toEqual([
      { employeeId: 'E01', gross: 8_000_000, hours: 10 },
    ])
    expect(managerProjection.payrollPeriods[0]).not.toHaveProperty('kpiSnapshot')
    expect(managerProjection.deletedEmployees.map(({ id }) => id)).toEqual(['E-DELETED'])
    expect(JSON.stringify(managerProjection)).not.toMatch(/HTKD001|HTKD002|QL-S01-002|VP001/u)
  })

  it('rolls back the import counter when the shared-state CAS loses a race', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-counter-race' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'counter-race-password',
      initialState: {
        stores: [{ id: 'S01', short: 'S01', name: 'Cửa hàng 01' }],
        importVouchers: [],
        expenseEntries: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin',
      password: 'counter-race-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const command = {
      type: 'import.create',
      expectedVersion: 1,
      payload: {
        storeId: 'S01',
        items: [{ name: 'Áo', category: 'Áo', quantity: 1, weight: 1, price: 100_000 }],
      },
    }
    env.DB.beforeBatch = async (database, statements) => {
      if (statements.some((statement) => statement.sql.includes('UPDATE counters'))) {
        database.database.prepare("UPDATE app_state SET version = version + 1 WHERE scope_key = 'global'").run()
      }
    }
    const raced = await worker.fetch(jsonRequest('https://idosi.example/api/command', command, {
      ...authorization,
      'idempotency-key': 'import-counter-race-1',
    }), env)
    expect(raced.status).toBe(409)
    expect(env.DB.database.prepare("SELECT counter_value FROM counters WHERE counter_name = 'system:imports'").get().counter_value).toBe(0)
    expect(readHydratedState(env.DB.database).importVouchers).toEqual([])

    const retry = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...command,
      expectedVersion: 2,
    }, {
      ...authorization,
      'idempotency-key': 'import-counter-race-2',
    }), env)
    expect(retry.status).toBe(201)
    expect(await retry.json()).toMatchObject({
      voucher: { code: expect.stringMatching(/-0001$/u) },
      counter: { value: 1 },
    })
  })

  it('hydrates, mutates, replaces, replays, and reloads state larger than two megabytes', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-large-state' }
    const largeOrders = Array.from({ length: 25_100 }, (_, index) => ({
      id: `legacy-order-${String(index).padStart(5, '0')}`,
      code: `S01-${String(index + 1).padStart(5, '0')}`,
      storeId: 'S01',
      amount: 10_000,
      paymentMethod: 'Tiền mặt',
      padding: `history-${index}-${'x'.repeat(40)}`,
    }))
    expect(Buffer.byteLength(JSON.stringify(largeOrders))).toBeGreaterThan(2 * 1024 * 1024)

    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'large-state-password',
      initialState: {
        schemaVersion: 2,
        stateVersion: 1,
        stores: [{ id: 'S01', short: 'S01', name: 'Cửa hàng 01' }],
        orders: largeOrders,
        notifications: [],
        employees: [],
        attendance: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const compactState = env.DB.database.prepare(`
      SELECT value_json FROM app_state WHERE scope_key = 'global'
    `).get().value_json
    expect(Buffer.byteLength(compactState)).toBeLessThan(1_500_000)
    expect(JSON.parse(compactState)).not.toHaveProperty('orders')
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS count FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orders'
    `).get()).toEqual({ count: largeOrders.length })

    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'large-state-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    env.DB.queryCount = 0
    const initialReload = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
    expect(initialReload.status).toBe(200)
    const initialReloadBody = await initialReload.json()
    expect(initialReloadBody.state.orders).toHaveLength(largeOrders.length)
    expect(initialReloadBody.state.orders.at(-1).id).toBe('legacy-order-25099')
    expect(env.DB.queryCount).toBeLessThan(25)

    const historicalRowBefore = env.DB.database.prepare(`
      SELECT entity_key, entity_order, value_json, updated_at
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orders'
        AND json_extract(value_json, '$.id') = 'legacy-order-00000'
    `).get()
    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.create',
      expectedVersion: 1,
      payload: {
        storeId: 'S01',
        customerName: 'Khách hàng mới',
        gender: 'Nữ',
        occupation: 'Buôn bán/kinh doanh',
        acquisitionChannel: 'Facebook',
        amount: 25_000,
        paymentMethod: 'Chuyển khoản',
      },
    }, { ...authorization, 'idempotency-key': 'large-state-order-create-0001' }), env)
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ version: 2, order: { code: 'S01-25101' } })
    expect(env.DB.database.prepare(`
      SELECT entity_key, entity_order, value_json, updated_at
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orders'
        AND json_extract(value_json, '$.id') = 'legacy-order-00000'
    `).get()).toEqual(historicalRowBefore)
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS count FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orders'
    `).get()).toEqual({ count: largeOrders.length + 1 })

    const replacementState = readHydratedState(env.DB.database)
    replacementState.largeStateMarker = 'persisted'
    const replaceCommand = {
      type: 'state.replace',
      expectedVersion: 2,
      payload: { state: replacementState },
    }
    const replaced = await worker.fetch(jsonRequest('https://idosi.example/api/command', replaceCommand, {
      ...authorization,
      'idempotency-key': 'large-state-replace-0001',
    }), env)
    expect(replaced.status).toBe(200)
    const replacedBody = await replaced.json()
    expect(replacedBody).toMatchObject({ version: 3, state: { largeStateMarker: 'persisted' } })
    expect(replacedBody.state.orders).toHaveLength(largeOrders.length + 1)
    const receiptMarker = JSON.parse(env.DB.database.prepare(`
      SELECT response_json FROM command_receipts
      WHERE idempotency_key = 'large-state-replace-0001'
    `).get().response_json)
    expect(receiptMarker).toMatchObject({ __idosiChunkedResponse: 1 })
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS count FROM command_receipt_chunks
      WHERE idempotency_key = 'large-state-replace-0001'
    `).get().count).toBe(receiptMarker.chunkCount)

    const replayed = await worker.fetch(jsonRequest('https://idosi.example/api/command', replaceCommand, {
      ...authorization,
      'idempotency-key': 'large-state-replace-0001',
    }), env)
    expect(replayed.status).toBe(200)
    expect(replayed.headers.get('Idempotency-Replayed')).toBe('true')
    expect((await replayed.json()).state.orders).toHaveLength(largeOrders.length + 1)

    const finalReload = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
    const finalState = (await finalReload.json()).state
    expect(finalState.largeStateMarker).toBe('persisted')
    expect(finalState.orders).toHaveLength(largeOrders.length + 1)
    expect(finalState.orders[0].code).toBe('S01-25101')
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }, 60_000)

  it('runs bootstrap, employee lifecycle, projected state, atomic order creation, and logout end to end', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-secret-for-test' }
    const initialState = {
      schemaVersion: 2,
      stateVersion: 1,
      stores: [{ id: 'SM234', short: 'SM234', name: 'IDOSI 234' }],
      employees: [
        { id: 'NV001', storeId: 'SM234', name: 'Nhân viên 1', passwordHash: 'must-never-leave-server' },
      ],
      orders: [{
        id: 'legacy-order-7',
        code: 'SM234-00007',
        storeId: 'SM234',
        employeeId: 'NV001',
        amount: 500_000,
        paymentMethod: 'Tiền mặt',
        source: 'order',
        createdAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
      }],
      notifications: [],
      attendance: [],
      schedule: [],
      tasks: [],
      shiftDefinitions: [{ id: 'ca1', name: 'Ca kiểm thử', start: '00:00', end: '23:59', active: true, storeId: 'SM234' }],
      managerAccounts: [{ username: 'removed-role', passwordHash: 'must-be-removed' }],
      managerPayroll: [{ id: 'legacy-manager-payroll' }],
      profitShares: [{ id: 'legacy-profit-share' }],
      policies: { late_tolerance_minutes: 500 },
      orderCounters: { SM234: 99 },
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'idosi-test-password',
      displayName: 'Quản trị kiểm thử',
      initialState,
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    expect(await bootstrap.json()).toMatchObject({ ok: true, initialized: true })
    expect(env.DB.database.prepare(`
      SELECT meta_key FROM system_metadata WHERE meta_key = 'migration:account-avatars-v1'
    `).get()).toEqual({ meta_key: 'migration:account-avatars-v1' })

    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'ADMIN',
      password: 'idosi-test-password',
    }), env)
    expect(login.status).toBe(200)
    const loginBody = await login.json()
    expect(loginBody.user).toMatchObject({ username: 'admin', role: 'admin' })
    expect(loginBody.token).toBeTruthy()
    const authorization = { authorization: `Bearer ${loginBody.token}` }

    const initial = await worker.fetch(new Request('https://idosi.example/api/bootstrap', { headers: authorization }), env)
    expect(initial.status).toBe(200)
    const initialBody = await initial.json()
    expect(initialBody).toMatchObject({
      scope: 'global',
      projection: 'admin',
      version: 1,
      state: { stores: [{ id: 'SM234' }], employees: [{ id: 'NV001' }] },
    })
    expect(initialBody.policies).toHaveLength(5)
    for (const key of ['managerAccounts', 'managerPayroll', 'profitShares', 'policies', 'orderCounters']) {
      expect(initialBody.state).not.toHaveProperty(key)
    }

    const stateMetadata = await worker.fetch(new Request(
      'https://idosi.example/api/state-metadata?scope=global',
      { headers: authorization },
    ), env)
    expect(stateMetadata.status).toBe(200)
    expect(await stateMetadata.json()).toMatchObject({
      scope: 'global',
      version: 1,
      updatedAt: expect.any(String),
      userVersion: 1,
      policyVersions: expect.objectContaining({
        late_tolerance_minutes: 1,
      }),
    })

    const createUserBody = {
      type: 'user.create',
      payload: {
        username: 'employee1',
        password: 'employee-test-password',
        displayName: 'Nhân viên 1',
        storeId: 'SM234',
        employeeId: 'NV001',
      },
    }
    const createUserHeaders = { ...authorization, 'idempotency-key': 'user-create-0001' }
    const createdUser = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      createUserBody,
      createUserHeaders,
    ), env)
    expect(createdUser.status).toBe(201)
    const createdUserBody = await createdUser.json()
    expect(createdUserBody.user).toMatchObject({
      username: 'employee1',
      role: 'employee',
      storeId: 'SM234',
      employeeId: 'NV001',
      status: 'active',
      version: 1,
    })
    const employeeUserId = createdUserBody.user.id

    const users = await worker.fetch(new Request('https://idosi.example/api/users', { headers: authorization }), env)
    expect(users.status).toBe(200)
    const usersBody = await users.json()
    expect(usersBody.users).toEqual([expect.objectContaining({
      id: employeeUserId,
      username: 'employee1',
      role: 'employee',
      version: 1,
    })])
    expect(JSON.stringify(usersBody)).not.toContain('password_hash')
    expect(JSON.stringify(usersBody)).not.toContain('employee-test-password')

    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee1',
      password: 'employee-test-password',
    }), env)
    expect(employeeLogin.status).toBe(200)
    const employeeLoginBody = await employeeLogin.json()
    expect(employeeLoginBody.bootstrap).toMatchObject({
      scope: 'global',
      projection: 'employee',
      version: 1,
      user: { role: 'employee', employeeId: 'NV001', storeId: 'SM234' },
      state: {
        stores: [{ id: 'SM234' }],
        employees: [{ id: 'NV001' }],
        orders: [{ code: 'SM234-00007' }],
      },
    })
    expect(employeeLoginBody.bootstrap.policies).toHaveLength(5)
    expect(employeeLoginBody).not.toHaveProperty('users')
    expect(JSON.stringify(employeeLoginBody)).not.toMatch(/password_hash|passwordHash|password_salt|passwordSalt/u)
    const employeeAuthorization = { authorization: `Bearer ${employeeLoginBody.token}` }

    const updateUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.update',
      expectedVersion: 1,
      payload: { userId: employeeUserId, displayName: 'Nhân viên Một' },
    }, { ...authorization, 'idempotency-key': 'user-update-0001' }), env)
    expect(updateUser.status).toBe(200)
    expect(await updateUser.json()).toMatchObject({ user: { displayName: 'Nhân viên Một', version: 2 } })

    const employeeBootstrap = await worker.fetch(new Request(
      'https://idosi.example/api/bootstrap',
      { headers: employeeAuthorization },
    ), env)
    expect(employeeBootstrap.status).toBe(200)
    const employeeBootstrapBody = await employeeBootstrap.json()
    expect(employeeBootstrapBody).toMatchObject({
      scope: 'global',
      projection: 'employee',
      version: 1,
      user: { role: 'employee', employeeId: 'NV001', storeId: 'SM234', version: 2 },
      state: {
        stores: [{ id: 'SM234' }],
        employees: [{ id: 'NV001' }],
        orders: [{ code: 'SM234-00007' }],
      },
    })
    expect(employeeBootstrapBody.policies).toHaveLength(5)
    expect(employeeBootstrapBody.state.employees[0]).not.toHaveProperty('passwordHash')

    const employeeCannotReplace = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge',
      scope: 'global',
      expectedVersion: 1,
      payload: { patch: { compromised: true } },
    }, { ...employeeAuthorization, 'idempotency-key': 'employee-state-0001' }), env)
    expect(employeeCannotReplace.status).toBe(403)
    expect(await employeeCannotReplace.json()).toMatchObject({ error: { code: 'SCOPE_FORBIDDEN' } })

    const commandBody = {
      type: 'state.merge',
      scope: 'global',
      expectedVersion: 1,
      payload: { patch: { ready: true } },
    }
    const commandHeaders = { ...authorization, 'idempotency-key': 'state-command-0001' }
    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', commandBody, commandHeaders), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ version: 2, state: { stores: [{ id: 'SM234' }], ready: true } })

    const replayed = await worker.fetch(jsonRequest('https://idosi.example/api/command', commandBody, commandHeaders), env)
    expect(replayed.status).toBe(200)
    expect(replayed.headers.get('idempotency-replayed')).toBe('true')
    expect(await replayed.json()).toMatchObject({ version: 2 })

    const reusedKey = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...commandBody,
      payload: { patch: { different: true } },
    }, commandHeaders), env)
    expect(reusedKey.status).toBe(409)
    expect(await reusedKey.json()).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_KEY_REUSED' } })

    const stale = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...commandBody,
      payload: { patch: { stale: true } },
    }, { ...authorization, 'idempotency-key': 'state-command-0002' }), env)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } })

    const policy = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'policy.set',
      expectedVersion: 1,
      payload: { key: 'late_tolerance_minutes', value: 12 },
    }, { ...authorization, 'idempotency-key': 'policy-command-0001' }), env)
    expect(policy.status).toBe(200)
    expect(await policy.json()).toMatchObject({ policy: { key: 'late_tolerance_minutes', value: 12, version: 2 } })

    const policyBatch = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'policies.set',
      payload: {
        updates: [
          { key: 'late_tolerance_minutes', value: 13, expectedVersion: 2 },
          { key: 'early_check_in_limit_minutes', value: 90, expectedVersion: 1 },
        ],
      },
    }, { ...authorization, 'idempotency-key': 'policy-batch-0001' }), env)
    expect(policyBatch.status).toBe(200)
    expect(await policyBatch.json()).toMatchObject({
      policies: [
        { key: 'late_tolerance_minutes', value: 13, version: 3 },
        { key: 'early_check_in_limit_minutes', value: 90, version: 2 },
      ],
    })

    const businessCounter = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'counter.next',
      expectedVersion: 0,
      payload: { name: 'store:SM234:orders', prefix: 'CLIENT-CANNOT-CONTROL' },
    }, { ...authorization, 'idempotency-key': 'counter-command-0001' }), env)
    expect(businessCounter.status).toBe(400)
    expect(await businessCounter.json()).toMatchObject({ error: { code: 'DOMAIN_COMMAND_REQUIRED' } })

    const checkInBody = {
      type: 'attendance.check_in',
      expectedVersion: 2,
      payload: {
        shiftId: 'ca1',
        location: { latitude: 10.7769, longitude: 106.7009, accuracy: 12 },
      },
    }
    const checkInHeaders = { ...employeeAuthorization, 'idempotency-key': 'attendance-in-0001' }
    const checkedIn = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      checkInBody,
      checkInHeaders,
    ), env)
    expect(checkedIn.status).toBe(201)
    const checkedInBody = await checkedIn.json()
    expect(checkedInBody).toMatchObject({
      version: 3,
      attendance: {
        employeeId: 'NV001',
        storeId: 'SM234',
        shiftId: 'ca1',
        shiftName: 'Ca kiểm thử',
        checkInLocation: { latitude: 10.7769, longitude: 106.7009, accuracy: 12 },
      },
    })
    expect(checkedInBody.attendance).not.toHaveProperty('checklistSnapshot')
    const attendanceId = checkedInBody.attendance.id

    const replayedCheckIn = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      checkInBody,
      checkInHeaders,
    ), env)
    expect(replayedCheckIn.status).toBe(201)
    expect(replayedCheckIn.headers.get('idempotency-replayed')).toBe('true')

    const orderBody = {
      type: 'order.create',
      expectedVersion: 3,
      payload: {
        storeId: 'SM234',
        amount: 1_250_000,
        customerName: 'Khách kiểm thử',
        customerPhone: '0901 234 567',
        gender: 'Nam',
        occupation: 'Kỹ sư',
        acquisitionChannel: 'Tiktok',
        paymentMethod: 'Chuyển khoản',
      },
    }
    const orderHeaders = { ...employeeAuthorization, 'idempotency-key': 'order-create-0001' }
    const createdOrder = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      orderBody,
      orderHeaders,
    ), env)
    expect(createdOrder.status).toBe(201)
    const createdOrderBody = await createdOrder.json()
    expect(createdOrderBody).toMatchObject({
      version: 4,
      order: {
        code: 'SM234-00008',
        storeId: 'SM234',
        employeeId: 'NV001',
        createdByEmployeeId: 'NV001',
        createdBy: { role: 'employee', employeeId: 'NV001' },
        shiftId: 'ca1',
        shiftName: 'Ca kiểm thử',
        attendanceId,
        amount: 1_250_000,
      },
    })
    const replayedOrder = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      orderBody,
      orderHeaders,
    ), env)
    expect(replayedOrder.status).toBe(201)
    expect(replayedOrder.headers.get('idempotency-replayed')).toBe('true')
    expect((await replayedOrder.json()).order.code).toBe('SM234-00008')

    const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.check_out',
      expectedVersion: 4,
      payload: {
        attendanceId,
        cashRevenue: 0,
        transferRevenue: 1_250_000,
        location: { latitude: 10.777, longitude: 106.701, accuracy: 15 },
      },
    }, { ...employeeAuthorization, 'idempotency-key': 'attendance-out-0001' }), env)
    expect(checkedOut.status).toBe(200)
    expect(await checkedOut.json()).toMatchObject({
      version: 5,
      attendance: {
        id: attendanceId,
        orderCount: 1,
        revenue: 1_250_000,
        cash: 0,
        transfer: 1_250_000,
      },
    })

    const employeeState = await worker.fetch(new Request(
      'https://idosi.example/api/state',
      { headers: employeeAuthorization },
    ), env)
    expect(employeeState.status).toBe(200)
    const employeeStateBody = await employeeState.json()
    expect(employeeStateBody.version).toBe(5)
    expect(employeeStateBody.state.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SM234-00008', employeeId: 'NV001', attendanceId }),
      expect.objectContaining({ code: 'SM234-00007', employeeId: 'NV001' }),
    ]))
    expect(employeeStateBody.state.attendance).toEqual([
      expect.objectContaining({ id: attendanceId, checkOutAt: expect.any(String), revenue: 1_250_000 }),
    ])
    expect(employeeStateBody.state).not.toHaveProperty('cashTransactions')

    const lockUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.set_status',
      expectedVersion: 2,
      payload: { userId: employeeUserId, status: 'locked' },
    }, { ...authorization, 'idempotency-key': 'user-lock-0001' }), env)
    expect(lockUser.status).toBe(200)
    expect(await lockUser.json()).toMatchObject({ user: { status: 'locked', version: 3 } })

    const afterLock = await worker.fetch(new Request(
      'https://idosi.example/api/state',
      { headers: employeeAuthorization },
    ), env)
    expect(afterLock.status).toBe(401)

    const resetPassword = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.reset_password',
      expectedVersion: 3,
      payload: { userId: employeeUserId, password: 'employee-new-password' },
    }, { ...authorization, 'idempotency-key': 'user-password-0001' }), env)
    expect(resetPassword.status).toBe(200)
    expect(await resetPassword.json()).toMatchObject({ user: { version: 4 } })

    const reactivate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.set_status',
      expectedVersion: 4,
      payload: { userId: employeeUserId, status: 'active' },
    }, { ...authorization, 'idempotency-key': 'user-active-0001' }), env)
    expect(reactivate.status).toBe(200)
    expect(await reactivate.json()).toMatchObject({ user: { status: 'active', version: 5 } })

    const relogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee1',
      password: 'employee-new-password',
    }), env)
    expect(relogin.status).toBe(200)
    expect(await relogin.json()).toMatchObject({ user: { role: 'employee', version: 5 } })

    const changeAdminPassword = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.change_password',
      expectedVersion: 1,
      payload: {
        currentPassword: 'idosi-test-password',
        newPassword: 'idosi-admin-new-password',
      },
    }, { ...authorization, 'idempotency-key': 'admin-password-0001' }), env)
    expect(changeAdminPassword.status).toBe(200)
    expect(await changeAdminPassword.json()).toMatchObject({
      user: { role: 'admin', version: 2 },
      otherSessionsRevoked: true,
    })

    const audit = await worker.fetch(new Request('https://idosi.example/api/audit?limit=20', { headers: authorization }), env)
    expect(audit.status).toBe(200)
    expect((await audit.json()).audit.map(({ action }) => action)).toEqual(expect.arrayContaining([
      'system.bootstrap',
      'auth.login',
      'user.create',
      'user.update',
      'state.merge',
      'policy.set',
      'policies.set',
      'attendance.check_in',
      'order.create',
      'attendance.check_out',
      'user.set_status',
      'user.reset_password',
      'user.change_password',
    ]))

    const logout = await worker.fetch(jsonRequest('https://idosi.example/api/logout', {}, authorization), env)
    expect(logout.status).toBe(200)
    const afterLogout = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
    expect(afterLogout.status).toBe(401)
  })

  it('never reuses a deleted store code when creating the next store', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-store-code' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'store-code-admin-password',
      initialState: {
        stores: [{ id: 'CH003', name: 'IDOSI Cửa hàng cũ', short: 'Cũ', status: 'Ngưng hoạt động' }],
        deletedStores: [{ id: 'CH002', name: 'IDOSI Cửa hàng đã xóa', deletedAt: '2026-08-01T00:00:00.000Z' }],
        employees: [], orders: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'store-code-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const deleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.delete', expectedVersion: 1, payload: { storeId: 'CH003' },
    }, { ...authorization, 'idempotency-key': 'store-code-delete-0001' }), env)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toMatchObject({ version: 2, store: { id: 'CH003' } })

    const retiredIdDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.create', expectedVersion: 2, payload: { id: 'CH003', name: 'IDOSI Trùng mã' },
    }, { ...authorization, 'idempotency-key': 'store-code-retired-0001' }), env)
    expect(retiredIdDenied.status).toBe(409)
    expect(await retiredIdDenied.json()).toMatchObject({ error: { code: 'STORE_ID_RETIRED' } })

    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.create', expectedVersion: 2, payload: { name: 'IDOSI Cửa hàng mới', short: 'Mới' },
    }, { ...authorization, 'idempotency-key': 'store-code-create-0001' }), env)
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ version: 3, store: { id: 'CH004' } })
  })

  it('stores CCCD images in private R2 and authorizes retrieval without persisting image bytes', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-identity-images' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'identity-images-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'IDOSI Tô Ngọc Vân', short: 'TNV' }],
        employees: [], attendance: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'identity-images-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`
    const jpegDataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]).toString('base64')}`
    const oversizedPngBytes = new Uint8Array((300 * 1024) + 1)
    oversizedPngBytes.set(pngBytes)
    const oversizedPngDataUrl = `data:image/png;base64,${Buffer.from(oversizedPngBytes).toString('base64')}`

    const oversizedIdentityImage = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'business_support', name: 'Ảnh CCCD quá lớn', phone: '0901234099', cccd: '079123450099',
        address: 'TP.HCM', startDate: '2026-08-01', employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
        username: 'support.image.large', password: 'support-image-large-password',
        identityImages: { front: oversizedPngDataUrl, back: pngDataUrl },
      },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-support-too-large-0001' }), env)
    expect(oversizedIdentityImage.status).toBe(413)
    expect(await oversizedIdentityImage.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGE_TOO_LARGE' } })

    const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'business_support', name: 'Hỗ trợ có CCCD', phone: '0901234001', cccd: '079123450001',
        address: 'TP.HCM', startDate: '2026-08-01', employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
        username: 'support.image', password: 'support-image-password', identityImages: { front: pngDataUrl, back: pngDataUrl },
      },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-support-create-0001' }), env)
    expect(supportCreated.status).toBe(201)
    const supportCreatedBody = await supportCreated.json()
    const firstFrontKey = supportCreatedBody.employee.identityImages.front.key
    expect(supportCreatedBody).toMatchObject({
      employee: {
        id: 'HTKD-001', identityImages: { front: { contentType: 'image/png', size: 8, uploadedAt: expect.any(String) } },
      },
      user: { role: 'business_support', employeeId: 'HTKD-001' },
    })
    expect(JSON.stringify(supportCreatedBody)).not.toContain(pngDataUrl)
    expect(bucket.objects.has(firstFrontKey)).toBe(true)

    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 2,
      payload: {
        unit: 'store_manager', storeId: 'S01', name: 'Quản lý có CCCD', phone: '0901234002', cccd: '079123450002',
        address: 'TP.HCM', startDate: '2026-08-01', employmentType: 'Part-Time', position: 'Quản lý cửa hàng',
        username: 'manager.image', password: 'manager-image-password', cccdImages: { front: pngDataUrl, back: pngDataUrl },
      },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const managerCreatedBody = await managerCreated.json()
    expect(managerCreatedBody.employee.id).toBe('QLCH-001')

    const adminImage = await worker.fetch(new Request('https://idosi.example/api/identity-images/HTKD-001/front', {
      headers: adminAuthorization,
    }), env)
    expect(adminImage.status).toBe(200)
    expect(adminImage.headers.get('content-type')).toBe('image/png')
    expect(adminImage.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await adminImage.arrayBuffer())).toEqual(pngBytes)
    const anonymousImage = await worker.fetch(new Request('https://idosi.example/api/identity-images/HTKD-001/front'), env)
    expect(anonymousImage.status).toBe(401)

    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.image', password: 'manager-image-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    expect((await worker.fetch(new Request('https://idosi.example/api/identity-images/QLCH-001/back', {
      headers: managerAuthorization,
    }), env)).status).toBe(200)
    expect((await worker.fetch(new Request('https://idosi.example/api/identity-images/HTKD-001/front', {
      headers: managerAuthorization,
    }), env)).status).toBe(403)

    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.image', password: 'support-image-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
    expect((await worker.fetch(new Request('https://idosi.example/api/identity-images/QLCH-001/back', {
      headers: supportAuthorization,
    }), env)).status).toBe(200)
    const visibleUsers = await worker.fetch(new Request('https://idosi.example/api/users', { headers: supportAuthorization }), env)
    expect((await visibleUsers.json()).users.map(({ employeeId }) => employeeId)).toEqual(expect.arrayContaining(['HTKD-001', 'QLCH-001']))

    const supportUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 3,
      payload: { employeeId: 'HTKD-001', identityImages: { front: jpegDataUrl } },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-support-update-0001' }), env)
    expect(supportUpdated.status).toBe(200)
    const secondFrontKey = (await supportUpdated.json()).employee.identityImages.front.key
    expect(secondFrontKey).not.toBe(firstFrontKey)
    expect(bucket.objects.has(firstFrontKey)).toBe(false)
    expect(bucket.deletedKeys).toContain(firstFrontKey)

    const supportImageRemoved = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 4,
      payload: { employeeId: 'HTKD-001', identityImages: { front: null } },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-support-remove-0001' }), env)
    expect(supportImageRemoved.status).toBe(400)
    expect(await supportImageRemoved.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGES_REQUIRED' } })
    expect(bucket.objects.has(secondFrontKey)).toBe(true)

    const unavailable = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 4,
      payload: { employeeId: 'HTKD-001', identityImages: { front: pngDataUrl } },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-storage-missing-0001' }), { DB: env.DB })
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGE_STORAGE_UNAVAILABLE' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 4 })

    const keysBeforeRace = [...bucket.objects.keys()]
    env.DB.beforeBatch = async ({ database }) => {
      database.prepare("UPDATE app_state SET version = version + 1 WHERE scope_key = 'global'").run()
    }
    const raced = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 4,
      payload: { employeeId: 'HTKD-001', identityImages: { front: pngDataUrl } },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-storage-race-0001' }), env)
    expect(raced.status).toBe(409)
    expect(await raced.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
    expect([...bucket.objects.keys()]).toEqual(keysBeforeRace)
  }, 30_000)

  it('lets a manager operate stores while enforcing the explicit admin-only boundaries', async () => {
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-manager-rbac' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'manager-rbac-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'IDOSI Tô Ngọc Vân', short: 'Tô Ngọc Vân', status: 'Đang hoạt động' }],
        employees: [
          { id: 'E01', code: 'E01', name: 'Nhân viên 01', phone: '0900000001', storeId: 'S01', employmentType: 'Full-Time', monthlySalary: 8_000_000 },
          { id: 'E02', code: 'E02', name: 'Nhân viên legacy nghỉ việc', phone: '0900000007', storeId: 'S01', employmentType: 'Full-Time', monthlySalary: 8_000_000, status: 'inactive' },
          { id: 'VP001', code: 'VP001', name: 'Nhân viên văn phòng', phone: '0900000002', storeId: 'OFFICE', unit: 'office' },
          { id: 'QLCH-RBAC', code: 'QLCH-RBAC', name: 'Quản lý IDOSI', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc' },
        ],
        orders: [{ id: 'O01', code: 'S01-00001', storeId: 'S01', customerName: 'Khách', amount: 100_000, paymentMethod: 'Tiền mặt' }],
        officeAdjustments: [{ id: 'OA01', employeeId: 'VP001', amount: 500_000 }],
        shiftDefinitions: [{ id: 'ca1', storeId: 'S01', name: 'Ca giao việc', date: '2026-08-14', start: '07:00', end: '12:00', active: true }],
        tasks: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'manager-rbac-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      expectedVersion: 0,
      payload: {
        role: 'store_manager',
        username: 'manager',
        password: 'manager-rbac-password',
        displayName: 'Quản lý IDOSI',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'manager-create-0001' }), env)
    expect(managerCreated.status).toBe(400)
    expect(await managerCreated.json()).toMatchObject({ error: { code: 'EMPLOYEE_SCOPE_INVALID' } })

    const linkedManagerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      expectedVersion: 0,
      payload: {
        role: 'store_manager',
        storeId: 'S01',
        employeeId: 'QLCH-RBAC',
        username: 'manager',
        password: 'manager-rbac-password',
        displayName: 'Quản lý IDOSI',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'manager-create-linked-0001' }), env)
    expect(linkedManagerCreated.status).toBe(201)
    expect(await linkedManagerCreated.json()).toMatchObject({ user: { role: 'store_manager', storeId: 'S01', employeeId: 'QLCH-RBAC' } })

    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager', password: 'manager-rbac-password',
    }), env)
    expect(managerLogin.status).toBe(200)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    const managerBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    const managerBootstrapBody = await managerBootstrap.json()
    expect(managerBootstrapBody).toMatchObject({ projection: 'store_manager', user: { role: 'store_manager' } })
    expect(managerBootstrapBody.state.employees.map(({ id }) => id)).toEqual(['E01', 'E02', 'QLCH-RBAC'])
    expect(managerBootstrapBody.state).not.toHaveProperty('officeAdjustments')

    const forbiddenCommands = [
      {
        key: 'manager-state-0001',
        body: { type: 'state.merge', expectedVersion: 1, payload: { patch: { stores: [] } } },
      },
      {
        key: 'manager-policy-0001',
        body: { type: 'policy.set', expectedVersion: 1, payload: { key: 'late_tolerance_minutes', value: 99 } },
      },
      {
        key: 'manager-order-edit-0001',
        body: { type: 'order.update', expectedVersion: 1, payload: { orderId: 'O01', amount: 200_000, reason: 'Không được phép' } },
      },
      {
        key: 'manager-order-create-0001',
        body: {
          type: 'order.create', expectedVersion: 1,
          payload: {
            storeId: 'S01', customerName: 'Khách', gender: 'Khác', occupation: 'Khác',
            acquisitionChannel: 'Khác', amount: 100_000, paymentMethod: 'Tiền mặt',
          },
        },
      },
      {
        key: 'manager-store-delete-0001',
        body: { type: 'store.delete', expectedVersion: 1, payload: { storeId: 'S01' } },
      },
      {
        key: 'manager-office-0001',
        body: {
          type: 'employee.create',
          expectedVersion: 1,
          payload: { storeId: 'OFFICE', name: 'Văn phòng', phone: '0900000003', employmentType: 'Chính thức', monthlySalary: 8_000_000 },
        },
      },
    ]
    for (const command of forbiddenCommands) {
      const response = await worker.fetch(jsonRequest('https://idosi.example/api/command', command.body, {
        ...managerAuthorization,
        'idempotency-key': command.key,
      }), env)
      expect(response.status, command.key).toBe(403)
    }
    const legacyInactiveReactivateDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 1,
      payload: { employeeId: 'E02', status: 'Đang làm việc' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-legacy-inactive-reactivate-0001' }), env)
    expect(legacyInactiveReactivateDenied.status).toBe(403)
    expect(await legacyInactiveReactivateDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_REACTIVATE_FORBIDDEN' } })
    const inactiveProfileAccountDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'employee.inactive', password: 'employee-inactive-password', displayName: 'Nhân viên inactive',
        storeId: 'S01', employeeId: 'E02',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-inactive-profile-account-0001' }), env)
    expect(inactiveProfileAccountDenied.status).toBe(409)
    expect(await inactiveProfileAccountDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_INACTIVE' } })

    const storeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.update',
      expectedVersion: 1,
      payload: { storeId: 'S01', status: 'Ngưng hoạt động', address: '123 Đường IDOSI' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-store-update-0001' }), env)
    expect(storeUpdated.status).toBe(200)
    expect(await storeUpdated.json()).toMatchObject({ version: 2, store: { status: 'Ngưng hoạt động' } })

    const invalidTaskShift = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'tasks.replace_scope',
      expectedVersion: 2,
      payload: { storeId: 'S01', date: '2026-08-14', shiftId: 'missing-shift', tasks: [] },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-tasks-invalid-shift-0001' }), env)
    expect(invalidTaskShift.status).toBe(400)
    expect(await invalidTaskShift.json()).toMatchObject({ error: { code: 'SHIFT_INVALID' } })
    const mismatchedTaskDate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'tasks.replace_scope',
      expectedVersion: 2,
      payload: { storeId: 'S01', date: '2026-08-15', shiftId: 'ca1', tasks: [] },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-tasks-wrong-date-0001' }), env)
    expect(mismatchedTaskDate.status).toBe(400)
    expect(await mismatchedTaskDate.json()).toMatchObject({ error: { code: 'SHIFT_DATE_MISMATCH' } })

    const tasksSaved = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'tasks.replace_scope',
      expectedVersion: 2,
      payload: {
        storeId: 'S01', date: '2026-08-14', shiftId: 'ca1',
        tasks: [{ title: 'Mở cửa hàng', detail: 'Kiểm tra vệ sinh' }],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-tasks-0001' }), env)
    expect(tasksSaved.status).toBe(200)
    expect(await tasksSaved.json()).toMatchObject({ version: 3, tasks: [{ storeId: 'S01', shiftId: 'ca1' }] })

    const employeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create',
      expectedVersion: 3,
      payload: {
        storeId: 'S01', name: 'Nhân viên mới', phone: '0900000004',
        cccd: '079000000004', address: 'TP. Hồ Chí Minh', startDate: '2026-08-14',
        employmentType: 'Part-Time', hourlyRate: 35_000,
        username: 'employee.new', password: 'employee-new-password',
        identityImages: testIdentityImages(),
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-0001' }), env)
    expect(employeeCreated.status).toBe(201)
    const employeeCreatedBody = await employeeCreated.json()
    expect(employeeCreatedBody).toMatchObject({
      version: 4,
      employee: { id: 'TNV-001', payBasis: 'hourly', hourlyRate: 35_000, status: 'Đang làm việc' },
      user: { role: 'employee', storeId: 'S01', employeeId: 'TNV-001', version: 1 },
    })

    const shiftCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'shift_definition.create',
      expectedVersion: 4,
      payload: { storeId: 'S01', name: 'Ca sáng', date: '2026-08-14', start: '07:00', end: '12:30' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-shift-0001' }), env)
    expect(shiftCreated.status).toBe(201)
    const shiftCreatedBody = await shiftCreated.json()
    expect(shiftCreatedBody).toMatchObject({
      version: 5,
      shift: { start: '07:00', end: '12:30', durationMinutes: 330, color: expect.stringMatching(/^#/u) },
    })

    const scheduleSaved = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'schedule.assign',
      expectedVersion: 5,
      payload: {
        storeId: 'S01', date: '2026-08-14',
        employeeIds: ['E01', employeeCreatedBody.employee.id],
        shiftIds: [shiftCreatedBody.shift.id],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-schedule-0001' }), env)
    expect(scheduleSaved.status).toBe(200)
    expect(await scheduleSaved.json()).toMatchObject({ version: 6, assignments: [{ storeId: 'S01' }, { storeId: 'S01' }] })

    const employeeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update',
      expectedVersion: 6,
      payload: { employeeId: employeeCreatedBody.employee.id, name: 'Nhân viên mới cập nhật' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-update-0001' }), env)
    expect(employeeUpdated.status).toBe(200)
    const employeeUpdatedBody = await employeeUpdated.json()
    expect(employeeUpdatedBody).toMatchObject({
      version: 7,
      employee: { id: 'TNV-001', name: 'Nhân viên mới cập nhật', authVersion: 2 },
      user: { displayName: 'Nhân viên mới cập nhật', version: 2 },
    })
    const employeeLocked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update',
      expectedVersion: 7,
      payload: { employeeId: 'TNV-001', status: 'Tạm ngưng' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-lock-0001' }), env)
    expect(employeeLocked.status).toBe(200)
    expect(await employeeLocked.json()).toMatchObject({
      version: 8,
      employee: { status: 'Tạm ngưng', authVersion: 3 },
      user: { status: 'locked', version: 3 },
    })
    const lockedLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.new', password: 'employee-new-password',
    }), env)
    expect(lockedLogin.status).toBe(403)
    const employeeReactivated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update',
      expectedVersion: 8,
      payload: { employeeId: 'TNV-001', status: 'Đang làm việc' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-active-0001' }), env)
    expect(employeeReactivated.status).toBe(200)
    const employeeReactivatedBody = await employeeReactivated.json()
    expect(employeeReactivatedBody).toMatchObject({
      version: 9,
      employee: { status: 'Đang làm việc', authVersion: 4 },
      user: { status: 'active', version: 4 },
    })
    const createdEmployeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.new', password: 'employee-new-password',
    }), env)
    expect(createdEmployeeLogin.status).toBe(200)
    const createdEmployeeLoginBody = await createdEmployeeLogin.json()
    expect(createdEmployeeLoginBody).toMatchObject({
      user: { role: 'employee', employeeId: 'TNV-001', displayName: 'Nhân viên mới cập nhật' },
    })

    const users = await worker.fetch(new Request('https://idosi.example/api/users', { headers: managerAuthorization }), env)
    expect(users.status).toBe(200)
    const usersBody = await users.json()
    expect(usersBody.users.map(({ role }) => role)).toEqual(['employee'])
    expect(usersBody.users.map(({ employeeId }) => employeeId)).toEqual(expect.arrayContaining(['TNV-001']))

    const managerCannotDeactivate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.set_status',
      expectedVersion: employeeReactivatedBody.user.version,
      payload: { userId: employeeReactivatedBody.user.id, status: 'inactive' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-user-delete-0001' }), env)
    expect(managerCannotDeactivate.status).toBe(403)
    expect(await managerCannotDeactivate.json()).toMatchObject({ error: { code: 'EMPLOYEE_DELETE_FORBIDDEN' } })

    const adminMarkedResigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 9,
      payload: { employeeId: 'TNV-001', status: 'Đã nghỉ việc' },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-employee-resigned-0001' }), env)
    expect(adminMarkedResigned.status).toBe(200)
    expect(await adminMarkedResigned.json()).toMatchObject({
      version: 10,
      employee: { status: 'Đã nghỉ việc' },
      user: { status: 'inactive', version: 5 },
    })
    const managerCannotReactivateProfile = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 10,
      payload: { employeeId: 'TNV-001', status: 'Đang làm việc' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-reactivate-denied-0001' }), env)
    expect(managerCannotReactivateProfile.status).toBe(403)
    expect(await managerCannotReactivateProfile.json()).toMatchObject({ error: { code: 'EMPLOYEE_REACTIVATE_FORBIDDEN' } })

    const employeeDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.delete',
      expectedVersion: 10,
      payload: { employeeId: 'TNV-001' },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-employee-delete-0001' }), env)
    expect(employeeDeleted.status).toBe(200)
    expect(await employeeDeleted.json()).toMatchObject({
      version: 11,
      employee: { id: 'TNV-001', status: 'Đã nghỉ việc' },
      user: { status: 'inactive', version: 6 },
    })
    const deletedSession = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: { authorization: `Bearer ${createdEmployeeLoginBody.token}` },
    }), env)
    expect(deletedSession.status).toBe(401)
    const deletedLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.new', password: 'employee-new-password',
    }), env)
    expect(deletedLogin.status).toBe(403)
    expect(await deletedLogin.json()).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } })

    const managerCannotReactivateAccount = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.set_status', expectedVersion: 6,
      payload: { userId: employeeReactivatedBody.user.id, status: 'active' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-user-reactivate-denied-0001' }), env)
    expect(managerCannotReactivateAccount.status).toBe(403)
    expect(await managerCannotReactivateAccount.json()).toMatchObject({ error: { code: 'EMPLOYEE_REACTIVATE_FORBIDDEN' } })
    const retiredAccountDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'employee.retired', password: 'employee-retired-password', displayName: 'Nhân viên đã xóa',
        storeId: 'S01', employeeId: 'TNV-001',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-retired-account-0001' }), env)
    expect(retiredAccountDenied.status).toBe(409)
    expect(await retiredAccountDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_ID_RETIRED' } })

    const retiredEmployeeIdIgnored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 11,
      payload: {
        id: 'TNV-001', storeId: 'S01', name: 'Nhân viên trùng mã', phone: '0900000006',
        cccd: '079000000006', address: 'TP. Hồ Chí Minh', startDate: '2026-08-14',
        employmentType: 'Part-Time', hourlyRate: 36_000,
        username: 'employee.reused', password: 'employee-reused-password',
        identityImages: testIdentityImages(),
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-retired-id-0001' }), env)
    expect(retiredEmployeeIdIgnored.status).toBe(201)
    expect(await retiredEmployeeIdIgnored.json()).toMatchObject({ version: 12, employee: { id: 'TNV-002' } })

    const nextEmployeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 12,
      payload: {
        storeId: 'S01', name: 'Nhân viên kế tiếp', phone: '0900000005',
        cccd: '079000000005', address: 'TP. Hồ Chí Minh', startDate: '2026-08-14',
        employmentType: 'Part-Time', hourlyRate: 36_000,
        username: 'employee.next', password: 'employee-next-password',
        identityImages: testIdentityImages(),
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-next-0001' }), env)
    expect(nextEmployeeCreated.status).toBe(201)
    expect(await nextEmployeeCreated.json()).toMatchObject({
      version: 13,
      employee: { id: 'TNV-003' },
      user: { employeeId: 'TNV-003', status: 'active' },
    })

    const secondRoleWithSharedPersonalInfo = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 13,
      payload: {
        storeId: 'S01', name: 'Nhân viên kiêm nhiệm', phone: '0900000005',
        cccd: '079000000005', address: 'TP. Hồ Chí Minh', startDate: '2026-08-14',
        employmentType: 'Part-Time', hourlyRate: 40_000,
        username: 'employee.second-role', password: 'employee-second-role-password',
        identityImages: testIdentityImages(),
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-shared-profile-0001' }), env)
    expect(secondRoleWithSharedPersonalInfo.status).toBe(201)
    expect(await secondRoleWithSharedPersonalInfo.json()).toMatchObject({
      version: 14,
      employee: { id: 'TNV-004', phone: '0900000005', cccd: '079000000005' },
      user: { employeeId: 'TNV-004', username: 'employee.second-role' },
    })

    const nextEmployeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.next', password: 'employee-next-password',
    }), env)
    const nextEmployeeToken = (await nextEmployeeLogin.json()).token
    const employeeAvatar = testAvatarDataUrl('image/png', 200 * 1024)
    const employeeSettingsUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 14,
      payload: { name: 'Nhân viên kế tiếp', email: 'employee.next@idosi.vn', avatar: employeeAvatar },
    }, {
      authorization: `Bearer ${nextEmployeeToken}`,
      'idempotency-key': 'employee-account-settings-avatar-0001',
    }), env)
    expect(employeeSettingsUpdated.status).toBe(200)
    const employeeSettingsBody = await employeeSettingsUpdated.json()
    expect(employeeSettingsBody).toMatchObject({
      version: 15,
      settings: {
        name: 'Nhân viên kế tiếp',
        email: 'employee.next@idosi.vn',
        avatar: {
          key: expect.stringMatching(/^account-avatars\/usr_[^/]+\//u),
          contentType: 'image/png',
          size: 200 * 1024,
          version: 1,
        },
      },
      user: { role: 'employee', employeeId: 'TNV-003', version: 2 },
    })
    expect(JSON.stringify(employeeSettingsBody)).not.toContain('base64')
    const storedEmployeeSettings = readHydratedState(env.DB.database).accountSettings[employeeSettingsBody.user.id]
    expect(storedEmployeeSettings.avatar).toMatchObject({ contentType: 'image/png', size: 200 * 1024, version: 1 })
    expect(readHydratedState(env.DB.database).employees.find(({ id }) => id === 'TNV-003')).not.toHaveProperty('avatar')
    const employeeAvatarResponse = await worker.fetch(new Request('https://idosi.example/api/account-avatar', {
      headers: { authorization: `Bearer ${nextEmployeeToken}` },
    }), env)
    expect(employeeAvatarResponse.status).toBe(200)
    expect(employeeAvatarResponse.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await employeeAvatarResponse.arrayBuffer())).toHaveLength(200 * 1024)
    expect((await worker.fetch(new Request('https://idosi.example/api/account-avatar'), env)).status).toBe(401)
  })

  it('keeps account-avatar objects transactional across conflict, replacement, and clear', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-lifecycle' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-lifecycle-password',
      initialState: { stores: [], employees: [], attendance: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-lifecycle-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const firstAvatar = testAvatarDataUrl('image/png', 1024)
    const firstUpload = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1, payload: { avatar: firstAvatar },
    }, { ...authorization, 'idempotency-key': 'avatar-lifecycle-first-0001' }), env)
    expect(firstUpload.status).toBe(200)
    const firstBody = await firstUpload.json()
    const firstKey = firstBody.settings.avatar.key
    expect(firstBody.settings.avatar).toMatchObject({ contentType: 'image/png', size: 1024, version: 1 })
    expect(bucket.objects.has(firstKey)).toBe(true)

    env.DB.beforeBatch = async ({ database }) => {
      database.prepare(`
        UPDATE app_state SET version = version + 1, last_request_id = 'avatar-test-race'
        WHERE scope_key = 'global'
      `).run()
    }
    const conflicted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 2,
      payload: { avatar: testAvatarDataUrl('image/jpeg', 2048) },
    }, { ...authorization, 'idempotency-key': 'avatar-lifecycle-conflict-0001' }), env)
    expect(conflicted.status).toBe(409)
    expect(await conflicted.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
    expect(bucket.objects.has(firstKey)).toBe(true)
    expect([...bucket.objects.keys()]).toEqual([firstKey])
    expect(bucket.deletedKeys.some((key) => key.startsWith('account-avatars/') && key !== firstKey)).toBe(true)

    const replacement = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 3,
      payload: { avatar: testAvatarDataUrl('image/webp', 4096) },
    }, { ...authorization, 'idempotency-key': 'avatar-lifecycle-replace-0001' }), env)
    expect(replacement.status).toBe(200)
    const replacementBody = await replacement.json()
    const replacementKey = replacementBody.settings.avatar.key
    expect(replacementBody.settings.avatar).toMatchObject({ contentType: 'image/webp', size: 4096, version: 2 })
    expect(bucket.objects.has(firstKey)).toBe(false)
    expect(bucket.objects.has(replacementKey)).toBe(true)

    const cleared = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 4, payload: { avatar: '' },
    }, { ...authorization, 'idempotency-key': 'avatar-lifecycle-clear-0001' }), env)
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toMatchObject({ version: 5, settings: { avatar: null } })
    expect(bucket.objects.has(replacementKey)).toBe(false)
    expect((await worker.fetch(new Request('https://idosi.example/api/account-avatar', {
      headers: authorization,
    }), env)).status).toBe(404)
    expect(JSON.stringify(readHydratedState(env.DB.database))).not.toContain('base64')
  })

  it('accepts structurally valid avatar formats and rejects fake or truncated image containers', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-structure' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-structure-password',
      initialState: { stores: [], employees: [], attendance: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-structure-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const truncateDataUrl = (dataUrl) => {
      const [prefix, payload] = dataUrl.split(',')
      const bytes = Buffer.from(payload, 'base64')
      return `${prefix},${bytes.subarray(0, -1).toString('base64')}`
    }
    const oversizedStaticGif = generatedStaticGifAvatar(1025, 1024)
    expect(oversizedStaticGif.length).toBeLessThanOrEqual(300 * 1024)
    const invalidAvatars = [
      legacyFakeWebpDataUrl(),
      truncateDataUrl(testAvatarDataUrl('image/jpeg', 512)),
      truncateDataUrl(testAvatarDataUrl('image/png', 512)),
      truncateDataUrl(testAvatarDataUrl('image/webp', 512)),
      truncateDataUrl(testGifAvatarDataUrl()),
      animatedGifAvatarDataUrl(),
      `data:image/gif;base64,${oversizedStaticGif.toString('base64')}`,
      `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`,
    ]
    for (const [index, avatar] of invalidAvatars.entries()) {
      const response = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'account_settings.update', expectedVersion: 1, payload: { avatar },
      }, { ...authorization, 'idempotency-key': `avatar-structure-invalid-${index}` }), env)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'AVATAR_INVALID' } })
    }
    expect(bucket.objects.size).toBe(0)

    const supported = [
      ['image/jpeg', testAvatarDataUrl('image/jpeg', 512), 512, 'jpg'],
      ['image/png', testAvatarDataUrl('image/png', 512), 512, 'png'],
      ['image/webp', testAvatarDataUrl('image/webp', 512), 512, 'webp'],
      ['image/gif', testGifAvatarDataUrl(), VALID_GIF_AVATAR.length, 'gif'],
      ['image/gif', generatedStaticGifAvatarDataUrl(64, 64), generatedStaticGifAvatar(64, 64).length, 'gif'],
    ]
    for (const [index, [contentType, avatar, size, extension]] of supported.entries()) {
      const expectedVersion = index + 1
      const response = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'account_settings.update', expectedVersion, payload: { avatar },
      }, { ...authorization, 'idempotency-key': `avatar-structure-valid-${index}` }), env)
      const body = await response.json()
      expect(response.status, `${contentType}: ${JSON.stringify(body)}`).toBe(200)
      expect(body.settings.avatar).toMatchObject({ contentType, size, version: index + 1 })
      expect(body.settings.avatar.key).toMatch(new RegExp(`\\.${extension}$`, 'u'))
      const downloaded = await worker.fetch(new Request('https://idosi.example/api/account-avatar', {
        headers: authorization,
      }), env)
      expect(downloaded.status).toBe(200)
      expect(downloaded.headers.get('content-type')).toBe(contentType)
      expect(new Uint8Array(await downloaded.arrayBuffer())).toHaveLength(size)
    }
    expect(bucket.objects.size).toBe(1)
  })

  it('durably queues account-avatar cleanup after rollback, replacement, and clear delete failures', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-durable-cleanup' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-durable-cleanup-password',
      initialState: { stores: [], employees: [], attendance: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-durable-cleanup-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const pendingMarker = () => env.DB.database.prepare(`
      SELECT meta_key, value_json FROM system_metadata
      WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
      ORDER BY meta_key LIMIT 1
    `).get()

    const originalPut = bucket.put.bind(bucket)
    bucket.put = async (key, value, options) => {
      if (key.startsWith('account-avatars/')) {
        expect(JSON.parse(pendingMarker().value_json)).toMatchObject({
          phase: 'prepared', keys: expect.arrayContaining([key]),
        })
      }
      const result = await originalPut(key, value, options)
      if (key.startsWith('account-avatars/')) bucket.failDeleteKeys.add(key)
      return result
    }
    env.DB.beforeBatch = async ({ database }) => {
      database.prepare(`
        UPDATE app_state SET version = version + 1, last_request_id = 'avatar-durable-rollback-race'
        WHERE scope_key = 'global'
      `).run()
    }
    const rolledBack = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1,
      payload: { avatar: testAvatarDataUrl('image/png', 1024) },
    }, { ...authorization, 'idempotency-key': 'avatar-durable-rollback' }), env)
    expect(rolledBack.status).toBe(409)
    expect(await rolledBack.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
    const [rollbackOrphanKey] = [...bucket.objects.keys()]
    expect(rollbackOrphanKey).toMatch(/^account-avatars\//u)
    expect(JSON.parse(pendingMarker().value_json)).toMatchObject({
      phase: 'prepared', status: 'pending', keys: [rollbackOrphanKey],
    })
    expect(readHydratedState(env.DB.database).accountSettings || {}).toEqual({})

    bucket.put = originalPut
    bucket.failDeleteKeys.clear()
    const rollbackCleanupRequest = {
      type: 'account_settings.update', expectedVersion: 2, payload: { avatar: '' },
    }
    const rollbackCleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', rollbackCleanupRequest, {
      ...authorization, 'idempotency-key': 'avatar-durable-cleanup-rollback',
    }), env)
    expect(rollbackCleanup.status).toBe(503)
    expect(await rollbackCleanup.json()).toMatchObject({ error: { code: 'ACCOUNT_AVATAR_CLEANUP_RETRY' } })
    expect(bucket.objects.has(rollbackOrphanKey)).toBe(false)
    expect(pendingMarker()).toBeUndefined()
    const rollbackRetry = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 2, payload: { name: 'Admin sau rollback' },
    }, {
      ...authorization, 'idempotency-key': 'avatar-durable-cleanup-rollback-retry',
    }), env)
    expect(rollbackRetry.status).toBe(200)
    expect(await rollbackRetry.json()).toMatchObject({ version: 3, settings: { name: 'Admin sau rollback' } })

    const firstUpload = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 3,
      payload: { avatar: testAvatarDataUrl('image/png', 2048) },
    }, { ...authorization, 'idempotency-key': 'avatar-durable-first' }), env)
    expect(firstUpload.status).toBe(200)
    const firstKey = (await firstUpload.json()).settings.avatar.key
    bucket.failDeleteKeys.add(firstKey)
    bucket.beforeDelete = async (key) => {
      if (key !== firstKey) return
      expect(JSON.parse(pendingMarker().value_json)).toMatchObject({
        phase: 'committed', keys: expect.arrayContaining([firstKey]),
      })
      const [activeSettings] = Object.values(readHydratedState(env.DB.database).accountSettings || {})
      expect(activeSettings?.avatar?.key).not.toBe(firstKey)
    }
    const replacement = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 4,
      payload: { avatar: testAvatarDataUrl('image/webp', 4096) },
    }, { ...authorization, 'idempotency-key': 'avatar-durable-replacement' }), env)
    expect(replacement.status).toBe(200)
    const replacementKey = (await replacement.json()).settings.avatar.key
    expect(bucket.objects.has(firstKey)).toBe(true)
    expect(bucket.objects.has(replacementKey)).toBe(true)
    expect(JSON.parse(pendingMarker().value_json)).toMatchObject({
      phase: 'committed', keys: [firstKey], status: 'pending',
    })

    bucket.beforeDelete = null
    bucket.failDeleteKeys.clear()
    const retireCleanupRequest = {
      type: 'account_settings.update', expectedVersion: 5, payload: { avatar: '' },
    }
    const retireCleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', retireCleanupRequest, {
      ...authorization, 'idempotency-key': 'avatar-durable-cleanup-retired',
    }), env)
    expect(retireCleanup.status).toBe(503)
    expect(bucket.objects.has(firstKey)).toBe(false)
    expect(bucket.objects.has(replacementKey)).toBe(true)
    const retireRetry = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 5, payload: { name: 'Admin sau replace' },
    }, {
      ...authorization, 'idempotency-key': 'avatar-durable-cleanup-retired-retry',
    }), env)
    expect(retireRetry.status).toBe(200)
    expect(await retireRetry.json()).toMatchObject({ version: 6 })

    bucket.failDeleteKeys.add(replacementKey)
    const cleared = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 6, payload: { avatar: '' },
    }, { ...authorization, 'idempotency-key': 'avatar-durable-clear' }), env)
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toMatchObject({ version: 7, settings: { avatar: null } })
    expect(bucket.objects.has(replacementKey)).toBe(true)
    expect(JSON.parse(pendingMarker().value_json)).toMatchObject({
      phase: 'committed', keys: [replacementKey], status: 'pending',
    })

    bucket.failDeleteKeys.clear()
    const clearCleanupRequest = {
      type: 'account_settings.update', expectedVersion: 7, payload: { avatar: '' },
    }
    const clearCleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', clearCleanupRequest, {
      ...authorization, 'idempotency-key': 'avatar-durable-cleanup-clear',
    }), env)
    expect(clearCleanup.status).toBe(503)
    expect(bucket.objects.has(replacementKey)).toBe(false)
    const clearRetry = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 7, payload: { name: 'Admin sau clear' },
    }, {
      ...authorization, 'idempotency-key': 'avatar-durable-cleanup-clear-retry',
    }), env)
    expect(clearRetry.status).toBe(200)
    expect(await clearRetry.json()).toMatchObject({ version: 8, settings: { avatar: null } })
    expect(pendingMarker()).toBeUndefined()
  }, 30_000)

  it('cancels an in-flight avatar put without committing a key after cleanup wins marker ownership', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-slow-put' }
    await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-slow-put-password',
      initialState: { stores: [], employees: [], attendance: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-slow-put-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const markerRow = () => env.DB.database.prepare(`
      SELECT meta_key, value_json FROM system_metadata
      WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
      ORDER BY meta_key LIMIT 1
    `).get()

    let releasePut
    let signalPutStarted
    const putStarted = new Promise((resolve) => { signalPutStarted = resolve })
    const putReleased = new Promise((resolve) => { releasePut = resolve })
    const originalPut = bucket.put.bind(bucket)
    bucket.put = async (key, value, options) => {
      if (key.startsWith('account-avatars/')) {
        signalPutStarted()
        await putReleased
      }
      return originalPut(key, value, options)
    }

    const uploadPromise = worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1,
      payload: { avatar: testAvatarDataUrl('image/png', 1024) },
    }, { ...authorization, 'idempotency-key': 'avatar-slow-put-upload' }), env)
    await putStarted
    const reservedMarker = JSON.parse(markerRow().value_json)
    expect(reservedMarker).toMatchObject({
      phase: 'prepared', pendingKeys: [expect.stringMatching(/^account-avatars\//u)],
    })
    const [reservedKey] = reservedMarker.pendingKeys

    const cleaner = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1, payload: { avatar: '' },
    }, { ...authorization, 'idempotency-key': 'avatar-slow-put-cleaner' }), env)
    expect(cleaner.status).toBe(503)
    expect(await cleaner.json()).toMatchObject({ error: { code: 'ACCOUNT_AVATAR_CLEANUP_RETRY' } })
    expect(JSON.parse(markerRow().value_json)).toMatchObject({
      phase: 'cancelled', pendingKeys: [reservedKey], keys: [reservedKey],
    })

    releasePut()
    const upload = await uploadPromise
    expect(upload.status).toBe(503)
    expect(await upload.json()).toMatchObject({ error: { code: 'ACCOUNT_AVATAR_UPLOAD_CANCELLED' } })
    expect(bucket.objects.has(reservedKey)).toBe(false)
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
    expect(readHydratedState(env.DB.database).accountSettings || {}).toEqual({})
    expect(markerRow()).toBeUndefined()

    const subsequent = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1, payload: { name: 'Admin sau race' },
    }, { ...authorization, 'idempotency-key': 'avatar-slow-put-subsequent' }), env)
    expect(subsequent.status).toBe(200)
    expect(await subsequent.json()).toMatchObject({ version: 2, settings: { name: 'Admin sau race' } })
    expect(markerRow()).toBeUndefined()
  }, 30_000)

  it('retains an acknowledged retry marker when cancellation cleanup cannot delete the uploaded object', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-cancel-delete-failure' }
    await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-cancel-delete-failure-password',
      initialState: { stores: [], employees: [], attendance: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-cancel-delete-failure-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const markerRow = () => env.DB.database.prepare(`
      SELECT meta_key, value_json FROM system_metadata
      WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
      ORDER BY meta_key LIMIT 1
    `).get()

    let releasePut
    let signalPutStarted
    const putStarted = new Promise((resolve) => { signalPutStarted = resolve })
    const putReleased = new Promise((resolve) => { releasePut = resolve })
    const originalPut = bucket.put.bind(bucket)
    bucket.put = async (key, value, options) => {
      if (key.startsWith('account-avatars/')) {
        signalPutStarted()
        await putReleased
      }
      return originalPut(key, value, options)
    }

    const uploadPromise = worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1,
      payload: { avatar: testAvatarDataUrl('image/png', 1024) },
    }, { ...authorization, 'idempotency-key': 'avatar-cancel-delete-failure-upload' }), env)
    await putStarted
    const [reservedKey] = JSON.parse(markerRow().value_json).pendingKeys

    const cleaner = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1, payload: { avatar: '' },
    }, { ...authorization, 'idempotency-key': 'avatar-cancel-delete-failure-cleaner' }), env)
    expect(cleaner.status).toBe(503)
    expect(JSON.parse(markerRow().value_json)).toMatchObject({
      phase: 'cancelled', pendingKeys: [reservedKey], keys: [reservedKey],
    })

    bucket.failDeleteKeys.add(reservedKey)
    releasePut()
    const upload = await uploadPromise
    expect(upload.status).toBe(503)
    expect(await upload.json()).toMatchObject({ error: { code: 'ACCOUNT_AVATAR_UPLOAD_CANCELLED' } })
    expect(bucket.objects.has(reservedKey)).toBe(true)
    expect(JSON.parse(markerRow().value_json)).toMatchObject({
      phase: 'acknowledged', status: 'pending', pendingKeys: [], keys: [reservedKey],
    })
    expect(readHydratedState(env.DB.database).accountSettings || {}).toEqual({})

    bucket.failDeleteKeys.clear()
    const cleanupRequest = {
      type: 'account_settings.update', expectedVersion: 1, payload: { avatar: '' },
    }
    const cleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', cleanupRequest, {
      ...authorization, 'idempotency-key': 'avatar-cancel-delete-failure-retry',
    }), env)
    expect(cleanup.status).toBe(503)
    expect(await cleanup.json()).toMatchObject({ error: { code: 'ACCOUNT_AVATAR_CLEANUP_RETRY' } })
    expect(bucket.objects.has(reservedKey)).toBe(false)
    expect(markerRow()).toBeUndefined()

    const retry = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1, payload: { name: 'Admin sau retry' },
    }, {
      ...authorization, 'idempotency-key': 'avatar-cancel-delete-failure-settings-retry',
    }), env)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ version: 2, settings: { name: 'Admin sau retry' } })
  }, 30_000)

  it('keeps non-avatar settings usable while bounding cancelled avatar lifecycles per account', async () => {
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-avatar-lifecycle-cap' }
    await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-lifecycle-cap-password',
      initialState: { stores: [], employees: [], attendance: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-lifecycle-cap-password',
    }), env)
    const loginBody = await login.json()
    const authorization = { authorization: `Bearer ${loginBody.token}` }
    for (let index = 0; index < 8; index += 1) {
      const timestamp = `2026-08-25T00:00:0${index}.000Z`
      env.DB.database.prepare(`
        INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
        VALUES (?, ?, 1, ?)
      `).run(`account-avatars:mutation-cleanup:crashed-${index}`, JSON.stringify({
        schema: 1,
        phase: 'cancelled',
        status: 'pending',
        userId: loginBody.user.id,
        requestId: `crashed-${index}`,
        ownerRequestId: '',
        keys: [],
        pendingKeys: [],
        preservedKeys: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }), timestamp)
    }

    const lifecycleRows = () => env.DB.database.prepare(`
      SELECT meta_key, value_json, version, updated_at FROM system_metadata
      WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
        AND json_extract(value_json, '$.userId') = ?
      ORDER BY meta_key
    `).all(loginBody.user.id)
    const lifecycleRowsBefore = lifecycleRows()
    const response = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1, payload: { name: 'Admin vẫn cập nhật được' },
    }, { ...authorization, 'idempotency-key': 'avatar-lifecycle-cap-update' }), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      version: 2,
      settings: { name: 'Admin vẫn cập nhật được' },
    })
    expect(lifecycleRows()).toEqual(lifecycleRowsBefore)

    const ninthAvatarMutation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 2,
      payload: { avatar: testAvatarDataUrl('image/png', 1024) },
    }, { ...authorization, 'idempotency-key': 'avatar-lifecycle-cap-ninth-avatar' }), env)
    expect(ninthAvatarMutation.status).toBe(503)
    expect(await ninthAvatarMutation.json()).toMatchObject({ error: { code: 'ACCOUNT_AVATAR_CLEANUP_QUEUE_FAILED' } })
    expect(lifecycleRows()).toHaveLength(8)
    expect(env.IDENTITY_IMAGES.objects.size).toBe(0)
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 2 })
  })

  it('does not let cancelled lifecycles from other accounts exhaust a global avatar cap', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-no-global-cap' }
    await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-no-global-cap-password',
      initialState: { stores: [], employees: [], attendance: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-no-global-cap-password',
    }), env)
    const loginBody = await login.json()
    const authorization = { authorization: `Bearer ${loginBody.token}` }
    const timestamp = '2026-08-25T00:00:00.000Z'
    const insertMarker = env.DB.database.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
      VALUES (?, ?, 1, ?)
    `)
    for (let index = 0; index < 1_000; index += 1) {
      insertMarker.run(`account-avatars:mutation-cleanup:historical-${index}`, JSON.stringify({
        schema: 1,
        phase: 'cancelled',
        status: 'pending',
        userId: `historical-user-${index}`,
        requestId: `historical-request-${index}`,
        ownerRequestId: '',
        keys: [],
        pendingKeys: [],
        preservedKeys: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }), timestamp)
    }

    const response = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1,
      payload: { avatar: testAvatarDataUrl('image/png', 1024) },
    }, { ...authorization, 'idempotency-key': 'avatar-no-global-cap-upload' }), env)
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({
      version: 2,
      settings: { avatar: { key: expect.stringMatching(/^account-avatars\//u) } },
    })
    expect(bucket.objects.has(body.settings.avatar.key)).toBe(true)
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS total FROM system_metadata
      WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
    `).get()).toEqual({ total: 1_000 })
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS total FROM system_metadata
      WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
        AND json_extract(value_json, '$.userId') = ?
    `).get(loginBody.user.id)).toEqual({ total: 0 })
  })

  it('serializes pending avatar cleanup and never continues the cleaner request into a new mutation', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-cleanup-owner' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-cleanup-owner-password',
      initialState: { stores: [], employees: [], attendance: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-cleanup-owner-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const staleKey = 'account-avatars/stale-owner/avatar.png'
    await bucket.put(staleKey, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    env.DB.database.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
      VALUES ('account-avatars:pending-cleanup', ?, 1, '2026-08-25T00:00:00.000Z')
    `).run(JSON.stringify({
      schema: 2, status: 'pending', ownerRequestId: '', leaseExpiresAt: '',
      keys: [staleKey], preservedKeys: [], reasons: ['concurrency-fixture'],
      createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
    }))

    let releaseDeletion
    let signalDeletionStarted
    const deletionStarted = new Promise((resolve) => { signalDeletionStarted = resolve })
    const deletionReleased = new Promise((resolve) => { releaseDeletion = resolve })
    bucket.beforeDelete = async (key) => {
      if (key !== staleKey) return
      signalDeletionStarted()
      await deletionReleased
    }
    const cleanerRequest = {
      type: 'account_settings.update', expectedVersion: 1,
      payload: { avatar: testAvatarDataUrl('image/png', 1024) },
    }
    const cleanerPromise = worker.fetch(jsonRequest('https://idosi.example/api/command', cleanerRequest, {
      ...authorization, 'idempotency-key': 'avatar-cleanup-owner-first',
    }), env)
    await deletionStarted

    const concurrent = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...cleanerRequest, payload: { avatar: testAvatarDataUrl('image/webp', 2048) },
    }, { ...authorization, 'idempotency-key': 'avatar-cleanup-owner-concurrent' }), env)
    expect(concurrent.status).toBe(503)
    expect(await concurrent.json()).toMatchObject({ error: { code: 'ACCOUNT_AVATAR_CLEANUP_PENDING' } })
    expect([...bucket.objects.keys()]).toEqual([staleKey])

    releaseDeletion()
    const cleaner = await cleanerPromise
    expect(cleaner.status).toBe(503)
    expect(await cleaner.json()).toMatchObject({ error: { code: 'ACCOUNT_AVATAR_CLEANUP_RETRY' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
    expect([...bucket.objects.keys()]).toEqual([])
    bucket.beforeDelete = null

    const retried = await worker.fetch(jsonRequest('https://idosi.example/api/command', cleanerRequest, {
      ...authorization, 'idempotency-key': 'avatar-cleanup-owner-first',
    }), env)
    expect(retried.status).toBe(200)
    const retriedBody = await retried.json()
    expect(retriedBody).toMatchObject({ version: 2, settings: { avatar: { key: expect.stringMatching(/^account-avatars\//u) } } })
    expect([...bucket.objects.keys()]).toEqual([retriedBody.settings.avatar.key])
  }, 30_000)

  it('migrates legacy inline account avatars and scrubs historical artifacts on authenticated bootstrap', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-legacy' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-legacy-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Legacy store' }],
        employees: [{
          id: 'QL-LEGACY', name: 'Quản lý legacy', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc',
        }],
        attendance: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-legacy-password',
    }), env)
    const loginBody = await login.json()
    const authorization = { authorization: `Bearer ${loginBody.token}` }
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'avatar.legacy.manager', password: 'avatar-legacy-manager-password',
        displayName: 'Quản lý legacy', role: 'store_manager', storeId: 'S01', employeeId: 'QL-LEGACY',
      },
    }, { ...authorization, 'idempotency-key': 'avatar-legacy-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'avatar.legacy.manager', password: 'avatar-legacy-manager-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    // Model an upgraded database that predates the durable migration marker.
    // Fresh installations are already clean and intentionally skip this scan.
    env.DB.database.prepare(`
      DELETE FROM system_metadata WHERE meta_key = 'migration:account-avatars-v1'
    `).run()
    const legacyAvatar = testAvatarDataUrl('image/png', 2048)
    const stateRow = env.DB.database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get()
    const compactState = JSON.parse(stateRow.value_json)
    compactState.accountSettings = {
      [loginBody.user.id]: { name: 'Admin legacy', avatar: legacyAvatar },
    }
    compactState.settings = { ...(compactState.settings || {}), avatar: legacyAvatar }
    env.DB.database.prepare(`
      UPDATE app_state SET value_json = ?, last_request_id = 'legacy-avatar-fixture' WHERE scope_key = 'global'
    `).run(JSON.stringify(compactState))
    env.DB.database.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      ) VALUES ('legacy-avatar-audit', ?, 'admin', 'account_settings.update', 'account-settings', ?, NULL, ?, NULL, ?)
    `).run(loginBody.user.id, loginBody.user.id, JSON.stringify({ avatar: legacyAvatar }), '2026-08-20T00:00:00.000Z')
    env.DB.database.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      ) VALUES (?, 'legacy-avatar-receipt-0001', 'legacy-hash', ?, 200, '2026-08-20T00:00:00.000Z')
    `).run(loginBody.user.id, JSON.stringify({ ok: true, settings: { avatar: legacyAvatar } }))

    const rejectedUpdate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 1, payload: { name: '' },
    }, { ...managerAuthorization, 'idempotency-key': 'avatar-legacy-invalid-update-0001' }), env)
    expect(rejectedUpdate.status).toBe(400)
    expect(await rejectedUpdate.json()).toMatchObject({ error: { code: 'DISPLAY_NAME_INVALID' } })
    expect([...bucket.objects.keys()]).toEqual([])
    expect(JSON.stringify(readHydratedState(env.DB.database))).toContain('base64')

    const originalPut = bucket.put.bind(bucket)
    bucket.put = async (key, value, options) => {
      if (key.startsWith('account-avatars/')) {
        const mutationMarker = env.DB.database.prepare(`
          SELECT value_json FROM system_metadata
          WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
            AND COALESCE(json_extract(value_json, '$.phase'), 'prepared') <> 'cancelled'
          ORDER BY meta_key LIMIT 1
        `).get()
        expect(JSON.parse(mutationMarker.value_json)).toMatchObject({
          phase: 'prepared', pendingKeys: expect.arrayContaining([key]),
        })
      }
      return originalPut(key, value, options)
    }
    const migratedAsManager = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect(migratedAsManager.status).toBe(200)
    const managerBody = await migratedAsManager.json()
    expect(managerBody.version).toBe(2)
    expect(managerBody.state.settings.avatar).toBe('')

    const migrated = await worker.fetch(new Request('https://idosi.example/api/bootstrap', { headers: authorization }), env)
    expect(migrated.status).toBe(200)
    const migratedBody = await migrated.json()
    expect(migratedBody.version).toBe(2)
    expect(migratedBody.state.settings.avatar).toMatchObject({
      key: expect.stringMatching(/^account-avatars\//u),
      contentType: 'image/png',
      size: 2048,
      version: 1,
    })
    expect(JSON.stringify(migratedBody)).not.toContain('base64')
    expect(JSON.stringify(readHydratedState(env.DB.database))).not.toContain('base64')
    expect(env.DB.database.prepare(`
      SELECT before_json, after_json, metadata_json FROM audit_log
      WHERE request_id = 'legacy-avatar-audit'
    `).get().after_json).not.toContain('base64')
    expect(env.DB.database.prepare(`
      SELECT response_json FROM command_receipts WHERE idempotency_key = 'legacy-avatar-receipt-0001'
    `).get().response_json).not.toContain('base64')
    expect([...bucket.objects.keys()]).toHaveLength(1)

    const secondBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', { headers: authorization }), env)
    expect((await secondBootstrap.json()).version).toBe(2)
    expect([...bucket.objects.keys()]).toHaveLength(1)
    expect(env.DB.database.prepare(`
      SELECT meta_key FROM system_metadata
      WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
        AND COALESCE(json_extract(value_json, '$.phase'), 'prepared') <> 'cancelled'
    `).get()).toBeUndefined()
    bucket.put = originalPut
  })

  it('keeps a canonical employee avatar readable through a multi-role proxy when its account-settings link is missing', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-profile-fallback' }
    await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-profile-fallback-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng' }],
        employees: [
          { id: 'EMP-OLD', name: 'Nhân viên gốc', storeId: 'OFFICE', unit: 'office', status: 'Đang làm việc' },
          {
            id: 'EMP-PROXY', name: 'Nhân viên cửa hàng', storeId: 'S01', unit: 'store', status: 'Đang làm việc',
            linkedEmployeeId: 'EMP-OLD',
          },
        ],
        attendance: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-profile-fallback-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'employee.old.avatar', password: 'employee-old-avatar-password',
        displayName: 'Nhân viên cửa hàng', role: 'employee', storeId: 'S01', employeeId: 'EMP-PROXY',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'employee-old-avatar-create' }), env)
    expect(created.status).toBe(201)

    const key = 'account-avatars/legacy-profile-EMP-OLD/avatar-v1.png'
    const bytes = new Uint8Array(128)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/png' } })
    const stateRow = env.DB.database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get()
    const compactState = JSON.parse(stateRow.value_json)
    compactState.accountSettings = {}
    const employees = readHydratedState(env.DB.database).employees.map((employee) => employee.id === 'EMP-OLD'
      ? { ...employee, avatarImage: { key, contentType: 'image/png', size: bytes.byteLength, version: 1 } }
      : employee)
    env.DB.database.prepare(`
      UPDATE app_state SET value_json = ?, last_request_id = 'avatar-profile-fallback-fixture'
      WHERE scope_key = 'global'
    `).run(JSON.stringify(compactState))
    replaceStateCollection(env.DB.database, 'employees', employees)

    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.old.avatar', password: 'employee-old-avatar-password',
    }), env)
    const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
    const employeeBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: employeeAuthorization,
    }), env)
    expect(employeeBootstrap.status).toBe(200)
    expect((await employeeBootstrap.json()).state.settings.avatar).toMatchObject({ key, version: 1 })

    const downloaded = await worker.fetch(new Request('https://idosi.example/api/account-avatar', {
      headers: employeeAuthorization,
    }), env)
    expect(downloaded.status).toBe(200)
    expect(downloaded.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes)
  })

  it('serves employee avatars only within active role scope without exposing profile existence', async () => {
    const bucket = new MemoryR2()
    const env = {
      DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-employee-avatar-rbac',
    }
    const profiles = [
      {
        id: 'E-A', name: 'Nhân viên A', storeId: 'S01', unit: 'store', status: 'Đang làm việc',
        authUserId: 'owner-E-A',
      },
      { id: 'E-B', name: 'Nhân viên B', storeId: 'S02', unit: 'store', status: 'Đang làm việc' },
      { id: 'E-NONE', name: 'Chưa có avatar', storeId: 'S01', unit: 'store', status: 'Đang làm việc' },
      { id: 'E-MISSING', name: 'Thiếu object', storeId: 'S01', unit: 'store', status: 'Đang làm việc' },
      {
        id: 'E-WRONG', name: 'Sai owner', storeId: 'S01', unit: 'store', status: 'Đang làm việc',
        authUserId: 'owner-E-WRONG',
      },
      { id: 'E-INACTIVE', name: 'Nhân viên nghỉ', storeId: 'S02', unit: 'store', status: 'Đã nghỉ việc' },
      { id: 'M-A', name: 'Quản lý A', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc' },
      { id: 'HTKD-A', name: 'Hỗ trợ nội bộ', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
      { id: 'OFFICE-A', name: 'Văn phòng', storeId: 'OFFICE', unit: 'office', status: 'Đang làm việc' },
      { id: 'E-ROOT', name: 'Nhân viên gốc', storeId: 'S01', unit: 'store', status: 'Đang làm việc' },
      {
        id: 'E-PROXY', name: 'Nhân viên vai trò', storeId: 'S01', unit: 'store', status: 'Đang làm việc',
        linkedEmployeeId: 'E-ROOT',
      },
      { id: 'E-COW', name: 'Đồng nghiệp', storeId: 'S01', unit: 'store', status: 'Đang làm việc' },
    ]
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'employee-avatar-rbac-admin-password',
      initialState: {
        stores: [
          { id: 'S01', name: 'Dosii S01', status: 'Đang hoạt động' },
          { id: 'S02', name: 'Dosii S02', status: 'Đang hoạt động' },
        ],
        employees: profiles,
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'employee-avatar-rbac-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const accounts = [
      {
        username: 'avatar.support', password: 'avatar-support-password', displayName: 'Hỗ trợ',
        role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-A',
      },
      {
        username: 'avatar.manager', password: 'avatar-manager-password', displayName: 'Quản lý',
        role: 'store_manager', storeId: 'S01', employeeId: 'M-A',
      },
      {
        username: 'avatar.employee', password: 'avatar-employee-password', displayName: 'Nhân viên',
        role: 'employee', storeId: 'S01', employeeId: 'E-PROXY',
      },
    ]
    for (const account of accounts) {
      const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create', payload: account,
      }, { ...adminAuthorization, 'idempotency-key': `employee-avatar-user-${account.role}` }), env)
      expect(created.status, account.role).toBe(201)
    }

    const bytes = validPngBytes(128)
    const avatarIds = [
      'E-A', 'E-B', 'E-INACTIVE', 'M-A', 'HTKD-A', 'OFFICE-A', 'E-ROOT', 'E-COW', 'E-MISSING',
    ]
    const withAvatars = profiles.map((profile) => {
      if (!avatarIds.includes(profile.id)) return profile
      const key = profile.id === 'E-A'
        ? 'account-avatars/owner-E-A/avatar-v1.png'
        : `account-avatars/legacy-profile-${profile.id}/avatar-v1.png`
      return { ...profile, avatarImage: { key, contentType: 'image/png', size: bytes.byteLength, version: 1 } }
    }).map((profile) => profile.id === 'E-WRONG'
      ? {
          ...profile,
          avatarImage: {
            key: 'account-avatars/another-owner/avatar-v1.png',
            contentType: 'image/png', size: bytes.byteLength, version: 1,
          },
        }
      : profile)
    for (const profileId of avatarIds.filter((id) => id !== 'E-MISSING')) {
      const key = profileId === 'E-A'
        ? 'account-avatars/owner-E-A/avatar-v1.png'
        : `account-avatars/legacy-profile-${profileId}/avatar-v1.png`
      await bucket.put(key, bytes)
    }
    await bucket.put('account-avatars/another-owner/avatar-v1.png', bytes)
    replaceStateCollection(env.DB.database, 'employees', withAvatars)

    const loginAs = async (username, password) => {
      const response = await worker.fetch(jsonRequest('https://idosi.example/api/login', { username, password }), env)
      expect(response.status).toBe(200)
      return { authorization: `Bearer ${(await response.json()).token}` }
    }
    const supportAuthorization = await loginAs('avatar.support', 'avatar-support-password')
    const managerAuthorization = await loginAs('avatar.manager', 'avatar-manager-password')
    const employeeAuthorization = await loginAs('avatar.employee', 'avatar-employee-password')
    const getAvatar = (id, authorization) => worker.fetch(new Request(
      `https://idosi.example/api/account-avatars/${id}`,
      { headers: authorization },
    ), env)
    const expectHidden = async (id, authorization) => {
      const response = await getAvatar(id, authorization)
      expect(response.status, id).toBe(404)
      expect(await response.json()).toMatchObject({ error: { code: 'EMPLOYEE_AVATAR_NOT_FOUND' } })
    }

    const adminStoreAvatar = await getAvatar('E-A', adminAuthorization)
    expect(adminStoreAvatar.status).toBe(200)
    expect((await getAvatar('OFFICE-A', adminAuthorization)).status).toBe(200)
    expect((await getAvatar('E-B', supportAuthorization)).status).toBe(200)
    await expectHidden('HTKD-A', supportAuthorization)
    await expectHidden('OFFICE-A', supportAuthorization)
    await expectHidden('E-INACTIVE', supportAuthorization)
    expect((await getAvatar('E-A', managerAuthorization)).status).toBe(200)
    await expectHidden('E-B', managerAuthorization)
    expect((await getAvatar('E-ROOT', employeeAuthorization)).status).toBe(200)
    await expectHidden('E-COW', employeeAuthorization)

    for (const id of ['UNKNOWN', 'E-NONE', 'E-MISSING', 'E-WRONG', '%2Fetc', '%E0%A4%A']) {
      await expectHidden(id, adminAuthorization)
    }
    expect(adminStoreAvatar.headers.get('cache-control')).toBe('private, no-store')
    expect(adminStoreAvatar.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(adminStoreAvatar.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(adminStoreAvatar.headers.get('referrer-policy')).toBe('no-referrer')
    expect(adminStoreAvatar.headers.get('x-content-type-options')).toBe('nosniff')
    expect(adminStoreAvatar.headers.get('x-avatar-version')).toBe('1')
    expect(adminStoreAvatar.headers.get('content-disposition')).toBe('inline; filename="avatar.png"')
    expect(adminStoreAvatar.headers.get('etag')).toContain('owner-E-A')
    expect(Buffer.from(await adminStoreAvatar.arrayBuffer())).toEqual(bytes)
  }, 30_000)

  it('tracks every legacy avatar upload durably through demo and full reset commits', async () => {
    for (const resetType of ['system.reset_demo', 'system.reset_all']) {
      const suffix = resetType.endsWith('demo') ? 'demo' : 'all'
      const bucket = new MemoryR2()
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: `bootstrap-legacy-reset-${suffix}` }
      await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: `legacy-reset-${suffix}-password`,
        initialState: { stores: [], employees: [], attendance: [] },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: `legacy-reset-${suffix}-password`,
      }), env)
      const authorization = { authorization: `Bearer ${(await login.json()).token}` }
      const row = env.DB.database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get()
      const compactState = JSON.parse(row.value_json)
      compactState.settings = { ...(compactState.settings || {}), avatar: testAvatarDataUrl('image/png', 1024) }
      env.DB.database.prepare(`
        UPDATE app_state SET value_json = ?, last_request_id = ? WHERE scope_key = 'global'
      `).run(JSON.stringify(compactState), `legacy-reset-${suffix}-fixture`)

      const originalPut = bucket.put.bind(bucket)
      bucket.put = async (key, value, options) => {
        if (key.startsWith('account-avatars/')) {
          const marker = env.DB.database.prepare(`
            SELECT value_json FROM system_metadata
            WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
              AND COALESCE(json_extract(value_json, '$.phase'), 'prepared') <> 'cancelled'
            ORDER BY meta_key LIMIT 1
          `).get()
          expect(JSON.parse(marker.value_json)).toMatchObject({
            phase: 'prepared', pendingKeys: expect.arrayContaining([key]),
          })
        }
        return originalPut(key, value, options)
      }
      const payload = resetType === 'system.reset_demo'
        ? { state: { schemaVersion: 2, stateVersion: 1, stores: [], employees: [], attendance: [] } }
        : { confirmation: 'RESET_ALL_DATA' }
      const reset = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: resetType, expectedVersion: 1, payload,
      }, { ...authorization, 'idempotency-key': `legacy-avatar-reset-${suffix}` }), env)
      const resetBody = await reset.json()
      expect(reset.status, `${resetType}: ${JSON.stringify(resetBody)}`).toBe(200)
      expect(JSON.stringify(resetBody)).not.toContain('base64')
      expect(JSON.stringify(readHydratedState(env.DB.database))).not.toContain('base64')
      expect(env.DB.database.prepare(`
        SELECT meta_key FROM system_metadata
        WHERE meta_key LIKE 'account-avatars:mutation-cleanup:%'
          AND COALESCE(json_extract(value_json, '$.phase'), 'prepared') <> 'cancelled'
      `).get()).toBeUndefined()
    }
  }, 30_000)

  it('quarantines invalid legacy inline avatars across settings and employee history without locking repair or reset', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-avatar-quarantine' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'avatar-quarantine-password',
      initialState: { stores: [], employees: [], deletedEmployees: [], attendance: [], orders: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'avatar-quarantine-password',
    }), env)
    const loginBody = await login.json()
    const authorization = { authorization: `Bearer ${loginBody.token}` }
    // Model an upgraded database that predates the durable migration marker.
    // Fresh installations are already clean and intentionally skip this scan.
    env.DB.database.prepare(`
      DELETE FROM system_metadata WHERE meta_key = 'migration:account-avatars-v1'
    `).run()
    const invalidAvatars = {
      gif: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==',
      svg: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`,
      jpgAlias: 'data:image/jpg;base64,/9j/2Q==',
      corrupt: 'data:image/png;base64,not_base64',
      hyphenMime: 'data:image-jpg;base64,/9j/2Q==',
    }
    const stateRow = env.DB.database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get()
    const compactState = JSON.parse(stateRow.value_json)
    compactState.settings = { name: 'Admin legacy invalid', avatar: invalidAvatars.gif }
    compactState.accountSettings = {
      [loginBody.user.id]: { name: 'Admin legacy invalid', avatar: invalidAvatars.svg },
    }
    env.DB.database.prepare(`
      UPDATE app_state SET value_json = ?, last_request_id = 'avatar-quarantine-fixture'
      WHERE scope_key = 'global'
    `).run(JSON.stringify(compactState))
    replaceStateCollection(env.DB.database, 'employees', [
      { id: 'EMP-JPG-INVALID', name: 'JPG alias', avatar: invalidAvatars.jpgAlias },
      { id: 'EMP-BASE64-INVALID', name: 'Base64 corrupt', avatar: invalidAvatars.corrupt },
    ])
    replaceStateCollection(env.DB.database, 'deletedEmployees', [
      { id: 'EMP-HYPHEN-INVALID', name: 'MIME dấu gạch', avatar: invalidAvatars.hyphenMime },
    ])
    env.DB.database.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      ) VALUES ('avatar-quarantine-audit-fixture', ?, 'admin', 'legacy.fixture', 'account-avatar', ?, ?, NULL, NULL, ?)
    `).run(loginBody.user.id, loginBody.user.id, JSON.stringify({ avatar: invalidAvatars.gif }), '2026-08-25T00:00:00.000Z')
    env.DB.database.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      ) VALUES (?, 'avatar-quarantine-receipt', 'avatar-quarantine-hash', ?, 200, '2026-08-25T00:00:00.000Z')
    `).run(loginBody.user.id, JSON.stringify({ ok: true, settings: { avatar: invalidAvatars.svg } }))

    const repaired = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
    expect(repaired.status).toBe(200)
    const repairedBody = await repaired.json()
    expect(repairedBody.version).toBe(2)
    expect(repairedBody.state.settings.avatar).toBeNull()
    expect([...bucket.objects.keys()]).toEqual([])
    const repairedState = readHydratedState(env.DB.database)
    expect(JSON.stringify(repairedState)).not.toContain('data:image')
    expect(repairedState.accountSettings[loginBody.user.id].avatar).toBeNull()
    expect(repairedState.settings).not.toHaveProperty('avatar')
    expect(repairedState.employees.every((employee) => !Object.hasOwn(employee, 'avatar'))).toBe(true)
    expect(repairedState.deletedEmployees.every((employee) => !Object.hasOwn(employee, 'avatar'))).toBe(true)
    expect(env.DB.database.prepare(`
      SELECT before_json FROM audit_log WHERE request_id = 'avatar-quarantine-audit-fixture'
    `).get().before_json).not.toContain('data:image')
    expect(env.DB.database.prepare(`
      SELECT response_json FROM command_receipts WHERE idempotency_key = 'avatar-quarantine-receipt'
    `).get().response_json).not.toContain('data:image')
    const migrationAudit = env.DB.database.prepare(`
      SELECT metadata_json FROM audit_log WHERE action = 'account_avatar.migrate_legacy' ORDER BY id DESC LIMIT 1
    `).get()
    expect(JSON.parse(migrationAudit.metadata_json)).toMatchObject({
      migratedObjects: 0,
      quarantinedInvalidObjects: 5,
      quarantined: expect.arrayContaining([
        expect.objectContaining({ location: 'settings.avatar', reason: 'legacy-avatar-invalid' }),
        expect.objectContaining({ location: `accountSettings.${loginBody.user.id}.avatar` }),
        expect.objectContaining({ location: 'employees.EMP-JPG-INVALID.avatar' }),
        expect.objectContaining({ location: 'employees.EMP-BASE64-INVALID.avatar' }),
        expect.objectContaining({ location: 'deletedEmployees.EMP-HYPHEN-INVALID.avatar' }),
      ]),
    })

    const reset = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_demo', expectedVersion: 2,
      payload: { state: { schemaVersion: 2, stateVersion: 1, stores: [], employees: [], attendance: [], orders: [] } },
    }, { ...authorization, 'idempotency-key': 'avatar-quarantine-reset-demo' }), env)
    expect(reset.status).toBe(200)
    expect(await reset.json()).toMatchObject({ version: 3, state: { stores: [], employees: [], attendance: [], orders: [] } })
    expect(env.DB.database.prepare(`
      SELECT value_json FROM system_metadata WHERE meta_key = 'account-avatars:pending-cleanup'
    `).get()).toBeUndefined()
  }, 30_000)

  it('persists manager-safe transfers, store settings, account preferences, and admin demo reset', async () => {
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-persistence-gaps' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'persistence-admin-password',
      initialState: {
        schemaVersion: 2,
        stateVersion: 1,
        stores: [
          { id: 'S01', name: 'Cửa hàng 01', short: 'S01', status: 'Đang hoạt động' },
          { id: 'S02', name: 'Cửa hàng 02', short: 'S02', status: 'Đang hoạt động' },
        ],
        employees: [
          { id: 'E01', code: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'VP001', code: 'VP001', name: 'Nhân viên văn phòng', storeId: 'OFFICE', unit: 'office' },
          { id: 'HTKD-PERSIST', code: 'HTKD-PERSIST', name: 'Quản lý cũ', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
        ],
        supportTransfers: [{
          id: 'ST-OFFICE', employeeId: 'VP001', fromStoreId: 'OFFICE', toStoreId: 'S01',
          fromDate: '2026-08-01', toDate: '2026-08-02', status: 'Đã duyệt',
        }],
        payrollPeriods: [{
          id: 'PAYROLL-LOCKED', storeId: 'S01', period: '2026-09', status: 'Đã khóa',
          lockedAt: '2026-09-30T00:00:00.000Z',
        }, {
          id: 'PAYROLL-PAID', storeId: 'S02', period: '2026-10', status: 'Đã chi',
          confirmedAt: '2026-10-31T00:00:00.000Z',
        }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)

    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'persistence-admin-password',
    }), env)
    const adminToken = (await adminLogin.json()).token
    const adminAuthorization = { authorization: `Bearer ${adminToken}` }
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      expectedVersion: 0,
      payload: {
        role: 'business_support', employeeId: 'HTKD-PERSIST', username: 'manager.settings', password: 'persistence-manager-password', displayName: 'Quản lý cũ',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'persistence-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const managerCreatedBody = await managerCreated.json()
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.settings', password: 'persistence-manager-password',
    }), env)
    const managerToken = (await managerLogin.json()).token
    const managerAuthorization = { authorization: `Bearer ${managerToken}` }

    const managerBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect((await managerBootstrap.json()).state.supportTransfers).toEqual([
      expect.objectContaining({ id: 'ST-OFFICE', employeeId: 'VP001' }),
    ])

    const adminTransferValidated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create',
      expectedVersion: 1,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-08-15', toDate: '2026-08-17',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-support-transfer-validated-0001' }), env)
    expect(adminTransferValidated.status).toBe(400)
    expect(await adminTransferValidated.json()).toMatchObject({ error: { code: 'SUPPORT_HOURLY_RATE_REQUIRED' } })

    const transferRateRequired = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create', expectedVersion: 1,
      payload: { employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-08-15', toDate: '2026-08-17' },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-rate-required-0001' }), env)
    expect(transferRateRequired.status).toBe(400)
    expect(await transferRateRequired.json()).toMatchObject({ error: { code: 'SUPPORT_HOURLY_RATE_REQUIRED' } })

    const transferSourceMismatch = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create', expectedVersion: 1,
      payload: {
        employeeId: 'E01', fromStoreId: 'S02', toStoreId: 'S01',
        fromDate: '2026-08-15', toDate: '2026-08-17', hourlySupportRate: 45_000, allowance: 0,
      },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-source-mismatch-0001' }), env)
    expect(transferSourceMismatch.status).toBe(400)
    expect(await transferSourceMismatch.json()).toMatchObject({ error: { code: 'TRANSFER_SOURCE_MISMATCH' } })

    const lockedTransfer = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create',
      expectedVersion: 1,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-09-01', toDate: '2026-09-02',
        hourlySupportRate: 45_000, allowance: 150_000, note: 'Kỳ đã khóa',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-locked-0001' }), env)
    expect(lockedTransfer.status).toBe(409)
    expect(await lockedTransfer.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
    const paidTransfer = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create', expectedVersion: 1,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-10-01', toDate: '2026-10-02',
        hourlySupportRate: 45_000, allowance: 150_000,
      },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-paid-0001' }), env)
    expect(paidTransfer.status).toBe(409)
    expect(await paidTransfer.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })

    const createTransferCommand = {
      type: 'support_transfer.create',
      expectedVersion: 1,
      payload: {
        employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        fromDate: '2026-08-15', toDate: '2026-08-17',
        hourlySupportRate: 45_000, allowance: 150_000, note: 'Hỗ trợ khai trương',
      },
    }
    const transferCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', createTransferCommand, {
      ...managerAuthorization, 'idempotency-key': 'support-transfer-create-0001',
    }), env)
    expect(transferCreated.status).toBe(201)
    const transferCreatedBody = await transferCreated.json()
    expect(transferCreatedBody).toMatchObject({
      ok: true,
      version: 2,
      transfer: {
        employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        fromDate: '2026-08-15', toDate: '2026-08-17', hourlySupportRate: 45_000,
        allowance: 150_000, status: 'Đã duyệt',
      },
    })
    const transferReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', createTransferCommand, {
      ...managerAuthorization, 'idempotency-key': 'support-transfer-create-0001',
    }), env)
    expect(transferReplay.status).toBe(201)
    expect(transferReplay.headers.get('idempotency-replayed')).toBe('true')
    expect(await transferReplay.json()).toEqual(transferCreatedBody)

    const overlappingTransfer = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create', expectedVersion: 2,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-08-17', toDate: '2026-08-19',
        hourlySupportRate: 45_000, allowance: 0,
      },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-overlap-0001' }), env)
    expect(overlappingTransfer.status).toBe(409)
    expect(await overlappingTransfer.json()).toMatchObject({ error: { code: 'SUPPORT_TRANSFER_OVERLAP' } })

    const transferId = transferCreatedBody.transfer.id
    const transferUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.update',
      expectedVersion: 2,
      payload: { transferId, toDate: '2026-08-18', hourlyRate: 50_000, allowance: 200_000, note: 'Đã gia hạn', status: 'Hoàn tất' },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-update-0001' }), env)
    expect(transferUpdated.status).toBe(200)
    expect(await transferUpdated.json()).toMatchObject({
      version: 3, transfer: { id: transferId, toDate: '2026-08-18', hourlySupportRate: 50_000, allowance: 200_000, note: 'Đã gia hạn', status: 'Hoàn tất' },
    })
    const managerDeleteDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.delete',
      expectedVersion: 3,
      payload: { transferId, reason: 'Điều chuyển đã kết thúc' },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-delete-denied-0001' }), env)
    expect(managerDeleteDenied.status).toBe(403)
    expect(await managerDeleteDenied.json()).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })
    const transferAfterDeniedDelete = readHydratedState(env.DB.database).supportTransfers.find(({ id }) => id === transferId)
    expect(transferAfterDeniedDelete).toMatchObject({ id: transferId, status: 'Hoàn tất' })
    expect(transferAfterDeniedDelete).not.toHaveProperty('deletedAt')

    const transferDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.delete',
      expectedVersion: 3,
      payload: { transferId, reason: 'Điều chuyển đã kết thúc' },
    }, { ...adminAuthorization, 'idempotency-key': 'support-transfer-delete-0001' }), env)
    expect(transferDeleted.status).toBe(200)
    expect(await transferDeleted.json()).toMatchObject({
      version: 4, transfer: { id: transferId, status: 'Đã xóa', deleteReason: 'Điều chuyển đã kết thúc' },
    })

    const invalidStore = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.update', expectedVersion: 4, payload: { storeId: 'S01', phone: '1234' },
    }, { ...adminAuthorization, 'idempotency-key': 'store-settings-invalid-0001' }), env)
    expect(invalidStore.status).toBe(400)
    expect(await invalidStore.json()).toMatchObject({ error: { code: 'PHONE_INVALID' } })
    const invalidHours = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.update', expectedVersion: 4,
      payload: { storeId: 'S01', operatingHours: { opening: '22:00', closing: '07:00' } },
    }, { ...adminAuthorization, 'idempotency-key': 'store-settings-hours-invalid-0001' }), env)
    expect(invalidHours.status).toBe(400)
    expect(await invalidHours.json()).toMatchObject({ error: { code: 'STORE_HOURS_INVALID' } })
    const storeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.update',
      expectedVersion: 4,
      payload: {
        storeId: 'S01', phone: '0901234567', email: 'STORE01@IDOSI.VN', tax: '0312345678',
        operatingHours: { opening: '07:30', closing: '22:45' }, address: '123 Đường IDOSI',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'store-settings-update-0001' }), env)
    expect(storeUpdated.status).toBe(200)
    expect(await storeUpdated.json()).toMatchObject({
      version: 5,
      store: {
        phone: '0901234567', email: 'store01@idosi.vn', tax: '0312345678', taxCode: '0312345678',
        opening: '07:30', openingTime: '07:30', closing: '22:45', closingTime: '22:45', address: '123 Đường IDOSI',
        operatingHours: { opening: '07:30', closing: '22:45' },
      },
    })
    const projectedStoreState = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: managerAuthorization,
    }), env)
    expect(projectedStoreState.status).toBe(200)
    expect((await projectedStoreState.json()).state.stores.find(({ id }) => id === 'S01')).toMatchObject({
      opening: '07:30', openingTime: '07:30', closing: '22:45', closingTime: '22:45',
      operatingHours: { opening: '07:30', closing: '22:45' },
    })

    const oversizedAvatar = testAvatarDataUrl('image/png', 300 * 1024 + 1)
    const avatarRejected = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 5, payload: { avatar: oversizedAvatar },
    }, { ...managerAuthorization, 'idempotency-key': 'account-settings-avatar-0001' }), env)
    expect(avatarRejected.status).toBe(413)
    expect(await avatarRejected.json()).toMatchObject({ error: { code: 'AVATAR_TOO_LARGE' } })
    const unsupportedAvatar = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 5,
      payload: { avatar: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` },
    }, { ...managerAuthorization, 'idempotency-key': 'account-settings-avatar-invalid-mime-0001' }), env)
    expect(unsupportedAvatar.status).toBe(400)
    expect(await unsupportedAvatar.json()).toMatchObject({ error: { code: 'AVATAR_INVALID' } })
    const spoofedAvatar = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 5,
      payload: { avatar: testAvatarDataUrl('image/jpeg', 512, 'image/png') },
    }, { ...managerAuthorization, 'idempotency-key': 'account-settings-avatar-spoofed-mime-0001' }), env)
    expect(spoofedAvatar.status).toBe(400)
    expect(await spoofedAvatar.json()).toMatchObject({ error: { code: 'AVATAR_INVALID' } })
    const invalidBase64Avatar = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 5, payload: { avatar: 'data:image/png;base64,not_base64' },
    }, { ...managerAuthorization, 'idempotency-key': 'account-settings-avatar-invalid-base64-0001' }), env)
    expect(invalidBase64Avatar.status).toBe(400)
    expect(await invalidBase64Avatar.json()).toMatchObject({ error: { code: 'AVATAR_INVALID' } })
    const boundaryAvatar = testAvatarDataUrl('image/webp', 300 * 1024)
    const settingsUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update',
      expectedVersion: 5,
      payload: {
        name: 'Quản lý IDOSI', email: 'manager@idosi.vn', phone: '0907654321', birthday: '1991-10-20',
        gender: 'Khác', address: 'TP. Hồ Chí Minh', bio: 'Quản lý vận hành cửa hàng.', avatar: boundaryAvatar,
        notifications: { tasks: false, dailyReport: true, expenseAlert: true },
      },
    }, { ...managerAuthorization, 'idempotency-key': 'account-settings-update-0001' }), env)
    expect(settingsUpdated.status).toBe(200)
    const settingsUpdatedBody = await settingsUpdated.json()
    expect(settingsUpdatedBody).toMatchObject({
      version: 6,
      settings: {
        name: 'Quản lý IDOSI', email: 'manager@idosi.vn', phone: '0907654321', birthday: '1991-10-20',
        avatar: {
          key: expect.stringMatching(/^account-avatars\/usr_[^/]+\//u),
          contentType: 'image/webp',
          size: 300 * 1024,
          version: 1,
        },
        notifications: { tasks: false, dailyReport: true, expenseAlert: true },
      },
      user: { id: managerCreatedBody.user.id, displayName: 'Quản lý IDOSI', version: 2 },
    })
    const managerAvatarKey = settingsUpdatedBody.settings.avatar.key
    expect(JSON.stringify(settingsUpdatedBody)).not.toContain('base64')
    expect(env.IDENTITY_IMAGES.objects.has(managerAvatarKey)).toBe(true)
    const managerAvatarResponse = await worker.fetch(new Request('https://idosi.example/api/account-avatar', {
      headers: managerAuthorization,
    }), env)
    expect(managerAvatarResponse.status).toBe(200)
    expect(managerAvatarResponse.headers.get('content-type')).toBe('image/webp')
    expect(managerAvatarResponse.headers.get('x-avatar-version')).toBe('1')
    expect(new Uint8Array(await managerAvatarResponse.arrayBuffer())).toHaveLength(300 * 1024)
    expect(JSON.stringify(readHydratedState(env.DB.database))).not.toContain('base64')
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS count FROM audit_log
      WHERE before_json LIKE '%base64%' OR after_json LIKE '%base64%' OR metadata_json LIKE '%base64%'
    `).get()).toEqual({ count: 0 })
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS count FROM command_receipts WHERE response_json LIKE '%base64%'
    `).get()).toEqual({ count: 0 })

    const adminStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: adminAuthorization,
    }), env)
    const adminProjectedState = (await adminStateResponse.json()).state
    expect(adminProjectedState).not.toHaveProperty('accountSettings')
    const genericReplace = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.replace', expectedVersion: 6, payload: { state: adminProjectedState },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-generic-replace-0001' }), env)
    expect(genericReplace.status).toBe(200)
    const genericReplaceBody = await genericReplace.json()
    expect(genericReplaceBody).toMatchObject({ version: 7 })
    expect(genericReplaceBody.state).not.toHaveProperty('accountSettings')
    const managerAfterGenericReplace = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect(await managerAfterGenericReplace.json()).toMatchObject({
      state: {
        settings: {
          name: 'Quản lý IDOSI', email: 'manager@idosi.vn',
          notifications: { tasks: false, dailyReport: true, expenseAlert: true },
        },
      },
    })
    const rawSettingsMutation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge', expectedVersion: 7, payload: { patch: { accountSettings: {} } },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-raw-settings-0001' }), env)
    expect(rawSettingsMutation.status).toBe(400)
    expect(await rawSettingsMutation.json()).toMatchObject({ error: { code: 'DOMAIN_COMMAND_REQUIRED' } })

    const resetPayload = {
      state: {
        schemaVersion: 2,
        stateVersion: 1,
        stores: [{ id: 'D01', name: 'Cửa hàng mẫu', short: 'D01', status: 'Đang hoạt động' }],
        employees: [],
        activeStoreId: 'D01',
        supportTransfers: [],
        orders: [],
        adminAccounts: [{ username: 'attacker', password: 'must-be-removed' }],
        accountSettings: { [managerCreatedBody.user.id]: { name: 'Không được ghi đè' } },
      },
    }
    const managerResetDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_demo', expectedVersion: 7, payload: resetPayload,
    }, { ...managerAuthorization, 'idempotency-key': 'manager-reset-demo-0001' }), env)
    expect(managerResetDenied.status).toBe(403)
    expect(await managerResetDenied.json()).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })

    const usersBeforeReset = env.DB.database.prepare(`
      SELECT id, username, display_name, role, status, version
      FROM users ORDER BY id
    `).all()
    const sessionsBeforeReset = env.DB.database.prepare(`
      SELECT id, token_hash, user_id, revoked_at
      FROM sessions ORDER BY id
    `).all()
    const resetResponse = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_demo', expectedVersion: 7, payload: resetPayload,
    }, { ...adminAuthorization, 'idempotency-key': 'admin-reset-demo-0001' }), env)
    expect(resetResponse.status).toBe(200)
    const resetBody = await resetResponse.json()
    expect(resetBody).toMatchObject({
      ok: true, version: 8, state: { stores: [{ id: 'D01' }], employees: [], activeStoreId: 'D01' },
      nonAdminAccountsPurged: true,
    })
    expect(resetBody.state).not.toHaveProperty('accountSettings')
    expect(env.DB.database.prepare(`
      SELECT id, username, display_name, role, status, version
      FROM users ORDER BY id
    `).all()).toEqual(usersBeforeReset.filter(({ role }) => role === 'admin'))
    expect(env.DB.database.prepare(`
      SELECT id, token_hash, user_id, revoked_at
      FROM sessions ORDER BY id
    `).all()).toEqual(sessionsBeforeReset.filter(({ user_id: userId }) => (
      usersBeforeReset.some(({ id, role }) => id === userId && role === 'admin')
    )))

    const rawState = readHydratedState(env.DB.database)
    expect(rawState).not.toHaveProperty('adminAccounts')
    expect(JSON.stringify(rawState)).not.toContain('must-be-removed')
    expect(rawState.accountSettings).toEqual({})
    expect(env.IDENTITY_IMAGES.objects.has(managerAvatarKey)).toBe(false)
    const managerAfterReset = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect(managerAfterReset.status).toBe(401)
    const usersAfterReset = await worker.fetch(new Request('https://idosi.example/api/users', {
      headers: adminAuthorization,
    }), env)
    expect(usersAfterReset.status).toBe(200)
    expect((await usersAfterReset.json()).users).toEqual([])
    expect(env.DB.database.prepare('SELECT id FROM users WHERE role <> \'admin\'').all()).toEqual([])
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(env.DB.database.prepare('SELECT action FROM audit_log ORDER BY id').all().map(({ action }) => action)).toEqual(expect.arrayContaining([
      'support_transfer.create',
      'support_transfer.update',
      'support_transfer.delete',
      'store.update',
      'account_settings.update',
      'system.reset_demo',
    ]))
  })

  it('creates business-support and store-manager profiles atomically with scoped RBAC and attendance', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-14T00:55:00.000Z'))
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-operational-roles' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin',
        password: 'operational-roles-admin-password',
        initialState: {
          stores: [
            { id: 'S01', short: 'TNV', name: 'IDOSI Tô Ngọc Vân', status: 'Đang hoạt động' },
            { id: 'S02', short: 'TH', name: 'IDOSI Tây Hòa', status: 'Đang hoạt động' },
          ],
          employees: [], attendance: [], schedule: [], tasks: [], shiftDefinitions: [],
          orders: [], expenseEntries: [], fixedExpenses: [], cashTransactions: [],
          salaryAdjustments: [], salaryAdvances: [], payrollPeriods: [], payrollPayments: [],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'operational-roles-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

      const missingAddress = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 1,
        payload: {
          unit: 'business_support', name: 'Thiếu địa chỉ', phone: '0901999999', cccd: '079123459999',
          startDate: '2026-08-01', employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
          username: 'support.no.address', password: 'support-no-address-password',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'business-support-address-required-0001' }), env)
      expect(missingAddress.status).toBe(400)
      expect(await missingAddress.json()).toMatchObject({ error: { code: 'EMPLOYEE_ADDRESS_INVALID' } })

      const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 1,
        payload: {
          unit: 'business_support', name: 'Hỗ trợ Kinh doanh 01', phone: '0901000001',
          cccd: '079123456701', address: 'TP.HCM', employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
          startDate: '2026-08-01', username: 'support.one', password: 'support-one-password',
          identityImages: testIdentityImages(),
        },
      }, { ...adminAuthorization, 'idempotency-key': 'business-support-create-0001' }), env)
      expect(supportCreated.status).toBe(201)
      expect(await supportCreated.json()).toMatchObject({
        version: 2,
        employee: {
          id: 'HTKD-001', unit: 'business_support', storeId: 'BUSINESS_SUPPORT', startDate: '2026-08-01',
          cccd: '079123456701', employmentType: 'Full-Time', position: 'NV hỗ trợ KD', workStart: '08:00', workEnd: '17:30',
        },
        user: { role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-001' },
      })

      const storeManagerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 2,
        payload: {
          unit: 'store_manager', storeId: 'S01', name: 'Quản lý TNV', phone: '0901000002',
          cccd: '079123456702', address: 'TP.HCM', employmentType: 'Full-Time', position: 'Quản lý cửa hàng',
          startDate: '2026-08-01', username: 'store.manager.one', password: 'store-manager-one-password',
          identityImages: testIdentityImages(),
        },
      }, { ...adminAuthorization, 'idempotency-key': 'store-manager-create-0001' }), env)
      expect(storeManagerCreated.status).toBe(201)
      expect(await storeManagerCreated.json()).toMatchObject({
        version: 3,
        employee: { id: 'QLCH-001', unit: 'store_manager', storeId: 'S01', position: 'Quản lý cửa hàng' },
        user: { role: 'store_manager', storeId: 'S01', employeeId: 'QLCH-001' },
      })

      const secondStoreManagerDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 3,
        payload: {
          unit: 'store_manager', storeId: 'S01', name: 'Quản lý trùng', phone: '0901000099',
          cccd: '079123456799', address: 'TP.HCM', employmentType: 'Full-Time', position: 'Quản lý cửa hàng',
          startDate: '2026-08-01', username: 'store.manager.duplicate', password: 'store-manager-duplicate-password',
          identityImages: testIdentityImages(),
        },
      }, { ...adminAuthorization, 'idempotency-key': 'store-manager-duplicate-denied-0001' }), env)
      expect(secondStoreManagerDenied.status).toBe(409)
      expect(await secondStoreManagerDenied.json()).toMatchObject({ error: { code: 'STORE_MANAGER_EXISTS' } })

      const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'support.one', password: 'support-one-password',
      }), env)
      const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
      for (const [index, type] of [
        'state.merge', 'system.reset_demo', 'user.create', 'task.done',
      ].entries()) {
        const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type, expectedVersion: 3, payload: {},
        }, { ...supportAuthorization, 'idempotency-key': `support-read-only-${String(index).padStart(4, '0')}` }), env)
        expect(denied.status, type).toBe(403)
        expect(await denied.json(), type).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })
      }
      expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 3 })
      const supportCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 3,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...supportAuthorization, 'idempotency-key': 'business-support-check-in-0001' }), env)
      expect(supportCheckIn.status).toBe(201)
      const supportAttendance = (await supportCheckIn.json()).attendance
      expect(supportAttendance).toMatchObject({
        employeeId: 'HTKD-001', storeId: 'BUSINESS_SUPPORT', unit: 'business_support',
        attendanceMode: 'office', shiftId: 'full_time', shiftName: 'Giờ hành chính',
        shiftStart: '08:00', shiftEnd: '17:30', shiftSource: 'profile-work-shift', arrivalTag: 'Đi sớm',
      })
      vi.setSystemTime(new Date('2026-08-14T10:05:00.000Z'))
      const supportCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 4,
        payload: {
          attendanceId: supportAttendance.id,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...supportAuthorization, 'idempotency-key': 'business-support-check-out-0001' }), env)
      expect(supportCheckOut.status).toBe(200)
      expect(await supportCheckOut.json()).toMatchObject({
        version: 5, attendance: { employeeId: 'HTKD-001', checkOut: '17:05', workdayCredit: 1 },
      })

      const storeManagerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'store.manager.one', password: 'store-manager-one-password',
      }), env)
      const storeManagerAuthorization = { authorization: `Bearer ${(await storeManagerLogin.json()).token}` }
      const storeEmployeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 5,
        payload: {
          storeId: 'S01', unit: 'store', name: 'Nhân viên TNV', phone: '0901000003',
          cccd: '079123456703', address: 'TP.HCM', startDate: '2026-08-01',
          employmentType: 'Full-Time', standardWorkDays: 26, requiredMonthlyHours: 208, baseSalary: 8_000_000,
          username: 'store.employee.one', password: 'store-employee-one-password',
          identityImages: testIdentityImages(),
        },
      }, { ...storeManagerAuthorization, 'idempotency-key': 'store-manager-employee-create-0001' }), env)
      expect(storeEmployeeCreated.status).toBe(201)
      expect(await storeEmployeeCreated.json()).toMatchObject({
        version: 6, employee: { id: 'TNV-001', unit: 'store', storeId: 'S01' }, user: { role: 'employee' },
      })

      const managerScheduleDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'schedule.assign', expectedVersion: 6,
        payload: {
          storeId: 'S01', date: '2026-08-15', employeeIds: ['QLCH-001'], shiftIds: ['SHIFT-01'],
        },
      }, { ...storeManagerAuthorization, 'idempotency-key': 'store-manager-own-schedule-denied-0001' }), env)
      expect(managerScheduleDenied.status).toBe(400)
      expect(await managerScheduleDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_STORE_MISMATCH' } })

      const crossStoreEmployee = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 6,
        payload: {
          storeId: 'S02', unit: 'store', name: 'Vượt phạm vi', phone: '0901000004',
          employmentType: 'Full-Time', monthlySalary: 8_000_000,
        },
      }, { ...storeManagerAuthorization, 'idempotency-key': 'store-manager-cross-store-0001' }), env)
      expect(crossStoreEmployee.status).toBe(403)
      expect(await crossStoreEmployee.json()).toMatchObject({ error: { code: 'STORE_SCOPE_FORBIDDEN' } })
      const crossStoreUpdate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'store.update', expectedVersion: 6, payload: { storeId: 'S02', name: 'Không được sửa' },
      }, { ...storeManagerAuthorization, 'idempotency-key': 'store-manager-cross-store-update-0001' }), env)
      expect(crossStoreUpdate.status).toBe(403)

      const storeUsers = await worker.fetch(new Request('https://idosi.example/api/users', {
        headers: storeManagerAuthorization,
      }), env)
      expect((await storeUsers.json()).users).toEqual([
        expect.objectContaining({ role: 'employee', storeId: 'S01', employeeId: 'TNV-001' }),
      ])
      for (const [index, command] of [
        {
          type: 'salary_adjustment.create',
          payload: { employeeId: 'TNV-001', period: '2026-08', type: 'Thưởng khác', amount: 500_000 },
        },
        {
          type: 'salary_advance.create',
          payload: { employeeId: 'TNV-001', period: '2026-08', amount: 100_000 },
        },
        {
          type: 'store_salary_config.set',
          payload: {
            employeeId: 'TNV-001', storeId: 'S01', thresholdHours: 208,
            regularHourlyRateVnd: 29_000, excessHourlyRateVnd: 25_000, effectiveFrom: '2026-08',
          },
        },
        { type: 'payroll.close', payload: { storeId: 'S01', period: '2026-08' } },
        { type: 'payroll.pay', payload: { storeId: 'S01', period: '2026-08' } },
        { type: 'payroll.lock', payload: { storeId: 'S01', period: '2026-08' } },
      ].entries()) {
        const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          ...command, expectedVersion: 6,
        }, {
          ...storeManagerAuthorization,
          'idempotency-key': `store-manager-payroll-mutation-denied-${String(index).padStart(4, '0')}`,
        }), env)
        expect(denied.status, command.type).toBe(403)
        expect(await denied.json(), command.type).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })
      }
      expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 6 })

      const supportSalaryConfig = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'store_salary_config.set', expectedVersion: 6,
        payload: {
          employeeId: 'TNV-001', storeId: 'S01', thresholdHours: 208,
          regularHourlyRateVnd: 29_000, excessHourlyRateVnd: 25_000, effectiveFrom: '2026-08',
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-store-salary-config-0001' }), env)
      expect(supportSalaryConfig.status).toBe(201)
      expect(await supportSalaryConfig.json()).toMatchObject({
        version: 7,
        salaryConfig: {
          employeeId: 'TNV-001', storeId: 'S01', thresholdHours: 208,
          regularHourlyRateVnd: 29_000, excessHourlyRateVnd: 25_000, effectiveFrom: '2026-08',
        },
      })

      const supportAdjustment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'salary_adjustment.create', expectedVersion: 7,
        payload: {
          employeeId: 'TNV-001', period: '2026-08', type: 'Thưởng khác', amount: 500_000,
          note: 'HTKD quản lý cửa hàng vận hành',
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-cross-store-salary-adjustment-0001' }), env)
      expect(supportAdjustment.status).toBe(201)
      expect(await supportAdjustment.json()).toMatchObject({
        version: 8,
        adjustment: { employeeId: 'TNV-001', storeId: 'S01', amount: 500_000 },
      })

      const payrollClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 8, payload: { storeId: 'S01', period: '2026-08' },
      }, { ...supportAuthorization, 'idempotency-key': 'support-cross-store-payroll-close-0001' }), env)
      expect(payrollClosed.status).toBe(201)
      expect((await payrollClosed.json()).period.rows.map(({ employeeId }) => employeeId)).toEqual(['TNV-001'])

      const payrollPaid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.pay', expectedVersion: 9, payload: { storeId: 'S01', period: '2026-08' },
      }, { ...supportAuthorization, 'idempotency-key': 'support-cross-store-payroll-pay-0001' }), env)
      expect(payrollPaid.status).toBe(200)
      expect(await payrollPaid.json()).toMatchObject({ version: 10, period: { status: 'Đã chi' } })

      const supportLockDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.lock', expectedVersion: 10, payload: { storeId: 'S01', period: '2026-08' },
      }, { ...supportAuthorization, 'idempotency-key': 'support-payroll-lock-denied-0001' }), env)
      expect(supportLockDenied.status).toBe(403)
      expect(await supportLockDenied.json()).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })

      const payrollLocked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.lock', expectedVersion: 10, payload: { storeId: 'S01', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'admin-payroll-lock-after-support-pay-0001' }), env)
      expect(payrollLocked.status).toBe(200)
      expect(await payrollLocked.json()).toMatchObject({ version: 11, period: { status: 'Đã khóa' } })

      const storeManagerState = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: storeManagerAuthorization,
      }), env)
      const storeManagerProjection = (await storeManagerState.json()).state
      expect(storeManagerProjection.stores.map(({ id }) => id)).toEqual(['S01'])
      expect(storeManagerProjection.employees.map(({ id }) => id).sort()).toEqual(['QLCH-001', 'TNV-001'])
      expect(storeManagerProjection.attendance).toEqual([])
      expect(storeManagerProjection.payrollPeriods).toEqual([
        expect.objectContaining({ storeId: 'S01', period: '2026-08', status: 'Đã khóa' }),
      ])
      expect(JSON.stringify(storeManagerProjection)).not.toContain('HTKD-001')
    } finally {
      vi.useRealTimers()
    }
  })

  it('prorates business-support monthly salary by worked days and excludes store managers', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-support-payroll' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'support-payroll-admin-password',
      initialState: {
        employees: [
          {
            id: 'HTKD001', code: 'HTKD001', name: 'Hỗ trợ Kinh doanh',
            storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc',
            employmentType: 'Chính thức', payBasis: 'monthly', monthlySalary: 12_000_000,
            standardWorkDays: 20, monthlyWorkdayTargets: { '2026-08': 20 },
          },
          {
            id: 'QL-INTERNAL-001', code: 'QL-INTERNAL-001', name: 'Quản lý không tính lương',
            storeId: 'BUSINESS_SUPPORT', unit: 'store_manager', status: 'Đang làm việc',
            payBasis: 'monthly', monthlySalary: 99_000_000, standardWorkDays: 20,
          },
        ],
        attendance: [
          {
            id: 'ATT-SUPPORT-01', employeeId: 'HTKD001', storeId: 'BUSINESS_SUPPORT',
            date: '2026-08-01', workDate: '2026-08-01', checkInAt: '2026-08-01T01:00:00.000Z',
            checkOutAt: '2026-08-01T10:00:00.000Z', workedSeconds: 32_400, workdayCredit: 1,
          },
          {
            id: 'ATT-SUPPORT-02', employeeId: 'HTKD001', storeId: 'BUSINESS_SUPPORT',
            date: '2026-08-02', workDate: '2026-08-02', checkInAt: '2026-08-02T01:00:00.000Z',
            checkOutAt: '2026-08-02T10:00:00.000Z', workedSeconds: 32_400, workdayCredit: 1,
          },
          {
            id: 'ATT-MANAGER-01', employeeId: 'QL-INTERNAL-001', storeId: 'BUSINESS_SUPPORT',
            date: '2026-08-01', workDate: '2026-08-01', checkInAt: '2026-08-01T01:00:00.000Z',
            checkOutAt: '2026-08-01T10:00:00.000Z', workedSeconds: 32_400, workdayCredit: 1,
          },
        ],
        payrollPeriods: [], orders: [], expenseEntries: [], salaryAdjustments: [], salaryAdvances: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'support-payroll-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const payrollClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1,
      payload: { storeId: 'BUSINESS_SUPPORT', period: '2026-08' },
    }, { ...adminAuthorization, 'idempotency-key': 'support-payroll-close-0001' }), env)
    expect(payrollClosed.status).toBe(201)
    const payroll = (await payrollClosed.json()).period
    expect(payroll.rows).toEqual([
      expect.objectContaining({
        employeeId: 'HTKD001', workedDays: 2, requiredWorkingDays: 20,
        baseSalary: 1_200_000, gross: 1_200_000, remaining: 1_200_000,
        salarySnapshot: expect.objectContaining({
          monthlySalary: 12_000_000, standardWorkDays: 20, proratedByWorkedDays: true,
        }),
      }),
    ])
    expect(payroll).not.toHaveProperty('kpiSnapshot')
    expect(JSON.stringify(payroll)).not.toContain('QL-INTERNAL-001')
  })

  it('uses preserved legacy defaults at the 208-hour boundary for Dosii and SM TNV', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-tiered-legacy-payroll' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'tiered-legacy-payroll-password',
      initialState: {
        stores: [
          { id: 'DOSII-01', short: 'Dosii NTL', name: 'Dosii NTL', status: 'Đang hoạt động' },
          { id: 'SM-01', short: 'SM TNV', name: 'SM TNV', status: 'Đang hoạt động' },
        ],
        employees: [
          {
            id: 'DOSII-FT-01', name: 'Nhân viên Dosii legacy', storeId: 'DOSII-01', unit: 'store',
            employmentType: 'Full-Time', monthlySalary: 8_000_000, baseSalary: 8_000_000,
            requiredMonthlyHours: 160, status: 'Đang làm việc',
          },
          {
            id: 'SM-FT-01', name: 'Nhân viên SM legacy', storeId: 'SM-01', unit: 'store',
            employmentType: 'Full-Time', monthlySalary: 9_000_000, baseSalary: 9_000_000,
            requiredMonthlyHours: 176, status: 'Đang làm việc',
          },
        ],
        attendance: [
          {
            id: 'ATT-DOSII-208', employeeId: 'DOSII-FT-01', storeId: 'DOSII-01', workDate: '2026-08-20',
            checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T09:00:00.000Z', hours: 208,
          },
          {
            id: 'ATT-SM-209', employeeId: 'SM-FT-01', storeId: 'SM-01', workDate: '2026-08-20',
            checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T09:00:00.000Z', hours: 209,
          },
        ],
        payrollPeriods: [], payrollPayments: [], salaryAdjustments: [], salaryAdvances: [],
        expenseEntries: [], cashTransactions: [], orders: [], storeEmployeeSalaryConfigs: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'tiered-legacy-payroll-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const dosiiClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'DOSII-01', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'tiered-legacy-dosii-close-0001' }), env)
    expect(dosiiClosed.status).toBe(201)
    expect(await dosiiClosed.json()).toMatchObject({
      period: { rows: [expect.objectContaining({
        employeeId: 'DOSII-FT-01', hours: 208, baseSalary: 6_032_000,
        salarySnapshot: expect.objectContaining({
          monthlySalary: 8_000_000,
          baseSalary: 8_000_000,
          requiredMonthlyHours: 160,
          salaryConfigSource: 'legacy-default',
          storePolicy: 'DOSII',
          standardHours: 208,
          excessHours: 0,
        }),
      })] },
    })

    const smClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 2, payload: { storeId: 'SM-01', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'tiered-legacy-sm-close-0001' }), env)
    expect(smClosed.status).toBe(201)
    expect(await smClosed.json()).toMatchObject({
      period: { rows: [expect.objectContaining({
        employeeId: 'SM-FT-01', hours: 209, baseSalary: 6_058_000,
        salarySnapshot: expect.objectContaining({
          monthlySalary: 9_000_000,
          baseSalary: 9_000_000,
          requiredMonthlyHours: 176,
          salaryConfigSource: 'legacy-default',
          storePolicy: 'SM_TNV',
          standardHours: 208,
          excessHours: 1,
        }),
      })] },
    })
  })

  it('authorizes, snapshots, invalidates, and locks employee salary configurations by period', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-tiered-config-payroll' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'tiered-config-payroll-password',
      initialState: {
        stores: [{ id: 'DOSII-01', short: 'Dosii KVC', name: 'Dosii KVC', status: 'Đang hoạt động' }],
        employees: [
          {
            id: 'DOSII-NEW-FT', name: 'Nhân viên Full-Time mới', storeId: 'DOSII-01', unit: 'store',
            employmentType: 'Full-Time', storeSalaryConfigRequired: true, status: 'Đang làm việc',
          },
          {
            id: 'DOSII-PT', name: 'Nhân viên Part-Time', storeId: 'DOSII-01', unit: 'store',
            employmentType: 'Part-Time', hourlyRate: 25_000, salary: 25_000, status: 'Đang làm việc',
          },
          {
            id: 'DOSII-MANAGER', name: 'Quản lý Dosii', storeId: 'DOSII-01', unit: 'store_manager', status: 'Đang làm việc',
          },
          {
            id: 'HTKD-SALARY', name: 'Hỗ trợ lương', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc',
          },
        ],
        attendance: [{
          id: 'ATT-DOSII-209', employeeId: 'DOSII-NEW-FT', storeId: 'DOSII-01', workDate: '2026-08-20',
          checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T09:00:00.000Z', hours: 209,
        }],
        payrollPeriods: [], payrollPayments: [], salaryAdjustments: [], salaryAdvances: [],
        expenseEntries: [], cashTransactions: [], orders: [], storeEmployeeSalaryConfigs: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'tiered-config-payroll-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    for (const user of [
      { username: 'salary.support', password: 'salary-support-password', role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-SALARY' },
      { username: 'salary.manager', password: 'salary-manager-password', role: 'store_manager', storeId: 'DOSII-01', employeeId: 'DOSII-MANAGER' },
    ]) {
      const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create', payload: { ...user, displayName: user.username },
      }, { ...adminAuthorization, 'idempotency-key': `tiered-config-${user.role}-user-0001` }), env)
      expect(created.status).toBe(201)
    }
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'salary.support', password: 'salary-support-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'salary.manager', password: 'salary-manager-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    const configPayload = {
      employeeId: 'DOSII-NEW-FT', storeId: 'DOSII-01', thresholdHours: 208,
      regularHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000, effectiveFrom: '2026-08',
    }

    const managerDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store_salary_config.set', expectedVersion: 1, payload: configPayload,
    }, { ...managerAuthorization, 'idempotency-key': 'tiered-config-manager-denied-0001' }), env)
    expect(managerDenied.status).toBe(403)
    expect(await managerDenied.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })

    const managerSmuggleDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 1,
      payload: { employeeId: 'DOSII-NEW-FT', regularHourlyRateVnd: 99_000 },
    }, { ...managerAuthorization, 'idempotency-key': 'tiered-config-manager-smuggle-denied-0001' }), env)
    expect(managerSmuggleDenied.status).toBe(403)
    expect(await managerSmuggleDenied.json()).toMatchObject({ error: { code: 'STORE_SALARY_CONFIG_FORBIDDEN' } })

    const managerPayModelChangeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 1,
      payload: { employeeId: 'DOSII-PT', employmentType: 'Full-Time' },
    }, { ...managerAuthorization, 'idempotency-key': 'tiered-config-manager-pay-model-denied-0001' }), env)
    expect(managerPayModelChangeDenied.status).toBe(403)
    expect(await managerPayModelChangeDenied.json()).toMatchObject({ error: { code: 'STORE_SALARY_CONFIG_FORBIDDEN' } })

    const partTimeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store_salary_config.set', expectedVersion: 1,
      payload: { ...configPayload, employeeId: 'DOSII-PT' },
    }, { ...adminAuthorization, 'idempotency-key': 'tiered-config-part-time-denied-0001' }), env)
    expect(partTimeDenied.status).toBe(409)
    expect(await partTimeDenied.json()).toMatchObject({ error: { code: 'FULL_TIME_EMPLOYEE_REQUIRED' } })

    const configured = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store_salary_config.set', expectedVersion: 1, payload: configPayload,
    }, { ...adminAuthorization, 'idempotency-key': 'tiered-config-admin-set-0001' }), env)
    expect(configured.status).toBe(201)
    expect(await configured.json()).toMatchObject({
      version: 2,
      salaryConfig: { ...configPayload, standardHourlyRateVnd: 30_000, version: 1 },
    })

    const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 2, payload: { storeId: 'DOSII-01', period: '2026-08' },
    }, { ...adminAuthorization, 'idempotency-key': 'tiered-config-close-0001' }), env)
    expect(closed.status).toBe(201)
    expect(await closed.json()).toMatchObject({
      version: 3,
      period: { rows: [expect.objectContaining({
        employeeId: 'DOSII-NEW-FT', baseSalary: 6_267_000,
        salarySnapshot: expect.objectContaining({
          salaryConfigSource: 'configured', standardHours: 208, excessHours: 1,
          salaryConfig: expect.objectContaining({
            standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000, effectiveFrom: '2026-08',
          }),
        }),
      }), expect.objectContaining({ employeeId: 'DOSII-PT', baseSalary: 0 })] },
    })

    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store_salary_config.set', expectedVersion: 3,
      payload: { ...configPayload, expectedVersion: 1, regularHourlyRateVnd: 31_000, excessHourlyRateVnd: 28_000 },
    }, { ...supportAuthorization, 'idempotency-key': 'tiered-config-support-update-0001' }), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ version: 4, salaryConfig: { version: 2, regularHourlyRateVnd: 31_000 } })
    expect(readHydratedState(env.DB.database).payrollPeriods[0]).toMatchObject({
      needsReclose: true, invalidationReason: 'store_salary_config.set',
    })

    const reclosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 4, payload: { storeId: 'DOSII-01', period: '2026-08' },
    }, { ...adminAuthorization, 'idempotency-key': 'tiered-config-reclose-0001' }), env)
    expect(reclosed.status).toBe(200)
    expect(await reclosed.json()).toMatchObject({
      version: 5,
      period: { rows: expect.arrayContaining([
        expect.objectContaining({ employeeId: 'DOSII-NEW-FT', baseSalary: 6_476_000 }),
      ]) },
    })

    const paid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay', expectedVersion: 5, payload: { storeId: 'DOSII-01', period: '2026-08' },
    }, { ...adminAuthorization, 'idempotency-key': 'tiered-config-pay-0001' }), env)
    expect(paid.status).toBe(200)
    const paidChangeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store_salary_config.set', expectedVersion: 6,
      payload: { ...configPayload, expectedVersion: 2, regularHourlyRateVnd: 32_000 },
    }, { ...supportAuthorization, 'idempotency-key': 'tiered-config-paid-change-denied-0001' }), env)
    expect(paidChangeDenied.status).toBe(409)
    expect(await paidChangeDenied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })
  })

  it('accrues the manager revenue bonus as exactly 2% of final monthly profit without duplicates', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-manager-revenue-bonus' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'manager-revenue-bonus-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Dosii Manager Bonus', status: 'Đang hoạt động' }],
        employees: [
          {
            id: 'E01', name: 'Nhân viên bán hàng', storeId: 'S01', unit: 'store',
            employmentType: 'Part-Time', hourlyRate: 10_000, salary: 10_000, status: 'Đang làm việc',
          },
          {
            id: 'QL01', name: 'Quản lý cửa hàng', storeId: 'S01', unit: 'store_manager',
            linkedEmployeeId: 'E01', status: 'Đang làm việc',
          },
        ],
        attendance: [{
          id: 'ATT-MANAGER-BONUS', employeeId: 'E01', storeId: 'S01', date: '2026-08-20',
          checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T11:00:00.000Z', hours: 10,
        }],
        orders: [{
          id: 'ORDER-MANAGER-BONUS', storeId: 'S01', amount: 1_322_000,
          status: 'Hoàn tất', createdAt: '2026-08-20T03:00:00.000Z',
        }],
        expenseEntries: [{
          id: 'EXP-MANAGER-BONUS', storeId: 'S01', amount: 100_000,
          sourceType: 'fixed-expense', sourceId: 'FIXED-MANAGER-BONUS', recognized: true,
          occurredAt: '2026-08-20T03:00:00.000Z',
        }],
        compensationEntries: [{
          id: 'CMP-MANAGER-ALLOWANCE', type: 'ALLOWANCE', targetUnit: 'store_manager',
          employeeId: 'QL01', employeeName: 'Quản lý cửa hàng', storeId: 'S01', amountVnd: 102_000,
          effectiveDate: '2026-08-01', period: '2026-08', status: 'APPROVED', version: 1,
        }],
        payrollPeriods: [], payrollPayments: [], cashTransactions: [], salaryAdjustments: [], salaryAdvances: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'manager-revenue-bonus-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'S01', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'manager-revenue-bonus-close-0001' }), env)
    expect(closed.status).toBe(201)
    const closedBody = await closed.json()
    expect(closedBody).toMatchObject({
      version: 2,
      period: {
        managerRevenueBonus: {
          managerId: 'QL01', managerCompensationVnd: 102_000,
          profitBeforeManagerBonusVnd: 1_020_000, bonusVnd: 20_000, finalProfitVnd: 1_000_000,
        },
        financeSnapshot: {
          revenue: 1_322_000, nonPayrollExpense: 100_000,
          employeePayrollExpense: 100_000, managerCompensationExpense: 102_000,
          managerRevenueBonusVnd: 20_000, totalManagerExpense: 122_000,
          earnedPayrollExpense: 222_000, netPayrollExpense: 222_000,
          expense: 322_000, profit: 1_000_000,
        },
      },
      payrollAccrual: {
        amount: 222_000, managerCompensationExpense: 102_000, managerRevenueBonusVnd: 20_000,
      },
      managerRevenueBonusEntry: {
        type: 'REVENUE', targetUnit: 'store_manager', employeeId: 'QL01', storeId: 'S01',
        amountVnd: 20_000, status: 'APPROVED', sourceType: 'manager-revenue-bonus', version: 1,
      },
    })
    const entryId = closedBody.managerRevenueBonusEntry.id

    const reclosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 2, payload: { storeId: 'S01', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'manager-revenue-bonus-reclose-0001' }), env)
    expect(reclosed.status).toBe(200)
    expect(await reclosed.json()).toMatchObject({
      version: 3,
      period: { financeSnapshot: { profit: 1_000_000, managerRevenueBonusVnd: 20_000 } },
      managerRevenueBonusEntry: { id: entryId, amountVnd: 20_000, version: 1 },
    })
    const state = readHydratedState(env.DB.database)
    expect(state.compensationEntries.filter((entry) => (
      entry.sourceType === 'manager-revenue-bonus' && !entry.voidedAt
    ))).toEqual([expect.objectContaining({ id: entryId, employeeId: 'QL01', amountVnd: 20_000 })])
    expect(state.expenseEntries.filter(({ sourceType }) => sourceType === 'payroll-accrual')).toEqual([
      expect.objectContaining({ amount: 222_000, managerRevenueBonusVnd: 20_000 }),
    ])
  })

  it('counts legacy store-manager compensation exactly once across employee and manager payroll', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-legacy-manager-compensation' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'legacy-manager-compensation-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Dosii Legacy Manager', status: 'Đang hoạt động' }],
        employees: [{
          id: 'E01', name: 'Quản lý legacy', storeId: 'S01', unit: 'store', isStoreManager: true,
          position: 'Quản lý cửa hàng', employmentType: 'Part-Time', hourlyRate: 10_000,
          salary: 10_000, status: 'Đang làm việc',
        }],
        attendance: [{
          id: 'ATT-LEGACY-MANAGER', employeeId: 'E01', storeId: 'S01', date: '2026-08-20',
          checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T11:00:00.000Z', hours: 10,
        }],
        orders: [{
          id: 'ORDER-LEGACY-MANAGER', storeId: 'S01', amount: 1_372_000,
          status: 'Hoàn tất', createdAt: '2026-08-20T03:00:00.000Z',
        }],
        expenseEntries: [{
          id: 'EXP-LEGACY-MANAGER', storeId: 'S01', amount: 100_000,
          sourceType: 'fixed-expense', sourceId: 'FIXED-LEGACY-MANAGER', recognized: true,
          occurredAt: '2026-08-20T03:00:00.000Z',
        }],
        compensationEntries: [{
          id: 'CMP-EMPLOYEE', type: 'MANUAL', targetUnit: 'store', employeeId: 'E01', storeId: 'S01',
          amountVnd: 50_000, effectiveDate: '2026-08-01', period: '2026-08', status: 'APPROVED',
        }, {
          id: 'CMP-MANAGER', type: 'ALLOWANCE', targetUnit: 'store_manager', employeeId: 'E01', storeId: 'S01',
          amountVnd: 102_000, effectiveDate: '2026-08-01', period: '2026-08', status: 'APPROVED',
        }],
        payrollPeriods: [], payrollPayments: [], cashTransactions: [], salaryAdjustments: [], salaryAdvances: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'legacy-manager-compensation-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'S01', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'legacy-manager-compensation-close-0001' }), env)
    expect(closed.status).toBe(201)
    expect(await closed.json()).toMatchObject({
      period: {
        rows: [expect.objectContaining({ employeeId: 'E01', baseSalary: 100_000, manualBonusVnd: 50_000, gross: 150_000 })],
        managerRevenueBonus: {
          managerId: 'E01', managerCompensationVnd: 102_000,
          profitBeforeManagerBonusVnd: 1_020_000, bonusVnd: 20_000, finalProfitVnd: 1_000_000,
        },
        financeSnapshot: {
          revenue: 1_372_000, nonPayrollExpense: 100_000, employeePayrollExpense: 150_000,
          managerCompensationExpense: 102_000, managerRevenueBonusVnd: 20_000,
          earnedPayrollExpense: 272_000, expense: 372_000, profit: 1_000_000,
        },
      },
    })
  })

  it('rejects manager revenue bonus calculation when legacy data has multiple active managers', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-manager-revenue-bonus-conflict' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'manager-revenue-conflict-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Dosii Manager Conflict', status: 'Đang hoạt động' }],
        employees: [
          { id: 'QL01', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc' },
          { id: 'QL02', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc' },
        ],
        payrollPeriods: [], compensationEntries: [], expenseEntries: [], orders: [], attendance: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'manager-revenue-conflict-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'S01', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'manager-revenue-conflict-close-0001' }), env)
    expect(denied.status).toBe(409)
    expect(await denied.json()).toMatchObject({
      error: { code: 'STORE_MANAGER_MULTIPLE_ACTIVE', details: { storeId: 'S01', managerCount: 2 } },
    })
  })

  it('rejects reactivating a second manager for the same store', async () => {
    const identityImages = {
      front: { key: 'identity/QL01/front.png' },
      back: { key: 'identity/QL01/back.png' },
    }
    const manager = (id, status) => ({
      id, code: id, name: `Quản lý ${id}`, phone: id === 'QL01' ? '0900000001' : '0900000002',
      cccd: id === 'QL01' ? '079123456701' : '079123456702', address: 'TP.HCM', startDate: '2026-08-01',
      employmentType: 'Full-Time', position: 'Quản lý cửa hàng', storeId: 'S01', unit: 'store_manager',
      status, identityImages,
    })
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-manager-reactivation-conflict' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'manager-reactivation-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Dosii Manager Reactivation', status: 'Đang hoạt động' }],
        employees: [manager('QL01', 'Đang làm việc'), manager('QL02', 'Tạm nghỉ')],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'manager-reactivation-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 1,
      payload: { employeeId: 'QL02', status: 'Đang làm việc' },
    }, { ...authorization, 'idempotency-key': 'manager-reactivation-conflict-0001' }), env)
    expect(denied.status).toBe(409)
    expect(await denied.json()).toMatchObject({ error: { code: 'STORE_MANAGER_EXISTS' } })
  })

  it('snapshots assigned shifts and keeps schedule history immutable across shift changes', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-shift-snapshot' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'shift-snapshot-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01', short: 'S01' }],
        employees: [{ id: 'E01', name: 'Nhân viên 01', storeId: 'S01' }],
        shiftDefinitions: [],
        schedule: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'shift-snapshot-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const shiftCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'shift_definition.create',
      expectedVersion: 1,
      payload: { storeId: 'S01', name: 'Ca sáng gốc', date: '2026-08-14', start: '07:00', end: '12:00' },
    }, { ...authorization, 'idempotency-key': 'snapshot-shift-create-0001' }), env)
    expect(shiftCreated.status).toBe(201)
    const shiftCreatedBody = await shiftCreated.json()
    expect(shiftCreatedBody).toMatchObject({
      version: 2,
      shift: { name: 'Ca sáng gốc', start: '07:00', end: '12:00', durationMinutes: 300, durationHours: 5, version: 1 },
    })
    const shiftId = shiftCreatedBody.shift.id

    const wrongDate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'schedule.assign',
      expectedVersion: 2,
      payload: { storeId: 'S01', date: '2026-08-15', employeeIds: ['E01'], shiftIds: [shiftId] },
    }, { ...authorization, 'idempotency-key': 'snapshot-wrong-date-0001' }), env)
    expect(wrongDate.status).toBe(400)
    expect(await wrongDate.json()).toMatchObject({ error: { code: 'SHIFT_DATE_MISMATCH' } })

    const assigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'schedule.assign',
      expectedVersion: 2,
      payload: { storeId: 'S01', date: '2026-08-14', employeeIds: ['E01'], shiftIds: [shiftId] },
    }, { ...authorization, 'idempotency-key': 'snapshot-schedule-assign-0001' }), env)
    expect(assigned.status).toBe(200)
    const assignedBody = await assigned.json()
    const originalSnapshot = assignedBody.assignments[0].shiftSnapshots[0]
    expect(originalSnapshot).toEqual({
      id: shiftId,
      name: 'Ca sáng gốc',
      start: '07:00',
      end: '12:00',
      time: '07:00 - 12:00',
      color: shiftCreatedBody.shift.color,
      durationMinutes: 300,
      durationHours: 5,
      date: '2026-08-14',
      version: 1,
    })

    const shiftUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'shift_definition.update',
      expectedVersion: 3,
      payload: { shiftId, storeId: 'S01', name: 'Ca sáng đã đổi', start: '08:00', end: '13:30' },
    }, { ...authorization, 'idempotency-key': 'snapshot-shift-update-0001' }), env)
    expect(shiftUpdated.status).toBe(200)
    expect(await shiftUpdated.json()).toMatchObject({
      version: 4,
      shift: { id: shiftId, name: 'Ca sáng đã đổi', start: '08:00', end: '13:30', durationMinutes: 330, version: 2 },
    })

    const scheduleReplaced = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'schedule.replace_day',
      expectedVersion: 4,
      payload: {
        storeId: 'S01', date: '2026-08-14', assignments: [{ employeeId: 'E01', shiftIds: [shiftId], note: 'Giữ ca cũ' }],
      },
    }, { ...authorization, 'idempotency-key': 'snapshot-schedule-replace-0001' }), env)
    expect(scheduleReplaced.status).toBe(200)
    const scheduleReplacedBody = await scheduleReplaced.json()
    expect(scheduleReplacedBody.version).toBe(5)
    expect(scheduleReplacedBody.assignments[0].shiftSnapshots).toEqual([originalSnapshot])

    const shiftDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'shift_definition.delete', expectedVersion: 5, payload: { shiftId, storeId: 'S01' },
    }, { ...authorization, 'idempotency-key': 'snapshot-shift-delete-0001' }), env)
    expect(shiftDeleted.status).toBe(200)
    expect(await shiftDeleted.json()).toMatchObject({ version: 6, shift: { id: shiftId, active: false, deletedAt: expect.any(String) } })

    const finalStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
    const finalState = (await finalStateResponse.json()).state
    expect(finalState.schedule[0]).toMatchObject({ employeeId: 'E01', shiftIds: [shiftId], note: 'Giữ ca cũ' })
    expect(finalState.schedule[0].shiftSnapshots).toEqual([originalSnapshot])
  })

  it('lets Admin and business support edit scoped attendance with payroll and audit invariants', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-attendance-edit' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'attendance-edit-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01', short: 'S01' }],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'VP-001', name: 'Nhân viên văn phòng', storeId: 'OFFICE', unit: 'office' },
          { id: 'HTKD-ATTENDANCE', code: 'HTKD-ATTENDANCE', name: 'Manager', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
        ],
        shiftDefinitions: [{ id: 'SHIFT-01', storeId: 'S01', name: 'Ca ngày', start: '08:00', end: '17:00', active: true }],
        attendance: [
          {
            id: 'ATT-AUG', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01', shiftStart: '08:00', shiftEnd: '17:00',
            date: '2026-08-14', workDate: '2026-08-14', attendanceDate: '2026-08-14',
            checkIn: '08:20', checkInTime: '08:20', checkInAt: '2026-08-14T01:20:00.000Z',
            checkOut: '17:00', checkOutTime: '17:00', checkOutAt: '2026-08-14T10:00:00.000Z',
            arrivalTag: 'Đi trễ', status: 'Đi trễ', minutesLate: 20, workedSeconds: 31_200, hours: 26 / 3,
            revenue: 2_500_000, cash: 1_000_000, transfer: 1_500_000, orderCount: 3,
          },
          {
            id: 'ATT-SEP', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01', shiftStart: '08:00', shiftEnd: '17:00',
            date: '2026-09-14', workDate: '2026-09-14', checkIn: '08:00', checkInAt: '2026-09-14T01:00:00.000Z',
            checkOut: '17:00', checkOutAt: '2026-09-14T10:00:00.000Z', workedSeconds: 32_400, hours: 9,
          },
          {
            id: 'ATT-OFFICE', employeeId: 'VP-001', storeId: 'OFFICE', shiftStart: '08:00', shiftEnd: '17:00',
            date: '2026-08-14', workDate: '2026-08-14', checkIn: '08:00', checkInAt: '2026-08-14T01:00:00.000Z',
            checkOut: '17:00', checkOutAt: '2026-08-14T10:00:00.000Z', workedSeconds: 32_400, hours: 9,
          },
        ],
        orders: [
          {
            id: 'ORDER-ATT-CASH', code: 'S01-00001', storeId: 'S01', employeeId: 'E01', attendanceId: 'ATT-AUG',
            amount: 1_000_000, customerName: 'Khách 1', paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order',
            createdAt: '2026-08-14T02:00:00.000Z', deletedAt: null,
          },
          {
            id: 'ORDER-ATT-TRANSFER', code: 'S01-00002', storeId: 'S01', employeeId: 'E01', attendanceId: 'ATT-AUG',
            amount: 1_500_000, customerName: 'Khách 2', paymentMethod: 'Chuyển khoản', status: 'Hoàn tất', source: 'order',
            createdAt: '2026-08-14T03:00:00.000Z', deletedAt: null,
          },
        ],
        payrollPeriods: [
          { id: 'PAY-AUG', storeId: 'S01', period: '2026-08', status: 'Đã chốt', needsReclose: false },
          { id: 'PAY-SEP', storeId: 'S01', period: '2026-09', status: 'Đã chi', confirmedAt: '2026-09-30T00:00:00.000Z' },
        ],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'attendance-edit-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const managerCreate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', expectedVersion: 0,
      payload: { role: 'business_support', employeeId: 'HTKD-ATTENDANCE', username: 'attendance.manager', password: 'attendance-manager-password', displayName: 'Manager' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-manager-create-0001' }), env)
    expect(managerCreate.status).toBe(201)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'attendance.manager', password: 'attendance-manager-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

    const managerUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: { attendanceId: 'ATT-AUG', checkIn: '08:15', checkOut: '17:05', reason: 'Đối soát theo yêu cầu cửa hàng' },
    }, { ...managerAuthorization, 'idempotency-key': 'attendance-support-update-0001' }), env)
    expect(managerUpdated.status).toBe(200)
    expect(await managerUpdated.json()).toMatchObject({
      version: 2,
      attendance: { id: 'ATT-AUG', checkIn: '08:15', checkOut: '17:05' },
      audit: { actor: { role: 'business_support' } },
    })
    const officeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: { attendanceId: 'ATT-OFFICE', checkIn: '08:05', checkOut: '17:00', reason: 'Không được sửa khối văn phòng' },
    }, { ...managerAuthorization, 'idempotency-key': 'attendance-support-office-denied-0001' }), env)
    expect(officeDenied.status).toBe(403)
    expect(await officeDenied.json()).toMatchObject({ error: { code: 'OFFICE_FORBIDDEN' } })

    const missingReason = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: { attendanceId: 'ATT-AUG', checkIn: '07:55', checkOut: '17:15' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-reason-required-0001' }), env)
    expect(missingReason.status).toBe(400)
    expect(await missingReason.json()).toMatchObject({ error: { code: 'REASON_REQUIRED' } })
    const immutableScope = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: {
        attendanceId: 'ATT-AUG', employeeId: 'E02', checkIn: '07:55', checkOut: '17:15', reason: 'Không được đổi nhân viên',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-scope-immutable-0001' }), env)
    expect(immutableScope.status).toBe(400)
    expect(await immutableScope.json()).toMatchObject({ error: { code: 'ATTENDANCE_SCOPE_IMMUTABLE' } })
    const invalidOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: { attendanceId: 'ATT-AUG', checkIn: '17:00', checkOut: '08:00', reason: 'Sai thứ tự giờ' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-time-invalid-0001' }), env)
    expect(invalidOrder.status).toBe(400)
    expect(await invalidOrder.json()).toMatchObject({ error: { code: 'ATTENDANCE_TIME_ORDER_INVALID' } })

    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: { attendanceId: 'ATT-AUG', date: '2026-08-14', checkIn: '07:55', checkOut: '17:15', reason: 'Đối soát máy chấm công' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-update-success-0001' }), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      version: 3,
      attendance: {
        id: 'ATT-AUG', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01',
        date: '2026-08-14', checkIn: '07:55', checkInAt: '2026-08-14T00:55:00.000Z',
        checkOut: '17:15', checkOutAt: '2026-08-14T10:15:00.000Z',
        arrivalTag: 'Đi sớm', status: 'Đi sớm', minutesLate: 0,
        departureTag: 'Đã ra về', workedSeconds: 33_600, workedMinutes: 560, hours: 28 / 3,
        revenue: 2_500_000, cash: 1_000_000, transfer: 1_500_000, orderCount: 3,
        editReason: 'Đối soát máy chấm công',
      },
    })
    const stateAfterUpdate = readHydratedState(env.DB.database)
    expect(stateAfterUpdate.payrollPeriods.find(({ id }) => id === 'PAY-AUG')).toMatchObject({
      status: 'Đã chốt', needsReclose: true, invalidationReason: 'attendance.update',
    })

    const orderUpdatedAfterAttendance = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update', expectedVersion: 3,
      payload: { orderId: 'ORDER-ATT-TRANSFER', amount: 2_000_000, reason: 'Cập nhật doanh thu sau chỉnh công' },
    }, { ...managerAuthorization, 'idempotency-key': 'attendance-followup-order-update-0001' }), env)
    expect(orderUpdatedAfterAttendance.status).toBe(200)
    expect(await orderUpdatedAfterAttendance.json()).toMatchObject({ version: 4, order: { amount: 2_000_000 } })
    expect(readHydratedState(env.DB.database).attendance.find(({ id }) => id === 'ATT-AUG')).toMatchObject({
      revenue: 3_000_000, cash: 1_000_000, transfer: 2_000_000, orderCount: 2,
    })

    const paidPeriodDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 4,
      payload: { attendanceId: 'ATT-SEP', checkIn: '08:05', checkOut: '17:00', reason: 'Kỳ đã chi' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-paid-denied-0001' }), env)
    expect(paidPeriodDenied.status).toBe(409)
    expect(await paidPeriodDenied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 4 })
    const audit = env.DB.database.prepare("SELECT metadata_json FROM audit_log WHERE action = 'attendance.update' ORDER BY id DESC").get()
    expect(JSON.parse(audit.metadata_json)).toMatchObject({
      reason: 'Đối soát máy chấm công', storeId: 'S01', employeeId: 'E01',
    })

    const resetAttendanceCommand = {
      type: 'operational_reset.restore', expectedVersion: 4,
      payload: {
        dataType: 'attendance', storeId: 'S01', employeeId: 'E01',
        fromDate: '2026-08-14', toDate: '2026-08-14', reason: 'Khôi phục lần chỉnh gần nhất',
      },
    }
    const resetAttendance = await worker.fetch(jsonRequest('https://idosi.example/api/command', resetAttendanceCommand, {
      ...adminAuthorization, 'idempotency-key': 'attendance-operational-reset-0001',
    }), env)
    expect(resetAttendance.status).toBe(200)
    const resetAttendanceBody = await resetAttendance.json()
    expect(resetAttendanceBody).toMatchObject({
      version: 5, restoredCount: 1, restoredIds: ['ATT-AUG'],
      reset: { dataType: 'attendance', storeId: 'S01', employeeId: 'E01', restoredCount: 1 },
      restored: [{ id: 'ATT-AUG', checkIn: '08:15', checkOut: '17:05' }],
    })
    const resetAttendanceReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', resetAttendanceCommand, {
      ...adminAuthorization, 'idempotency-key': 'attendance-operational-reset-0001',
    }), env)
    expect(resetAttendanceReplay.status).toBe(200)
    expect(resetAttendanceReplay.headers.get('idempotency-replayed')).toBe('true')
    expect(await resetAttendanceReplay.json()).toEqual(resetAttendanceBody)
    const stateAfterReset = readHydratedState(env.DB.database)
    expect(stateAfterReset.attendance.find(({ id }) => id === 'ATT-AUG')).toMatchObject({
      checkIn: '08:15', checkOut: '17:05',
      revenue: 3_000_000, cash: 1_000_000, transfer: 2_000_000, orderCount: 2,
    })
    expect(stateAfterReset.attendanceAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'Khôi phục', attendanceId: 'ATT-AUG' }),
      expect.objectContaining({ action: 'Sửa', attendanceId: 'ATT-AUG', restoredAt: expect.any(String) }),
    ]))

    const businessSupportOperationalResetDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...resetAttendanceCommand, expectedVersion: 5,
    }, { ...managerAuthorization, 'idempotency-key': 'business-support-operational-reset-denied-0001' }), env)
    expect(businessSupportOperationalResetDenied.status).toBe(403)
    expect(await businessSupportOperationalResetDenied.json()).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })
  })

  it('restores a pre-deploy attendance correction from the private D1 audit log once', async () => {
    const before = {
      id: 'ATT-LEGACY-D1', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01',
      date: '2026-08-12', workDate: '2026-08-12', attendanceDate: '2026-08-12',
      checkIn: '08:20', checkInTime: '08:20', checkInAt: '2026-08-12T01:20:00.000Z',
      checkOut: '17:00', checkOutTime: '17:00', checkOutAt: '2026-08-12T10:00:00.000Z',
      arrivalTag: 'Đi trễ', departureTag: 'Đã ra về', punctuality: 'Đi trễ', status: 'Đi trễ',
      minutesEarly: 0, minutesLate: 20, workedSeconds: 31_200, workedMinutes: 520, hours: 26 / 3,
      revenue: 900_000, cash: 400_000, transfer: 500_000, orderCount: 2,
    }
    const after = {
      ...before,
      checkIn: '07:55', checkInTime: '07:55', checkInAt: '2026-08-12T00:55:00.000Z',
      checkOut: '17:15', checkOutTime: '17:15', checkOutAt: '2026-08-12T10:15:00.000Z',
      arrivalTag: 'Đi sớm', punctuality: 'Đi sớm', status: 'Đi sớm', minutesEarly: 5, minutesLate: 0,
      workedSeconds: 33_600, workedMinutes: 560, hours: 28 / 3,
      editedAt: '2026-08-13T02:00:00.000Z', editedBy: { id: 'legacy-admin', role: 'admin' },
      editReason: 'Đối soát trước khi nâng cấp', updatedAt: '2026-08-13T02:00:00.000Z',
    }
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-legacy-attendance-audit' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'legacy-attendance-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01' }],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'HTKD-LEGACY', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', unit: 'business_support' },
        ],
        attendance: [after], attendanceAudit: [],
        payrollPeriods: [{ id: 'PAY-LEGACY', storeId: 'S01', period: '2026-08', status: 'Đã chốt', needsReclose: false }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'legacy-attendance-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const adminId = env.DB.database.prepare("SELECT id FROM users WHERE role = 'admin'").get().id
    const metadata = {
      reason: 'Đối soát trước khi nâng cấp', storeId: 'S01', employeeId: 'E01',
      changedFields: ['checkIn', 'checkOut', 'workedSeconds', 'hours'],
    }
    env.DB.database.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      ) VALUES (?, ?, 'admin', 'attendance.update', 'attendance', ?, ?, ?, ?, ?)
    `).run(
      'legacy-attendance-request-0001', adminId, 'ATT-LEGACY-D1',
      JSON.stringify(before), JSON.stringify(after), JSON.stringify(metadata), '2026-08-13T02:00:00.000Z',
    )
    const legacyAuditId = env.DB.database.prepare(`
      SELECT id FROM audit_log WHERE request_id = 'legacy-attendance-request-0001'
    `).get().id

    const supportUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', expectedVersion: 0,
      payload: {
        role: 'business_support', employeeId: 'HTKD-LEGACY', username: 'support.legacy',
        password: 'support-legacy-password', displayName: 'Hỗ trợ KD',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-legacy-user-create-0001' }), env)
    expect(supportUser.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.legacy', password: 'support-legacy-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
    const resetPayload = {
      dataType: 'attendance', storeId: 'S01', employeeId: 'E01',
      fromDate: '2026-08-12', toDate: '2026-08-12', reason: 'Khôi phục bản chỉnh cũ',
    }
    const supportResetDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'operational_reset.restore', expectedVersion: 1, payload: resetPayload,
    }, { ...supportAuthorization, 'idempotency-key': 'legacy-attendance-reset-0001' }), env)
    expect(supportResetDenied.status).toBe(403)
    expect(await supportResetDenied.json()).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })

    const restored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'operational_reset.restore', expectedVersion: 1, payload: resetPayload,
    }, { ...adminAuthorization, 'idempotency-key': 'legacy-attendance-reset-admin-0001' }), env)
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({
      version: 2, restoredCount: 1,
      restored: [{ id: 'ATT-LEGACY-D1', checkIn: '08:20', checkOut: '17:00', revenue: 900_000, orderCount: 2 }],
    })
    let state = readHydratedState(env.DB.database)
    expect(state.attendance[0]).toMatchObject({ checkIn: '08:20', checkOut: '17:00', revenue: 900_000, orderCount: 2 })
    expect(state.attendanceAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'Khôi phục', attendanceId: 'ATT-LEGACY-D1' }),
      expect.objectContaining({
        id: `ata_legacy_${legacyAuditId}`, source: 'd1-audit-log', legacyAuditLogId: legacyAuditId,
        attendanceId: 'ATT-LEGACY-D1', restoredAt: expect.any(String),
      }),
    ]))
    expect(state.payrollPeriods[0]).toMatchObject({ needsReclose: true, invalidationReason: 'operational_reset.restore' })

    const secondReset = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'operational_reset.restore', expectedVersion: 2, payload: resetPayload,
    }, { ...adminAuthorization, 'idempotency-key': 'legacy-attendance-reset-noop-0001' }), env)
    expect(secondReset.status).toBe(200)
    expect(await secondReset.json()).toMatchObject({ version: 2, existing: true, restoredCount: 0, restored: [] })
    state = readHydratedState(env.DB.database)
    expect(state.attendanceAudit.filter(({ id }) => id === `ata_legacy_${legacyAuditId}`)).toHaveLength(1)

    const supportAuditView = await worker.fetch(new Request('https://idosi.example/api/audit', {
      headers: supportAuthorization,
    }), env)
    expect(supportAuditView.status).toBe(200)
    expect((await supportAuditView.json()).audit).toEqual([])
  })

  it('checks an Office employee in and out with server time, location, scoped history, and prorated payroll', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-14T00:55:00.000Z'))
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-office-attendance' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin',
        password: 'office-attendance-admin-password',
        initialState: {
          employees: [{
            id: 'VP001', code: 'VP001', name: 'Nhân viên Văn phòng', phone: '0900000001',
            storeId: 'OFFICE', unit: 'office', isOffice: true, employmentType: 'Chính thức',
            payBasis: 'monthly', monthlySalary: 20_000_000, workStart: '08:00', workEnd: '17:00',
          }, {
            id: 'HTKD-OFFICE', code: 'HTKD-OFFICE', name: 'Manager', storeId: 'BUSINESS_SUPPORT',
            unit: 'business_support', status: 'Đang làm việc', workStart: '08:00', workEnd: '17:00',
          }],
          attendance: [{
            id: 'ATT-OFFICE-HISTORY', employeeId: 'VP001', employeeName: 'Nhân viên Văn phòng',
            storeId: 'OFFICE', unit: 'office', attendanceMode: 'office', date: '2026-08-13',
            workDate: '2026-08-13', attendanceDate: '2026-08-13', shiftId: 'OFFICE_DEFAULT',
            shiftStart: '08:00', shiftEnd: '17:00', checkIn: '08:00', checkInAt: '2026-08-13T01:00:00.000Z',
            checkOut: '17:00', checkOutAt: '2026-08-13T10:00:00.000Z', workedSeconds: 32_400,
            workedMinutes: 540, hours: 9, workdayCredit: 1, arrivalTag: 'Đi đúng giờ', minutesEarly: 0, minutesLate: 0,
            requiredWorkingDaysSnapshot: 24, standardWorkDaysSnapshot: 24,
          }],
          officeAdjustments: [{
            id: 'DCH-OFFICE-HISTORY', employeeId: 'VP001', employeeName: 'Nhân viên Văn phòng',
            date: '2026-08-10', type: 'Phụ cấp', amount: 200_000, content: 'Phụ cấp dữ liệu cũ',
          }],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'office-attendance-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

      const invalidWorkTime = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 1,
        payload: { employeeId: 'VP001', workStart: '18:00', workEnd: '08:00' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-work-time-invalid-0001' }), env)
      expect(invalidWorkTime.status).toBe(400)
      expect(await invalidWorkTime.json()).toMatchObject({ error: { code: 'WORK_TIME_UPDATE_COMMAND_REQUIRED' } })
      const invalidWorkdayPeriod = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 1,
        payload: { employeeId: 'VP001', standardWorkDaysPeriod: '2026-13', standardWorkDays: 20 },
      }, { ...adminAuthorization, 'idempotency-key': 'office-work-period-invalid-0001' }), env)
      expect(invalidWorkdayPeriod.status).toBe(400)
      expect(await invalidWorkdayPeriod.json()).toMatchObject({ error: { code: 'OFFICE_WORK_DAYS_PERIOD_INVALID' } })

      const officeProfileUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 1,
        payload: {
          employeeId: 'VP001',
          standardWorkDaysPeriod: '2026-08', standardWorkDays: 20,
          identityImages: testIdentityImages(),
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-profile-update-0001' }), env)
      expect(officeProfileUpdated.status).toBe(200)
      expect(await officeProfileUpdated.json()).toMatchObject({
        version: 2,
        employee: {
          id: 'VP001', workStart: '08:00', workEnd: '17:00', standardWorkDays: 20,
          standardWorkDaysPeriod: '2026-08', monthlyWorkdayTargets: { '2026-08': 20 },
        },
      })

      const policiesUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'policies.set',
        payload: {
          updates: [
            { key: 'attendance_maintain_max_late_count', value: 1, expectedVersion: 1 },
            { key: 'attendance_improve_min_late_count', value: 2, expectedVersion: 1 },
            { key: 'attendance_improve_min_late_minutes', value: 15, expectedVersion: 1 },
          ],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-policies-update-0001' }), env)
      expect(policiesUpdated.status).toBe(200)
      expect(await policiesUpdated.json()).toMatchObject({
        policies: [
          { key: 'attendance_maintain_max_late_count', value: 1, version: 2 },
          { key: 'attendance_improve_min_late_count', value: 2, version: 2 },
          { key: 'attendance_improve_min_late_minutes', value: 15, version: 2 },
        ],
      })

      const officeUserCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create',
        payload: {
          username: 'office.employee', password: 'office-employee-password', displayName: 'Nhân viên Văn phòng',
          storeId: 'OFFICE', employeeId: 'VP001',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-user-create-0001' }), env)
      expect(officeUserCreated.status).toBe(201)
      const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create',
        payload: { role: 'business_support', employeeId: 'HTKD-OFFICE', username: 'office.manager', password: 'office-manager-password', displayName: 'Manager' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-manager-create-0001' }), env)
      expect(managerCreated.status).toBe(201)
      const officeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'office.employee', password: 'office-employee-password',
      }), env)
      const officeAuthorization = { authorization: `Bearer ${(await officeLogin.json()).token}` }
      const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'office.manager', password: 'office-manager-password',
      }), env)
      const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

      const managerOfficeTakeoverDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 2,
        payload: {
          employeeId: 'VP001', storeId: 'S01', username: 'office.takeover', password: 'office-takeover-password',
        },
      }, { ...managerAuthorization, 'idempotency-key': 'office-manager-takeover-denied-0001' }), env)
      expect(managerOfficeTakeoverDenied.status).toBe(400)
      expect(await managerOfficeTakeoverDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_STORE_IMMUTABLE' } })

      vi.setSystemTime(new Date('2026-08-14T01:15:00.000Z'))
      const missingLocation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 2, payload: {},
      }, { ...officeAuthorization, 'idempotency-key': 'office-location-required-0001' }), env)
      expect(missingLocation.status).toBe(400)
      expect(await missingLocation.json()).toMatchObject({ error: { code: 'LOCATION_REQUIRED' } })

      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 2,
        payload: { location: { latitude: 10.8231, longitude: 106.6297, accuracy: 12, label: 'Văn phòng IDOSI' } },
      }, { ...officeAuthorization, 'idempotency-key': 'office-attendance-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      const checkedInBody = await checkedIn.json()
      expect(checkedInBody).toMatchObject({
        version: 3,
        serverTime: '2026-08-14T01:15:00.000Z',
        attendance: {
          employeeId: 'VP001', storeId: 'OFFICE', attendanceMode: 'office', date: '2026-08-14',
          shiftId: 'full_time', shiftName: 'Giờ hành chính', shiftStart: '08:00', shiftEnd: '17:00',
          shiftSource: 'profile-work-shift', checkIn: '08:15', checkInAt: '2026-08-14T01:15:00.000Z',
          arrivalTag: 'Đi trễ', minutesEarly: 0, minutesLate: 15, requiredWorkingDaysSnapshot: 20,
          standardWorkDaysSnapshot: 20, workdayCredit: 0,
          checkInLocation: {
            latitude: 10.8231, longitude: 106.6297, accuracy: 12, label: 'Văn phòng IDOSI',
            capturedAt: '2026-08-14T01:15:00.000Z',
          },
        },
      })
      const attendanceId = checkedInBody.attendance.id

      vi.setSystemTime(new Date('2026-08-14T10:05:00.000Z'))
      const officeExpenseDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 3,
        payload: {
          attendanceId, expense: 10_000,
          location: { latitude: 10.8232, longitude: 106.6298, accuracy: 10 },
        },
      }, { ...officeAuthorization, 'idempotency-key': 'office-expense-denied-0001' }), env)
      expect(officeExpenseDenied.status).toBe(400)
      expect(await officeExpenseDenied.json()).toMatchObject({ error: { code: 'OFFICE_CHECK_OUT_FIELDS_INVALID' } })
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 3,
        payload: {
          attendanceId,
          location: { latitude: 10.8232, longitude: 106.6298, accuracy: 10, label: 'Văn phòng IDOSI' },
        },
      }, { ...officeAuthorization, 'idempotency-key': 'office-attendance-out-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 4,
        attendance: {
          id: attendanceId, checkOut: '17:05', checkOutAt: '2026-08-14T10:05:00.000Z',
          departureTag: 'Đã ra về', workedSeconds: 31_800, workdayCredit: 1,
          checkOutLocation: { capturedAt: '2026-08-14T10:05:00.000Z' },
        },
        expense: null,
      })

      vi.setSystemTime(new Date('2026-08-14T10:06:00.000Z'))
      const duplicateOfficeDay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 4,
        payload: { location: { latitude: 10.8232, longitude: 106.6298, accuracy: 10 } },
      }, { ...officeAuthorization, 'idempotency-key': 'office-duplicate-day-0001' }), env)
      expect(duplicateOfficeDay.status).toBe(409)
      expect(await duplicateOfficeDay.json()).toMatchObject({ error: { code: 'OFFICE_ATTENDANCE_ALREADY_RECORDED' } })
      const officeAdjustment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'salary_adjustment.create', expectedVersion: 4,
        payload: {
          employeeId: 'VP001', period: '2026-08', type: 'Thưởng khác', amount: 500_000,
          note: 'Thưởng chuyên cần',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-salary-adjustment-0001' }), env)
      expect(officeAdjustment.status).toBe(201)
      expect(await officeAdjustment.json()).toMatchObject({
        version: 5,
        adjustment: { employeeId: 'VP001', storeId: 'OFFICE', period: '2026-08', amount: 500_000 },
      })
      const secondOfficeAdjustment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'salary_adjustment.create', expectedVersion: 5,
        payload: {
          employeeId: 'VP001', period: '2026-08', type: 'Thưởng khác', amount: 500_000,
          note: 'Thưởng chuyên cần',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-salary-adjustment-0002' }), env)
      expect(secondOfficeAdjustment.status).toBe(201)
      expect(await secondOfficeAdjustment.json()).toMatchObject({ version: 6 })
      const managerOfficePayrollDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 6, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...managerAuthorization, 'idempotency-key': 'office-manager-payroll-denied-0001' }), env)
      expect(managerOfficePayrollDenied.status).toBe(403)
      expect(await managerOfficePayrollDenied.json()).toMatchObject({ error: { code: 'OFFICE_FORBIDDEN' } })

      const payrollClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 6, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-close-0001' }), env)
      expect(payrollClosed.status).toBe(201)
      expect(await payrollClosed.json()).toMatchObject({
        version: 7,
        period: {
          storeId: 'OFFICE', period: '2026-08',
          rows: [{
            employeeId: 'VP001', workedDays: 2, requiredWorkingDays: 20,
            baseSalary: 2_000_000, gross: 3_200_000, remaining: 3_200_000,
            salarySnapshot: { monthlySalary: 20_000_000, standardWorkDays: 20, proratedByWorkedDays: true },
          }],
        },
      })

      const officeState = await worker.fetch(new Request('https://idosi.example/api/state', { headers: officeAuthorization }), env)
      expect(officeState.status).toBe(200)
      const officeStateBody = await officeState.json()
      expect(officeStateBody).toMatchObject({
        projection: 'employee', version: 7,
        state: {
          employees: [{
            id: 'VP001', storeId: 'OFFICE', standardWorkDaysPeriod: '2026-08',
            monthlyWorkdayTargets: { '2026-08': 20 },
          }],
          attendance: [
            { id: attendanceId, employeeId: 'VP001', checkOut: '17:05', workdayCredit: 1 },
            { id: 'ATT-OFFICE-HISTORY', employeeId: 'VP001', workdayCredit: 1 },
          ],
          salaryAdjustments: [
            { employeeId: 'VP001', period: '2026-08', amount: 500_000 },
            { employeeId: 'VP001', period: '2026-08', amount: 500_000 },
          ],
          officeAdjustments: [{ id: 'DCH-OFFICE-HISTORY', employeeId: 'VP001', amount: 200_000 }],
          payrollPeriods: [{ storeId: 'OFFICE', rows: [{ employeeId: 'VP001', gross: 3_200_000 }] }],
          activeAttendanceId: null,
          finishedShift: true,
        },
      })
      expect(officeStateBody.policies).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'attendance_improve_min_late_minutes', value: 15, version: 2 }),
      ]))

      const payrollProfileUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 7,
        payload: {
          employeeId: 'VP001', salary: 21_000_000,
          standardWorkDaysPeriod: '2026-08', standardWorkDays: 18,
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-profile-update-0001' }), env)
      expect(payrollProfileUpdated.status).toBe(200)
      expect(await payrollProfileUpdated.json()).toMatchObject({ version: 8 })
      const dirtyPeriod = readHydratedState(env.DB.database)
        .payrollPeriods.find((item) => item.storeId === 'OFFICE' && item.period === '2026-08')
      expect(dirtyPeriod).toMatchObject({ needsReclose: true, invalidationReason: 'employee.update' })

      const dirtyOfficePay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.pay', expectedVersion: 8, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-pay-dirty-0001' }), env)
      expect(dirtyOfficePay.status).toBe(409)
      expect(await dirtyOfficePay.json()).toMatchObject({ error: { code: 'PAYROLL_NEEDS_RECLOSE' } })

      const officePayrollReclosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 8, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-reclose-0001' }), env)
      expect(officePayrollReclosed.status).toBe(200)
      expect(await officePayrollReclosed.json()).toMatchObject({
        version: 9,
        period: { rows: [{ employeeId: 'VP001', requiredWorkingDays: 18, baseSalary: 2_333_333, gross: 3_533_333 }] },
      })
      const officePayrollPaid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.pay', expectedVersion: 9, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-pay-0001' }), env)
      expect(officePayrollPaid.status).toBe(200)
      expect(await officePayrollPaid.json()).toMatchObject({ version: 10 })
      const paidTargetChangeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 10,
        payload: { employeeId: 'VP001', standardWorkDaysPeriod: '2026-08', standardWorkDays: 19 },
      }, { ...adminAuthorization, 'idempotency-key': 'office-paid-target-denied-0001' }), env)
      expect(paidTargetChangeDenied.status).toBe(409)
      expect(await paidTargetChangeDenied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })

      const managerState = await worker.fetch(new Request('https://idosi.example/api/state', { headers: managerAuthorization }), env)
      expect(managerState.status).toBe(200)
      const managerStateBody = await managerState.json()
      expect(managerStateBody.state.employees.map(({ id }) => id)).toEqual(['VP001', 'HTKD-OFFICE'])
      expect(managerStateBody.state.attendance).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'ATT-OFFICE-HISTORY', employeeId: 'VP001' }),
      ]))
      expect(managerStateBody.state.payrollPeriods).toEqual(expect.arrayContaining([
        expect.objectContaining({ storeId: 'OFFICE', period: '2026-08' }),
      ]))
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks notifications read atomically within employee, manager, and admin projections', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-notification-scope' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'notification-admin-password',
      initialState: {
        stores: [
          { id: 'S01', name: 'Cửa hàng 01', short: 'S01' },
          { id: 'S02', name: 'Cửa hàng 02', short: 'S02' },
        ],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'E02', name: 'Nhân viên 02', storeId: 'S02', unit: 'store' },
          { id: 'VP001', name: 'Nhân viên văn phòng', storeId: 'OFFICE', unit: 'office' },
          { id: 'HTKD-NOTIFY', code: 'HTKD-NOTIFY', name: 'Manager', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
        ],
        notifications: [
          { id: 'N-E01', employeeId: 'E01', storeId: 'S01', title: 'Thông báo E01', readAt: null },
          { id: 'N-STORE', storeId: 'S01', title: 'Thông báo cửa hàng', readAt: null },
          { id: 'N-READ', employeeId: 'E01', storeId: 'S01', title: 'Đã đọc', readAt: '2026-08-01T00:00:00.000Z' },
          { id: 'N-E02', employeeId: 'E02', storeId: 'S02', title: 'Thông báo E02', readAt: null },
          { id: 'N-OFFICE', employeeId: 'VP001', storeId: 'OFFICE', title: 'Thông báo văn phòng', readAt: null },
          { id: 'N-OFFICE-IDS', employeeIds: ['VP001'], title: 'Thông báo nhóm văn phòng', readAt: null },
          { id: 'N-OFFICE-ASSIGNEES', assignees: [{ id: 'VP001' }], title: 'Thông báo giao Văn phòng', readAt: null },
        ],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'notification-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const employeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'notification.employee', password: 'notification-employee-password', displayName: 'Nhân viên 01',
        storeId: 'S01', employeeId: 'E01',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-employee-create-0001' }), env)
    expect(employeeCreated.status).toBe(201)
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        role: 'business_support', employeeId: 'HTKD-NOTIFY', username: 'notification.manager', password: 'notification-manager-password', displayName: 'Manager',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'notification.employee', password: 'notification-employee-password',
    }), env)
    const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'notification.manager', password: 'notification-manager-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

    const employeeBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: employeeAuthorization,
    }), env)
    expect((await employeeBootstrap.json()).state.notifications.map(({ id }) => id)).toEqual(['N-E01', 'N-STORE', 'N-READ'])
    const managerBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect((await managerBootstrap.json()).state.notifications.map(({ id }) => id)).toEqual([
      'N-E01', 'N-STORE', 'N-READ', 'N-E02', 'N-OFFICE', 'N-OFFICE-IDS', 'N-OFFICE-ASSIGNEES',
    ])

    const managerOfficeAudienceRead = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 1, payload: { notificationId: 'N-OFFICE-IDS' },
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-office-audience-0001' }), env)
    expect(managerOfficeAudienceRead.status).toBe(200)
    expect(await managerOfficeAudienceRead.json()).toMatchObject({
      version: 2, updatedCount: 1, notification: { id: 'N-OFFICE-IDS', readAt: expect.any(String) },
    })

    const otherEmployeeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 2, payload: { notificationId: 'N-E02' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-other-denied-0001' }), env)
    expect(otherEmployeeDenied.status).toBe(404)
    expect(await otherEmployeeDenied.json()).toMatchObject({ error: { code: 'NOTIFICATION_NOT_FOUND' } })
    const marked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 2, payload: { notificationId: 'N-E01' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-mark-read-0001' }), env)
    expect(marked.status).toBe(200)
    const markedBody = await marked.json()
    expect(markedBody).toMatchObject({
      version: 3, updatedCount: 1,
      notification: { id: 'N-E01', readAt: expect.any(String) },
      notifications: [{ id: 'N-E01' }],
    })
    const markedReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 2, payload: { notificationId: 'N-E01' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-mark-read-0001' }), env)
    expect(markedReplay.headers.get('idempotency-replayed')).toBe('true')
    expect(await markedReplay.json()).toEqual(markedBody)

    const employeeStoreDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 3, payload: { storeId: 'S02' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-store-denied-0001' }), env)
    expect(employeeStoreDenied.status).toBe(403)
    const employeeMarkedAll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 3, payload: {},
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-employee-all-0001' }), env)
    expect(employeeMarkedAll.status).toBe(200)
    expect(await employeeMarkedAll.json()).toMatchObject({
      version: 4, storeId: 'S01', notificationIds: ['N-STORE'], notifications: [{ id: 'N-STORE' }], updatedCount: 1,
    })
    const employeeNoop = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 4, payload: {},
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-employee-noop-0001' }), env)
    expect(employeeNoop.status).toBe(200)
    expect(await employeeNoop.json()).toMatchObject({ version: 4, notificationIds: [], updatedCount: 0, existing: true })

    const managerOfficeRead = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 4, payload: { storeId: 'OFFICE' },
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-office-0001' }), env)
    expect(managerOfficeRead.status).toBe(200)
    expect(await managerOfficeRead.json()).toMatchObject({
      version: 5, storeId: 'OFFICE', notificationIds: ['N-OFFICE'], updatedCount: 1,
    })
    const managerMarkedAll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 5, payload: {},
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-all-0001' }), env)
    expect(managerMarkedAll.status).toBe(200)
    expect(await managerMarkedAll.json()).toMatchObject({
      version: 6,
      storeId: null,
      notificationIds: ['N-E01', 'N-STORE', 'N-E02', 'N-OFFICE-ASSIGNEES'],
      notifications: [{ id: 'N-E01' }, { id: 'N-STORE' }, { id: 'N-E02' }, { id: 'N-OFFICE-ASSIGNEES' }],
      updatedCount: 4,
    })
    const managerOfficeReadNoop = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 6, payload: { notificationId: 'N-OFFICE' },
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-office-read-0001' }), env)
    expect(managerOfficeReadNoop.status).toBe(200)
    expect(await managerOfficeReadNoop.json()).toMatchObject({ version: 6, updatedCount: 0, existing: true })

    const adminClearedOffice = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.clear', expectedVersion: 6, payload: { storeId: 'OFFICE' },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-admin-clear-0001' }), env)
    expect(adminClearedOffice.status).toBe(200)
    expect(await adminClearedOffice.json()).toMatchObject({
      version: 7, command: 'notification.clear', storeId: 'OFFICE', notificationIds: ['N-OFFICE'], updatedCount: 1,
    })
    const adminProjectedForReplace = await worker.fetch(new Request('https://idosi.example/api/state', { headers: adminAuthorization }), env)
    const adminProjectedForReplaceBody = await adminProjectedForReplace.json()
    const adminReplace = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.replace', expectedVersion: 7, payload: { state: adminProjectedForReplaceBody.state },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-admin-state-replace-0001' }), env)
    expect(adminReplace.status).toBe(200)
    expect(await adminReplace.json()).toMatchObject({ version: 8 })
    const finalState = readHydratedState(env.DB.database)
    const finalNotifications = Object.fromEntries(finalState.notifications.map((notification) => [notification.id, notification]))
    expect(finalState.notifications.filter(({ readAt }) => readAt).map(({ id }) => id)).toEqual(['N-READ'])
    expect(Object.keys(finalNotifications['N-E01'].readAtByUserId)).toHaveLength(2)
    expect(Object.keys(finalNotifications['N-STORE'].readAtByUserId)).toHaveLength(2)
    expect(Object.keys(finalNotifications['N-E02'].readAtByUserId)).toHaveLength(1)
    expect(Object.keys(finalNotifications['N-OFFICE'].readAtByUserId)).toHaveLength(2)
    expect(Object.keys(finalNotifications['N-OFFICE-IDS'].readAtByUserId)).toHaveLength(1)
    expect(Object.keys(finalNotifications['N-OFFICE-ASSIGNEES'].readAtByUserId)).toHaveLength(1)

    const employeeFinal = await worker.fetch(new Request('https://idosi.example/api/state', { headers: employeeAuthorization }), env)
    const employeeFinalNotifications = Object.fromEntries((await employeeFinal.json()).state.notifications.map((notification) => [notification.id, notification]))
    expect(employeeFinalNotifications['N-E01'].readAt).toEqual(expect.any(String))
    expect(employeeFinalNotifications['N-STORE'].readAt).toEqual(expect.any(String))
    const adminFinal = await worker.fetch(new Request('https://idosi.example/api/state', { headers: adminAuthorization }), env)
    const adminFinalNotifications = Object.fromEntries((await adminFinal.json()).state.notifications.map((notification) => [notification.id, notification]))
    expect(adminFinalNotifications['N-E01'].readAt).toBeNull()
    expect(adminFinalNotifications['N-OFFICE'].readAt).toEqual(expect.any(String))
    expect(env.DB.database.prepare('SELECT action FROM audit_log WHERE action LIKE ? ORDER BY id',).all('notification.%')).toEqual([
      { action: 'notification.mark_read' },
      { action: 'notification.mark_read' },
      { action: 'notification.mark_all_read' },
      { action: 'notification.mark_all_read' },
      { action: 'notification.mark_all_read' },
      { action: 'notification.clear' },
    ])
  })

  it('commits production domain commands atomically with RBAC, audit, and finance deduplication', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-finance-secret' }
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const period = localDate.slice(0, 7)
    const occurredAt = `${localDate}T12:00:00+07:00`
    const initialState = {
      schemaVersion: 2,
      stateVersion: 1,
      stores: [{ id: 'S01', short: 'S01', name: 'Cửa hàng 01' }],
      employees: [{
        id: 'E01',
        storeId: 'S01',
        name: 'Nhân viên 01',
        status: 'Đang làm việc',
        payBasis: 'monthly',
        monthlySalary: 10_000_000,
        tiktokAllowance: 0,
      }],
      orders: [{
        id: 'ORDER-01',
        code: 'S01-00001',
        storeId: 'S01',
        employeeId: 'E01',
        employeeName: 'Nhân viên 01',
        attendanceId: 'ATT-01',
        shiftId: 'SHIFT-01',
        amount: 20_000_000,
        paymentMethod: 'Tiền mặt',
        customerName: 'Khách ban đầu',
        customerPhone: '0901234567',
        customerAge: 30,
        source: 'order',
        status: 'Hoàn tất',
        createdAt: occurredAt,
        updatedAt: occurredAt,
        deletedAt: null,
      }],
      attendance: [{
        id: 'ATT-01',
        employeeId: 'E01',
        storeId: 'S01',
        shiftId: 'SHIFT-01',
        date: localDate,
        checkInAt: `${localDate}T08:00:00+07:00`,
        checkOutAt: `${localDate}T17:00:00+07:00`,
        hours: 160,
        revenue: 20_000_000,
        cash: 20_000_000,
        transfer: 0,
        orderCount: 1,
      }],
      tasks: [{ id: 'TASK-01', storeId: 'S01', employeeId: 'E01', title: 'Kiểm kê', completedBy: {} }],
      orderAudit: [],
      auditLogs: [],
      notifications: [],
      expenseEntries: [],
      fixedExpenses: [],
      cashTransactions: [],
      importVouchers: [{
        id: 'IMPORT-LEGACY',
        code: 'PN-01012020-00005',
        storeId: 'S01',
        items: [{ name: 'Dữ liệu cũ', category: 'Khác', quantity: 1, price: 1 }],
        goodsAmount: 1,
        shippingAmount: 0,
        relatedAmount: 0,
        totalAmount: 1,
        status: 'Đã xóa',
        createdAt: '2020-01-01T12:00:00+07:00',
        deletedAt: '2020-01-02T12:00:00+07:00',
      }],
      salaryAdjustments: [],
      salaryAdvances: [],
      payrollPeriods: [],
      payrollPayments: [],
      schedule: [],
      shiftDefinitions: [],
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'finance-admin-password',
      displayName: 'Admin tài chính',
      initialState,
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)

    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin',
      password: 'finance-admin-password',
    }), env)
    const adminToken = (await adminLogin.json()).token
    const adminAuthorization = { authorization: `Bearer ${adminToken}` }
    const createEmployee = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'employee01',
        password: 'finance-employee-password',
        displayName: 'Nhân viên 01',
        storeId: 'S01',
        employeeId: 'E01',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'finance-user-create' }), env)
    expect(createEmployee.status).toBe(201)
    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee01',
      password: 'finance-employee-password',
    }), env)
    const employeeToken = (await employeeLogin.json()).token
    const employeeAuthorization = { authorization: `Bearer ${employeeToken}` }

    const taskDone = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.done',
      expectedVersion: 1,
      payload: { taskId: 'TASK-01', done: true, employeeId: 'SHOULD-BE-IGNORED' },
    }, { ...employeeAuthorization, 'idempotency-key': 'task-done-01' }), env)
    expect(taskDone.status).toBe(200)
    expect(await taskDone.json()).toMatchObject({
      version: 2,
      task: { id: 'TASK-01', completedBy: { E01: true } },
    })

    const forbiddenOrderEdit = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update',
      expectedVersion: 2,
      payload: { orderId: 'ORDER-01', amount: 21_000_000, reason: 'Không có quyền' },
    }, { ...employeeAuthorization, 'idempotency-key': 'employee-order-edit' }), env)
    expect(forbiddenOrderEdit.status).toBe(403)

    const updatedOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update',
      expectedVersion: 2,
      payload: {
        orderId: 'ORDER-01',
        amount: 21_000_000,
        paymentMethod: 'Chuyển khoản',
        reason: 'Sửa theo chứng từ',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'order-update-01' }), env)
    expect(updatedOrder.status).toBe(200)
    expect(await updatedOrder.json()).toMatchObject({
      version: 3,
      order: { id: 'ORDER-01', amount: 21_000_000, paymentMethod: 'Chuyển khoản' },
      audit: { reason: 'Sửa theo chứng từ', revenueBefore: 20_000_000, revenueAfter: 21_000_000 },
    })

    const deletedOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.delete',
      expectedVersion: 3,
      payload: { orderId: 'ORDER-01', reason: 'Hủy đơn sai' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-delete-01' }), env)
    expect(deletedOrder.status).toBe(200)
    expect(await deletedOrder.json()).toMatchObject({ version: 4, order: { status: 'Đã xóa' } })

    const fixedCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'fixed_expense.create',
      expectedVersion: 4,
      payload: { storeId: 'S01', type: 'Điện', amount: 100_000, note: 'Tháng này', occurredAt },
    }, { ...adminAuthorization, 'idempotency-key': 'fixed-create-01' }), env)
    expect(fixedCreated.status).toBe(201)
    const fixedCreatedBody = await fixedCreated.json()
    expect(fixedCreatedBody).toMatchObject({
      version: 5,
      expense: { type: 'Điện', amount: 100_000 },
      expenseEntry: { sourceType: 'fixed-expense', recognized: true },
    })
    const fixedId = fixedCreatedBody.expense.id

    const fixedUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'fixed_expense.update',
      expectedVersion: 5,
      payload: { expenseId: fixedId, amount: 150_000, reason: 'Hóa đơn bổ sung' },
    }, { ...adminAuthorization, 'idempotency-key': 'fixed-update-01' }), env)
    expect(fixedUpdated.status).toBe(200)
    expect(await fixedUpdated.json()).toMatchObject({ version: 6, expenseEntry: { amount: 150_000 } })

    const manualExpense = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'expense.create',
      expectedVersion: 6,
      payload: { storeId: 'S01', type: 'Vật tư', category: 'other', amount: 50_000, occurredAt },
    }, { ...adminAuthorization, 'idempotency-key': 'expense-create-01' }), env)
    expect(manualExpense.status).toBe(201)
    expect(await manualExpense.json()).toMatchObject({ version: 7, expenseEntry: { sourceType: 'manual-expense' } })

    const importBody = {
      type: 'import.create',
      expectedVersion: 7,
      payload: {
        storeId: 'S01',
        items: [{ name: 'Áo thun', category: 'Áo', quantity: 2, weight: 2, price: 100_000 }],
        shippingAmount: 10_000,
        relatedAmount: 0,
      },
    }
    const importHeaders = { ...adminAuthorization, 'idempotency-key': 'import-create-01' }
    const importCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', importBody, importHeaders), env)
    expect(importCreated.status).toBe(201)
    const importCreatedBody = await importCreated.json()
    expect(importCreatedBody).toMatchObject({
      version: 8,
      voucher: { code: expect.stringMatching(/^PN-\d{2}\/\d{2}\/\d{2}-0006$/u), goodsAmount: 200_000, totalAmount: 210_000 },
      expense: { amount: 210_000, sourceType: 'import-voucher' },
      counter: { name: 'system:imports', value: 6 },
    })
    const replayedImport = await worker.fetch(jsonRequest('https://idosi.example/api/command', importBody, importHeaders), env)
    expect(replayedImport.status).toBe(201)
    expect(replayedImport.headers.get('idempotency-replayed')).toBe('true')
    const voucherId = importCreatedBody.voucher.id

    const importUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'import.update',
      expectedVersion: 8,
      payload: {
        voucherId,
        items: [{ name: 'Áo thun', category: 'Áo', quantity: 3, weight: 3, price: 100_000 }],
        shippingAmount: 10_000,
        relatedAmount: 0,
        reason: 'Tăng số lượng theo phiếu giao',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'import-update-01' }), env)
    expect(importUpdated.status).toBe(200)
    expect(await importUpdated.json()).toMatchObject({ version: 9, voucher: { totalAmount: 310_000 }, expense: { amount: 310_000 } })

    const importDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'import.delete',
      expectedVersion: 9,
      payload: { voucherId, reason: 'Phiếu nhập trùng' },
    }, { ...adminAuthorization, 'idempotency-key': 'import-delete-01' }), env)
    expect(importDeleted.status).toBe(200)
    expect(await importDeleted.json()).toMatchObject({
      version: 10,
      voucher: { status: 'Đã xóa' },
      expense: { recognized: false },
    })

    const salaryAdjustment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_adjustment.create',
      expectedVersion: 10,
      payload: {
        employeeId: 'E01',
        period,
        type: 'Thưởng khác',
        amount: 500_000,
        note: 'Thưởng kiểm thử',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'salary-adjustment-create-01' }), env)
    expect(salaryAdjustment.status).toBe(201)
    expect(await salaryAdjustment.json()).toMatchObject({
      version: 11,
      adjustment: { employeeId: 'E01', period, type: 'Thưởng khác', amount: 500_000 },
    })

    const advanceCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_advance.create',
      expectedVersion: 11,
      payload: { employeeId: 'E01', period, amount: 2_000_000, note: 'Tạm ứng' },
    }, { ...adminAuthorization, 'idempotency-key': 'advance-create-01' }), env)
    expect(advanceCreated.status).toBe(201)
    const advanceCreatedBody = await advanceCreated.json()
    expect(advanceCreatedBody).toMatchObject({
      version: 12,
      advance: { amount: 2_000_000, availableAtCreation: 10_500_000, status: 'Mới tạo' },
    })
    const advanceId = advanceCreatedBody.advance.id

    const advanceUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_advance.update',
      expectedVersion: 12,
      payload: { advanceId, amount: 2_500_000, note: 'Tạm ứng đã duyệt' },
    }, { ...adminAuthorization, 'idempotency-key': 'advance-update-01' }), env)
    expect(advanceUpdated.status).toBe(200)
    expect(await advanceUpdated.json()).toMatchObject({ version: 13, advance: { amount: 2_500_000 } })

    const advanceConfirmed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_advance.confirm',
      expectedVersion: 13,
      payload: { advanceId },
    }, { ...adminAuthorization, 'idempotency-key': 'advance-confirm-01' }), env)
    expect(advanceConfirmed.status).toBe(200)
    expect(await advanceConfirmed.json()).toMatchObject({
      version: 14,
      advance: { status: 'Đã chi', amount: 2_500_000 },
      expense: { amount: 2_500_000, sourceType: 'salary-advance' },
      transaction: { amount: 2_500_000, direction: 'out' },
    })

    const payrollClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close',
      expectedVersion: 14,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-close-01' }), env)
    expect(payrollClosed.status).toBe(201)
    expect(await payrollClosed.json()).toMatchObject({
      version: 15,
      period: {
        status: 'Đã chốt',
        rows: [{ employeeId: 'E01', gross: 10_500_000, advancesPaid: 2_500_000, remaining: 8_000_000 }],
      },
    })

    const adjustmentAfterClose = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_adjustment.create',
      expectedVersion: 15,
      payload: {
        employeeId: 'E01',
        period,
        type: 'Phụ cấp khác',
        amount: 100_000,
        note: 'Phát sinh sau chốt',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'salary-adjustment-after-close' }), env)
    expect(adjustmentAfterClose.status).toBe(201)
    expect(await adjustmentAfterClose.json()).toMatchObject({ version: 16 })

    const dirtyPayrollPay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay',
      expectedVersion: 16,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-pay-dirty' }), env)
    expect(dirtyPayrollPay.status).toBe(409)
    expect(await dirtyPayrollPay.json()).toMatchObject({ error: { code: 'PAYROLL_NEEDS_RECLOSE' } })

    const payrollReclosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close',
      expectedVersion: 16,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-reclose-01' }), env)
    expect(payrollReclosed.status).toBe(200)
    expect(await payrollReclosed.json()).toMatchObject({
      version: 17,
      period: {
        needsReclose: false,
        rows: [{ employeeId: 'E01', gross: 10_600_000, advancesPaid: 2_500_000, remaining: 8_100_000 }],
      },
    })

    const payrollState = readHydratedState(env.DB.database)
    const payrollIndex = payrollState.payrollPeriods.findIndex((item) => item.storeId === 'S01' && item.period === period)
    const cleanPayrollPeriods = structuredClone(payrollState.payrollPeriods)
    payrollState.payrollPeriods[payrollIndex].rows.push({ ...payrollState.payrollPeriods[payrollIndex].rows[0] })
    replaceStateCollection(env.DB.database, 'payrollPeriods', payrollState.payrollPeriods)
    const duplicatePayrollPay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay',
      expectedVersion: 17,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-pay-duplicate-row' }), env)
    expect(duplicatePayrollPay.status).toBe(409)
    expect(await duplicatePayrollPay.json()).toMatchObject({ error: { code: 'PAYROLL_ROW_DUPLICATE' } })
    replaceStateCollection(env.DB.database, 'payrollPeriods', cleanPayrollPeriods)

    const payrollPaid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay',
      expectedVersion: 17,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-pay-01' }), env)
    expect(payrollPaid.status).toBe(200)
    expect(await payrollPaid.json()).toMatchObject({
      version: 18,
      period: { status: 'Đã chi' },
      payments: [{ employeeId: 'E01', amount: 8_100_000 }],
    })

    const payrollLocked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.lock',
      expectedVersion: 18,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-lock-01' }), env)
    expect(payrollLocked.status).toBe(200)
    expect(await payrollLocked.json()).toMatchObject({ version: 19, period: { status: 'Đã khóa' } })

    const lockedAdvance = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_advance.create',
      expectedVersion: 19,
      payload: { employeeId: 'E01', period, amount: 100_000 },
    }, { ...adminAuthorization, 'idempotency-key': 'advance-after-lock' }), env)
    expect(lockedAdvance.status).toBe(409)
    expect(await lockedAdvance.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })

    const protectedReplace = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge',
      expectedVersion: 19,
      payload: { patch: { orders: [] } },
    }, { ...adminAuthorization, 'idempotency-key': 'protected-state-change' }), env)
    expect(protectedReplace.status).toBe(400)
    expect(await protectedReplace.json()).toMatchObject({ error: { code: 'DOMAIN_COMMAND_REQUIRED' } })

    const rawStateRow = env.DB.database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get()
    const rawState = JSON.parse(rawStateRow.value_json)
    rawState.legacyIntegration = {
      access_token: 'legacy-access-secret-sentinel',
      disguised: { hash: 'legacy-hash-sentinel', salt: 'salt', iterations: 210_000, algorithm: 'PBKDF2-SHA256' },
    }
    env.DB.database.prepare("UPDATE app_state SET value_json = ? WHERE scope_key = 'global'").run(JSON.stringify(rawState))
    const scrubbedMerge = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge',
      expectedVersion: 19,
      payload: { patch: { scrubbedLegacyState: true } },
    }, { ...adminAuthorization, 'idempotency-key': 'scrub-legacy-state' }), env)
    expect(scrubbedMerge.status).toBe(200)
    expect(JSON.stringify(await scrubbedMerge.json())).not.toMatch(/legacy-access-secret-sentinel|legacy-hash-sentinel/u)

    const finalStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: adminAuthorization,
    }), env)
    const finalState = (await finalStateResponse.json()).state
    expect(finalState.attendance[0]).toMatchObject({ revenue: 0, cash: 0, transfer: 0, orderCount: 0 })
    expect(finalState.expenseEntries.filter((entry) => (
      entry.sourceType === 'salary-advance' || entry.sourceType === 'payroll-payment'
    )).reduce((sum, entry) => sum + entry.amount, 0)).toBe(10_600_000)
    expect(finalState.expenseEntries.filter((entry) => entry.sourceType === 'import-voucher' && entry.sourceId === voucherId)).toEqual([
      expect.objectContaining({ sourceId: voucherId, amount: 310_000, recognized: false }),
    ])
    expect(finalState.cashTransactions.filter((entry) => entry.sourceType === 'salary-advance')).toHaveLength(1)
    expect(finalState.cashTransactions.filter((entry) => entry.sourceType === 'payroll-payment')).toHaveLength(1)

    const auditResponse = await worker.fetch(new Request('https://idosi.example/api/audit?limit=100', {
      headers: adminAuthorization,
    }), env)
    const auditBody = await auditResponse.json()
    const auditActions = auditBody.audit.map(({ action }) => action)
    expect(JSON.stringify(auditBody)).not.toMatch(/legacy-access-secret-sentinel|legacy-hash-sentinel/u)
    expect(auditActions).toEqual(expect.arrayContaining([
      'task.done',
      'order.update',
      'order.delete',
      'fixed_expense.create',
      'fixed_expense.update',
      'expense.create',
      'import.create',
      'import.update',
      'import.delete',
      'salary_adjustment.create',
      'salary_advance.create',
      'salary_advance.update',
      'salary_advance.confirm',
      'payroll.close',
      'payroll.pay',
      'payroll.lock',
    ]))
  })

  it('lets business support create store managers, mutate orders, and complete Admin assignments', async () => {
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-support-work' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'support-work-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'IDOSI Tô Ngọc Vân', short: 'TNV', status: 'Đang hoạt động' }],
        employees: [], attendance: [], schedule: [], tasks: [], supportWorkAssignments: [],
        orders: [{
          id: 'ORDER-SUPPORT-01', code: 'S01-00001', storeId: 'S01', employeeId: 'E01',
          amount: 500_000, customerName: 'Khách hàng', paymentMethod: 'Tiền mặt',
          status: 'Hoàn tất', source: 'order', createdAt: '2026-08-18T01:00:00.000Z',
        }],
        orderAudit: [], auditLogs: [], notifications: [], shiftDefinitions: [],
        expenseEntries: [], fixedExpenses: [], cashTransactions: [], importVouchers: [],
        salaryAdjustments: [], salaryAdvances: [], payrollPeriods: [], payrollPayments: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'support-work-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'business_support', name: 'Hỗ trợ Kinh doanh', phone: '0901111111',
        cccd: '079123456711', address: 'TP. Hồ Chí Minh', startDate: '2026-08-01',
        employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
        username: 'support.work', password: 'support-work-account-password',
        identityImages: testIdentityImages(),
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-work-profile-create-0001' }), env)
    expect(supportCreated.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.work', password: 'support-work-account-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 2,
      payload: {
        unit: 'store_manager', storeId: 'S01', name: 'Quản lý do Hỗ trợ tạo', phone: '0902222222',
        cccd: '079123456722', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Quản lý cửa hàng',
        username: 'manager.by.support', password: 'manager-by-support-password',
        identityImages: testIdentityImages(),
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-create-store-manager-0001' }), env)
    expect(managerCreated.status).toBe(201)
    expect(await managerCreated.json()).toMatchObject({
      version: 3,
      employee: {
        id: 'QLCH-001', unit: 'store_manager', storeId: 'S01', employmentType: 'Full-Time',
        baseSalary: 0, salary: 0, payBasis: 'allowance-only', payFormula: 'allowance-bonus-only',
      },
      user: { role: 'store_manager', employeeId: 'QLCH-001', storeId: 'S01' },
    })
    expect(readHydratedState(env.DB.database).employees.find(({ id }) => id === 'QLCH-001')).toMatchObject({
      baseSalary: 0, salary: 0, payBasis: 'allowance-only', payFormula: 'allowance-bonus-only',
    })

    const invalidStoreEmployee = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 3,
      payload: { unit: 'store', storeId: 'S01', name: 'Thiếu CCCD', phone: '0903333333' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-create-store-employee-invalid-0001' }), env)
    expect(invalidStoreEmployee.status).toBe(400)
    expect(await invalidStoreEmployee.json()).toMatchObject({ error: { code: 'CCCD_INVALID' } })
    const orderUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update', expectedVersion: 3,
      payload: { orderId: 'ORDER-SUPPORT-01', amount: 600_000, reason: 'Đối soát lại đơn hàng' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-order-update-0001' }), env)
    expect(orderUpdated.status).toBe(200)
    expect(await orderUpdated.json()).toMatchObject({
      version: 4,
      order: { id: 'ORDER-SUPPORT-01', amount: 600_000 },
      audit: { actor: { role: 'business_support' }, reason: 'Đối soát lại đơn hàng' },
    })

    const assigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.assign', expectedVersion: 4,
      payload: {
        date: '2026-08-18', employeeId: 'HTKD-001',
        tasks: [
          { id: 'WORK-01', name: 'Kiểm tra báo cáo', description: 'Đối chiếu doanh thu' },
          { id: 'WORK-02', name: 'Liên hệ cửa hàng', description: 'Xác nhận tồn kho' },
        ],
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-work-assign-0001' }), env)
    expect(assigned.status).toBe(201)
    const assignedBody = await assigned.json()
    expect(assignedBody).toMatchObject({
      version: 5,
      assignment: { employeeId: 'HTKD-001', totalTasks: 2, completionRate: 0, status: 'assigned' },
      notification: { type: 'support-work-assigned', employeeId: 'HTKD-001', route: '/support/tasks' },
    })
    const assignmentId = assignedBody.assignment.id

    const secondAssigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.assign', expectedVersion: 5,
      payload: {
        date: '2026-08-18', employeeId: 'HTKD-001',
        tasks: [{ id: 'WORK-03', name: 'Kiểm tra cửa hàng', description: 'Ghi nhận hiện trạng' }],
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-work-assign-same-day-0001' }), env)
    expect(secondAssigned.status).toBe(201)
    const secondAssignedBody = await secondAssigned.json()
    expect(secondAssignedBody).toMatchObject({ version: 6, assignment: { status: 'assigned', totalTasks: 1 } })
    expect(secondAssignedBody.assignment.id).not.toBe(assignmentId)

    const replaced = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.assign', expectedVersion: 6,
      payload: {
        assignmentId: secondAssignedBody.assignment.id,
        date: '2026-08-18', employeeId: 'HTKD-001',
        tasks: [{ id: 'WORK-03', name: 'Kiểm tra cửa hàng cập nhật', description: 'Chụp và ghi nhận hiện trạng' }],
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-work-replace-explicit-0001' }), env)
    expect(replaced.status).toBe(200)
    expect(await replaced.json()).toMatchObject({
      version: 7,
      assignment: {
        id: secondAssignedBody.assignment.id,
        history: [
          expect.objectContaining({
            action: 'assigned',
            details: { taskCount: 1, tasks: [expect.objectContaining({ name: 'Kiểm tra cửa hàng' })] },
          }),
          expect.objectContaining({
            action: 'replaced',
            details: {
              taskCount: 1,
              beforeTasks: [expect.objectContaining({ name: 'Kiểm tra cửa hàng' })],
              afterTasks: [expect.objectContaining({ name: 'Kiểm tra cửa hàng cập nhật' })],
            },
          }),
        ],
      },
    })

    const supportStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: supportAuthorization,
    }), env)
    const supportState = (await supportStateResponse.json()).state
    expect(supportState.supportWorkAssignments).toHaveLength(2)
    expect(supportState.supportWorkAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: assignmentId, employeeId: 'HTKD-001' }),
      expect.objectContaining({ id: secondAssignedBody.assignment.id, employeeId: 'HTKD-001' }),
    ]))
    expect(supportState.orderAudit).toEqual([
      expect.objectContaining({
        orderId: 'ORDER-SUPPORT-01', action: 'Sửa', actor: expect.objectContaining({ role: 'business_support' }),
      }),
    ])
    expect(supportState.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'support-work-assigned', assignmentId }),
    ]))

    const missingReason = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.update', expectedVersion: 7,
      payload: { assignmentId, tasks: [{ id: 'WORK-01', completed: true }], submit: true },
    }, { ...supportAuthorization, 'idempotency-key': 'support-work-missing-reason-0001' }), env)
    expect(missingReason.status).toBe(400)
    expect(await missingReason.json()).toMatchObject({ error: { code: 'SUPPORT_WORK_REASON_REQUIRED' } })

    const submitted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.update', expectedVersion: 7,
      payload: {
        assignmentId,
        tasks: [{ id: 'WORK-01', completed: true }, { id: 'WORK-02', completed: false }],
        submit: true,
        incompleteReason: 'Cửa hàng chưa phản hồi tồn kho.',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-work-submit-0001' }), env)
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toMatchObject({
      version: 8,
      assignment: {
        id: assignmentId, status: 'incomplete', completedTasks: 1, totalTasks: 2,
        completionRate: 50, incompleteReason: 'Cửa hàng chưa phản hồi tồn kho.',
        submittedAt: expect.any(String),
      },
      notification: { type: 'support-work-submitted', route: '/admin/tasks' },
    })

    const orderDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.delete', expectedVersion: 8,
      payload: { orderId: 'ORDER-SUPPORT-01', reason: 'Đơn hàng nhập trùng' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-order-delete-0001' }), env)
    expect(orderDeleted.status).toBe(200)
    expect(await orderDeleted.json()).toMatchObject({ version: 9, order: { status: 'Đã xóa' } })

    const supportAudit = await worker.fetch(new Request('https://idosi.example/api/audit?limit=100', {
      headers: supportAuthorization,
    }), env)
    expect(supportAudit.status).toBe(200)
    expect((await supportAudit.json()).audit.map(({ action }) => action)).toEqual(['order.delete', 'order.update'])
    const adminState = (await (await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: adminAuthorization,
    }), env)).json()).state
    const completedAssignment = adminState.supportWorkAssignments.find((record) => record.id === assignmentId)
    expect(completedAssignment).toMatchObject({
      id: assignmentId, employeeId: 'HTKD-001', status: 'incomplete', completionRate: 50,
      history: [
        expect.objectContaining({
          action: 'assigned', at: expect.any(String),
          details: {
            taskCount: 2,
            tasks: expect.arrayContaining([
              expect.objectContaining({ id: 'WORK-01', name: 'Kiểm tra báo cáo', description: 'Đối chiếu doanh thu' }),
              expect.objectContaining({ id: 'WORK-02', name: 'Liên hệ cửa hàng', description: 'Xác nhận tồn kho' }),
            ]),
          },
        }),
        expect.objectContaining({ action: 'submitted', at: expect.any(String) }),
      ],
    })
  })

  it('validates and snapshots catalog assignments while keeping rewards optional and manual work required', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-26T01:00:00.000Z'))
      const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-work-catalog-assignments' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'work-catalog-assignment-password',
        initialState: {
          stores: [
            { id: 'S01', name: 'IDOSI Tô Ngọc Vân', status: 'Đang hoạt động' },
            { id: 'S02', name: 'IDOSI Tây Hòa', status: 'Đang hoạt động' },
          ],
          employees: [
            {
              id: 'E01', name: 'Nhân viên catalog', storeId: 'S01', unit: 'store',
              status: 'Đang làm việc', startDate: '2026-08-01', employmentType: 'Part-Time', hourlyRate: 30_000,
            },
            {
              id: 'HTKD-01', name: 'Hỗ trợ catalog', storeId: 'BUSINESS_SUPPORT',
              unit: 'business_support', status: 'Đang làm việc', startDate: '2026-08-01',
            },
          ],
          shiftDefinitions: [{
            id: 'SHIFT-AM', name: 'Ca sáng', storeId: 'S01', date: '2026-08-26',
            start: '08:00', end: '17:00', active: true,
          }],
          schedule: [{
            id: 'SCHEDULE-E01', employeeId: 'E01', storeId: 'S01', date: '2026-08-26',
            shiftId: 'SHIFT-AM', shiftIds: ['SHIFT-AM'],
          }],
          workCatalogItems: [
            {
              id: 'CAT-STORE-FIXED', code: 'store.fixed.open', version: 2,
              kind: 'FIXED_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-AM', shiftName: 'Ca sáng',
              name: 'Mở cửa theo danh mục', amountVnd: 0, active: true, sortOrder: 1,
              effectiveFrom: '2026-08-01', effectiveTo: null,
            },
            {
              id: 'CAT-STORE-REWARD', code: 'store.reward.display', version: 3,
              kind: 'REWARD_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-AM', shiftName: 'Ca sáng',
              name: 'Trưng bày nhận thưởng', amountVnd: 25_000, active: true, sortOrder: 2,
              effectiveFrom: '2026-08-01', effectiveTo: null,
            },
            {
              id: 'CAT-WRONG-STORE', code: 'store.fixed.other', version: 1,
              kind: 'FIXED_TASK', targetGroup: 'store', storeId: 'S02', shiftId: null, shiftName: null,
              name: 'Việc cửa hàng khác', amountVnd: 0, active: true, sortOrder: 3,
              effectiveFrom: '2026-08-01', effectiveTo: null,
            },
            {
              id: 'CAT-WRONG-SHIFT', code: 'store.fixed.other-shift', version: 1,
              kind: 'FIXED_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-PM', shiftName: 'Ca chiều',
              name: 'Việc ca khác', amountVnd: 0, active: true, sortOrder: 4,
              effectiveFrom: '2026-08-01', effectiveTo: null,
            },
            {
              id: 'CAT-EXPIRED', code: 'store.fixed.expired', version: 1,
              kind: 'FIXED_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-AM', shiftName: 'Ca sáng',
              name: 'Việc đã hết hiệu lực', amountVnd: 0, active: true, sortOrder: 5,
              effectiveFrom: '2026-08-01', effectiveTo: '2026-08-25',
            },
            {
              id: 'CAT-INACTIVE', code: 'store.fixed.inactive', version: 1,
              kind: 'FIXED_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-AM', shiftName: 'Ca sáng',
              name: 'Việc đã ngừng', amountVnd: 0, active: false, sortOrder: 6,
              effectiveFrom: '2026-08-01', effectiveTo: null,
            },
            {
              id: 'CAT-SUPPORT-FIXED', code: 'support.fixed.report', version: 7,
              kind: 'FIXED_TASK', targetGroup: 'business_support', storeId: null, shiftId: null, shiftName: null,
              name: 'Đối chiếu báo cáo', amountVnd: 0, active: true, sortOrder: 1,
              effectiveFrom: '2026-08-01', effectiveTo: null,
            },
            {
              id: 'CAT-SUPPORT-REWARD', code: 'support.reward.follow-up', version: 4,
              kind: 'REWARD_TASK', targetGroup: 'business_support', storeId: null, shiftId: null, shiftName: null,
              name: 'Theo dõi khách nhận thưởng', amountVnd: 40_000, active: true, sortOrder: 2,
              effectiveFrom: '2026-08-01', effectiveTo: null,
            },
            {
              id: 'CAT-OFFICE-FIXED', code: 'office.fixed.archive', version: 1,
              kind: 'FIXED_TASK', targetGroup: 'office', storeId: null, shiftId: null, shiftName: null,
              name: 'Lưu hồ sơ văn phòng', amountVnd: 0, active: true, sortOrder: 1,
              effectiveFrom: '2026-08-01', effectiveTo: null,
            },
          ],
          attendance: [], tasks: [], taskAssignmentHistory: [], supportWorkAssignments: [],
          orders: [], notifications: [], expenseEntries: [], fixedExpenses: [], cashTransactions: [],
          salaryAdjustments: [], salaryAdvances: [], payrollPeriods: [], payrollPayments: [],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'work-catalog-assignment-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
      for (const account of [
        {
          username: 'catalog.employee', password: 'catalog-employee-password', role: 'employee',
          storeId: 'S01', employeeId: 'E01', displayName: 'Nhân viên catalog',
        },
        {
          username: 'catalog.support', password: 'catalog-support-password', role: 'business_support',
          storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-01', displayName: 'Hỗ trợ catalog',
        },
      ]) {
        const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type: 'user.create', payload: account,
        }, { ...adminAuthorization, 'idempotency-key': `catalog-user-${account.employeeId}` }), env)
        expect(created.status).toBe(201)
      }
      const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'catalog.employee', password: 'catalog-employee-password',
      }), env)
      const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
      const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'catalog.support', password: 'catalog-support-password',
      }), env)
      const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

      for (const catalogItemId of ['CAT-WRONG-STORE', 'CAT-WRONG-SHIFT', 'CAT-EXPIRED', 'CAT-INACTIVE', 'CAT-OFFICE-FIXED']) {
        const invalid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type: 'tasks.assign', expectedVersion: 1,
          payload: {
            storeId: 'S01', date: '2026-08-26', shiftId: 'SHIFT-AM', employeeIds: ['E01'],
            tasks: [{ catalogItemId }],
          },
        }, { ...adminAuthorization, 'idempotency-key': `catalog-store-scope-${catalogItemId}` }), env)
        expect(invalid.status, catalogItemId).toBe(400)
        expect(await invalid.json()).toMatchObject({ error: { code: 'WORK_CATALOG_TASK_INVALID' } })
      }
      const staleCatalog = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'tasks.assign', expectedVersion: 1,
        payload: {
          storeId: 'S01', date: '2026-08-26', shiftId: 'SHIFT-AM', employeeIds: ['E01'],
          tasks: [{ catalogItemId: 'CAT-STORE-FIXED', catalogVersion: 1 }],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'catalog-store-stale-version' }), env)
      expect(staleCatalog.status).toBe(409)
      expect(await staleCatalog.json()).toMatchObject({
        error: {
          code: 'WORK_CATALOG_VERSION_CONFLICT',
          details: { catalogItemId: 'CAT-STORE-FIXED', requestedVersion: 1, currentVersion: 2 },
        },
      })

      const storeAssigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'tasks.assign', expectedVersion: 1,
        payload: {
          storeId: 'S01', date: '2026-08-26', shiftId: 'SHIFT-AM', employeeIds: ['E01'],
          tasks: [
            {
              id: 'STORE-FIXED-ASSIGNED', title: 'Tên client không được tin', catalogItemId: 'CAT-STORE-FIXED',
              catalogVersion: 2, catalogCode: 'spoofed', kind: 'REWARD_TASK', amountVnd: 999_999, required: false,
            },
            {
              id: 'STORE-REWARD-ASSIGNED', title: 'Tên thưởng giả', catalogItemId: 'CAT-STORE-REWARD',
              catalogVersion: 3, amountVnd: 1, required: true,
            },
            { id: 'STORE-MANUAL-ASSIGNED', title: 'Công việc nhập tay cũ', detail: 'Vẫn được hỗ trợ' },
          ],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'catalog-store-assign' }), env)
      expect(storeAssigned.status).toBe(201)
      const storeAssignedBody = await storeAssigned.json()
      expect(storeAssignedBody).toMatchObject({
        version: 2,
        tasks: [
          {
            id: 'STORE-FIXED-ASSIGNED', title: 'Mở cửa theo danh mục',
            catalogItemId: 'CAT-STORE-FIXED', catalogCode: 'store.fixed.open', catalogVersion: 2,
            kind: 'FIXED_TASK', catalogKind: 'FIXED_TASK', amountVnd: 0, required: true,
            catalogSnapshot: {
              catalogItemId: 'CAT-STORE-FIXED', catalogCode: 'store.fixed.open', catalogVersion: 2,
              kind: 'FIXED_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-AM',
              amountVnd: 0, required: true, effectiveDate: '2026-08-26',
            },
          },
          {
            id: 'STORE-REWARD-ASSIGNED', title: 'Trưng bày nhận thưởng',
            catalogItemId: 'CAT-STORE-REWARD', catalogCode: 'store.reward.display', catalogVersion: 3,
            kind: 'REWARD_TASK', amountVnd: 25_000, required: false,
          },
          { id: 'STORE-MANUAL-ASSIGNED', title: 'Công việc nhập tay cũ', detail: 'Vẫn được hỗ trợ' },
        ],
        history: {
          tasks: expect.arrayContaining([
            expect.objectContaining({ catalogItemId: 'CAT-STORE-FIXED', catalogVersion: 2, required: true }),
            expect.objectContaining({ catalogItemId: 'CAT-STORE-REWARD', catalogVersion: 3, required: false }),
          ]),
        },
      })
      expect(storeAssignedBody.tasks[2]).not.toHaveProperty('catalogItemId')

      const wrongSupportTarget = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_work.assign', expectedVersion: 2,
        payload: {
          date: '2026-08-26', employeeId: 'HTKD-01',
          tasks: [{ id: 'SUPPORT-WRONG-TARGET', catalogItemId: 'CAT-OFFICE-FIXED' }],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'catalog-support-wrong-target' }), env)
      expect(wrongSupportTarget.status).toBe(400)
      expect(await wrongSupportTarget.json()).toMatchObject({ error: { code: 'WORK_CATALOG_TASK_INVALID' } })

      const supportAssigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_work.assign', expectedVersion: 2,
        payload: {
          date: '2026-08-26', employeeId: 'HTKD-01',
          tasks: [
            { id: 'SUPPORT-FIXED-ASSIGNED', catalogItemId: 'CAT-SUPPORT-FIXED', catalogVersion: 7 },
            {
              id: 'SUPPORT-REWARD-ASSIGNED', catalogItemId: 'CAT-SUPPORT-REWARD', catalogVersion: 4,
              name: 'Tên giả', amountVnd: 5, required: true,
            },
          ],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'catalog-support-assign' }), env)
      expect(supportAssigned.status).toBe(201)
      const supportAssignedBody = await supportAssigned.json()
      expect(supportAssignedBody).toMatchObject({
        version: 3,
        assignment: {
          requiredTasks: 1, completedRequiredTasks: 0, incompleteRequiredTasks: 1,
          rewardTasks: 1, completedRewardTasks: 0,
          tasks: [
            {
              id: 'SUPPORT-FIXED-ASSIGNED', name: 'Đối chiếu báo cáo',
              catalogItemId: 'CAT-SUPPORT-FIXED', catalogCode: 'support.fixed.report', catalogVersion: 7,
              kind: 'FIXED_TASK', amountVnd: 0, required: true,
            },
            {
              id: 'SUPPORT-REWARD-ASSIGNED', name: 'Theo dõi khách nhận thưởng',
              catalogItemId: 'CAT-SUPPORT-REWARD', catalogCode: 'support.reward.follow-up', catalogVersion: 4,
              kind: 'REWARD_TASK', amountVnd: 40_000, required: false,
            },
          ],
        },
      })
      const supportAssignmentId = supportAssignedBody.assignment.id

      const supportFixedReasonRequired = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_work.update', expectedVersion: 3,
        payload: {
          assignmentId: supportAssignmentId,
          tasks: [
            { id: 'SUPPORT-FIXED-ASSIGNED', completed: false },
            { id: 'SUPPORT-REWARD-ASSIGNED', completed: false },
          ],
          submit: true,
        },
      }, { ...supportAuthorization, 'idempotency-key': 'catalog-support-fixed-reason-required' }), env)
      expect(supportFixedReasonRequired.status).toBe(400)
      expect(await supportFixedReasonRequired.json()).toMatchObject({ error: { code: 'SUPPORT_WORK_REASON_REQUIRED' } })

      const rewardDisabled = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'work_catalog.delete', expectedVersion: 3,
        payload: { id: 'CAT-SUPPORT-REWARD', expectedVersion: 4, reason: 'Ngừng áp dụng cho lượt giao mới' },
      }, { ...adminAuthorization, 'idempotency-key': 'catalog-support-reward-disable' }), env)
      expect(rewardDisabled.status).toBe(200)
      expect(await rewardDisabled.json()).toMatchObject({ version: 4, item: { active: false, version: 5 } })

      const supportSubmitted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_work.update', expectedVersion: 4,
        payload: {
          assignmentId: supportAssignmentId,
          tasks: [
            { id: 'SUPPORT-FIXED-ASSIGNED', completed: true },
            { id: 'SUPPORT-REWARD-ASSIGNED', completed: false },
          ],
          submit: true,
        },
      }, { ...supportAuthorization, 'idempotency-key': 'catalog-support-reward-optional' }), env)
      expect(supportSubmitted.status).toBe(200)
      expect(await supportSubmitted.json()).toMatchObject({
        version: 5,
        assignment: {
          status: 'completed', totalTasks: 2, completedTasks: 1, completionRate: 50,
          requiredTasks: 1, completedRequiredTasks: 1, incompleteRequiredTasks: 0,
          rewardTasks: 1, completedRewardTasks: 0, incompleteReason: null,
          tasks: [
            expect.objectContaining({ catalogItemId: 'CAT-SUPPORT-FIXED', catalogVersion: 7, required: true }),
            expect.objectContaining({ catalogItemId: 'CAT-SUPPORT-REWARD', catalogVersion: 4, required: false }),
          ],
        },
      })

      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 5,
        payload: { shiftId: 'SHIFT-AM', location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'catalog-store-check-in' }), env)
      expect(checkedIn.status).toBe(201)
      const checkedInBody = await checkedIn.json()
      expect(checkedInBody).toMatchObject({
        version: 6,
        attendance: {
          checklistSnapshot: {
            source: 'work-catalog',
            tasks: expect.arrayContaining([
              expect.objectContaining({ catalogItemId: 'CAT-STORE-FIXED', required: true }),
              expect.objectContaining({ catalogItemId: 'CAT-STORE-REWARD', required: false }),
            ]),
          },
        },
      })
      const attendanceId = checkedInBody.attendance.id
      const checklistTasks = checkedInBody.attendance.checklistSnapshot.tasks
      const progressTasks = [
        ...storeAssignedBody.tasks.map((task) => ({
          id: task.id,
          completed: task.id === 'STORE-FIXED-ASSIGNED' ? true : task.id === 'STORE-MANUAL-ASSIGNED',
        })),
        ...checklistTasks.map((task) => ({ id: task.id, completed: task.required === true })),
      ]
      const storeFixedReasonRequired = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.progress.save', expectedVersion: 6,
        payload: {
          attendanceId,
          tasks: progressTasks.map((task) => task.id === 'STORE-FIXED-ASSIGNED' ? { ...task, completed: false } : task),
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'catalog-store-fixed-reason-required' }), env)
      expect(storeFixedReasonRequired.status).toBe(400)
      expect(await storeFixedReasonRequired.json()).toMatchObject({
        error: { code: 'INCOMPLETE_TASK_REASON_REQUIRED', details: { taskIds: ['STORE-FIXED-ASSIGNED'] } },
      })

      const progressSaved = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.progress.save', expectedVersion: 6,
        payload: { attendanceId, tasks: progressTasks },
      }, { ...employeeAuthorization, 'idempotency-key': 'catalog-store-rewards-optional' }), env)
      expect(progressSaved.status).toBe(200)
      expect(await progressSaved.json()).toMatchObject({
        version: 7,
        totalTasks: 5, completedTasks: 3, completionRate: 60,
        requiredTasks: 3, completedRequiredTasks: 3,
        rewardTasks: 2, completedRewardTasks: 0, incompleteReason: '',
        assignments: expect.arrayContaining([
          expect.objectContaining({ assignmentId: storeAssignedBody.assignmentId, requiredTasks: 2, completedRequiredTasks: 2 }),
        ]),
      })

      vi.setSystemTime(new Date('2026-08-26T10:00:00.000Z'))
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 7,
        payload: {
          attendanceId, cashRevenue: 0, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'catalog-store-check-out-with-rewards-open' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 8,
        attendance: { id: attendanceId, incompleteTaskReason: null, incompleteTasksSnapshot: [] },
      })

      const persisted = readHydratedState(env.DB.database)
      expect(persisted.supportWorkAssignments[0].tasks).toEqual([
        expect.objectContaining({ catalogItemId: 'CAT-SUPPORT-FIXED', catalogVersion: 7, required: true }),
        expect.objectContaining({ catalogItemId: 'CAT-SUPPORT-REWARD', catalogVersion: 4, required: false }),
      ])
      expect(persisted.tasks.find(({ id }) => id === 'STORE-MANUAL-ASSIGNED')).not.toHaveProperty('catalogItemId')
    } finally {
      vi.useRealTimers()
    }
  })

  it('creates complete office accounts with VP hyphen codes and private identity images', async () => {
    const pngBytes = new Uint8Array(validPngBytes(512))
    const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`
    const env = {
      DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-office-profile', IDENTITY_IMAGES: new MemoryR2(),
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'office-profile-admin-password',
      initialState: {
        stores: [],
        employees: [{
          id: 'VP001', code: 'VP001', storeId: 'OFFICE', unit: 'office',
          name: 'Hồ sơ cũ', phone: '0900000001', status: 'Đang làm việc',
        }],
        attendance: [], orders: [], notifications: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'office-profile-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await login.json()).token}` }

    const invalidCccd = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'office', storeId: 'OFFICE', name: 'CCCD sai', phone: '0904444444', cccd: '123',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Full-Time',
        position: 'Kế Toán', username: 'office.invalid', password: 'office-invalid-password',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'office-invalid-cccd-0001' }), env)
    expect(invalidCccd.status).toBe(400)
    expect(await invalidCccd.json()).toMatchObject({ error: { code: 'CCCD_INVALID' } })

    const missingIdentityImages = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'office', storeId: 'OFFICE', name: 'Thiếu ảnh CCCD', phone: '0904444444',
        cccd: '079123456744', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Kế Toán',
        username: 'office.missing.images', password: 'office-missing-images-password',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'office-missing-images-0001' }), env)
    expect(missingIdentityImages.status).toBe(400)
    expect(await missingIdentityImages.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGES_REQUIRED' } })

    const physicalStoreOffice = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'office', storeId: 'S01', name: 'Sai đơn vị', phone: '0904444444',
        cccd: '079123456744', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Kế Toán', identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'office.wrong.store', password: 'office-wrong-store-password',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'office-physical-store-denied-0001' }), env)
    expect(physicalStoreOffice.status).toBe(400)
    expect(await physicalStoreOffice.json()).toMatchObject({ error: { code: 'OFFICE_STORE_REQUIRED' } })

    const officeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'office', storeId: 'OFFICE', name: 'Nhân viên Kế Toán', phone: '0904444444',
        cccd: '079123456744', address: '12 Đường IDOSI, Phường Hiệp Bình, TP. Hồ Chí Minh',
        addressDetails: { province: 'TP. Hồ Chí Minh', ward: 'Phường Hiệp Bình', street: '12 Đường IDOSI' },
        startDate: '2026-08-18', employmentType: 'Full-Time', position: 'Kế Toán',
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'office.accounting', password: 'office-accounting-password',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'office-profile-create-0001' }), env)
    expect(officeCreated.status).toBe(201)
    const officeBody = await officeCreated.json()
    expect(officeBody).toMatchObject({
      version: 2,
      employee: {
        id: 'VP-002', code: 'VP-002', unit: 'office', storeId: 'OFFICE',
        employmentType: 'Full-Time', position: 'Kế Toán', cccd: '079123456744',
        addressDetails: { province: 'TP. Hồ Chí Minh', ward: 'Phường Hiệp Bình', street: '12 Đường IDOSI' },
        identityImages: {
          front: { contentType: 'image/png', size: pngBytes.byteLength },
          back: { contentType: 'image/png', size: pngBytes.byteLength },
        },
      },
      user: { role: 'employee', employeeId: 'VP-002', storeId: 'OFFICE' },
    })
    expect(JSON.stringify(officeBody)).not.toContain(pngDataUrl)
    const officeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'office.accounting', password: 'office-accounting-password',
    }), env)
    const officeAuthorization = { authorization: `Bearer ${(await officeLogin.json()).token}` }
    const ownImage = await worker.fetch(new Request('https://idosi.example/api/identity-images/VP-002/front', {
      headers: officeAuthorization,
    }), env)
    expect(ownImage.status).toBe(200)
    expect(ownImage.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await ownImage.arrayBuffer())).toEqual(pngBytes)

    const officeWorkAssigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.assign', expectedVersion: 2,
      payload: {
        targetUnit: 'office', date: '2026-08-21', employeeId: 'VP-002',
        tasks: [{ id: 'OFFICE-WORK-01', name: 'Đối chiếu chứng từ' }],
      },
    }, { ...adminAuthorization, 'idempotency-key': 'office-work-assign-0001' }), env)
    expect(officeWorkAssigned.status).toBe(201)
    const officeWorkBody = await officeWorkAssigned.json()
    expect(officeWorkBody).toMatchObject({
      version: 3,
      assignment: { targetUnit: 'office', employeeId: 'VP-002', totalTasks: 1 },
      notification: {
        type: 'support-work-assigned', targetUnit: 'office', storeId: 'OFFICE', route: '/employee/tasks',
      },
    })
    const officeState = (await (await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: officeAuthorization,
    }), env)).json()).state
    expect(officeState.supportWorkAssignments).toEqual([
      expect.objectContaining({ id: officeWorkBody.assignment.id, targetUnit: 'office', employeeId: 'VP-002' }),
    ])

    const officeWorkSubmitted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.update', expectedVersion: 3,
      payload: {
        assignmentId: officeWorkBody.assignment.id,
        tasks: [{ id: 'OFFICE-WORK-01', completed: true }],
        submit: true,
      },
    }, { ...officeAuthorization, 'idempotency-key': 'office-work-submit-0001' }), env)
    expect(officeWorkSubmitted.status).toBe(200)
    expect(await officeWorkSubmitted.json()).toMatchObject({
      version: 4,
      assignment: { targetUnit: 'office', employeeId: 'VP-002', status: 'completed' },
      notification: { type: 'support-work-submitted', storeId: 'OFFICE', route: '/admin/tasks' },
    })
  })

  it('lets business support create office and store employees with creator-provided credentials and policy access', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
    const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`
    const env = {
      DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-support-staff-policy', IDENTITY_IMAGES: new MemoryR2(),
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'support-staff-policy-admin-password',
      initialState: {
        stores: [
          { id: 'SM234', name: 'SecondMall SM234', short: 'SM234', status: 'Đang hoạt động' },
          { id: 'S02', name: 'IDOSI Tây Hòa', short: 'TH', status: 'Đang hoạt động' },
        ],
        employees: [], attendance: [], schedule: [], tasks: [], orders: [], notifications: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'support-staff-policy-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'business_support', name: 'Hỗ trợ Nhân sự', phone: '0907000001',
        cccd: '079999000010', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
        username: 'support.staff', password: 'support-staff-account-password',
        identityImages: { front: pngDataUrl, back: pngDataUrl },
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-staff-profile-create-0001' }), env)
    expect(supportCreated.status).toBe(201)
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 2,
      payload: {
        unit: 'store_manager', storeId: 'SM234', name: 'Quản lý SM234', phone: '0907000002',
        cccd: '079999000020', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Quản lý cửa hàng',
        username: 'manager.sm234', password: 'manager-sm234-account-password',
        identityImages: { front: pngDataUrl, back: pngDataUrl },
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-staff-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.staff', password: 'support-staff-account-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.sm234', password: 'manager-sm234-account-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

    const officeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 3,
      payload: {
        unit: 'office', storeId: 'OFFICE', name: 'Kế toán do Hỗ trợ tạo', phone: '0907000003',
        cccd: '079999000001', address: '12 Đường IDOSI, TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Thực Tập Sinh', position: 'Kế Toán',
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'support.office', password: 'support-office-account-password',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-office-create-0001' }), env)
    expect(officeCreated.status).toBe(201)
    expect(await officeCreated.json()).toMatchObject({
      version: 4,
      employee: { id: 'VP-001', unit: 'office', position: 'Kế Toán', employmentType: 'Thực Tập Sinh' },
      user: { role: 'employee', employeeId: 'VP-001', storeId: 'OFFICE' },
    })

    const missingImages = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 4,
      payload: {
        unit: 'store', storeId: 'SM234', name: 'Thiếu ảnh', phone: '0907000099', cccd: '079999999999',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Part-Time', hourlyRate: 30_000,
        username: 'missing.images', password: 'missing-images-password',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-store-images-required-0001' }), env)
    expect(missingImages.status).toBe(400)
    expect(await missingImages.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGES_REQUIRED' } })

    const firstStoreCommand = {
      type: 'employee.create', expectedVersion: 4,
      payload: {
        id: 'CLIENT-ID-999', code: 'CLIENT-CODE-999', employeeCode: 'CLIENT-EMPLOYEE-999',
        unit: 'store', storeId: 'SM234', name: 'Bến', phone: '0907000004', cccd: '079999123456',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Part-Time', hourlyRate: 30_000,
        position: 'Nhân viên bán hàng', identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'sm234.ben', password: 'manual-ben-password',
      },
    }
    const firstStoreHeaders = { ...supportAuthorization, 'idempotency-key': 'support-store-ben-create-0001' }
    const firstStoreCreated = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', firstStoreCommand, firstStoreHeaders,
    ), env)
    expect(firstStoreCreated.status).toBe(201)
    const firstStoreBody = await firstStoreCreated.json()
    expect(firstStoreBody).toMatchObject({
      version: 5,
      employee: {
        id: 'SM234-001', unit: 'store', storeId: 'SM234', cccd: '079999123456',
        startDate: '2026-08-18', position: 'Nhân viên bán hàng', username: 'sm234.ben',
      },
      user: { role: 'employee', employeeId: 'SM234-001', username: 'sm234.ben' },
    })
    expect(firstStoreBody.employee).not.toHaveProperty('password')

    const duplicateNameCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 5,
      payload: {
        unit: 'store', storeId: 'SM234', name: 'Bến', phone: '0907000005', cccd: '079999654321',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Part-Time', hourlyRate: 31_000,
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'sm234.ben.2', password: 'manual-ben-2-password',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-store-ben-duplicate-create-0001' }), env)
    expect(duplicateNameCreated.status).toBe(201)
    expect(await duplicateNameCreated.json()).toMatchObject({
      version: 6,
      employee: { id: 'SM234-002', username: 'sm234.ben.2', position: 'Nhân viên bán hàng' },
    })

    const secondStoreCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 6,
      payload: {
        unit: 'store', storeId: 'S02', name: 'Anh', phone: '0907000006', cccd: '079999147852',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Part-Time', hourlyRate: 32_000,
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'th.anh', password: 'manual-anh-password',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-store-anh-create-0001' }), env)
    expect(secondStoreCreated.status).toBe(201)
    expect(await secondStoreCreated.json()).toMatchObject({
      version: 7,
      employee: { id: 'TH-001', username: 'th.anh' },
    })

    const replayed = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', firstStoreCommand, firstStoreHeaders,
    ), env)
    expect(replayed.status).toBe(201)
    expect(replayed.headers.get('idempotency-replayed')).toBe('true')
    const replayedBody = await replayed.json()
    expect(replayedBody).toMatchObject({ employee: { id: 'SM234-001' }, user: { username: 'sm234.ben' } })
    expect(replayedBody).not.toHaveProperty('generatedCredentials')

    const policyUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'policy.set', expectedVersion: 1,
      payload: { key: 'late_tolerance_minutes', value: 17 },
    }, { ...supportAuthorization, 'idempotency-key': 'support-policy-set-0001' }), env)
    expect(policyUpdated.status).toBe(200)
    expect(await policyUpdated.json()).toMatchObject({
      policy: { key: 'late_tolerance_minutes', value: 17, version: 2 },
    })
    const policiesUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'policies.set',
      payload: { updates: [{ key: 'early_check_in_limit_minutes', value: 100, expectedVersion: 1 }] },
    }, { ...supportAuthorization, 'idempotency-key': 'support-policies-set-0001' }), env)
    expect(policiesUpdated.status).toBe(200)
    expect(await policiesUpdated.json()).toMatchObject({
      policies: [{ key: 'early_check_in_limit_minutes', value: 100, version: 2 }],
    })
    expect(env.DB.database.prepare(`
      SELECT action, actor_role FROM audit_log
      WHERE action IN ('policy.set', 'policies.set') ORDER BY id
    `).all()).toEqual([
      { action: 'policy.set', actor_role: 'business_support' },
      { action: 'policies.set', actor_role: 'business_support' },
    ])

    const employeeUpdatedBySupport = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 7,
      payload: { employeeId: 'SM234-001', name: 'Bến cập nhật' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-staff-update-allowed-0001' }), env)
    expect(employeeUpdatedBySupport.status).toBe(200)
    expect(await employeeUpdatedBySupport.json()).toMatchObject({
      version: 8, employee: { id: 'SM234-001', name: 'Bến cập nhật' },
    })

    for (const [index, type] of ['employee.delete', 'system.reset_demo'].entries()) {
      const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type, expectedVersion: 8,
        payload: type === 'system.reset_demo'
          ? { state: { stores: [], employees: [] } }
          : { employeeId: 'SM234-001', name: 'Không được sửa' },
      }, { ...supportAuthorization, 'idempotency-key': `support-staff-forbidden-${index}-0001` }), env)
      expect(denied.status, type).toBe(403)
      expect(await denied.json(), type).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })
    }

    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'sm234.ben', password: 'manual-ben-password',
    }), env)
    expect(employeeLogin.status).toBe(200)
    const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
    const supportImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/TH-001/front', { headers: supportAuthorization },
    ), env)
    expect(supportImage.status).toBe(200)
    const ownStoreManagerImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/SM234-001/front', { headers: managerAuthorization },
    ), env)
    expect(ownStoreManagerImage.status).toBe(200)
    const crossStoreManagerImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/TH-001/front', { headers: managerAuthorization },
    ), env)
    expect(crossStoreManagerImage.status).toBe(403)
    const ownEmployeeImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/SM234-001/back', { headers: employeeAuthorization },
    ), env)
    expect(ownEmployeeImage.status).toBe(200)
    const crossEmployeeImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/TH-001/back', { headers: employeeAuthorization },
    ), env)
    expect(crossEmployeeImage.status).toBe(403)

    const receipt = env.DB.database.prepare(`
      SELECT response_json FROM command_receipts WHERE idempotency_key = 'support-store-ben-create-0001'
    `).get()
    expect(receipt.response_json).not.toContain('manual-ben-password')
    expect(receipt.response_json).not.toContain('generatedCredentials')
    const rawState = JSON.stringify(readHydratedState(env.DB.database))
    expect(rawState).not.toContain('manual-ben-password')
    expect(rawState).not.toContain('CLIENT-ID-999')
    expect(rawState).not.toContain('CLIENT-CODE-999')
    expect(rawState).not.toContain('CLIENT-EMPLOYEE-999')
    const auditJson = JSON.stringify(env.DB.database.prepare(`
      SELECT before_json, after_json, metadata_json FROM audit_log ORDER BY id
    `).all())
    expect(auditJson).not.toContain('manual-ben-password')
  })

  it('proxies authenticated Vietnamese address suggestions without exposing the Google key', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-address-suggestions' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'address-suggestions-admin-password',
      initialState: { stores: [], employees: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'address-suggestions-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const unavailable = await worker.fetch(new Request(
      'https://idosi.example/api/address-suggestions?type=province&query=ho', { headers: authorization },
    ), env)
    expect(unavailable.status).toBe(200)
    expect(await unavailable.json()).toMatchObject({ configured: false, suggestions: [] })

    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify({
      suggestions: [{
        placePrediction: {
          placeId: 'place-hcm', text: { text: 'Thành phố Hồ Chí Minh, Việt Nam' },
          structuredFormat: {
            mainText: { text: 'Thành phố Hồ Chí Minh' }, secondaryText: { text: 'Việt Nam' },
          },
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', upstreamFetch)
    try {
      env.GOOGLE_MAPS_API_KEY = 'google-maps-test-key-never-return'
      const suggested = await worker.fetch(new Request(
        'https://idosi.example/api/address-suggestions?type=ward&query=hiep&province=TP.%20Ho%20Chi%20Minh',
        { headers: authorization },
      ), env)
      expect(suggested.status).toBe(200)
      const suggestedBody = await suggested.json()
      expect(suggestedBody).toMatchObject({
        configured: true,
        suggestions: [{
          label: 'Thành phố Hồ Chí Minh, Việt Nam', value: 'Thành phố Hồ Chí Minh',
          placeId: 'place-hcm', province: 'TP. Ho Chi Minh', ward: 'Thành phố Hồ Chí Minh',
        }],
      })
      expect(JSON.stringify(suggestedBody)).not.toContain(env.GOOGLE_MAPS_API_KEY)
      expect(upstreamFetch).toHaveBeenCalledWith(
        'https://places.googleapis.com/v1/places:autocomplete',
        expect.objectContaining({ method: 'POST' }),
      )
      const upstreamOptions = upstreamFetch.mock.calls[0][1]
      expect(upstreamOptions.headers['X-Goog-Api-Key']).toBe(env.GOOGLE_MAPS_API_KEY)
      expect(upstreamOptions.headers['X-Goog-FieldMask']).toContain('suggestions.placePrediction.placeId')
      expect(JSON.parse(upstreamOptions.body)).toMatchObject({
        input: 'hiep, TP. Ho Chi Minh, Việt Nam', languageCode: 'vi', regionCode: 'vn',
        includedRegionCodes: ['vn'],
      })

      for (let index = 1; index < 30; index += 1) {
        const response = await worker.fetch(new Request(
          `https://idosi.example/api/address-suggestions?type=province&query=ho${index}`,
          { headers: authorization },
        ), env)
        expect(response.status).toBe(200)
      }
      const limited = await worker.fetch(new Request(
        'https://idosi.example/api/address-suggestions?type=province&query=limit',
        { headers: authorization },
      ), env)
      expect(limited.status).toBe(429)
      expect(await limited.json()).toMatchObject({ error: { code: 'ADDRESS_SUGGESTION_RATE_LIMITED' } })
      expect(upstreamFetch).toHaveBeenCalledTimes(30)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('restores the latest order edit atomically and reconciles shift revenue', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-order-operational-reset' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'order-operational-reset-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01', short: 'S01' }],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'HTKD-RESET', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', unit: 'business_support' },
        ],
        attendance: [{
          id: 'ATT-ORDER-01', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01',
          date: '2026-08-18', checkInAt: '2026-08-18T01:00:00.000Z', checkOutAt: '2026-08-18T10:00:00.000Z',
          revenue: 100_000, cash: 100_000, transfer: 0, orderCount: 1,
        }],
        orders: [{
          id: 'ORDER-RESET-01', code: 'S01-00001', storeId: 'S01', employeeId: 'E01', attendanceId: 'ATT-ORDER-01',
          amount: 100_000, customerName: 'Khách', paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order',
          createdAt: '2026-08-18T02:00:00.000Z', updatedAt: '2026-08-18T02:00:00.000Z', deletedAt: null,
        }],
        orderAudit: [], attendanceAudit: [], operationalResetHistory: [],
        payrollPeriods: [{ id: 'PAY-CLOSED', storeId: 'S01', period: '2026-08', status: 'Đã chốt', needsReclose: false }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'order-operational-reset-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const supportUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', expectedVersion: 0,
      payload: {
        role: 'business_support', employeeId: 'HTKD-RESET', username: 'support.reset',
        password: 'support-reset-password', displayName: 'Hỗ trợ KD',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-reset-user-create-0001' }), env)
    expect(supportUser.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.reset', password: 'support-reset-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update', expectedVersion: 1,
      payload: { orderId: 'ORDER-RESET-01', amount: 250_000, reason: 'Đối soát doanh thu' },
    }, { ...supportAuthorization, 'idempotency-key': 'order-before-operational-reset-0001' }), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ version: 2, order: { amount: 250_000 } })
    let state = readHydratedState(env.DB.database)
    expect(state.attendance[0]).toMatchObject({ revenue: 250_000, cash: 250_000, transfer: 0, orderCount: 1 })
    expect(state.payrollPeriods[0]).toMatchObject({ needsReclose: true, invalidationReason: 'order.update' })

    const resetCommand = {
      type: 'operational_reset.restore', expectedVersion: 2,
      payload: {
        dataType: 'orders', storeId: 'S01', employeeId: 'E01',
        fromDate: '2026-08-18', toDate: '2026-08-18', reason: 'Hoàn tác lần sửa gần nhất',
      },
    }
    const restored = await worker.fetch(jsonRequest('https://idosi.example/api/command', resetCommand, {
      ...adminAuthorization, 'idempotency-key': 'order-operational-reset-0001',
    }), env)
    expect(restored.status).toBe(200)
    const restoredBody = await restored.json()
    expect(restoredBody).toMatchObject({
      version: 3, restoredCount: 1, restoredIds: ['ORDER-RESET-01'],
      reset: { dataType: 'orders', storeId: 'S01', employeeId: 'E01', restoredCount: 1 },
      restored: [{ id: 'ORDER-RESET-01', amount: 100_000, status: 'Hoàn tất', deletedAt: null }],
    })
    const replay = await worker.fetch(jsonRequest('https://idosi.example/api/command', resetCommand, {
      ...adminAuthorization, 'idempotency-key': 'order-operational-reset-0001',
    }), env)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('idempotency-replayed')).toBe('true')
    expect(await replay.json()).toEqual(restoredBody)

    state = readHydratedState(env.DB.database)
    expect(state.orders[0]).toMatchObject({ id: 'ORDER-RESET-01', amount: 100_000, restoredAt: expect.any(String) })
    expect(state.attendance[0]).toMatchObject({ revenue: 100_000, cash: 100_000, transfer: 0, orderCount: 1 })
    expect(state.orderAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'Khôi phục', orderId: 'ORDER-RESET-01', changedFields: ['amount'],
        revenueBefore: 250_000, revenueAfter: 100_000,
      }),
      expect.objectContaining({ action: 'Sửa', orderId: 'ORDER-RESET-01', restoredAt: expect.any(String) }),
    ]))
    expect(state.operationalResetHistory[0]).toMatchObject({
      dataType: 'orders', restoredCount: 1, restoredIds: ['ORDER-RESET-01'], createdBy: { role: 'admin' },
    })
    expect(state.stores).toHaveLength(1)
    expect(state.employees).toHaveLength(2)
    expect(state.payrollPeriods).toHaveLength(1)
    const audit = env.DB.database.prepare("SELECT actor_role, entity_type, metadata_json FROM audit_log WHERE action = 'operational_reset.restore'").get()
    expect(audit).toMatchObject({ actor_role: 'admin', entity_type: 'operational-reset' })
    expect(JSON.parse(audit.metadata_json)).toMatchObject({ dataType: 'orders', restoredCount: 1 })
    const protectedHistoryMutation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge', expectedVersion: 3, payload: { patch: { attendanceAudit: [], operationalResetHistory: [] } },
    }, { ...adminAuthorization, 'idempotency-key': 'operational-history-raw-mutation-denied-0001' }), env)
    expect(protectedHistoryMutation.status).toBe(400)
    expect(await protectedHistoryMutation.json()).toMatchObject({ error: { code: 'DOMAIN_COMMAND_REQUIRED' } })
  })

  it('blocks paid order mutations and stale operational restore snapshots', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-paid-order-stale-reset' }
    const staleBefore = {
      id: 'ORDER-STALE', code: 'S02-00001', storeId: 'S02', employeeId: 'E02', amount: 50_000,
      customerName: 'Khách', paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order',
      createdAt: '2026-08-18T02:00:00.000Z', updatedAt: '2026-08-18T02:00:00.000Z', deletedAt: null,
    }
    const staleAfter = { ...staleBefore, amount: 75_000, updatedAt: '2026-08-18T03:00:00.000Z' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'paid-order-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01' }, { id: 'S02', name: 'Cửa hàng 02' }],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'E02', name: 'Nhân viên 02', storeId: 'S02', unit: 'store' },
          { id: 'HTKD-LOCK', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', unit: 'business_support' },
        ],
        orders: [{
          id: 'ORDER-PAID', code: 'S01-00001', storeId: 'S01', employeeId: 'E01', amount: 100_000,
          customerName: 'Khách', paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order',
          createdAt: '2026-08-18T02:00:00.000Z', deletedAt: null,
        }, { ...staleBefore, amount: 90_000 }],
        orderAudit: [{
          id: 'AUDIT-STALE', action: 'Sửa', orderId: 'ORDER-STALE', storeId: 'S02',
          before: staleBefore, after: staleAfter, createdAt: '2026-08-18T03:00:00.000Z',
        }],
        payrollPeriods: [{
          id: 'PAY-PAID', storeId: 'S01', period: '2026-08', status: 'Đã chi',
          confirmedAt: '2026-08-31T00:00:00.000Z',
        }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'paid-order-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const supportUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', expectedVersion: 0,
      payload: {
        role: 'business_support', employeeId: 'HTKD-LOCK', username: 'support.lock',
        password: 'support-lock-password', displayName: 'Hỗ trợ KD',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-lock-user-create-0001' }), env)
    expect(supportUser.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.lock', password: 'support-lock-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

    for (const [index, authorization] of [supportAuthorization, adminAuthorization].entries()) {
      const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.update', expectedVersion: 1,
        payload: { orderId: 'ORDER-PAID', amount: 200_000, reason: 'Kỳ đã chi' },
      }, { ...authorization, 'idempotency-key': `paid-order-update-denied-${index}` }), env)
      expect(denied.status).toBe(409)
      expect(await denied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })
    }
    const deleteDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.delete', expectedVersion: 1,
      payload: { orderId: 'ORDER-PAID', reason: 'Kỳ đã chi' },
    }, { ...supportAuthorization, 'idempotency-key': 'paid-order-delete-denied-0001' }), env)
    expect(deleteDenied.status).toBe(409)
    expect(await deleteDenied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })

    const staleReset = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'operational_reset.restore', expectedVersion: 1,
      payload: {
        dataType: 'orders', storeId: 'S02', employeeId: 'E02', fromDate: '2026-08-18', toDate: '2026-08-18',
        reason: 'Không được ghi đè thay đổi mới',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'stale-order-reset-denied-0001' }), env)
    expect(staleReset.status).toBe(409)
    expect(await staleReset.json()).toMatchObject({ error: { code: 'OPERATIONAL_RESET_STALE_AUDIT' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
  })

  it('resets all runtime data in two phases, verifies paginated R2 cleanup, and keeps only Admin access', async () => {
    const bucket = new MemoryR2()
    bucket.pageSize = 1
    const env = {
      DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-reset-all-runtime',
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'reset-all-runtime-admin-password',
      initialState: {
        schemaVersion: 2,
        stores: [{ id: 'S01', name: 'IDOSI Tô Ngọc Vân', short: 'TNV' }],
        employees: [], attendance: [{ id: 'ATT-LEGACY', employeeId: 'OLD-01', storeId: 'S01' }],
        orders: [{ id: 'ORDER-LEGACY', storeId: 'S01', amount: 100_000 }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const firstAdminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'reset-all-runtime-admin-password',
    }), env)
    const firstAdminAuthorization = { authorization: `Bearer ${(await firstAdminLogin.json()).token}` }
    const currentAdminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'reset-all-runtime-admin-password',
    }), env)
    const currentAdminLoginBody = await currentAdminLogin.json()
    const currentAdminAuthorization = { authorization: `Bearer ${currentAdminLoginBody.token}` }
    const adminId = currentAdminLoginBody.user.id
    const secondAdminId = 'admin-reset-secondary'
    const secondAdminPassword = await hashPassword('reset-secondary-admin-password')
    env.DB.database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, version,
        password_updated_at, created_at, updated_at
      ) VALUES (?, 'admin.secondary', 'admin.secondary', 'Admin phụ', ?, ?, ?, ?, 'admin', 'active', 1, ?, ?, ?)
    `).run(
      secondAdminId,
      secondAdminPassword.hash,
      secondAdminPassword.salt,
      secondAdminPassword.iterations,
      secondAdminPassword.algorithm,
      '2026-08-18T00:00:00.000Z',
      '2026-08-18T00:00:00.000Z',
      '2026-08-18T00:00:00.000Z',
    )
    const secondAdminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin.secondary', password: 'reset-secondary-admin-password',
    }), env)
    expect(secondAdminLogin.status).toBe(200)
    const secondAdminAuthorization = { authorization: `Bearer ${(await secondAdminLogin.json()).token}` }
    const pngBytes = new Uint8Array(validPngBytes(512))
    const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`

    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'store_manager', storeId: 'S01', name: 'Quản lý sẽ bị xóa', phone: '0909000001',
        cccd: '079999900001', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Quản lý cửa hàng',
        baseSalary: 15_000_000, standardWorkDays: 26, requiredMonthlyHours: 208,
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'manager.reset.all', password: 'manager-reset-all-password',
      },
    }, { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.reset.all', password: 'manager-reset-all-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    const settingsUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 2,
      payload: { name: 'Admin được giữ lại', email: 'admin@idosi.vn', avatar: pngDataUrl, notifications: { tasks: false } },
    }, { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-admin-settings-0001' }), env)
    const settingsUpdatedBody = await settingsUpdated.json()
    expect(settingsUpdated.status, JSON.stringify(settingsUpdatedBody)).toBe(200)
    const preservedAdminAvatarKey = settingsUpdatedBody.settings.avatar.key

    env.DB.database.prepare(`
      INSERT INTO app_state (scope_key, value_json, version, updated_at, updated_by, last_request_id)
      VALUES ('private:reset-fixture', '{"secretBusinessState":true}', 1, ?, ?, 'fixture-private-state')
    `).run('2026-08-18T00:00:00.000Z', adminId)
    env.DB.database.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES ('private:reset-fixture', 'privateRecords', ?, ?)
    `).run('2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z')
    const orphanKey = 'identity-images/orphan/front/orphan.png'
    const orphanAccountAvatarKey = 'account-avatars/orphan/avatar.png'
    await bucket.put(orphanKey, pngBytes)
    await bucket.put(orphanAccountAvatarKey, pngBytes)
    await bucket.put('other-prefix/must-survive.png', pngBytes)

    const missingConfirmation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_all', expectedVersion: 3, payload: { confirmation: 'RESET' },
    }, { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-confirmation-invalid-0001' }), env)
    expect(missingConfirmation.status).toBe(400)
    expect(await missingConfirmation.json()).toMatchObject({ error: { code: 'RESET_CONFIRMATION_REQUIRED' } })
    const managerDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_all', expectedVersion: 3, payload: { confirmation: 'RESET_ALL_DATA' },
    }, { ...managerAuthorization, 'idempotency-key': 'reset-all-manager-denied-0001' }), env)
    expect(managerDenied.status).toBe(403)
    expect(await managerDenied.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })

    const resetCommand = {
      type: 'system.reset_all', expectedVersion: 3, payload: { confirmation: 'RESET_ALL_DATA' },
    }
    const resetHeaders = { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-runtime-0001' }
    bucket.failDeleteKeys.add(orphanKey)
    const cleanupPending = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', resetCommand, resetHeaders,
    ), env)
    expect(cleanupPending.status).toBe(503)
    expect(await cleanupPending.json()).toMatchObject({ error: { code: 'RESET_CLEANUP_PENDING' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 4 })
    expect(env.DB.database.prepare('SELECT meta_key FROM system_metadata WHERE meta_key = ?').get(
      'system:reset_all_pending',
    )).toEqual({ meta_key: 'system:reset_all_pending' })
    expect(env.DB.database.prepare('SELECT id, role FROM users ORDER BY id').all()).toEqual([{ id: adminId, role: 'admin' }])
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 1 })
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM command_receipts').get()).toEqual({ count: 0 })
    expect((await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: currentAdminAuthorization,
    }), env)).status).toBe(200)
    expect((await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: firstAdminAuthorization,
    }), env)).status).toBe(401)
    expect((await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: secondAdminAuthorization,
    }), env)).status).toBe(401)
    expect((await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: managerAuthorization,
    }), env)).status).toBe(401)
    const mutationBlocked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge', expectedVersion: 4, payload: { patch: { forbiddenDuringCleanup: true } },
    }, { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-mutation-blocked-0001' }), env)
    expect(mutationBlocked.status).toBe(503)
    expect(await mutationBlocked.json()).toMatchObject({ error: { code: 'RESET_CLEANUP_PENDING' } })
    const logoutBlocked = await worker.fetch(jsonRequest(
      'https://idosi.example/api/logout', {}, currentAdminAuthorization,
    ), env)
    expect(logoutBlocked.status).toBe(503)

    bucket.failDeleteKeys.delete(orphanKey)
    const recoveryCommand = {
      type: 'system.reset_all', expectedVersion: 4, payload: { confirmation: 'RESET_ALL_DATA' },
    }
    const recoveryHeaders = { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-runtime-recovery-0001' }
    const resetCompleted = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', recoveryCommand, recoveryHeaders,
    ), env)
    expect(resetCompleted.status).toBe(200)
    const completedBody = await resetCompleted.json()
    expect(completedBody).toMatchObject({
      ok: true,
      command: 'system.reset_all',
      version: 4,
      reset: {
        purged: {
          accounts: 2,
          otherAdminAccounts: 1,
          nonAdminAccounts: 1,
          sessions: 3,
          commandReceipts: 2,
          privateStateScopes: 1,
          identityImageObjectsTargeted: 3,
          accountAvatarObjectsTargeted: 1,
        },
        preservedAdminAccountIds: [adminId],
        preservedCurrentAdminSession: true,
        preservedAdminAccountSettings: [adminId],
        defaultPolicyCount: 5,
        identityImagePrefix: 'identity-images/',
        identityImageStorageVerifiedEmpty: true,
        accountAvatarPrefix: 'account-avatars/',
        accountAvatarStorageVerified: true,
      },
      state: { stores: [], employees: [], attendance: [], orders: [] },
    })
    const replay = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', resetCommand, resetHeaders,
    ), env)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('idempotency-replayed')).toBe('true')
    expect(await replay.json()).toEqual(completedBody)

    expect(env.DB.database.prepare('SELECT meta_key FROM system_metadata WHERE meta_key = ?').get(
      'system:reset_all_pending',
    )).toBeUndefined()
    expect(env.DB.database.prepare('SELECT action, actor_id FROM audit_log').all()).toEqual([
      { action: 'system.reset_all', actor_id: adminId },
    ])
    expect(env.DB.database.prepare('SELECT actor_id, idempotency_key FROM command_receipts').all()).toEqual([
      { actor_id: adminId, idempotency_key: 'reset-all-runtime-0001' },
    ])
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM command_receipt_chunks').get()).toEqual({ count: 0 })
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM state_entities').get()).toEqual({ count: 17 })
    expect(env.DB.database.prepare(`
      SELECT collection_key, COUNT(*) AS count
      FROM state_entities
      GROUP BY collection_key
    `).all()).toEqual([{ collection_key: 'orderInformationOptions', count: 17 }])
    expect(env.DB.database.prepare('SELECT scope_key FROM app_state ORDER BY scope_key').all()).toEqual([{ scope_key: 'global' }])
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM counters').get()).toEqual({ count: 0 })
    expect(env.DB.database.prepare('SELECT policy_key, version FROM policies ORDER BY policy_key').all()).toEqual(
      Object.keys({
        attendance_improve_min_late_count: 1,
        attendance_improve_min_late_minutes: 1,
        attendance_maintain_max_late_count: 1,
        early_check_in_limit_minutes: 1,
        late_tolerance_minutes: 1,
      }).sort().map((policy_key) => ({ policy_key, version: 1 })),
    )
    const resetState = readHydratedState(env.DB.database)
    for (const key of [
      'stores', 'employees', 'attendance', 'orders', 'orderAudit', 'notifications',
      'expenseEntries', 'payrollPeriods', 'supportTransfers', 'supportWorkAssignments',
    ]) expect(resetState[key]).toEqual([])
    expect(resetState.orderInformationOptions).toHaveLength(17)
    expect(resetState.accountSettings[adminId]).toMatchObject({
      name: 'Admin được giữ lại', email: 'admin@idosi.vn',
      avatar: { key: preservedAdminAvatarKey, contentType: 'image/png', version: 1 },
      notifications: { tasks: false },
    })
    expect([...bucket.objects.keys()].sort()).toEqual([preservedAdminAvatarKey, 'other-prefix/must-survive.png'].sort())
    expect(bucket.deletedKeys).toEqual(expect.arrayContaining([
      orphanKey,
      orphanAccountAvatarKey,
      expect.stringMatching(/^identity-images\/QLCH-001\/front\//u),
      expect.stringMatching(/^identity-images\/QLCH-001\/back\//u),
    ]))
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('rejects an unsafe repeated R2 pagination cursor before mutating D1', async () => {
    const bucket = new MemoryR2()
    bucket.pageSize = 1
    bucket.repeatCursor = true
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const key of [
      'identity-images/orphan-a/front/a.png',
      'identity-images/orphan-b/front/b.png',
      'identity-images/orphan-c/front/c.png',
    ]) await bucket.put(key, pngBytes)
    const env = {
      DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-reset-repeated-cursor',
    }
    await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'reset-repeated-cursor-admin-password',
      initialState: { stores: [{ id: 'S01', name: 'Store must remain' }], employees: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'reset-repeated-cursor-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_all', expectedVersion: 1, payload: { confirmation: 'RESET_ALL_DATA' },
    }, { ...authorization, 'idempotency-key': 'reset-repeated-cursor-0001' }), env)
    expect(denied.status).toBe(503)
    expect(await denied.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGE_LIST_FAILED' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
    expect(readHydratedState(env.DB.database).stores).toEqual([{ id: 'S01', name: 'Store must remain' }])
    expect(env.DB.database.prepare('SELECT meta_key FROM system_metadata WHERE meta_key = ?').get(
      'system:reset_all_pending',
    )).toBeUndefined()
    expect(bucket.objects.size).toBe(3)
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('promotes an existing store employee to a dual store-manager role without manager salary', async () => {
    const env = {
      DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-store-manager-promotion',
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'store-manager-promotion-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Dosii Tô Ngọc Vân', short: 'TNV' }],
        employees: [], attendance: [], payrollPeriods: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'store-manager-promotion-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const storeEmployeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'store', storeId: 'S01', name: 'Nhân viên kiêm quản lý', phone: '0908000001',
        cccd: '079888000001', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Nhân viên bán hàng', baseSalary: 9_000_000,
        standardWorkDays: 26, requiredMonthlyHours: 208,
        username: 'dual.manager', password: 'dual-manager-password', identityImages: testIdentityImages(),
      },
    }, { ...authorization, 'idempotency-key': 'dual-store-employee-create-0001' }), env)
    expect(storeEmployeeCreated.status).toBe(201)
    const storeEmployeeBody = await storeEmployeeCreated.json()
    expect(storeEmployeeBody).toMatchObject({
      version: 2,
      employee: {
        id: 'DOSII-TNV-001', unit: 'store',
      },
      user: { role: 'employee', employeeId: 'DOSII-TNV-001' },
    })
    expect(storeEmployeeBody.employee).not.toHaveProperty('baseSalary')

    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'dual.manager', password: 'dual-manager-password',
    }), env)
    expect(employeeLogin.status).toBe(200)
    const employeeToken = (await employeeLogin.json()).token

    const promoted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 2,
      payload: {
        unit: 'store_manager', storeId: 'S01', linkedEmployeeId: 'DOSII-TNV-001',
      },
    }, { ...authorization, 'idempotency-key': 'dual-store-manager-promote-0001' }), env)
    expect(promoted.status).toBe(201)
    expect(await promoted.json()).toMatchObject({
      version: 3,
      employee: {
        id: 'QLCH-001', linkedEmployeeId: 'DOSII-TNV-001', baseSalary: 0, salary: 0,
        payBasis: 'allowance-only', salaryUnit: 'none', payFormula: 'allowance-bonus-only',
      },
      user: { role: 'employee', employeeId: 'DOSII-TNV-001', storeId: 'S01' },
    })

    const existingEmployeeSession = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: { authorization: `Bearer ${employeeToken}` },
    }), env)
    expect(existingEmployeeSession.status).toBe(200)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'dual.manager', password: 'dual-manager-password',
    }), env)
    expect(managerLogin.status).toBe(200)
    const managerLoginBody = await managerLogin.clone().json()
    expect(managerLoginBody).toMatchObject({
      user: {
        role: 'employee', employeeId: 'DOSII-TNV-001', storeId: 'S01', needsRoleSelection: true,
        availableRoles: expect.arrayContaining([
          expect.objectContaining({ role: 'employee', employeeId: 'DOSII-TNV-001', storeId: 'S01' }),
          expect.objectContaining({ role: 'store_manager', employeeId: 'QLCH-001', storeId: 'S01' }),
        ]),
      },
    })
    const managerToken = managerLoginBody.token
    const roleSelected = await worker.fetch(jsonRequest('https://idosi.example/api/session/role', {
      role: 'store_manager', employeeId: 'QLCH-001', storeId: 'S01',
    }, { authorization: `Bearer ${managerToken}` }), env)
    expect(roleSelected.status).toBe(200)
    expect(await roleSelected.json()).toMatchObject({
      user: { role: 'store_manager', employeeId: 'QLCH-001', storeId: 'S01' },
    })
    const managerProjection = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: { authorization: `Bearer ${managerToken}` },
    }), env)
    const managerState = (await managerProjection.json()).state
    const projectedStoreEmployee = managerState.employees.find(({ id }) => id === 'DOSII-TNV-001')
    expect(projectedStoreEmployee).toMatchObject({ unit: 'store' })
    expect(projectedStoreEmployee).not.toHaveProperty('baseSalary')
    const rawProfiles = readHydratedState(env.DB.database).employees
    expect(rawProfiles.find(({ id }) => id === 'QLCH-001')).toMatchObject({
      linkedEmployeeId: 'DOSII-TNV-001', baseSalary: 0, salaryUnit: 'none',
    })
    const persistedStoreEmployee = rawProfiles.find(({ id }) => id === 'DOSII-TNV-001')
    expect(persistedStoreEmployee).toMatchObject({ unit: 'store' })
    expect(persistedStoreEmployee).not.toHaveProperty('baseSalary')

    const deletedManagerRole = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.delete', expectedVersion: 3,
      payload: { employeeId: 'QLCH-001' },
    }, { ...authorization, 'idempotency-key': 'dual-store-manager-delete-0001' }), env)
    expect(deletedManagerRole.status).toBe(200)
    const revokedManagerSession = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: { authorization: `Bearer ${managerToken}` },
    }), env)
    expect(revokedManagerSession.status).toBe(401)
    const employeeOnlyLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'dual.manager', password: 'dual-manager-password',
    }), env)
    expect(employeeOnlyLogin.status).toBe(200)
    expect(await employeeOnlyLogin.json()).toMatchObject({
      user: { role: 'employee', employeeId: 'DOSII-TNV-001', storeId: 'S01' },
    })

    const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 4,
      payload: {
        unit: 'business_support', name: 'Hỗ trợ ba vai trò', phone: '0908000002',
        cccd: '079888000002', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Part-Time', position: 'NV hỗ trợ KD',
        username: 'triple.role', password: 'triple-role-password', identityImages: testIdentityImages(),
        workShifts: [{ id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' }],
      },
    }, { ...authorization, 'idempotency-key': 'triple-role-support-create-0001' }), env)
    expect(supportCreated.status).toBe(201)
    const supportProfile = (await supportCreated.json()).employee

    const linkedStoreRole = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 5,
      payload: {
        unit: 'store', storeId: 'S01', linkedEmployeeId: supportProfile.id,
        employmentType: 'Part-Time', startDate: '2026-08-18', hourlyRate: 25_000,
        salary: 25_000, age: 28, position: 'Nhân viên bán hàng',
      },
    }, { ...authorization, 'idempotency-key': 'triple-role-store-link-0001' }), env)
    expect(linkedStoreRole.status).toBe(201)
    const linkedStoreProfile = (await linkedStoreRole.json()).employee

    const linkedManagerRole = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 6,
      payload: { unit: 'store_manager', storeId: 'S01', linkedEmployeeId: supportProfile.id },
    }, { ...authorization, 'idempotency-key': 'triple-role-manager-link-0001' }), env)
    expect(linkedManagerRole.status).toBe(201)
    const linkedManagerProfile = (await linkedManagerRole.json()).employee

    const tripleLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'triple.role', password: 'triple-role-password',
    }), env)
    expect(tripleLogin.status).toBe(200)
    const tripleLoginBody = await tripleLogin.json()
    expect(tripleLoginBody.user).toMatchObject({
      role: 'business_support', employeeId: supportProfile.id, needsRoleSelection: true,
      availableRoles: expect.arrayContaining([
        expect.objectContaining({ role: 'business_support', employeeId: supportProfile.id }),
        expect.objectContaining({ role: 'employee', employeeId: linkedStoreProfile.id, storeId: 'S01' }),
        expect.objectContaining({ role: 'store_manager', employeeId: linkedManagerProfile.id, storeId: 'S01' }),
      ]),
    })
    const tripleManagerSelection = await worker.fetch(jsonRequest('https://idosi.example/api/session/role', {
      role: 'store_manager', employeeId: linkedManagerProfile.id, storeId: 'S01',
    }, { authorization: `Bearer ${tripleLoginBody.token}` }), env)
    expect(tripleManagerSelection.status).toBe(200)
    expect(await tripleManagerSelection.json()).toMatchObject({
      user: { role: 'store_manager', employeeId: linkedManagerProfile.id, storeId: 'S01' },
    })

    const managerSettingsUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 7,
      payload: { name: 'Hỗ trợ ba vai trò' },
    }, { authorization: `Bearer ${tripleLoginBody.token}`, 'idempotency-key': 'triple-role-manager-settings-0001' }), env)
    expect(managerSettingsUpdated.status).toBe(200)
    expect(await managerSettingsUpdated.json()).toMatchObject({
      version: 8,
      user: {
        role: 'store_manager', employeeId: linkedManagerProfile.id, storeId: 'S01',
        availableRoles: expect.arrayContaining([
          expect.objectContaining({ role: 'business_support', employeeId: supportProfile.id }),
          expect.objectContaining({ role: 'employee', employeeId: linkedStoreProfile.id, storeId: 'S01' }),
          expect.objectContaining({ role: 'store_manager', employeeId: linkedManagerProfile.id, storeId: 'S01' }),
        ]),
      },
    })

    const officeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 8,
      payload: {
        unit: 'office', storeId: 'OFFICE', name: 'Văn phòng kiêm bán hàng', phone: '0908000003',
        cccd: '079888000003', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Marketing', username: 'office.store.role',
        password: 'office-store-role-password', identityImages: testIdentityImages(),
      },
    }, { ...authorization, 'idempotency-key': 'office-store-role-source-0001' }), env)
    expect(officeCreated.status).toBe(201)
    const officeProfile = (await officeCreated.json()).employee
    const officeStoreRole = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 9,
      payload: { unit: 'store', storeId: 'S01', linkedEmployeeId: officeProfile.id, hourlyRate: 27_000, salary: 27_000 },
    }, { ...authorization, 'idempotency-key': 'office-store-role-link-0001' }), env)
    expect(officeStoreRole.status).toBe(201)
    const officeStoreProfile = (await officeStoreRole.json()).employee
    expect(officeStoreProfile).toMatchObject({
      unit: 'store', storeId: 'S01', linkedEmployeeId: officeProfile.id,
      employmentType: 'Part-Time', hourlyRate: 27_000, salaryUnit: 'hour',
    })
    const officeRoleLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'office.store.role', password: 'office-store-role-password',
    }), env)
    expect(officeRoleLogin.status).toBe(200)
    expect(await officeRoleLogin.json()).toMatchObject({
      user: {
        role: 'employee', employeeId: officeProfile.id, needsRoleSelection: true,
        availableRoles: expect.arrayContaining([
          expect.objectContaining({ role: 'employee', employeeId: officeProfile.id, label: 'Nhân viên văn phòng' }),
          expect.objectContaining({ role: 'employee', employeeId: officeStoreProfile.id, storeId: 'S01', label: 'Nhân viên cửa hàng' }),
        ]),
      },
    })
    const duplicateOfficeStoreRole = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 10,
      payload: { unit: 'store', storeId: 'S01', linkedEmployeeId: officeProfile.id, hourlyRate: 30_000, salary: 30_000 },
    }, { ...authorization, 'idempotency-key': 'office-store-role-duplicate-0001' }), env)
    expect(duplicateOfficeStoreRole.status).toBe(409)
    expect(await duplicateOfficeStoreRole.json()).toMatchObject({ error: { code: 'LINKED_EMPLOYEE_ROLE_EXISTS' } })
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }, 30_000)

  it('excludes an Admin-created assigned order from employee checkout reconciliation', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
      const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-exact-order-creator-checkout' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'exact-order-creator-admin-password',
        initialState: {
          stores: [{ id: 'S01', short: 'TNV', name: 'IDOSI Tô Ngọc Vân', status: 'Đang hoạt động' }],
          employees: [{
            id: 'E01', name: 'Nhân viên Một', storeId: 'S01', unit: 'store', status: 'Đang làm việc',
            employmentType: 'Part-Time', hourlyRate: 30_000,
          }, {
            id: 'HTKD-ORDER', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT',
            unit: 'business_support', status: 'Đang làm việc',
          }],
          attendance: [{
            id: 'ATT-E01', employeeId: 'E01', employeeName: 'Nhân viên Một', storeId: 'S01',
            date: '2026-08-20', workDate: '2026-08-20', shiftId: 'CA-SAME', shift: 'CA-SAME',
            shiftName: 'Ca chung', shiftStart: '08:00', shiftEnd: '17:00',
            checkIn: '08:00', checkInAt: '2026-08-20T01:00:00.000Z', checkOut: null, checkOutAt: null,
          }],
          orders: [{
            id: 'ORDER-OWN', code: 'S01-OWN', storeId: 'S01', employeeId: 'E01',
            createdByEmployeeId: 'E01', createdBy: { role: 'employee', employeeId: 'E01' },
            attendanceId: 'ATT-E01', shiftId: 'CA-SAME', amount: 120_000,
            paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order', createdAt: '2026-08-20T02:00:00.000Z',
          }, {
            id: 'ORDER-ADMIN-ASSIGNED', code: 'S01-ADMIN', storeId: 'S01', employeeId: 'E01',
            createdBy: { id: 'admin', role: 'admin' }, attendanceId: 'ATT-E01', shiftId: 'CA-SAME',
            amount: 900_000, paymentMethod: 'Chuyển khoản', status: 'Hoàn tất', source: 'order',
            createdAt: '2026-08-20T02:05:00.000Z',
          }],
          notifications: [{
            id: 'N-ORDER-OWN', type: 'order.created', storeId: 'S01', employeeId: 'E01',
            orderId: 'ORDER-OWN', orderCode: 'S01-OWN', title: 'Đơn do nhân viên tạo',
          }, {
            id: 'N-ORDER-OWN-LEGACY', type: 'order.created', storeId: 'S01', employeeId: 'E01',
            orderId: 'S01-OWN', title: 'Đơn legacy dùng mã trong orderId',
          }, {
            id: 'N-ORDER-ADMIN', type: 'order.created', storeId: 'S01', employeeId: 'E01',
            orderId: 'ORDER-ADMIN-ASSIGNED', orderCode: 'S01-ADMIN', title: 'Đơn do Admin tạo và gán',
          }],
          tasks: [], schedule: [], shiftDefinitions: [], supportTransfers: [],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)

      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'exact-order-creator-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
      const userCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create',
        payload: {
          username: 'employee.one', password: 'employee-one-password', displayName: 'Nhân viên Một',
          storeId: 'S01', employeeId: 'E01', role: 'employee',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'exact-order-creator-user-0001' }), env)
      expect(userCreated.status).toBe(201)
      const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'employee.one', password: 'employee-one-password',
      }), env)
      const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }

      const employeeStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      expect(employeeStateResponse.status).toBe(200)
      const employeeState = (await employeeStateResponse.json()).state
      expect(employeeState.orders.map(({ id }) => id)).toEqual(['ORDER-OWN'])
      expect(employeeState.notifications.map(({ id }) => id)).toEqual(['N-ORDER-OWN', 'N-ORDER-OWN-LEGACY'])

      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 1,
        payload: {
          attendanceId: 'ATT-E01', cashRevenue: 120_000, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'exact-order-creator-checkout-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 2,
        attendance: {
          id: 'ATT-E01', orderCount: 1, revenue: 120_000, cash: 120_000, transfer: 0,
          revenueReconciliation: {
            matched: true, expectedCash: 120_000, expectedTransfer: 0, expectedTotal: 120_000,
          },
        },
      })

      const adminOrderUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.update', expectedVersion: 2,
        payload: { orderId: 'ORDER-ADMIN-ASSIGNED', amount: 950_000, reason: 'Đối soát đơn do Admin tạo' },
      }, { ...adminAuthorization, 'idempotency-key': 'exact-order-creator-admin-update-0001' }), env)
      expect(adminOrderUpdated.status).toBe(200)
      expect(await adminOrderUpdated.json()).toMatchObject({ version: 3, order: { amount: 950_000 } })
      expect(readHydratedState(env.DB.database).attendance[0]).toMatchObject({
        id: 'ATT-E01', orderCount: 1, revenue: 120_000, cash: 120_000, transfer: 0,
      })

      const adminOrderRestored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'operational_reset.restore', expectedVersion: 3,
        payload: {
          dataType: 'orders', storeId: 'S01', employeeId: 'E01',
          fromDate: '2026-08-20', toDate: '2026-08-20', reason: 'Hoàn tác đơn do Admin tạo',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'exact-order-creator-admin-reset-0001' }), env)
      expect(adminOrderRestored.status).toBe(200)
      expect(await adminOrderRestored.json()).toMatchObject({
        version: 4, restoredCount: 1, restoredIds: ['ORDER-ADMIN-ASSIGNED'],
      })
      expect(readHydratedState(env.DB.database).attendance[0]).toMatchObject({
        id: 'ATT-E01', orderCount: 1, revenue: 120_000, cash: 120_000, transfer: 0,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('assigns future store tasks and reconciles employee checkout against mandatory customer orders', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-18T01:00:00.000Z'))
      const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-employee-shift-reconciliation' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'employee-shift-admin-password',
        initialState: {
          stores: [
            { id: 'S01', short: 'TNV', name: 'IDOSI Tô Ngọc Vân', status: 'Đang hoạt động' },
            { id: 'S02', short: 'TH', name: 'IDOSI Tây Hòa', status: 'Đang hoạt động' },
          ],
          employees: [
            { id: 'E01', name: 'Nhân viên Một', phone: '0901234567', cccd: '079123456789', address: '12 Tô Ngọc Vân', startDate: '2026-08-01', storeId: 'S01', unit: 'store', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30_000 },
            { id: 'E02', name: 'Nhân viên Hai', storeId: 'S02', unit: 'store', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30_000 },
            { id: 'HTKD-01', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
            { id: 'QLCH-01', name: 'Quản lý S01', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc' },
            { id: 'QLCH-02', name: 'Quản lý S02', storeId: 'S02', unit: 'store_manager', status: 'Đang làm việc' },
          ],
          attendance: [], schedule: [], tasks: [], taskAssignmentHistory: [], notifications: [],
          shiftDefinitions: [], orders: [], orderAudit: [], expenseEntries: [], fixedExpenses: [],
          cashTransactions: [], salaryAdjustments: [], salaryAdvances: [], payrollPeriods: [], payrollPayments: [],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'employee-shift-admin-password',
      }), env)
      let adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
      for (const account of [
        { username: 'employee.one', password: 'employee-one-password', displayName: 'Nhân viên Một', storeId: 'S01', employeeId: 'E01', role: 'employee' },
        { username: 'employee.two', password: 'employee-two-password', displayName: 'Nhân viên Hai', storeId: 'S02', employeeId: 'E02', role: 'employee' },
        { username: 'support.ops', password: 'support-ops-password', displayName: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-01', role: 'business_support' },
        { username: 'manager.s01', password: 'manager-s01-password', displayName: 'Quản lý S01', storeId: 'S01', employeeId: 'QLCH-01', role: 'store_manager' },
        { username: 'manager.s02', password: 'manager-s02-password', displayName: 'Quản lý S02', storeId: 'S02', employeeId: 'QLCH-02', role: 'store_manager' },
      ]) {
        const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type: 'user.create', payload: account,
        }, { ...adminAuthorization, 'idempotency-key': `employee-shift-user-${account.employeeId}` }), env)
        expect(created.status, account.employeeId).toBe(201)
      }
      const loginAs = async (username, password) => {
        const response = await worker.fetch(jsonRequest('https://idosi.example/api/login', { username, password }), env)
        expect(response.status).toBe(200)
        return { authorization: `Bearer ${(await response.json()).token}` }
      }
      let employeeAuthorization = await loginAs('employee.one', 'employee-one-password')
      const otherEmployeeAuthorization = await loginAs('employee.two', 'employee-two-password')
      let supportAuthorization = await loginAs('support.ops', 'support-ops-password')
      const managerAuthorization = await loginAs('manager.s01', 'manager-s01-password')
      let destinationManagerAuthorization = await loginAs('manager.s02', 'manager-s02-password')

      const shiftCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'shift_definition.create', expectedVersion: 1,
        payload: { storeId: 'S01', id: 'SHIFT-FUTURE', name: 'Ca tương lai', date: '2026-08-20', start: '08:00', end: '17:00' },
      }, { ...supportAuthorization, 'idempotency-key': 'support-future-shift-0001' }), env)
      expect(shiftCreated.status).toBe(201)
      expect(await shiftCreated.json()).toMatchObject({ version: 2, shift: { id: 'SHIFT-FUTURE', storeId: 'S01' } })

      const assigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'tasks.assign', expectedVersion: 2,
        payload: {
          storeId: 'S01', date: '2026-08-20', shiftId: 'SHIFT-FUTURE', employeeIds: ['E01'],
          tasks: [
            { id: 'TASK-FUTURE-01', title: 'Mở cửa hàng', detail: 'Kiểm tra vệ sinh' },
            { id: 'TASK-FUTURE-02', title: 'Kiểm hàng', detail: 'Ghi nhận tồn kho' },
          ],
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-future-task-0001' }), env)
      expect(assigned.status).toBe(201)
      const assignedBody = await assigned.json()
      expect(assignedBody).toMatchObject({
        version: 3,
        employeeIds: ['E01'],
        tasks: [
          { id: 'TASK-FUTURE-01', employeeIds: ['E01'] },
          { id: 'TASK-FUTURE-02', employeeIds: ['E01'] },
        ],
        notifications: [{ type: 'store-task-assigned', employeeId: 'E01', route: '/employee/home' }],
        history: { action: 'assigned', employeeIds: ['E01'], taskCount: 2 },
      })

      const crossStoreAssignment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'tasks.assign', expectedVersion: 3,
        payload: {
          storeId: 'S01', date: '2026-08-20', shiftId: 'SHIFT-FUTURE', employeeIds: ['E02'],
          tasks: [{ title: 'Không hợp lệ' }],
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-cross-store-task-0001' }), env)
      expect(crossStoreAssignment.status).toBe(400)
      expect(await crossStoreAssignment.json()).toMatchObject({ error: { code: 'EMPLOYEE_STORE_MISMATCH' } })
      const managerCrossStore = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'tasks.assign', expectedVersion: 3,
        payload: {
          storeId: 'S02', date: '2026-08-20', employeeIds: ['E02'], tasks: [{ title: 'Vượt phạm vi' }],
        },
      }, { ...managerAuthorization, 'idempotency-key': 'manager-cross-store-task-0001' }), env)
      expect(managerCrossStore.status).toBe(403)
      expect(await managerCrossStore.json()).toMatchObject({ error: { code: 'STORE_SCOPE_FORBIDDEN' } })
      const otherEmployeeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.done', expectedVersion: 3, payload: { taskId: 'TASK-FUTURE-01', done: true },
      }, { ...otherEmployeeAuthorization, 'idempotency-key': 'other-employee-task-denied-0001' }), env)
      expect(otherEmployeeDenied.status).toBe(403)
      expect(await otherEmployeeDenied.json()).toMatchObject({ error: { code: 'TASK_FORBIDDEN' } })

      const scheduled = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'schedule.assign', expectedVersion: 3,
        payload: { storeId: 'S01', date: '2026-08-20', employeeIds: ['E01'], shiftIds: ['SHIFT-FUTURE'] },
      }, { ...supportAuthorization, 'idempotency-key': 'support-future-schedule-0001' }), env)
      expect(scheduled.status).toBe(200)
      expect(await scheduled.json()).toMatchObject({ version: 4, assignments: [{ employeeId: 'E01', shiftId: 'SHIFT-FUTURE' }] })
      const employeeBeforeShift = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      const employeeBeforeShiftState = (await employeeBeforeShift.json()).state
      expect(employeeBeforeShiftState.tasks.map(({ id }) => id).sort()).toEqual(['TASK-FUTURE-01', 'TASK-FUTURE-02'])
      expect(employeeBeforeShiftState.notifications).toEqual([
        expect.objectContaining({ type: 'store-task-assigned', employeeId: 'E01' }),
      ])
      expect(employeeBeforeShiftState.taskAssignmentHistory).toEqual([
        expect.objectContaining({ action: 'assigned', employeeIds: ['E01'] }),
      ])
      const prematureDone = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.done', expectedVersion: 4, payload: { taskId: 'TASK-FUTURE-01', done: true },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-premature-task-0001' }), env)
      expect(prematureDone.status).toBe(409)
      expect(await prematureDone.json()).toMatchObject({ error: { code: 'TASK_DATE_INVALID' } })

      vi.setSystemTime(new Date('2026-08-20T01:00:00.000Z'))
      adminAuthorization = await loginAs('admin', 'employee-shift-admin-password')
      employeeAuthorization = await loginAs('employee.one', 'employee-one-password')
      supportAuthorization = await loginAs('support.ops', 'support-ops-password')
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 4,
        payload: { shiftId: 'SHIFT-FUTURE', location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-future-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      const checkedInBody = await checkedIn.json()
      const attendanceId = checkedInBody.attendance.id
      expect(checkedInBody.attendance).not.toHaveProperty('checklistSnapshot')
      const completedTask = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.done', expectedVersion: 5, payload: { taskId: 'TASK-FUTURE-01', done: true },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-task-done-0001' }), env)
      expect(completedTask.status).toBe(200)
      expect(await completedTask.json()).toMatchObject({ version: 6, task: { completedBy: { E01: true } } })

      const missingCustomerProfile = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 6,
        payload: { storeId: 'S01', customerName: 'Thiếu hồ sơ', amount: 100_000, paymentMethod: 'Tiền mặt' },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-order-profile-required-0001' }), env)
      expect(missingCustomerProfile.status).toBe(400)
      expect(await missingCustomerProfile.json()).toMatchObject({ error: { code: 'ORDER_GENDER_INVALID' } })
      const invalidOccupation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 6,
        payload: {
          storeId: 'S01', customerName: 'Nghề ngoài danh mục', gender: 'Nữ', occupation: 'Kế toán',
          acquisitionChannel: 'Facebook', amount: 100_000, paymentMethod: 'Tiền mặt',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-order-invalid-occupation-0001' }), env)
      expect(invalidOccupation.status).toBe(400)
      expect(await invalidOccupation.json()).toMatchObject({ error: { code: 'ORDER_OCCUPATION_INVALID' } })
      const spoofedOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 6,
        payload: {
          storeId: 'S02', employeeId: 'E02', attendanceId: 'ATT-SPOOF', customerName: 'Giả mạo',
          gender: 'Khác', occupation: 'Khác', acquisitionChannel: 'Khác', amount: 100_000, paymentMethod: 'Tiền mặt',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-order-spoof-0001' }), env)
      expect(spoofedOrder.status).toBe(403)
      expect(await spoofedOrder.json()).toMatchObject({ error: { code: 'STORE_FORBIDDEN' } })

      const cashOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 6,
        payload: {
          storeId: 'S01', employeeId: 'E02', attendanceId: 'ATT-SPOOF', customerName: 'Khách tiền mặt',
          gender: 'Nữ', occupation: 'Nhân viên VP', acquisitionChannel: 'Facebook', amount: 100_000, paymentMethod: 'Tiền mặt',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-cash-order-0001' }), env)
      expect(cashOrder.status).toBe(201)
      const cashOrderBody = await cashOrder.json()
      expect(cashOrderBody).toMatchObject({
        version: 7,
        order: {
          storeId: 'S01', employeeId: 'E01', attendanceId, gender: 'Nữ', occupation: 'Nhân viên VP',
          acquisitionChannel: 'Facebook', paymentMethod: 'Tiền mặt', amount: 100_000,
        },
      })
      const transferOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 7,
        payload: {
          storeId: 'S01', customerName: 'Khách chuyển khoản', gender: 'Nam', occupation: 'Kỹ sư',
          acquisitionChannel: 'Tiktok', amount: 200_000, paymentMethod: 'Chuyển khoản',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-transfer-order-0001' }), env)
      expect(transferOrder.status).toBe(201)
      const transferOrderBody = await transferOrder.json()
      expect(transferOrderBody).toMatchObject({ version: 8, order: { attendanceId, acquisitionChannel: 'Tiktok' } })
      const invalidOccupationUpdate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.update', expectedVersion: 8,
        payload: { orderId: transferOrderBody.order.id, occupation: 'Kế toán', reason: 'Thử nghề ngoài danh mục' },
      }, { ...adminAuthorization, 'idempotency-key': 'admin-order-invalid-occupation-update-0001' }), env)
      expect(invalidOccupationUpdate.status).toBe(400)
      expect(await invalidOccupationUpdate.json()).toMatchObject({ error: { code: 'ORDER_OCCUPATION_INVALID' } })
      const updatedOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.update', expectedVersion: 8,
        payload: {
          orderId: transferOrderBody.order.id, gender: 'Khác', occupation: 'Giáo viên',
          acquisitionChannel: 'Zalo', reason: 'Bổ sung hồ sơ khách hàng',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'admin-order-profile-update-0001' }), env)
      expect(updatedOrder.status).toBe(200)
      expect(await updatedOrder.json()).toMatchObject({
        version: 9,
        order: { gender: 'Khác', occupation: 'Giáo viên', acquisitionChannel: 'Zalo' },
        audit: { changedFields: ['gender', 'occupation', 'acquisitionChannel'] },
      })

      const mismatchCheckout = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 9,
        payload: {
          attendanceId, cashRevenue: 50_000, transferRevenue: 200_000,
          incompleteTaskReason: 'Còn kiểm hàng',
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-checkout-mismatch-0001' }), env)
      expect(mismatchCheckout.status).toBe(409)
      expect(await mismatchCheckout.json()).toMatchObject({
        error: {
          code: 'SHIFT_REVENUE_MISMATCH',
          details: {
            expected: { cashRevenue: 100_000, transferRevenue: 200_000, totalRevenue: 300_000 },
            received: { cashRevenue: 50_000, transferRevenue: 200_000, totalRevenue: 250_000 },
          },
        },
      })
      const taskProgressSaved = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.progress.save', expectedVersion: 9,
        payload: {
          attendanceId,
          tasks: [
            { id: 'TASK-FUTURE-01', completed: true },
            { id: 'TASK-FUTURE-02', completed: false },
          ],
          incompleteReason: 'Chưa hoàn tất kiểm hàng vì khách đông',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-checklist-complete-0001' }), env)
      expect(taskProgressSaved.status).toBe(200)
      expect(await taskProgressSaved.json()).toMatchObject({ version: 10 })

      const reasonRequired = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 10,
        payload: {
          attendanceId, cashRevenue: 100_000, transferRevenue: 200_000,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-checkout-reason-required-0001' }), env)
      expect(reasonRequired.status).toBe(400)
      expect(await reasonRequired.json()).toMatchObject({
        error: { code: 'INCOMPLETE_TASK_REASON_REQUIRED', details: { taskIds: ['TASK-FUTURE-02'] } },
      })
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 10,
        payload: {
          attendanceId, cashRevenue: 100_000, transferRevenue: 200_000,
          incompleteTaskReason: 'Chưa hoàn tất kiểm hàng vì khách đông',
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-checkout-success-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 11,
        attendance: {
          id: attendanceId, orderCount: 2, revenue: 300_000, cash: 100_000, transfer: 200_000,
          declaredRevenue: { cash: 100_000, transfer: 200_000, total: 300_000 },
          revenueReconciliation: {
            matched: true, expectedCash: 100_000, expectedTransfer: 200_000, expectedTotal: 300_000,
          },
          incompleteTaskReason: 'Chưa hoàn tất kiểm hàng vì khách đông',
          incompleteTasksSnapshot: [{ id: 'TASK-FUTURE-02', title: 'Kiểm hàng' }],
        },
      })
      const persistedState = readHydratedState(env.DB.database)
      const assignedTaskHistory = persistedState.taskAssignmentHistory.find(({ action }) => action === 'assigned')
      expect(assignedTaskHistory).toMatchObject({
        tasks: [
          { id: 'TASK-FUTURE-01', completedBy: { E01: true } },
          { id: 'TASK-FUTURE-02', completedBy: { E01: false } },
        ],
        progressHistory: expect.arrayContaining([
          expect.objectContaining({ taskId: 'TASK-FUTURE-01', employeeId: 'E01', done: true }),
          expect.objectContaining({ action: 'progress-submitted', employeeId: 'E01', attendanceId }),
        ]),
      })
      expect(persistedState.tasks.find(({ id }) => id === 'TASK-FUTURE-01').completionHistory).toEqual([
        expect.objectContaining({ employeeId: 'E01', done: true }),
      ])

      const transferCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_transfer.create', expectedVersion: 11,
        payload: {
          employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
          startAt: '2026-08-21T08:00', endAt: '2026-08-21T12:00', hourlySupportRate: 45_000,
          allowance: 180_000, note: 'Hỗ trợ cửa hàng Tây Hòa',
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-runtime-transfer-0001' }), env)
      expect(transferCreated.status).toBe(201)
      const transferCreatedBody = await transferCreated.json()
      expect(transferCreatedBody).toMatchObject({
        version: 12,
        transfer: {
          employeeId: 'E01', toStoreId: 'S02',
          startAt: '2026-08-21T01:00:00.000Z', endAt: '2026-08-21T05:00:00.000Z',
          fromDate: '2026-08-21', toDate: '2026-08-21',
        },
      })

      vi.setSystemTime(new Date('2026-08-21T00:59:59.999Z'))
      const beforeTransferLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'employee.one', password: 'employee-one-password',
      }), env)
      expect(beforeTransferLogin.status).toBe(200)
      expect(await beforeTransferLogin.json()).toMatchObject({ user: { storeId: 'S01' } })
      vi.setSystemTime(new Date('2026-08-21T01:00:00.000Z'))
      employeeAuthorization = await loginAs('employee.one', 'employee-one-password')
      supportAuthorization = await loginAs('support.ops', 'support-ops-password')
      destinationManagerAuthorization = await loginAs('manager.s02', 'manager-s02-password')
      const transferredLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'employee.one', password: 'employee-one-password',
      }), env)
      expect(transferredLogin.status).toBe(200)
      expect(await transferredLogin.json()).toMatchObject({
        user: { storeId: 'S02', homeStoreId: 'S01', activeTransferId: transferCreatedBody.transfer.id },
      })
      const transferredEmployeeProjection = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      const transferredEmployeeState = (await transferredEmployeeProjection.json()).state
      expect(transferredEmployeeState.stores.map(({ id }) => id).sort()).toEqual(['S01', 'S02'])
      expect(transferredEmployeeState.supportTransfers).toEqual([
        expect.objectContaining({ id: transferCreatedBody.transfer.id, hourlySupportRate: 45_000, allowance: 180_000 }),
      ])
      const destinationProjection = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: destinationManagerAuthorization,
      }), env)
      expect(destinationProjection.status).toBe(200)
      const destinationEmployee = (await destinationProjection.json()).state.employees.find(({ id }) => id === 'E01')
      expect(destinationEmployee).toMatchObject({
        id: 'E01', name: 'Nhân viên Một', phone: '0901234567', cccd: '079123456789', address: '12 Tô Ngọc Vân',
        homeStoreId: 'S01', supportStoreId: 'S02',
        supportAssignment: {
          startAt: '2026-08-21T01:00:00.000Z', endAt: '2026-08-21T05:00:00.000Z',
          fromDate: '2026-08-21', toDate: '2026-08-21', hourlySupportRate: 45_000,
          allowance: 180_000, status: 'Đã duyệt',
        },
      })

      const destinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 12,
        payload: { location: { latitude: 10.81, longitude: 106.68, accuracy: 7 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-support-check-in-0001' }), env)
      expect(destinationCheckIn.status).toBe(201)
      const destinationCheckInBody = await destinationCheckIn.json()
      expect(destinationCheckInBody).toMatchObject({
        version: 13,
        attendance: {
          shiftName: 'Ca hỗ trợ cửa hàng', shiftSource: 'support-transfer',
          shiftStart: '08:00', shiftEnd: '12:00', arrivalTag: 'Đi đúng giờ', minutesLate: 0,
        },
      })
      const destinationAttendanceId = destinationCheckInBody.attendance.id
      expect(destinationCheckInBody.attendance).not.toHaveProperty('checklistSnapshot')
      vi.setSystemTime(new Date('2026-08-21T05:00:00.000Z'))
      const stateAtExclusiveEnd = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      expect(stateAtExclusiveEnd.status).toBe(200)
      const stateAtExclusiveEndBody = await stateAtExclusiveEnd.json()
      expect(stateAtExclusiveEndBody).toMatchObject({ user: { storeId: 'S01' }, state: { activeStoreId: 'S01' } })
      expect(stateAtExclusiveEndBody.state.attendance.find(({ id }) => id === destinationAttendanceId)).toMatchObject({
        storeId: 'S02', checkOutAt: null,
      })
      expect(stateAtExclusiveEndBody.state.stores.map(({ id }) => id).sort()).toEqual(['S01', 'S02'])
      const destinationAtExclusiveEnd = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: destinationManagerAuthorization,
      }), env)
      expect(destinationAtExclusiveEnd.status).toBe(200)
      const historicalDestinationEmployee = (await destinationAtExclusiveEnd.json()).state.employees
        .find(({ id }) => id === 'E01')
      expect(historicalDestinationEmployee).toMatchObject({
        id: 'E01', name: 'Nhân viên Một', unit: 'store', storeId: 'S01',
        historicalStoreId: 'S02', historicalOnly: true,
      })
      expect(historicalDestinationEmployee).not.toHaveProperty('phone')
      expect(historicalDestinationEmployee).not.toHaveProperty('cccd')
      expect(historicalDestinationEmployee).not.toHaveProperty('address')
      vi.setSystemTime(new Date('2026-08-21T07:00:00.000Z'))
      const destinationCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 13,
        payload: {
          attendanceId: destinationAttendanceId, cashRevenue: 0, transferRevenue: 0,
          location: { latitude: 10.81, longitude: 106.68, accuracy: 7 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-support-check-out-0001' }), env)
      expect(destinationCheckOut.status).toBe(200)
      expect(await destinationCheckOut.json()).toMatchObject({
        version: 14,
        attendance: {
          storeId: 'S02', homeStoreId: 'S01', supportTransferId: transferCreatedBody.transfer.id,
          elapsedSeconds: 21_600, workedSeconds: 14_400, hours: 4,
        },
      })
      const stateAfterSupportShift = readHydratedState(env.DB.database)
      expect(stateAfterSupportShift.supportTransfers.find(({ id }) => id === transferCreatedBody.transfer.id)).toMatchObject({
        status: 'Hoàn tất',
      })
      const destinationPayroll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 14, payload: { storeId: 'S02', period: '2026-08' },
      }, { ...supportAuthorization, 'idempotency-key': 'support-destination-payroll-0001' }), env)
      expect(destinationPayroll.status).toBe(201)
      const destinationPayrollBody = await destinationPayroll.json()
      expect(destinationPayrollBody).toMatchObject({ version: 15, period: { storeId: 'S02' } })
      expect(destinationPayrollBody.period.rows.find(({ employeeId }) => employeeId === 'E01')).toMatchObject({
        employeeId: 'E01', hours: 4, baseSalary: 180_000, supportHourlyPay: 180_000,
        supportAllowance: 180_000, gross: 360_000,
        supportTransferIds: [transferCreatedBody.transfer.id],
      })
      const employeeReturnedHome = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      expect(await employeeReturnedHome.json()).toMatchObject({ state: { activeStoreId: 'S01' } })
      expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('records idempotent employee shift expenses and submits scoped task completion to management', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-22T03:00:00.000Z'))
      const attendanceId = 'ATT-SHIFT-OPS-01'
      const assignmentId = 'TASK-ASSIGNMENT-SHIFT-OPS-01'
      const { env, adminAuthorization, employeeAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-shift-operations',
        transfer: {
          id: 'TRANSFER-CANCELLED', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
          startAt: '2026-08-20T08:00', endAt: '2026-08-20T12:00', status: 'Đã hủy', deletedAt: '2026-08-20T00:00:00.000Z',
        },
        attendance: [{
          id: attendanceId, employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ', storeId: 'S01',
          date: '2026-08-22', shiftId: 'SHIFT-OPS', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
          checkIn: '08:00', checkInAt: '2026-08-22T01:00:00.000Z', checkOut: null, checkOutAt: null,
        }],
        tasks: [{
          id: 'TASK-OPS-01', assignmentId, storeId: 'S01', date: '2026-08-22', shiftId: 'SHIFT-OPS',
          employeeIds: ['E01'], title: 'Kiểm tra quầy', completedBy: {},
        }, {
          id: 'TASK-OPS-02', assignmentId, storeId: 'S01', date: '2026-08-22', shiftId: 'SHIFT-OPS',
          employeeIds: ['E01'], title: 'Báo cáo tồn kho', completedBy: {},
        }],
        taskAssignmentHistory: [{
          id: assignmentId, assignmentId, action: 'assigned', storeId: 'S01', date: '2026-08-22', shiftId: 'SHIFT-OPS',
          employeeIds: ['E01'], tasks: [
            { id: 'TASK-OPS-01', title: 'Kiểm tra quầy', completedBy: {} },
            { id: 'TASK-OPS-02', title: 'Báo cáo tồn kho', completedBy: {} },
          ],
          progressHistory: [],
        }],
      })

      const expenseRequest = {
        type: 'shift_expense.create', expectedVersion: 1,
        payload: { attendanceId, name: 'Mua vật dụng vệ sinh', amount: 35_000, note: 'Mua trong ca sáng' },
      }
      const expense = await worker.fetch(jsonRequest('https://idosi.example/api/command', expenseRequest, {
        ...employeeAuthorization, 'idempotency-key': 'shift-expense-idempotent-0001',
      }), env)
      expect(expense.status).toBe(201)
      const expenseBody = await expense.json()
      expect(expenseBody).toMatchObject({
        version: 2,
        expense: {
          storeId: 'S01', employeeId: 'E01', attendanceId, shiftId: 'SHIFT-OPS',
          name: 'Mua vật dụng vệ sinh', amount: 35_000, sourceType: 'shift-expense-item',
        },
        attendance: { id: attendanceId, expense: 35_000, shiftExpenseTotal: 35_000 },
      })
      const expenseReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', expenseRequest, {
        ...employeeAuthorization, 'idempotency-key': 'shift-expense-idempotent-0001',
      }), env)
      expect(expenseReplay.status).toBe(201)
      expect(await expenseReplay.json()).toMatchObject({ version: 2, expense: { id: expenseBody.expense.id } })

      replaceStateCollection(env.DB.database, 'payrollPeriods', [{
        id: 'PAY-SHIFT-OPS', storeId: 'S01', period: '2026-08', status: 'Đã khóa', lockedAt: '2026-08-22T02:00:00.000Z',
      }])
      const lockedExpense = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'shift_expense.create', expectedVersion: 2,
        payload: { attendanceId, name: 'Chi phí bị chặn', amount: 10_000 },
      }, { ...employeeAuthorization, 'idempotency-key': 'shift-expense-locked-0001' }), env)
      expect(lockedExpense.status).toBe(409)
      expect(await lockedExpense.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
      replaceStateCollection(env.DB.database, 'payrollPeriods', [])

      const missingReason = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.progress.save', expectedVersion: 2,
        payload: { attendanceId, tasks: [{ id: 'TASK-OPS-01', completed: true }, { id: 'TASK-OPS-02', completed: false }] },
      }, { ...employeeAuthorization, 'idempotency-key': 'task-progress-missing-reason-0001' }), env)
      expect(missingReason.status).toBe(400)
      expect(await missingReason.json()).toMatchObject({ error: { code: 'INCOMPLETE_TASK_REASON_REQUIRED' } })

      const progressRequest = {
        type: 'task.progress.save', expectedVersion: 2,
        payload: {
          attendanceId,
          tasks: [{ id: 'TASK-OPS-01', completed: true }, { id: 'TASK-OPS-02', completed: false }],
          incompleteReason: 'Chưa kiểm xong kho cuối ca',
        },
      }
      const progress = await worker.fetch(jsonRequest('https://idosi.example/api/command', progressRequest, {
        ...employeeAuthorization, 'idempotency-key': 'task-progress-idempotent-0001',
      }), env)
      expect(progress.status).toBe(200)
      expect(await progress.json()).toMatchObject({
        version: 3, attendanceId, employeeId: 'E01', completedTasks: 1, totalTasks: 2, completionRate: 50,
        incompleteReason: 'Chưa kiểm xong kho cuối ca',
        notifications: [{ type: 'store-task-progress-submitted', storeId: 'S01', employeeId: 'E01', assignmentId }],
      })
      const progressReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', progressRequest, {
        ...employeeAuthorization, 'idempotency-key': 'task-progress-idempotent-0001',
      }), env)
      expect(progressReplay.status).toBe(200)
      expect(await progressReplay.json()).toMatchObject({ version: 3, completionRate: 50 })

      const employeeState = await worker.fetch(new Request('https://idosi.example/api/state', { headers: employeeAuthorization }), env)
      const employeeStateBody = await employeeState.json()
      expect(employeeStateBody.state.expenseEntries).toEqual([
        expect.objectContaining({ id: expenseBody.expense.id, employeeId: 'E01', attendanceId, amount: 35_000 }),
      ])
      expect(employeeStateBody.state.notifications.some(({ type }) => type === 'store-task-progress-submitted')).toBe(false)
      const adminState = await worker.fetch(new Request('https://idosi.example/api/state', { headers: adminAuthorization }), env)
      expect((await adminState.json()).state.notifications).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'store-task-progress-submitted', assignmentId, employeeId: 'E01' }),
      ]))

      const checkout = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 3,
        payload: {
          attendanceId, cashRevenue: 0, transferRevenue: 0,
          incompleteTaskReason: 'Chưa kiểm xong kho cuối ca',
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'shift-ops-checkout-0001' }), env)
      expect(checkout.status).toBe(200)
      expect(await checkout.json()).toMatchObject({
        version: 4,
        attendance: { id: attendanceId, expense: 35_000, shiftExpenseTotal: 35_000 },
      })
      const persisted = readHydratedState(env.DB.database)
      expect(persisted.expenseEntries.filter(({ attendanceId: id }) => id === attendanceId)).toHaveLength(1)
      expect(persisted.cashTransactions.filter(({ attendanceId: id }) => id === attendanceId)).toHaveLength(1)
      expect(persisted.taskAssignmentHistory[0]).toMatchObject({
        assignmentId, status: 'incomplete', completedTasks: 1, totalTasks: 2, completionRate: 50,
        incompleteReason: 'Chưa kiểm xong kho cuối ca',
        progressHistory: [expect.objectContaining({ action: 'progress-submitted', employeeId: 'E01', attendanceId, completionRate: 50 })],
      })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('persists one standalone progress receipt for unassigned and orphaned task sets', async () => {
    const attendanceId = 'ATT-STANDALONE-PROGRESS-01'
    const rewardSnapshot = {
      catalogItemId: 'CAT-STANDALONE-REWARD', catalogCode: 'store.reward.standalone', catalogVersion: 1,
      kind: 'REWARD_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-STANDALONE',
      shiftName: 'Ca độc lập', name: 'Công việc thưởng độc lập', amountVnd: 8_000,
      required: false, optional: true, effectiveDate: '2026-08-22',
    }
    const { env, employeeAuthorization } = await setupSupportTransferRuntime({
      token: 'bootstrap-standalone-task-progress',
      transfer: {
        id: 'TRANSFER-STANDALONE-DELETED', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-01T08:00', endAt: '2026-08-01T12:00', status: 'Đã hủy', deletedAt: '2026-08-01T00:00:00.000Z',
      },
      attendance: [{
        id: attendanceId, employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ', storeId: 'S01',
        date: '2026-08-22', shiftId: 'SHIFT-STANDALONE', shiftName: 'Ca độc lập',
        shiftStart: '08:00', shiftEnd: '12:00', checkInAt: '2026-08-22T01:00:00.000Z', checkOutAt: null,
      }],
      tasks: [{
        id: 'TASK-STANDALONE-MANUAL', storeId: 'S01', date: '2026-08-22', shiftId: 'SHIFT-STANDALONE',
        employeeIds: ['E01'], title: 'Công việc bắt buộc độc lập', required: true, completedBy: {},
      }, {
        id: 'TASK-STANDALONE-REWARD', storeId: 'S01', date: '2026-08-22', shiftId: 'SHIFT-STANDALONE',
        employeeIds: ['E01'], title: rewardSnapshot.name, required: false,
        catalogItemId: rewardSnapshot.catalogItemId, catalogCode: rewardSnapshot.catalogCode,
        catalogVersion: rewardSnapshot.catalogVersion, catalogKind: rewardSnapshot.kind,
        amountVnd: rewardSnapshot.amountVnd, catalogSnapshot: rewardSnapshot, completedBy: {},
      }],
      taskAssignmentHistory: [],
    })
    const command = (completedReward, expectedVersion, idempotencyKey) => worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      {
        type: 'task.progress.save', expectedVersion,
        payload: {
          attendanceId,
          tasks: [
            { id: 'TASK-STANDALONE-MANUAL', completed: true },
            { id: 'TASK-STANDALONE-REWARD', completed: completedReward },
          ],
        },
      },
      { ...employeeAuthorization, 'idempotency-key': idempotencyKey },
    ), env)

    const first = await command(true, 1, 'standalone-task-progress-first-0001')
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      version: 2, attendanceId, totalTasks: 2, completedTasks: 2,
      rewardTasks: 1, completedRewardTasks: 1,
      notifications: [{ type: 'store-task-progress-submitted', assignmentId: null }],
    })
    const afterFirst = readHydratedState(env.DB.database)
    const firstReceipts = afterFirst.taskAssignmentHistory.filter(({ source }) => source === 'task-progress-receipt')
    expect(firstReceipts).toHaveLength(1)
    expect(firstReceipts[0]).toMatchObject({
      id: `task_progress_receipt:${attendanceId}`, receiptOnly: true, assignmentId: null,
      employeeId: 'E01', employeeIds: ['E01'], attendanceId, storeId: 'S01', shiftId: 'SHIFT-STANDALONE',
      taskIds: ['TASK-STANDALONE-MANUAL', 'TASK-STANDALONE-REWARD'], tasks: [],
      progressHistory: [expect.objectContaining({
        action: 'progress-submitted', attendanceId, employeeId: 'E01', totalTasks: 2, completedTasks: 2,
        rewardTaskSnapshots: [expect.objectContaining({
          taskId: 'TASK-STANDALONE-REWARD', catalogItemId: 'CAT-STANDALONE-REWARD', completed: true,
        })],
        completedRewardTaskSnapshots: [expect.objectContaining({ taskId: 'TASK-STANDALONE-REWARD' })],
      })],
    })
    expect(afterFirst.notifications.filter(({ type }) => type === 'store-task-progress-submitted')).toHaveLength(1)
    expect(afterFirst.workCatalogProgress).toHaveLength(1)
    expect(afterFirst.compensationEntries).toEqual([
      expect.objectContaining({ type: 'WORK', amountVnd: 8_000, status: 'ACTIVE' }),
    ])
    const firstInvariant = {
      stateVersion: afterFirst.stateVersion,
      tasks: afterFirst.tasks,
      taskAssignmentHistory: afterFirst.taskAssignmentHistory,
      notifications: afterFirst.notifications,
      workCatalogProgress: afterFirst.workCatalogProgress,
      compensationEntries: afterFirst.compensationEntries,
    }

    const firstSemanticRetry = await command(true, 2, 'standalone-task-progress-first-retry-0001')
    expect(firstSemanticRetry.status).toBe(200)
    expect(await firstSemanticRetry.json()).toMatchObject({ version: 2, existing: true, attendanceId })
    expect(readHydratedState(env.DB.database)).toMatchObject(firstInvariant)

    const changed = await command(false, 2, 'standalone-task-progress-changed-0001')
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({ version: 3, completedTasks: 1, completedRewardTasks: 0 })
    const afterChanged = readHydratedState(env.DB.database)
    expect(afterChanged.taskAssignmentHistory.filter(({ source }) => source === 'task-progress-receipt')).toHaveLength(1)
    expect(afterChanged.taskAssignmentHistory.find(({ source }) => source === 'task-progress-receipt').progressHistory)
      .toHaveLength(2)
    expect(afterChanged.notifications.filter(({ type }) => type === 'store-task-progress-submitted')).toHaveLength(2)
    expect(afterChanged.compensationEntries).toEqual([
      expect.objectContaining({ type: 'WORK', amountVnd: 8_000, status: 'VOID', voidSource: 'task-progress' }),
    ])
    const changedInvariant = {
      stateVersion: afterChanged.stateVersion,
      tasks: afterChanged.tasks,
      taskAssignmentHistory: afterChanged.taskAssignmentHistory,
      notifications: afterChanged.notifications,
      workCatalogProgress: afterChanged.workCatalogProgress,
      compensationEntries: afterChanged.compensationEntries,
    }
    const changedSemanticRetry = await command(false, 3, 'standalone-task-progress-changed-retry-0001')
    expect(changedSemanticRetry.status).toBe(200)
    expect(await changedSemanticRetry.json()).toMatchObject({ version: 3, existing: true, attendanceId })
    expect(readHydratedState(env.DB.database)).toMatchObject(changedInvariant)

    replaceStateCollection(env.DB.database, 'tasks', afterChanged.tasks.map((task) => ({
      ...task, assignmentId: 'ASSIGNMENT-WITHOUT-HISTORY',
    })))
    const orphanedAssignment = await command(true, 3, 'standalone-task-progress-orphaned-0001')
    expect(orphanedAssignment.status).toBe(200)
    expect(await orphanedAssignment.json()).toMatchObject({
      version: 4, completedTasks: 2,
      notifications: [{ type: 'store-task-progress-submitted', assignmentId: null }],
    })
    const afterOrphanedAssignment = readHydratedState(env.DB.database)
    const finalReceipts = afterOrphanedAssignment.taskAssignmentHistory
      .filter(({ source }) => source === 'task-progress-receipt')
    expect(finalReceipts).toHaveLength(1)
    expect(finalReceipts[0].progressHistory).toHaveLength(3)
    expect(finalReceipts[0].progressHistory[2]).toMatchObject({
      fingerprint: expect.any(String), rewardTaskSnapshots: [expect.objectContaining({
        assignmentId: 'ASSIGNMENT-WITHOUT-HISTORY', completed: true,
      })],
    })
    expect(afterOrphanedAssignment.notifications.filter(({ type }) => type === 'store-task-progress-submitted'))
      .toHaveLength(3)
    expect(afterOrphanedAssignment.compensationEntries).toEqual([
      expect.objectContaining({ type: 'WORK', amountVnd: 8_000, status: 'ACTIVE' }),
    ])
    const orphanInvariant = {
      stateVersion: afterOrphanedAssignment.stateVersion,
      tasks: afterOrphanedAssignment.tasks,
      taskAssignmentHistory: afterOrphanedAssignment.taskAssignmentHistory,
      notifications: afterOrphanedAssignment.notifications,
      workCatalogProgress: afterOrphanedAssignment.workCatalogProgress,
      compensationEntries: afterOrphanedAssignment.compensationEntries,
    }
    const orphanSemanticRetry = await command(true, 4, 'standalone-task-progress-orphaned-retry-0001')
    expect(orphanSemanticRetry.status).toBe(200)
    expect(await orphanSemanticRetry.json()).toMatchObject({ version: 4, existing: true, attendanceId })
    expect(readHydratedState(env.DB.database)).toMatchObject(orphanInvariant)
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS count FROM audit_log WHERE action = 'task.progress.save'
    `).get()).toEqual({ count: 3 })
  }, 30_000)

  it('protects order information settings with audited soft-disable, strict RBAC, and legacy-safe order validation', async () => {
    const optionTimestamp = '2026-08-20T00:00:00.000Z'
    const orderInformationOptions = [
      { id: 'order-occupation-001', kind: 'occupation', code: 'OCC-001', label: 'Nhân viên VP', normalizedLabel: 'nhân viên vp', active: true, sortOrder: 100, createdAt: optionTimestamp, updatedAt: optionTimestamp },
      { id: 'order-occupation-002', kind: 'occupation', code: 'OCC-002', label: 'Kỹ sư', normalizedLabel: 'kỹ sư', active: true, sortOrder: 200, createdAt: optionTimestamp, updatedAt: optionTimestamp },
      { id: 'order-occupation-003', kind: 'occupation', code: 'OCC-003', label: 'Nghề đã nghỉ', normalizedLabel: 'nghề đã nghỉ', active: false, sortOrder: 300, deletedAt: optionTimestamp, createdAt: optionTimestamp, updatedAt: optionTimestamp },
    ]
    const historicalOrders = [
      { id: 'ORDER-USED', code: 'LEGACY-USED', storeId: 'S01', customerName: 'Khách nghề đã dùng', gender: 'Nam', occupation: 'Kỹ sư', acquisitionChannel: 'Facebook', amount: 100_000, paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order', createdAt: optionTimestamp },
      { id: 'ORDER-LEGACY', code: 'LEGACY-UNKNOWN', storeId: 'S01', customerName: 'Khách nghề legacy', gender: 'Nữ', occupation: 'Nghề legacy ngoài danh mục', acquisitionChannel: 'Zalo', amount: 110_000, paymentMethod: 'Chuyển khoản', status: 'Hoàn tất', source: 'order', createdAt: optionTimestamp },
      { id: 'ORDER-OTHER', code: 'LEGACY-OTHER', storeId: 'S01', customerName: 'Khách nghề khác', gender: 'Khác', occupation: 'Nhân viên VP', acquisitionChannel: 'Khác', amount: 120_000, paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order', createdAt: optionTimestamp },
    ]
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-order-information-settings' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'order-information-admin-password',
      initialState: {
        stores: [{ id: 'S01', short: 'S01', name: 'IDOSI S01', status: 'Đang hoạt động' }],
        employees: [
          { id: 'HTKD-ORDER', code: 'HTKD-ORDER', name: 'Hỗ trợ đơn hàng', unit: 'business_support', storeId: 'BUSINESS_SUPPORT', status: 'Đang làm việc' },
          { id: 'QLCH-ORDER', code: 'QLCH-ORDER', name: 'Quản lý đơn hàng', unit: 'store_manager', storeId: 'S01', status: 'Đang làm việc' },
          { id: 'NV-ORDER', code: 'NV-ORDER', name: 'Nhân viên đơn hàng', unit: 'store', storeId: 'S01', status: 'Đang làm việc' },
        ],
        orderInformationOptions,
        orders: historicalOrders,
        orderAudit: [],
        attendance: [],
        payrollPeriods: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'order-information-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    for (const account of [
      { username: 'support.order', password: 'support-order-password', displayName: 'Hỗ trợ đơn hàng', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-ORDER', role: 'business_support' },
      { username: 'manager.order', password: 'manager-order-password', displayName: 'Quản lý đơn hàng', storeId: 'S01', employeeId: 'QLCH-ORDER', role: 'store_manager' },
      { username: 'employee.order', password: 'employee-order-password', displayName: 'Nhân viên đơn hàng', storeId: 'S01', employeeId: 'NV-ORDER', role: 'employee' },
    ]) {
      const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create', payload: account,
      }, { ...adminAuthorization, 'idempotency-key': `order-information-user-${account.role}` }), env)
      expect(created.status, account.role).toBe(201)
    }
    const loginAs = async (username, password) => {
      const response = await worker.fetch(jsonRequest('https://idosi.example/api/login', { username, password }), env)
      expect(response.status).toBe(200)
      return { authorization: `Bearer ${(await response.json()).token}` }
    }
    const supportAuthorization = await loginAs('support.order', 'support-order-password')
    const managerAuthorization = await loginAs('manager.order', 'manager-order-password')
    const employeeAuthorization = await loginAs('employee.order', 'employee-order-password')
    const configuredOrderInformationOptions = readHydratedState(env.DB.database).orderInformationOptions
    const configuredOccupations = configuredOrderInformationOptions.filter(({ kind }) => kind === 'occupation')
    expect(configuredOccupations).toHaveLength(15)
    expect(configuredOccupations).toEqual(expect.arrayContaining(orderInformationOptions))

    for (const authorization of [adminAuthorization, supportAuthorization, managerAuthorization, employeeAuthorization]) {
      const projected = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
      expect(projected.status).toBe(200)
      const projectedOptions = (await projected.json()).state.orderInformationOptions
      expect(projectedOptions).toEqual(configuredOrderInformationOptions)
      expect(projectedOptions.filter(({ kind }) => kind === 'payment_method')).toEqual([
        expect.objectContaining({ id: 'order-payment-001', code: 'PAY-001', label: 'Tiền mặt', active: true, system: true }),
        expect.objectContaining({ id: 'order-payment-002', code: 'PAY-002', label: 'Chuyển khoản', active: true, system: true }),
      ])
    }

    const protectedMutation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge', expectedVersion: 1,
      payload: { patch: { orderInformationOptions: [{ ...orderInformationOptions[0], label: 'Ghi đè trái phép' }] } },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-generic-mutation' }), env)
    expect(protectedMutation.status).toBe(400)
    expect(await protectedMutation.json()).toMatchObject({ error: { code: 'DOMAIN_COMMAND_REQUIRED' } })

    const restrictedCommands = [
      ['create', { label: 'Bị chặn', code: 'DEN-01' }],
      ['update', { optionId: 'order-occupation-001', label: 'Bị chặn', code: 'DEN-02' }],
      ['disable', { optionId: 'order-occupation-001', reason: 'Bị chặn' }],
      ['restore', { optionId: 'order-occupation-003' }],
      ['reorder', { orderedIds: configuredOccupations.map(({ id }) => id) }],
    ]
    for (const [role, authorization] of [['store_manager', managerAuthorization], ['employee', employeeAuthorization]]) {
      for (const [operation, payload] of restrictedCommands) {
        const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type: `order_information.${operation}`, expectedVersion: 1, payload,
        }, { ...authorization, 'idempotency-key': `order-information-${role}-${operation}` }), env)
        expect(denied.status, `${role}:${operation}`).toBe(403)
        expect(await denied.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })
      }
    }

    for (const [role, authorization] of [['admin', adminAuthorization], ['business_support', supportAuthorization]]) {
      const retired = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.working_time.set', expectedVersion: 1,
        payload: { employeeId: 'HTKD-ORDER', effectiveFrom: '2026-08-25', workTimeType: 'Full-Time' },
      }, { ...authorization, 'idempotency-key': `retired-working-time-${role}` }), env)
      expect(retired.status).toBe(410)
      expect(await retired.json()).toMatchObject({ error: { code: 'COMMAND_RETIRED' } })
    }
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
    expect(readHydratedState(env.DB.database).employees).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'HTKD-ORDER' }),
    ]))

    const invalidRequests = [
      ['client-id', { type: 'order_information.create', payload: { id: 'client-id', label: 'Kế toán', code: 'OCC-100' } }, 400, 'ORDER_INFORMATION_OPTION_ID_SERVER_MANAGED'],
      ['payment-kind', { type: 'order_information.create', payload: { kind: 'payment', label: 'Thẻ', code: 'PAY-003' } }, 400, 'ORDER_INFORMATION_KIND_INVALID'],
      ['bad-code', { type: 'order_information.create', payload: { label: 'Kế toán', code: 'Mã lỗi' } }, 400, 'ORDER_INFORMATION_CODE_INVALID'],
      ['duplicate-label', { type: 'order_information.create', payload: { label: '  Kỹ   sư ', code: 'OCC-900' } }, 409, 'ORDER_INFORMATION_DUPLICATE'],
      ['duplicate-inactive-code', { type: 'order_information.create', payload: { label: 'Nghề mới', code: 'occ-003' } }, 409, 'ORDER_INFORMATION_DUPLICATE'],
      ['bad-option-id', { type: 'order_information.update', payload: { optionId: '../bad', label: 'Nghề mới', code: 'OCC-900' } }, 400, 'ORDER_INFORMATION_OPTION_ID_INVALID'],
      ['missing-option-id', { type: 'order_information.update', payload: { optionId: 'order-occupation-999', label: 'Nghề mới', code: 'OCC-900' } }, 404, 'ORDER_INFORMATION_OPTION_NOT_FOUND'],
      ['protected-payment', { type: 'order_information.disable', payload: { optionId: 'order-payment-001', reason: 'Không được phép' } }, 403, 'ORDER_INFORMATION_SYSTEM_OPTION_PROTECTED'],
      ['hard-delete', { type: 'order_information.delete', payload: { optionId: 'order-occupation-002' } }, 400, 'COMMAND_UNKNOWN'],
    ]
    for (const [key, request, status, code] of invalidRequests) {
      const rejected = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        ...request, expectedVersion: 1,
      }, { ...adminAuthorization, 'idempotency-key': `order-information-invalid-${key}` }), env)
      expect(rejected.status, key).toBe(status)
      expect(await rejected.json()).toMatchObject({ error: { code } })
    }

    const createRequest = {
      type: 'order_information.create', expectedVersion: 1,
      payload: { label: 'Kế toán', code: 'occ-100', active: false },
    }
    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', createRequest, {
      ...supportAuthorization, 'idempotency-key': 'order-information-create-accountant',
    }), env)
    expect(created.status).toBe(201)
    const createdBody = await created.json()
    expect(createdBody).toMatchObject({
      version: 2,
      option: { kind: 'occupation', label: 'Kế toán', code: 'OCC-100', active: true, createdBy: { role: 'business_support' } },
    })
    const optionId = createdBody.option.id
    const replayed = await worker.fetch(jsonRequest('https://idosi.example/api/command', createRequest, {
      ...supportAuthorization, 'idempotency-key': 'order-information-create-accountant',
    }), env)
    expect(replayed.status).toBe(201)
    expect(await replayed.json()).toMatchObject({ version: 2, option: { id: optionId } })

    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order_information.update', expectedVersion: 2,
      payload: { optionId, label: 'Kế toán doanh nghiệp', code: 'OCC-100', active: false },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-update-accountant' }), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ version: 3, option: { id: optionId, label: 'Kế toán doanh nghiệp', active: true } })
    const duplicateUpdate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order_information.update', expectedVersion: 3,
      payload: { optionId, label: 'Kế toán doanh nghiệp', code: 'OCC-001' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-update-duplicate' }), env)
    expect(duplicateUpdate.status).toBe(409)
    expect(await duplicateUpdate.json()).toMatchObject({ error: { code: 'ORDER_INFORMATION_DUPLICATE' } })

    const invalidReorder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order_information.reorder', expectedVersion: 3, payload: { orderedIds: [optionId] },
    }, { ...supportAuthorization, 'idempotency-key': 'order-information-reorder-invalid' }), env)
    expect(invalidReorder.status).toBe(400)
    expect(await invalidReorder.json()).toMatchObject({ error: { code: 'ORDER_INFORMATION_ORDER_INVALID' } })
    const orderedIds = [optionId, ...configuredOccupations.map(({ id }) => id)]
    const reordered = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order_information.reorder', expectedVersion: 3, payload: { orderedIds },
    }, { ...supportAuthorization, 'idempotency-key': 'order-information-reorder' }), env)
    expect(reordered.status).toBe(200)
    expect(await reordered.json()).toMatchObject({
      version: 4,
      options: orderedIds.map((id, index) => expect.objectContaining({ id, sortOrder: (index + 1) * 100 })),
    })

    const disabled = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order_information.disable', expectedVersion: 4,
      payload: { optionId: 'order-occupation-002', reason: 'Ngừng dùng cho đơn mới' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-disable-used' }), env)
    expect(disabled.status).toBe(200)
    expect(await disabled.json()).toMatchObject({
      version: 5,
      option: { id: 'order-occupation-002', active: false, deletedAt: expect.any(String), deleteReason: 'Ngừng dùng cho đơn mới' },
    })
    let persisted = readHydratedState(env.DB.database)
    expect(persisted.orderInformationOptions.filter(({ kind }) => kind === 'occupation')).toHaveLength(16)
    expect(persisted.orderInformationOptions.filter(({ kind }) => kind === 'payment_method')).toHaveLength(2)
    expect(persisted.orderInformationOptions.find(({ id }) => id === 'order-occupation-002')).toMatchObject({ active: false })
    expect(persisted.orders.find(({ id }) => id === 'ORDER-USED')).toMatchObject({ occupation: 'Kỹ sư' })

    const disabledNewOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.create', expectedVersion: 5,
      payload: { storeId: 'S01', customerName: 'Không chọn nghề nghỉ', gender: 'Nam', occupation: 'Kỹ sư', acquisitionChannel: 'Facebook', amount: 90_000, paymentMethod: 'Tiền mặt' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-disabled-new-order' }), env)
    expect(disabledNewOrder.status).toBe(400)
    expect(await disabledNewOrder.json()).toMatchObject({ error: { code: 'ORDER_OCCUPATION_INVALID' } })
    const invalidPayment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.create', expectedVersion: 5,
      payload: { storeId: 'S01', customerName: 'Sai thanh toán', gender: 'Nữ', occupation: 'Kế toán doanh nghiệp', acquisitionChannel: 'Zalo', amount: 90_000, paymentMethod: 'Chuyển khoản ' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-payment-invalid' }), env)
    expect(invalidPayment.status).toBe(400)
    expect(await invalidPayment.json()).toMatchObject({ error: { code: 'PAYMENT_METHOD_INVALID' } })
    const transferPaymentRow = env.DB.database.prepare(`
      SELECT entity_key, value_json FROM state_entities
      WHERE scope_key = 'global'
        AND collection_key = 'orderInformationOptions'
        AND json_extract(value_json, '$.id') = 'order-payment-002'
    `).get()
    const inactiveTransferJson = JSON.stringify({ ...JSON.parse(transferPaymentRow.value_json), active: false })
    env.DB.database.prepare(`
      UPDATE state_entities SET value_json = ?, value_bytes = ?
      WHERE scope_key = 'global' AND collection_key = 'orderInformationOptions' AND entity_key = ?
    `).run(inactiveTransferJson, Buffer.byteLength(inactiveTransferJson), transferPaymentRow.entity_key)
    const databaseBackedPayment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.create', expectedVersion: 5,
      payload: { storeId: 'S01', customerName: 'Nguồn thanh toán DB', gender: 'Nữ', occupation: 'Kế toán doanh nghiệp', acquisitionChannel: 'Zalo', amount: 90_000, paymentMethod: 'Chuyển khoản' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-payment-database-source' }), env)
    expect(databaseBackedPayment.status).toBe(409)
    expect(await databaseBackedPayment.json()).toMatchObject({ error: { code: 'ORDER_PAYMENT_CONFIGURATION_INVALID' } })
    env.DB.database.prepare(`
      UPDATE state_entities SET value_json = ?, value_bytes = ?
      WHERE scope_key = 'global' AND collection_key = 'orderInformationOptions' AND entity_key = ?
    `).run(transferPaymentRow.value_json, Buffer.byteLength(transferPaymentRow.value_json), transferPaymentRow.entity_key)
    const activeNewOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.create', expectedVersion: 5,
      payload: { storeId: 'S01', customerName: 'Nghề mới hợp lệ', gender: 'Nữ', occupation: 'Kế toán doanh nghiệp', acquisitionChannel: 'Zalo', amount: 90_000, paymentMethod: 'Chuyển khoản' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-active-new-order' }), env)
    expect(activeNewOrder.status).toBe(201)
    expect(await activeNewOrder.json()).toMatchObject({ version: 6, order: { occupation: 'Kế toán doanh nghiệp', paymentMethod: 'Chuyển khoản' } })

    const legacyKept = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update', expectedVersion: 6,
      payload: { orderId: 'ORDER-LEGACY', occupation: 'Nghề legacy ngoài danh mục', amount: 115_000, reason: 'Sửa tiền, giữ nghề lịch sử' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-keep-legacy' }), env)
    expect(legacyKept.status).toBe(200)
    expect(await legacyKept.json()).toMatchObject({ version: 7, order: { occupation: 'Nghề legacy ngoài danh mục', amount: 115_000 } })
    const inactiveKept = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update', expectedVersion: 7,
      payload: { orderId: 'ORDER-USED', occupation: 'Kỹ sư', amount: 105_000, reason: 'Sửa tiền, giữ nghề đã nghỉ' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-keep-inactive' }), env)
    expect(inactiveKept.status).toBe(200)
    expect(await inactiveKept.json()).toMatchObject({ version: 8, order: { occupation: 'Kỹ sư', amount: 105_000 } })
    for (const [key, occupation] of [['inactive', 'Kỹ sư'], ['legacy', 'Nghề legacy ngoài danh mục']]) {
      const cannotSelect = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.update', expectedVersion: 8,
        payload: { orderId: 'ORDER-OTHER', occupation, reason: 'Không được chọn mới' },
      }, { ...adminAuthorization, 'idempotency-key': `order-information-cannot-select-${key}` }), env)
      expect(cannotSelect.status).toBe(400)
      expect(await cannotSelect.json()).toMatchObject({ error: { code: 'ORDER_OCCUPATION_INVALID' } })
    }

    const restored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order_information.restore', expectedVersion: 8, payload: { optionId: 'order-occupation-002' },
    }, { ...supportAuthorization, 'idempotency-key': 'order-information-restore-used' }), env)
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({
      version: 9,
      option: { id: 'order-occupation-002', active: true, deletedAt: null, deletedBy: null, deleteReason: null },
    })
    const newlySelectable = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update', expectedVersion: 9,
      payload: { orderId: 'ORDER-OTHER', occupation: 'Kỹ sư', reason: 'Nghề đã được khôi phục' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-information-select-restored' }), env)
    expect(newlySelectable.status).toBe(200)
    expect(await newlySelectable.json()).toMatchObject({ version: 10, order: { occupation: 'Kỹ sư' } })

    persisted = readHydratedState(env.DB.database)
    expect(persisted.orderInformationOptions.filter(({ kind }) => kind === 'occupation').map(({ id }) => id)).toEqual(orderedIds)
    expect(persisted.orderInformationOptions.filter(({ kind }) => kind === 'payment_method').map(({ id }) => id)).toEqual([
      'order-payment-001', 'order-payment-002',
    ])
    expect(persisted.orders.find(({ id }) => id === 'ORDER-LEGACY').occupation).toBe('Nghề legacy ngoài danh mục')
    const optionAudits = env.DB.database.prepare(`
      SELECT action, metadata_json FROM audit_log
      WHERE entity_type IN ('order-information-option', 'order-information-options')
      ORDER BY id
    `).all()
    expect(optionAudits.map(({ action }) => action)).toEqual([
      'order_information.create', 'order_information.update', 'order_information.reorder',
      'order_information.disable', 'order_information.restore',
    ])
    expect(JSON.parse(optionAudits.find(({ action }) => action === 'order_information.disable').metadata_json)).toMatchObject({
      deletionMode: 'soft-disable', usedByOrderCount: 1,
    })
  }, 30_000)

  it('blocks retired working-time configuration while preserving profile shifts and daily schedule operations', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T06:05:00.000Z'))
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-working-time-rbac' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'working-time-admin-password',
        initialState: { stores: [], employees: [], attendance: [], schedule: [], shiftDefinitions: [] },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'working-time-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
      const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 1,
        payload: {
          unit: 'business_support', name: 'Hỗ trợ ca linh hoạt', phone: '0908111222', cccd: '079888111222',
          address: 'TP. Hồ Chí Minh', startDate: '2026-08-20', employmentType: 'Part-Time', position: 'NV hỗ trợ KD',
          username: 'support.shifts', password: 'support-shifts-password', identityImages: testIdentityImages(),
          workShifts: [
            { id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
            { id: 'support_pm', name: 'Ca chiều mới', start: '13:00', end: '17:30' },
          ],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'working-time-support-create-0001' }), env)
      expect(supportCreated.status).toBe(201)
      const support = (await supportCreated.json()).employee
      expect(support).toMatchObject({
        workTimeType: 'Part-Time', workStart: '08:00', workEnd: '12:00',
        workingTime: { type: 'Part-Time', mode: 'shifts' },
      })
      const officeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 2,
        payload: {
          unit: 'office', storeId: 'OFFICE', name: 'Marketing linh hoạt', phone: '0908333444', cccd: '079888333444',
          address: 'Địa chỉ cũ', startDate: '2026-08-20', employmentType: 'Part-Time', position: 'Marketing',
          username: 'office.shifts', password: 'office-shifts-password', identityImages: testIdentityImages(),
          workShifts: [{ id: 'office_am', name: 'Ca sáng', start: '08:00', end: '12:00' }],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'working-time-office-create-0001' }), env)
      const officeCreatedBody = await officeCreated.json()
      expect(officeCreated.status, JSON.stringify(officeCreatedBody)).toBe(201)
      const office = officeCreatedBody.employee
      const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'support.shifts', password: 'support-shifts-password',
      }), env)
      const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

      const officeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 3,
        payload: {
          employeeId: office.id, phone: '0908555666', address: 'Địa chỉ mới',
        },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-office-update-0001' }), env)
      expect(officeUpdated.status).toBe(200)
      expect(await officeUpdated.json()).toMatchObject({
        version: 4,
        employee: { phone: '0908555666', address: 'Địa chỉ mới', workShifts: [{ id: 'office_am' }] },
      })

      const officeWorkingTimeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.working_time.set', expectedVersion: 4,
        payload: {
          employeeId: office.id, effectiveFrom: '2026-08-20', workTimeType: 'Part-Time',
          workStart: '08:00', workEnd: '12:00',
          workShifts: [
            { id: 'office_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
            { id: 'office_pm', name: 'Ca chiều', start: '13:00', end: '17:30' },
          ],
        },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-office-effective-update-0001' }), env)
      expect(officeWorkingTimeUpdated.status).toBe(410)
      expect(await officeWorkingTimeUpdated.json()).toMatchObject({ error: { code: 'COMMAND_RETIRED' } })

      const genericWorkingTimeUpdate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 4,
        payload: {
          employeeId: support.id, workTimeType: 'Part-Time', workStart: '08:00', workEnd: '12:00',
          workShifts: [
            { id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
            { id: 'support_pm', name: 'Ca chiều trái phép', start: '13:00', end: '17:30' },
          ],
          workingTime: {
            type: 'Part-Time', mode: 'shifts',
            shifts: [
              { id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
              { id: 'support_pm', name: 'Ca chiều trái phép', start: '13:00', end: '17:30' },
            ],
          },
        },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-support-generic-update-0001' }), env)
      expect(genericWorkingTimeUpdate.status).toBe(400)
      expect(await genericWorkingTimeUpdate.json()).toMatchObject({ error: { code: 'WORK_TIME_UPDATE_COMMAND_REQUIRED' } })

      const supportUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.working_time.set', expectedVersion: 4,
        payload: {
          employeeId: support.id, effectiveFrom: '2026-08-20',
          workTimeType: 'Part-Time', workStart: '08:00', workEnd: '12:00',
          workShifts: [
            { id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
            { id: 'support_pm', name: 'Ca chiều mới', start: '13:00', end: '17:30' },
          ],
          workingTime: {
            type: 'Part-Time', mode: 'shifts',
            shifts: [
              { id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
              { id: 'support_pm', name: 'Ca chiều mới', start: '13:00', end: '17:30' },
            ],
          },
        },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-support-update-0001' }), env)
      expect(supportUpdated.status).toBe(410)
      expect(await supportUpdated.json()).toMatchObject({ error: { code: 'COMMAND_RETIRED' } })

      const officeMetadataUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 4,
        payload: { employeeId: office.id, address: 'Địa chỉ mới đã xác nhận' },
      }, { ...adminAuthorization, 'idempotency-key': 'working-time-office-metadata-update' }), env)
      expect(officeMetadataUpdated.status).toBe(200)
      expect(await officeMetadataUpdated.json()).toMatchObject({ version: 5, employee: { workShifts: [{ id: 'office_am' }] } })
      const supportMetadataUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 5,
        payload: { employeeId: support.id, address: 'TP. Hồ Chí Minh đã xác nhận' },
      }, { ...adminAuthorization, 'idempotency-key': 'working-time-support-metadata-update' }), env)
      expect(supportMetadataUpdated.status).toBe(200)
      expect(await supportMetadataUpdated.json()).toMatchObject({
        version: 6, employee: { workShifts: [{ id: 'support_am' }, { id: 'support_pm', name: 'Ca chiều mới' }] },
      })

      const protectedUpdate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 6,
        payload: { employeeId: support.id, phone: '0908999999' },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-support-protected-0001' }), env)
      expect(protectedUpdate.status).toBe(403)
      expect(await protectedUpdate.json()).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })

      const missingShift = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 6,
        payload: { location: { latitude: 10.8231, longitude: 106.6297, accuracy: 10 } },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-support-missing-shift-0001' }), env)
      expect(missingShift.status).toBe(400)
      expect(await missingShift.json()).toMatchObject({ error: { code: 'PROFILE_WORK_SHIFT_REQUIRED' } })

      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 6,
        payload: {
          shiftId: 'support_pm',
          location: { latitude: 10.8231, longitude: 106.6297, accuracy: 10, label: 'Văn phòng IDOSI' },
        },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-support-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      expect(await checkedIn.json()).toMatchObject({
        version: 7,
        attendance: {
          employeeId: support.id, shiftId: 'support_pm', shiftName: 'Ca chiều mới',
          shiftStart: '13:00', shiftEnd: '17:30', shiftSource: 'profile-work-shift',
          checkIn: '13:05', arrivalTag: 'Đi đúng giờ', minutesLate: 5,
        },
      })

      const dailySchedule = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.assign', expectedVersion: 7,
        payload: {
          employeeId: support.id, date: '2026-08-21', shiftName: 'Ca tối',
          start: '18:00', end: '21:00', note: 'Lịch riêng ngày 21/08',
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-daily-schedule-0001' }), env)
      expect(dailySchedule.status).toBe(200)
      expect(await dailySchedule.json()).toMatchObject({
        version: 8,
        schedule: {
          employeeId: support.id, targetUnit: 'business_support', date: '2026-08-21', employmentType: 'Part-Time',
          shiftName: 'Ca tối', start: '18:00', end: '21:00', version: 1,
        },
        history: { action: 'Tạo lịch', recordedBy: { role: 'business_support' } },
      })
      const officeDailySchedule = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.assign', expectedVersion: 8,
        payload: {
          targetUnit: 'office', employeeId: office.id, date: '2026-08-21', shiftName: 'Ca văn phòng',
          start: '08:00', end: '17:30', note: 'Lịch dành cho Khối văn phòng',
        },
      }, { ...supportAuthorization, 'idempotency-key': 'office-daily-schedule-0001' }), env)
      expect(officeDailySchedule.status).toBe(200)
      expect(await officeDailySchedule.json()).toMatchObject({
        version: 9,
        schedule: {
          employeeId: office.id, targetUnit: 'office', date: '2026-08-21',
          shiftName: 'Ca văn phòng', start: '08:00', end: '17:30', version: 1,
        },
      })
      const scheduledState = readHydratedState(env.DB.database)
      expect(scheduledState.supportWorkSchedules).toEqual(expect.arrayContaining([
        expect.objectContaining({ employeeId: support.id, targetUnit: 'business_support', date: '2026-08-21', shiftName: 'Ca tối' }),
        expect.objectContaining({ employeeId: office.id, targetUnit: 'office', date: '2026-08-21', shiftName: 'Ca văn phòng' }),
      ]))
      expect(scheduledState.notifications).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'support-schedule-assigned', targetEmployeeId: support.id }),
        expect.objectContaining({ type: 'support-schedule-assigned', targetEmployeeId: office.id, route: '/employee/schedule' }),
      ]))
      const officeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'office.shifts', password: 'office-shifts-password',
      }), env)
      const officeAuthorization = { authorization: `Bearer ${(await officeLogin.json()).token}` }
      const officeState = await worker.fetch(new Request('https://idosi.example/api/state', { headers: officeAuthorization }), env)
      expect(officeState.status).toBe(200)
      expect((await officeState.json()).state.supportWorkSchedules).toEqual([
        expect.objectContaining({ employeeId: office.id, targetUnit: 'office', date: '2026-08-21' }),
      ])
      const scheduled = readHydratedState(env.DB.database).supportWorkSchedules.find(({ employeeId }) => employeeId === support.id)
      const supportScheduleUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.assign', expectedVersion: 9,
        payload: {
          scheduleId: scheduled.id, employeeId: support.id, date: '2026-08-22', shiftName: 'Ca tối mới',
          start: '18:30', end: '21:30', note: 'Hỗ trợ KD sửa lịch',
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-daily-schedule-update-0001' }), env)
      expect(supportScheduleUpdated.status).toBe(200)
      expect(await supportScheduleUpdated.json()).toMatchObject({
        version: 10,
        schedule: { id: scheduled.id, date: '2026-08-22', start: '18:30', end: '21:30', version: 2 },
        history: { action: 'Cập nhật lịch', recordedBy: { role: 'business_support' } },
      })
      const supportScheduleDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.delete', expectedVersion: 10,
        payload: { scheduleId: scheduled.id, reason: 'Phân lịch nhầm' },
      }, { ...supportAuthorization, 'idempotency-key': 'support-daily-schedule-delete-0001' }), env)
      expect(supportScheduleDeleted.status).toBe(200)
      expect(await supportScheduleDeleted.json()).toMatchObject({
        version: 11,
        schedule: { id: scheduled.id, employeeId: support.id },
        history: { action: 'Xóa lịch', reason: 'Phân lịch nhầm', recordedBy: { role: 'business_support' } },
      })
      expect(readHydratedState(env.DB.database).supportWorkSchedules).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: scheduled.id }),
      ]))

      const officeSelfCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.assign', expectedVersion: 11,
        payload: {
          employeeId: office.id, targetUnit: 'office', date: '2026-08-22', shiftName: 'Ca sáng tự tạo',
          start: '08:00', end: '12:00', note: 'Nhân viên văn phòng tự tạo',
        },
      }, { ...officeAuthorization, 'idempotency-key': 'office-self-schedule-create-0001' }), env)
      expect(officeSelfCreated.status).toBe(200)
      const officeSelfCreatedBody = await officeSelfCreated.json()
      expect(officeSelfCreatedBody).toMatchObject({
        version: 12,
        schedule: {
          employeeId: office.id, targetUnit: 'office', date: '2026-08-22',
          shiftName: 'Ca sáng tự tạo', start: '08:00', end: '12:00',
        },
        history: { action: 'Tạo lịch', recordedBy: { role: 'employee' } },
      })

      const officeSelfSpoofed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.assign', expectedVersion: 12,
        payload: {
          employeeId: support.id, targetUnit: 'business_support', date: '2026-08-23', shiftName: 'Ca giả mạo',
          start: '08:00', end: '12:00',
        },
      }, { ...officeAuthorization, 'idempotency-key': 'office-self-schedule-spoof-0001' }), env)
      expect(officeSelfSpoofed.status).toBe(403)
      expect(await officeSelfSpoofed.json()).toMatchObject({ error: { code: 'SUPPORT_SCHEDULE_SELF_ONLY' } })

      const officeSelfUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.assign', expectedVersion: 12,
        payload: {
          scheduleId: officeSelfCreatedBody.schedule.id, employeeId: office.id, targetUnit: 'office',
          date: '2026-08-23', shiftName: 'Ca sáng đã sửa', start: '08:30', end: '12:30',
        },
      }, { ...officeAuthorization, 'idempotency-key': 'office-self-schedule-update-0001' }), env)
      expect(officeSelfUpdated.status).toBe(200)
      expect(await officeSelfUpdated.json()).toMatchObject({
        version: 13,
        schedule: { id: officeSelfCreatedBody.schedule.id, employeeId: office.id, date: '2026-08-23', start: '08:30', end: '12:30' },
        history: { action: 'Cập nhật lịch', recordedBy: { role: 'employee' } },
      })

      const officeSelfDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.delete', expectedVersion: 13,
        payload: { scheduleId: officeSelfCreatedBody.schedule.id, reason: 'Nhân viên đổi ngày nghỉ' },
      }, { ...officeAuthorization, 'idempotency-key': 'office-self-schedule-delete-0001' }), env)
      expect(officeSelfDeleted.status).toBe(200)
      expect(await officeSelfDeleted.json()).toMatchObject({
        version: 14,
        schedule: { id: officeSelfCreatedBody.schedule.id, employeeId: office.id },
        history: { action: 'Xóa lịch', reason: 'Nhân viên đổi ngày nghỉ', recordedBy: { role: 'employee' } },
      })
      expect(readHydratedState(env.DB.database).supportWorkSchedules).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: officeSelfCreatedBody.schedule.id }),
      ]))
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('preserves assigned store shift resolution for Store Manager attendance', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-24T01:05:00.000Z')) // 08:05 Vietnam
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-manager-attendance-shift' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'manager-attendance-admin-password',
        initialState: {
          stores: [{ id: 'S01', short: 'TNV', name: 'IDOSI Tô Ngọc Vân', status: 'Đang hoạt động' }],
          employees: [], attendance: [],
          schedule: [{
            id: 'MANAGER-ASSIGNMENT', storeId: 'S01', employeeId: 'QLCH-001', date: '2026-08-24',
            shiftId: 'MANAGER_SHIFT', shiftIds: ['MANAGER_SHIFT'],
          }],
          shiftDefinitions: [{
            id: 'MANAGER_SHIFT', storeId: 'S01', name: 'Ca quản lý cửa hàng', start: '08:00', end: '12:00', active: true,
          }],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'manager-attendance-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
      const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 1,
        payload: {
          unit: 'store_manager', storeId: 'S01', name: 'Quản lý giữ ca cửa hàng', phone: '0908777010',
          cccd: '079777001010', address: 'TP. Hồ Chí Minh', startDate: '2026-08-20',
          employmentType: 'Full-Time', position: 'Quản lý cửa hàng', username: 'manager.shift',
          password: 'manager-shift-password', identityImages: testIdentityImages(),
        },
      }, { ...adminAuthorization, 'idempotency-key': 'manager-attendance-create' }), env)
      expect(managerCreated.status).toBe(201)
      expect((await managerCreated.json()).employee).toMatchObject({ id: 'QLCH-001', unit: 'store_manager' })
      const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'manager.shift', password: 'manager-shift-password',
      }), env)
      const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 2,
        payload: {
          shiftId: 'MANAGER_SHIFT',
          location: { latitude: 10.8231, longitude: 106.6297, accuracy: 8 },
        },
      }, { ...managerAuthorization, 'idempotency-key': 'manager-attendance-check-in' }), env)
      expect(checkedIn.status).toBe(201)
      expect(await checkedIn.json()).toMatchObject({
        version: 3,
        attendance: {
          employeeId: 'QLCH-001', shiftId: 'MANAGER_SHIFT', shiftName: 'Ca quản lý cửa hàng',
          shiftStart: '08:00', shiftEnd: '12:00', checkIn: '08:05', minutesLate: 5,
        },
      })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('uses canonical daily schedules for Office and Business Support when a single submitted profile shift id is stale', async () => {
    vi.useFakeTimers()
    try {
      // The UTC date is still 23/08, but the canonical business date in Vietnam
      // is already 24/08. The daily schedule must be selected by that VN date.
      vi.setSystemTime(new Date('2026-08-23T23:59:00.000Z')) // 06:59 24/08 Vietnam
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-canonical-daily-attendance' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'canonical-daily-admin-password',
        initialState: { stores: [], employees: [], attendance: [], schedule: [], shiftDefinitions: [] },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'canonical-daily-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

      const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 1,
        payload: {
          unit: 'business_support', name: 'Hỗ trợ lịch ngày', phone: '0908777001', cccd: '079777000111',
          address: 'TP. Hồ Chí Minh', startDate: '2026-08-20', employmentType: 'Part-Time', position: 'NV hỗ trợ KD',
          username: 'support.daily', password: 'support-daily-password', identityImages: testIdentityImages(),
          workShifts: [
            { id: 'support_am', name: 'Ca hồ sơ sáng', start: '08:00', end: '12:00' },
            { id: 'support_pm', name: 'Ca hồ sơ chiều', start: '13:00', end: '17:30' },
          ],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'canonical-daily-support-create' }), env)
      expect(supportCreated.status).toBe(201)
      const support = (await supportCreated.json()).employee

      const officeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 2,
        payload: {
          unit: 'office', storeId: 'OFFICE', name: 'Văn phòng lịch ngày', phone: '0908777002', cccd: '079777000222',
          address: 'TP. Hồ Chí Minh', startDate: '2026-08-20', employmentType: 'Full-Time', position: 'Kế toán',
          username: 'office.daily', password: 'office-daily-password', identityImages: testIdentityImages(),
          workShifts: [{ id: 'full_time', name: 'Giờ hồ sơ', start: '08:00', end: '17:30' }],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'canonical-daily-office-create' }), env)
      expect(officeCreated.status).toBe(201)
      const office = (await officeCreated.json()).employee

      const supportDailyResponse = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.assign', expectedVersion: 3,
        payload: {
          targetUnit: 'business_support', employeeId: support.id, date: '2026-08-24',
          shiftName: 'Ca ngày hỗ trợ', start: '08:30', end: '17:00',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'canonical-daily-support-assign' }), env)
      expect(supportDailyResponse.status).toBe(200)
      const supportDaily = (await supportDailyResponse.json()).schedule
      const officeDailyResponse = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.assign', expectedVersion: 4,
        payload: {
          targetUnit: 'office', employeeId: office.id, date: '2026-08-24',
          shiftName: 'Ca ngày văn phòng', start: '08:30', end: '17:00',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'canonical-daily-office-assign' }), env)
      expect(officeDailyResponse.status).toBe(200)
      const officeDaily = (await officeDailyResponse.json()).schedule

      const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'support.daily', password: 'support-daily-password',
      }), env)
      const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
      const officeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'office.daily', password: 'office-daily-password',
      }), env)
      const officeAuthorization = { authorization: `Bearer ${(await officeLogin.json()).token}` }
      const location = { latitude: 10.8231, longitude: 106.6297, accuracy: 8 }

      const supportCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 5,
        payload: {
          shiftId: 'support_am', shiftName: 'Ca client không hợp lệ', start: '00:00', end: '00:01', location,
        },
      }, { ...supportAuthorization, 'idempotency-key': 'canonical-daily-support-check-in' }), env)
      expect(supportCheckIn.status).toBe(201)
      const supportAttendance = (await supportCheckIn.json()).attendance
      expect(supportAttendance).toMatchObject({
        employeeId: support.id, date: '2026-08-24', shiftId: supportDaily.id, shiftName: 'Ca ngày hỗ trợ',
        shiftStart: '08:30', shiftEnd: '17:00', shiftSource: 'support-daily-schedule',
        checkIn: '06:59', checkInAt: '2026-08-23T23:59:00.000Z', minutesEarly: 91, minutesLate: 0,
        workdayCredit: 0,
      })

      vi.setSystemTime(new Date('2026-08-24T01:35:00.000Z')) // 08:35 Vietnam
      const officeCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 6,
        payload: {
          shiftId: 'full_time', shiftName: 'Ca client không hợp lệ', start: '00:00', end: '00:01', location,
        },
      }, { ...officeAuthorization, 'idempotency-key': 'canonical-daily-office-check-in' }), env)
      expect(officeCheckIn.status).toBe(201)
      const officeAttendance = (await officeCheckIn.json()).attendance
      expect(officeAttendance).toMatchObject({
        employeeId: office.id, shiftId: officeDaily.id, shiftName: 'Ca ngày văn phòng',
        shiftStart: '08:30', shiftEnd: '17:00', shiftSource: 'support-daily-schedule',
        checkIn: '08:35', minutesLate: 5, workdayCredit: 0,
      })

      const supportDailyUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_schedule.assign', expectedVersion: 7,
        payload: {
          scheduleId: supportDaily.id, targetUnit: 'business_support', employeeId: support.id,
          date: '2026-08-24', shiftName: 'Ca ngày đã đổi', start: '09:00', end: '18:00',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'canonical-daily-support-update' }), env)
      expect(supportDailyUpdated.status).toBe(200)

      vi.setSystemTime(new Date('2026-08-24T10:00:00.000Z')) // 17:00 Vietnam
      const supportCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 8,
        payload: { attendanceId: supportAttendance.id, location },
      }, { ...supportAuthorization, 'idempotency-key': 'canonical-daily-support-check-out' }), env)
      expect(supportCheckOut.status).toBe(200)
      expect(await supportCheckOut.json()).toMatchObject({
        version: 9,
        attendance: {
          id: supportAttendance.id, shiftId: supportDaily.id, shiftName: 'Ca ngày hỗ trợ',
          shiftStart: '08:30', shiftEnd: '17:00', workedSeconds: 36_060, workdayCredit: 1,
        },
      })

      const officeCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 9,
        payload: { attendanceId: officeAttendance.id, location },
      }, { ...officeAuthorization, 'idempotency-key': 'canonical-daily-office-check-out' }), env)
      expect(officeCheckOut.status).toBe(200)
      expect(await officeCheckOut.json()).toMatchObject({
        version: 10,
        attendance: {
          id: officeAttendance.id, shiftId: officeDaily.id,
          shiftStart: '08:30', shiftEnd: '17:00', workedSeconds: 30_300, workdayCredit: 1,
        },
      })

      vi.setSystemTime(new Date('2026-08-24T10:01:00.000Z'))
      const duplicate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 10,
        payload: { shiftId: 'support_am', location },
      }, { ...supportAuthorization, 'idempotency-key': 'canonical-daily-support-duplicate' }), env)
      expect(duplicate.status).toBe(409)
      expect(await duplicate.json()).toMatchObject({ error: { code: 'OFFICE_ATTENDANCE_ALREADY_RECORDED' } })

      vi.setSystemTime(new Date('2026-08-25T01:05:00.000Z')) // 08:05 Vietnam; no daily schedule
      const nextDaySupportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'support.daily', password: 'support-daily-password',
      }), env)
      const nextDaySupportAuthorization = { authorization: `Bearer ${(await nextDaySupportLogin.json()).token}` }
      const ambiguousStaleShift = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 10,
        payload: { shiftId: 'removed_profile_shift', location },
      }, { ...nextDaySupportAuthorization, 'idempotency-key': 'canonical-profile-stale-multiple' }), env)
      expect(ambiguousStaleShift.status).toBe(400)
      expect(await ambiguousStaleShift.json()).toMatchObject({ error: { code: 'SHIFT_INVALID' } })

      const profileCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 10,
        payload: { shiftId: 'support_am', location },
      }, { ...nextDaySupportAuthorization, 'idempotency-key': 'canonical-profile-valid-next-date' }), env)
      expect(profileCheckIn.status).toBe(201)
      const profileAttendance = (await profileCheckIn.json()).attendance
      expect(profileAttendance).toMatchObject({
        employeeId: support.id, date: '2026-08-25', shiftId: 'support_am', shiftSource: 'profile-work-shift',
        shiftStart: '08:00', shiftEnd: '12:00', checkIn: '08:05', minutesLate: 5,
      })

      vi.setSystemTime(new Date('2026-08-25T05:00:00.000Z')) // 12:00 Vietnam
      const profileCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 11,
        payload: { attendanceId: profileAttendance.id, location },
      }, { ...nextDaySupportAuthorization, 'idempotency-key': 'canonical-profile-check-out-next-date' }), env)
      expect(profileCheckOut.status).toBe(200)
      expect(await profileCheckOut.json()).toMatchObject({
        version: 12,
        attendance: { id: profileAttendance.id, workedSeconds: 14_100, workdayCredit: 1 },
      })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('applies effective-dated Office and Business Support working time without rewriting attendance snapshots', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T01:05:00.000Z')) // 08:05 Vietnam
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-effective-working-time' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'effective-working-time-admin',
        initialState: { stores: [], employees: [], attendance: [], schedule: [], shiftDefinitions: [] },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'effective-working-time-admin',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

      const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 1,
        payload: {
          unit: 'business_support', name: 'Hỗ trợ thực tập', phone: '0908111222', cccd: '079888111222',
          address: 'TP. Hồ Chí Minh', startDate: '2026-08-20', employmentType: 'Thực Tập Sinh', position: 'NV hỗ trợ KD',
          username: 'support.effective', password: 'support-effective-password', identityImages: testIdentityImages(),
          workShifts: [{ id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' }],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'effective-support-create-0001' }), env)
      expect(supportCreated.status).toBe(201)
      const support = (await supportCreated.json()).employee

      const officeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 2,
        payload: {
          unit: 'office', storeId: 'OFFICE', name: 'Kế toán hiệu lực', phone: '0908333444', cccd: '079888333444',
          address: 'TP. Hồ Chí Minh', startDate: '2026-08-20', employmentType: 'Full-Time', position: 'Kế Toán',
          username: 'office.effective', password: 'office-effective-password', identityImages: testIdentityImages(),
          workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'effective-office-create-0001' }), env)
      expect(officeCreated.status).toBe(201)
      const office = (await officeCreated.json()).employee
      const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'support.effective', password: 'support-effective-password',
      }), env)
      const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
      const officeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'office.effective', password: 'office-effective-password',
      }), env)
      const officeAuthorization = { authorization: `Bearer ${(await officeLogin.json()).token}` }

      const oldAttendance = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 3,
        payload: { location: { latitude: 10.81, longitude: 106.68, accuracy: 8 } },
      }, { ...officeAuthorization, 'idempotency-key': 'effective-office-check-in-old' }), env)
      expect(oldAttendance.status).toBe(201)
      const oldAttendanceBody = await oldAttendance.json()
      expect(oldAttendanceBody.attendance).toMatchObject({ shiftStart: '08:00', shiftEnd: '17:30' })
      vi.setSystemTime(new Date('2026-08-20T10:30:00.000Z')) // 17:30 Vietnam
      const oldCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 4,
        payload: { attendanceId: oldAttendanceBody.attendance.id, location: { latitude: 10.81, longitude: 106.68, accuracy: 8 } },
      }, { ...officeAuthorization, 'idempotency-key': 'effective-office-check-out-old' }), env)
      expect(oldCheckOut.status).toBe(200)

      const officeScheduled = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.working_time.set', expectedVersion: 5,
        payload: {
          employeeId: office.id, effectiveFrom: '2026-08-21', workTimeType: 'Full-Time',
          workShifts: [{ id: 'full_time', name: 'Giờ hành chính mới', start: '08:30', end: '17:00' }],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'effective-office-schedule-0001' }), env)
      expect(officeScheduled.status).toBe(410)
      expect(await officeScheduled.json()).toMatchObject({ error: { code: 'COMMAND_RETIRED' } })

      const supportScheduled = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.working_time.set', expectedVersion: 5,
        payload: {
          employeeId: support.id, effectiveFrom: '2026-08-22', workTimeType: 'Part-Time',
          workShifts: [
            { id: 'support_pm', name: 'Ca chiều', start: '13:00', end: '17:30' },
            { id: 'support_evening', name: 'Ca tối', start: '18:00', end: '21:00' },
          ],
        },
      }, { ...supportAuthorization, 'idempotency-key': 'effective-support-schedule-0001' }), env)
      expect(supportScheduled.status).toBe(410)
      expect(await supportScheduled.json()).toMatchObject({ error: { code: 'COMMAND_RETIRED' } })

      const scheduledEmployees = readHydratedState(env.DB.database).employees.map((employee) => {
        if (employee.id === office.id) return {
          ...employee,
          workTimeSchedule: [
            { effectiveFrom: '2026-08-20', employmentType: 'Full-Time', workTimeType: 'Full-Time', workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }], source: 'preserved-history' },
            { effectiveFrom: '2026-08-21', employmentType: 'Full-Time', workTimeType: 'Full-Time', workShifts: [{ id: 'full_time', name: 'Giờ hành chính mới', start: '08:30', end: '17:00' }], source: 'preserved-history' },
          ],
        }
        if (employee.id === support.id) return {
          ...employee,
          workTimeSchedule: [
            { effectiveFrom: '2026-08-20', employmentType: 'Thực Tập Sinh', workTimeType: 'Part-Time', workShifts: [{ id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' }], source: 'preserved-history' },
            { effectiveFrom: '2026-08-22', employmentType: 'Thực Tập Sinh', workTimeType: 'Part-Time', workShifts: [{ id: 'support_pm', name: 'Ca hiệu lực 08:30', start: '08:30', end: '17:00' }], source: 'preserved-history' },
          ],
        }
        return employee
      })
      replaceStateCollection(env.DB.database, 'employees', scheduledEmployees)
      expect(readHydratedState(env.DB.database).employees.find(({ id }) => id === office.id).workTimeSchedule)
        .toHaveLength(2)

      for (const [expectedVersion, employeeId, phone, key] of [
        [5, office.id, '0908333445', 'office-one'],
        [6, support.id, '0908111223', 'support'],
        [7, office.id, '0908333446', 'office-two'],
      ]) {
        const metadataUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type: 'employee.update', expectedVersion, payload: { employeeId, phone },
        }, { ...adminAuthorization, 'idempotency-key': `effective-metadata-${key}` }), env)
        expect(metadataUpdated.status).toBe(200)
      }
      const preservedSchedules = readHydratedState(env.DB.database).employees
      expect(preservedSchedules.find(({ id }) => id === office.id).workTimeSchedule.map(({ effectiveFrom }) => effectiveFrom))
        .toEqual(['2026-08-20', '2026-08-21'])
      expect(preservedSchedules.find(({ id }) => id === support.id).workTimeSchedule.filter(({ effectiveFrom }) => effectiveFrom === '2026-08-22'))
        .toHaveLength(1)

      vi.setSystemTime(new Date('2026-08-21T01:35:00.000Z')) // 08:35 Vietnam
      const refreshedOfficeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'office.effective', password: 'office-effective-password',
      }), env)
      const refreshedOfficeAuthorization = { authorization: `Bearer ${(await refreshedOfficeLogin.json()).token}` }
      const newAttendance = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 8,
        payload: { location: { latitude: 10.81, longitude: 106.68, accuracy: 8 } },
      }, { ...refreshedOfficeAuthorization, 'idempotency-key': 'effective-office-check-in-new' }), env)
      expect(newAttendance.status).toBe(201)
      const newAttendanceBody = await newAttendance.json()
      expect(newAttendanceBody.attendance).toMatchObject({
        shiftName: 'Giờ hành chính mới', shiftStart: '08:30', shiftEnd: '17:00', minutesLate: 5,
      })
      let storedAttendance = readHydratedState(env.DB.database).attendance
      expect(storedAttendance.find(({ id }) => id === oldAttendanceBody.attendance.id)).toMatchObject({
        shiftStart: '08:00', shiftEnd: '17:30', checkOutAt: expect.any(String),
      })
      expect(storedAttendance.find(({ id }) => id === newAttendanceBody.attendance.id)).toMatchObject({
        shiftStart: '08:30', shiftEnd: '17:00',
      })

      vi.setSystemTime(new Date('2026-08-21T10:00:00.000Z')) // 17:00 Vietnam
      const newOfficeCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 9,
        payload: { attendanceId: newAttendanceBody.attendance.id, location: { latitude: 10.81, longitude: 106.68, accuracy: 8 } },
      }, { ...refreshedOfficeAuthorization, 'idempotency-key': 'effective-office-check-out-new' }), env)
      expect(newOfficeCheckOut.status).toBe(200)
      expect(await newOfficeCheckOut.json()).toMatchObject({
        version: 10,
        attendance: { shiftStart: '08:30', shiftEnd: '17:00', workdayCredit: 1 },
      })

      vi.setSystemTime(new Date('2026-08-22T01:35:00.000Z')) // 08:35 Vietnam
      const refreshedSupportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'support.effective', password: 'support-effective-password',
      }), env)
      const refreshedSupportAuthorization = { authorization: `Bearer ${(await refreshedSupportLogin.json()).token}` }
      const supportAttendance = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 10,
        payload: { shiftId: 'support_pm', location: { latitude: 10.81, longitude: 106.68, accuracy: 8 } },
      }, { ...refreshedSupportAuthorization, 'idempotency-key': 'effective-support-check-in-new' }), env)
      expect(supportAttendance.status).toBe(201)
      const supportAttendanceBody = await supportAttendance.json()
      expect(supportAttendanceBody.attendance).toMatchObject({
        shiftId: 'support_pm', shiftName: 'Ca hiệu lực 08:30',
        shiftStart: '08:30', shiftEnd: '17:00', minutesLate: 5,
      })

      vi.setSystemTime(new Date('2026-08-22T10:00:00.000Z')) // 17:00 Vietnam
      const supportCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 11,
        payload: { attendanceId: supportAttendanceBody.attendance.id, location: { latitude: 10.81, longitude: 106.68, accuracy: 8 } },
      }, { ...refreshedSupportAuthorization, 'idempotency-key': 'effective-support-check-out-new' }), env)
      expect(supportCheckOut.status).toBe(200)
      expect(await supportCheckOut.json()).toMatchObject({
        version: 12,
        attendance: { shiftStart: '08:30', shiftEnd: '17:00', workdayCredit: 1 },
      })

      const refreshedAdminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'effective-working-time-admin',
      }), env)
      const refreshedAdminAuthorization = { authorization: `Bearer ${(await refreshedAdminLogin.json()).token}` }
      const payrollClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 12, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...refreshedAdminAuthorization, 'idempotency-key': 'effective-office-payroll-close' }), env)
      expect(payrollClosed.status).toBe(201)
      expect(await payrollClosed.json()).toMatchObject({
        version: 13,
        period: { rows: [expect.objectContaining({ employeeId: office.id, workedDays: 2 })] },
      })

      storedAttendance = readHydratedState(env.DB.database).attendance
      expect(storedAttendance.find(({ id }) => id === newAttendanceBody.attendance.id)).toMatchObject({
        shiftStart: '08:30', shiftEnd: '17:00', workdayCredit: 1,
      })
      expect(storedAttendance.find(({ id }) => id === supportAttendanceBody.attendance.id)).toMatchObject({
        shiftStart: '08:30', shiftEnd: '17:00', workdayCredit: 1,
      })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it.each([
    {
      label: 'paid',
      period: { id: 'PAY-S02-AUG-PAID', storeId: 'S02', period: '2026-08', status: 'Đã chi', confirmedAt: '2026-08-20T00:00:00.000Z' },
      code: 'PAYROLL_PERIOD_PAID',
    },
    {
      label: 'locked',
      period: { id: 'PAY-S02-AUG-LOCKED', storeId: 'S02', period: '2026-08', status: 'Đã khóa', lockedAt: '2026-08-20T00:00:00.000Z' },
      code: 'PAYROLL_PERIOD_LOCKED',
    },
  ])('rejects a destination check-in when its payroll period is $label', async ({ label, period, code }) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T02:00:00.000Z')) // 09:00 Vietnam
      const transfer = {
        id: `TR-CHECK-IN-${label.toUpperCase()}`, employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T05:00:00.000Z',
        fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 45_000, allowance: 0,
        status: 'Đã duyệt', createdAt: '2026-08-19T00:00:00.000Z',
      }
      const { env, employeeAuthorization } = await setupSupportTransferRuntime({
        token: `bootstrap-transfer-check-in-${label}`, transfer, payrollPeriods: [period],
      })
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': `transfer-check-in-${label}-0001` }), env)
      expect(checkedIn.status).toBe(409)
      expect(await checkedIn.json()).toMatchObject({ error: { code } })
      const state = readHydratedState(env.DB.database)
      expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
      expect(state.attendance).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('blocks payroll close, pay and lock while attendance is open, then allows checkout and close', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T02:00:00.000Z')) // 09:00 Vietnam
      const transfer = {
        id: 'TR-OPEN-PAYROLL-GUARD', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T05:00:00.000Z',
        fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 45_000, allowance: 0,
        status: 'Đã duyệt', createdAt: '2026-08-19T00:00:00.000Z',
      }
      const { env, adminAuthorization, employeeAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-open-payroll-guard', transfer,
      })
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'open-payroll-guard-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      const checkedInBody = await checkedIn.json()
      const attendanceId = checkedInBody.attendance.id
      expect(checkedInBody.attendance).not.toHaveProperty('checklistSnapshot')

      for (const operation of ['close', 'pay', 'lock']) {
        const blocked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type: `payroll.${operation}`, expectedVersion: 2, payload: { storeId: 'S02', period: '2026-08' },
        }, { ...adminAuthorization, 'idempotency-key': `open-payroll-guard-${operation}-0001` }), env)
        expect(blocked.status, operation).toBe(409)
        expect(await blocked.json()).toMatchObject({
          error: { code: 'PAYROLL_ATTENDANCE_OPEN', details: { attendanceIds: [attendanceId] } },
        })
      }

      vi.setSystemTime(new Date('2026-08-20T03:00:00.000Z'))
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 2,
        payload: {
          attendanceId, cashRevenue: 0, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'open-payroll-guard-check-out-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({ version: 3, attendance: { id: attendanceId, workedSeconds: 3_600 } })

      const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 3, payload: { storeId: 'S02', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'open-payroll-guard-close-after-checkout-0001' }), env)
      expect(closed.status).toBe(201)
      expect(await closed.json()).toMatchObject({ version: 4, period: { storeId: 'S02', period: '2026-08', status: 'Đã chốt' } })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('lets business support correct destination attendance and Admin restore it within exact transfer bounds', async () => {
    const transfer = {
      id: 'TR-HISTORICAL-CORRECTION', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
      startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T05:00:00.000Z',
      fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 45_000, allowance: 0,
      status: 'Hoàn tất', completedAt: '2026-08-20T05:00:00.000Z',
    }
    const attendance = [{
      id: 'ATT-TRANSFER-CORRECTION', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ',
      storeId: 'S02', homeStoreId: 'S01', supportTransferId: transfer.id,
      date: '2026-08-20', workDate: '2026-08-20', attendanceDate: '2026-08-20',
      shiftId: 'SUPPORT_TRANSFER_TR_HISTORICAL_CORRECTION', shiftStart: '08:00', shiftEnd: '12:00',
      checkIn: '08:10', checkInAt: '2026-08-20T01:10:00.000Z',
      checkOut: '11:50', checkOutAt: '2026-08-20T04:50:00.000Z', workedSeconds: 13_200, hours: 11 / 3,
      deletedAt: null,
    }]
    const { env, adminAuthorization, supportAuthorization } = await setupSupportTransferRuntime({
      token: 'bootstrap-transfer-correction', transfer, attendance,
    })

    const extended = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: {
        attendanceId: attendance[0].id, date: '2026-08-20', checkIn: '08:00', checkOut: '23:00',
        reason: 'Không được kéo dài qua thời gian hỗ trợ',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'transfer-correction-out-of-bounds-0001' }), env)
    expect(extended.status).toBe(400)
    expect(await extended.json()).toMatchObject({ error: { code: 'ATTENDANCE_TRANSFER_BOUNDS_INVALID' } })

    const corrected = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: {
        attendanceId: attendance[0].id, date: '2026-08-20', checkIn: '08:00', checkOut: '12:00',
        reason: 'Đối soát đúng thời gian điều chuyển',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'transfer-correction-valid-0001' }), env)
    expect(corrected.status).toBe(200)
    expect(await corrected.json()).toMatchObject({
      version: 2,
      attendance: {
        id: attendance[0].id, storeId: 'S02', supportTransferId: transfer.id,
        checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T05:00:00.000Z',
        workedSeconds: 14_400, departureTag: 'Đã ra về',
      },
      audit: { actor: { role: 'business_support' } },
    })

    const restored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'operational_reset.restore', expectedVersion: 2,
      payload: {
        dataType: 'attendance', storeId: 'S02', employeeId: 'E01',
        fromDate: '2026-08-20', toDate: '2026-08-20', reason: 'Khôi phục giờ chấm công trước đó',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'transfer-correction-restore-0001' }), env)
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({
      version: 3, restoredCount: 1,
      restored: [{ id: attendance[0].id, storeId: 'S02', checkIn: '08:10', checkOut: '11:50' }],
    })
  }, 30_000)

  it('corrects an overnight transferred attendance using absolute next-day checkout time', async () => {
    const transfer = {
      id: 'TR-OVERNIGHT-CORRECTION', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
      startAt: '2026-08-31T15:00:00.000Z', endAt: '2026-08-31T19:00:00.000Z',
      fromDate: '2026-08-31', toDate: '2026-09-01', hourlySupportRate: 45_000, allowance: 0,
      status: 'Hoàn tất', completedAt: '2026-08-31T19:00:00.000Z',
    }
    const attendance = [{
      id: 'ATT-OVERNIGHT-CORRECTION', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ',
      storeId: 'S02', homeStoreId: 'S01', supportTransferId: transfer.id,
      date: '2026-08-31', workDate: '2026-08-31', attendanceDate: '2026-08-31',
      shiftId: 'SUPPORT_TRANSFER_TR_OVERNIGHT_CORRECTION', shiftStart: '22:00', shiftEnd: '02:00',
      checkIn: '22:15', checkInAt: '2026-08-31T15:15:00.000Z',
      checkOut: '01:45', checkOutAt: '2026-08-31T18:45:00.000Z', workedSeconds: 12_600, hours: 3.5,
      deletedAt: null,
    }]
    const { env, adminAuthorization } = await setupSupportTransferRuntime({
      token: 'bootstrap-overnight-correction', transfer, attendance,
    })
    const corrected = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: {
        attendanceId: attendance[0].id, date: '2026-08-31', checkIn: '22:30', checkOut: '01:30',
        reason: 'Đối soát ca hỗ trợ qua đêm',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'overnight-correction-valid-0001' }), env)
    expect(corrected.status).toBe(200)
    expect(await corrected.json()).toMatchObject({
      version: 2,
      attendance: {
        checkInAt: '2026-08-31T15:30:00.000Z', checkOutAt: '2026-08-31T18:30:00.000Z',
        workedSeconds: 10_800, workedMinutes: 180, hours: 3,
        arrivalTag: 'Đi trễ', minutesLate: 30, departureTag: 'Về sớm',
      },
    })
  }, 30_000)

  it('checks into an overnight support transfer using the exact previous-day start instant', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-31T17:30:00.000Z')) // 01/09 00:30 Vietnam
      const transfer = {
        id: 'TR-OVERNIGHT', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-31T15:00:00.000Z', endAt: '2026-08-31T19:00:00.000Z',
        fromDate: '2026-08-31', toDate: '2026-09-01', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt', createdAt: '2026-08-20T00:00:00.000Z',
      }
      const { env, employeeAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-transfer-overnight', transfer,
      })
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'overnight-transfer-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      expect(await checkedIn.json()).toMatchObject({
        version: 2,
        attendance: {
          date: '2026-09-01', storeId: 'S02', supportTransferId: 'TR-OVERNIGHT',
          shiftStart: '22:00', shiftEnd: '02:00', arrivalTag: 'Đi trễ', minutesLate: 150,
        },
      })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('caps cross-month support pay at endAt, invalidates the check-in period and pays allowance once', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-31T16:00:00.000Z')) // 31/08 23:00 Vietnam
      const transfer = {
        id: 'TR-CROSS-MONTH', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-31T15:00:00.000Z', endAt: '2026-08-31T19:00:00.000Z',
        fromDate: '2026-08-31', toDate: '2026-09-01', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt', createdAt: '2026-08-20T00:00:00.000Z',
      }
      const { env, adminAuthorization, employeeAuthorization, managerAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-transfer-cross-month',
        transfer,
        payrollPeriods: [{
          id: 'PAY-S02-AUG', storeId: 'S02', period: '2026-08', status: 'Đã chốt', rows: [],
          confirmedAt: null, lockedAt: null, needsReclose: false,
        }],
      })
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'cross-month-transfer-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      const checkedInBody = await checkedIn.json()
      const attendanceId = checkedInBody.attendance.id
      expect(checkedInBody.attendance).not.toHaveProperty('checklistSnapshot')

      vi.setSystemTime(new Date('2026-08-31T16:05:00.000Z'))
      const orderCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 2,
        payload: {
          storeId: 'S02', customerName: 'Khách hỗ trợ', gender: 'Nữ', occupation: 'Nhân viên VP',
          acquisitionChannel: 'Facebook', amount: 100_000, paymentMethod: 'Tiền mặt',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'cross-month-transfer-order-0001' }), env)
      expect(orderCreated.status).toBe(201)
      const orderBody = await orderCreated.json()

      const deleteLinked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_transfer.delete', expectedVersion: 3,
        payload: { transferId: transfer.id, reason: 'Không được xóa sau khi chấm công' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-delete-linked-0001' }), env)
      expect(deleteLinked.status).toBe(409)
      expect(await deleteLinked.json()).toMatchObject({ error: { code: 'SUPPORT_TRANSFER_ATTENDANCE_IMMUTABLE' } })
      const cancelLinked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_transfer.update', expectedVersion: 3,
        payload: { transferId: transfer.id, status: 'Đã hủy' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-cancel-linked-0001' }), env)
      expect(cancelLinked.status).toBe(409)
      expect(await cancelLinked.json()).toMatchObject({ error: { code: 'SUPPORT_TRANSFER_ATTENDANCE_IMMUTABLE' } })

      vi.setSystemTime(new Date('2026-08-31T21:00:00.000Z')) // 01/09 04:00, two hours after endAt
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 3,
        payload: {
          attendanceId, cashRevenue: 100_000, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'cross-month-transfer-check-out-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 4,
        attendance: {
          storeId: 'S02', supportTransferId: transfer.id,
          elapsedSeconds: 18_000, workedSeconds: 10_800, workedMinutes: 180, hours: 3,
          supportActualPay: 315_000,
          supportCompensation: {
            hourlyRate: 45_000, hours: 3, basePay: 135_000, allowance: 180_000,
            allowanceApplied: true, totalPay: 315_000,
          },
        },
        supportExpense: {
          storeId: 'S02', amount: 315_000, sourceType: 'support-attendance-compensation', sourceId: attendanceId,
        },
      })
      const afterCheckout = readHydratedState(env.DB.database)
      expect(afterCheckout.expenseEntries.find(({ sourceId }) => sourceId === attendanceId)).toMatchObject({
        storeId: 'S02', amount: 315_000, recognized: true, category: 'payroll-support',
      })
      expect(afterCheckout.payrollPeriods.find(({ id }) => id === 'PAY-S02-AUG')).toMatchObject({
        period: '2026-08', needsReclose: true, invalidationReason: 'attendance.check_out',
      })
      expect(afterCheckout.payrollPeriods.some(({ period }) => period === '2026-09')).toBe(false)
      expect(afterCheckout.supportTransfers.find(({ id }) => id === transfer.id)).toMatchObject({ status: 'Hoàn tất' })

      replaceStateCollection(env.DB.database, 'schedule', [{
        id: 'SCH-HISTORICAL-S02', employeeId: 'E01', storeId: 'S02', date: '2026-08-31',
        shiftId: 'SHIFT-HISTORICAL-S02', shiftName: 'Ca lịch sử cửa hàng đích',
      }])

      const historicalManagerStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: managerAuthorization,
      }), env)
      const historicalManagerState = (await historicalManagerStateResponse.json()).state
      expect(historicalManagerState.employees.find(({ id }) => id === 'E01')).toEqual({
        id: 'E01',
        name: 'Nhân viên hỗ trợ',
        unit: 'store',
        status: 'Đang làm việc',
        storeId: 'S01',
        historicalStoreId: 'S02',
        historicalOnly: true,
      })
      expect(historicalManagerState.employees.find(({ id }) => id === 'E01')).not.toHaveProperty('hourlyRate')
      expect(historicalManagerState.employees.find(({ id }) => id === 'E01')).not.toHaveProperty('employmentType')
      expect(historicalManagerState.employees.some(({ id }) => id === 'HTKD-TRANSFER')).toBe(false)
      expect(historicalManagerState.attendance.find(({ id }) => id === attendanceId)).toMatchObject({ storeId: 'S02' })
      expect(historicalManagerState.schedule).toEqual([
        expect.objectContaining({ id: 'SCH-HISTORICAL-S02', employeeId: 'E01', storeId: 'S02' }),
      ])
      expect(historicalManagerState.orders.find(({ id }) => id === orderBody.order.id)).toMatchObject({ storeId: 'S02' })
      expect(historicalManagerState.notifications.find(({ orderId }) => orderId === orderBody.order.id)).toMatchObject({
        type: 'order.created', storeId: 'S02', employeeId: 'E01',
      })

      const augustPayroll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 4, payload: { storeId: 'S02', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-payroll-aug-0001' }), env)
      expect(augustPayroll.status).toBe(200)
      const augustPayrollBody = await augustPayroll.json()
      expect(augustPayrollBody.period.rows.find(({ employeeId }) => employeeId === 'E01')).toMatchObject({
        hours: 3, baseSalary: 135_000, supportHourlyPay: 135_000, supportAllowance: 180_000,
        supportActualPay: 315_000, gross: 315_000, supportTransferIds: [transfer.id],
      })
      const septemberPayroll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 5, payload: { storeId: 'S02', period: '2026-09' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-payroll-sep-0001' }), env)
      expect(septemberPayroll.status).toBe(201)
      expect((await septemberPayroll.json()).period.rows.some(({ employeeId }) => employeeId === 'E01')).toBe(false)
      const homePayroll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 6, payload: { storeId: 'S01', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-payroll-home-0001' }), env)
      expect(homePayroll.status).toBe(201)
      const homeEmployeeRow = (await homePayroll.json()).period.rows.find(({ employeeId }) => employeeId === 'E01')
      expect(homeEmployeeRow).toMatchObject({ hours: 0, baseSalary: 0, gross: 0 })
      expect(homeEmployeeRow).not.toHaveProperty('supportAllowance')
      const managerPayrollState = (await (await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: managerAuthorization,
      }), env)).json()).state
      expect(managerPayrollState.payrollPeriods.find(({ period }) => period === '2026-08').rows).toEqual([
        expect.objectContaining({ employeeId: 'E01', supportAllowance: 180_000 }),
      ])
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('rejects a cross-month checkout for legacy open attendance when the destination period is locked', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-31T16:00:00.000Z'))
      const transfer = {
        id: 'TR-LOCKED-AUG', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-31T15:00:00.000Z', endAt: '2026-08-31T19:00:00.000Z',
        fromDate: '2026-08-31', toDate: '2026-09-01', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt', createdAt: '2026-08-20T00:00:00.000Z',
      }
      const { env, employeeAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-transfer-locked-aug',
        transfer,
        attendance: [{
          id: 'ATT-LOCKED-AUG-OPEN', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ',
          storeId: 'S02', homeStoreId: 'S01', supportTransferId: transfer.id,
          date: '2026-08-31', workDate: '2026-08-31', shiftId: 'SUPPORT_TRANSFER_TR_LOCKED_AUG',
          shiftStart: '22:00', shiftEnd: '02:00', checkIn: '23:00', checkInAt: '2026-08-31T16:00:00.000Z',
          checkOut: null, checkOutAt: null, deletedAt: null,
        }],
        payrollPeriods: [{
          id: 'PAY-S02-AUG-LOCKED', storeId: 'S02', period: '2026-08', status: 'Đã khóa', rows: [],
          confirmedAt: '2026-09-01T00:00:00.000Z', lockedAt: '2026-09-01T01:00:00.000Z',
        }],
      })
      vi.setSystemTime(new Date('2026-08-31T17:30:00.000Z')) // September locally, August attendance period
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 1,
        payload: {
          attendanceId: 'ATT-LOCKED-AUG-OPEN', cashRevenue: 0, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'locked-aug-transfer-check-out-0001' }), env)
      expect(checkedOut.status).toBe(409)
      expect(await checkedOut.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
      const state = readHydratedState(env.DB.database)
      expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
      expect(state.attendance.find(({ id }) => id === 'ATT-LOCKED-AUG-OPEN')).toMatchObject({ checkOutAt: null })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('does not complete an active transfer when closing a pre-existing home attendance', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T07:00:00.000Z'))
      const transfer = {
        id: 'TR-AFTER-HOME-SHIFT', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-20T07:00:00.000Z', endAt: '2026-08-20T14:00:00.000Z',
        fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt', createdAt: '2026-08-01T00:00:00.000Z',
      }
      const { env, employeeAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-transfer-home-open',
        transfer,
        attendance: [{
          id: 'ATT-HOME-OPEN', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ', storeId: 'S01',
          date: '2026-08-20', workDate: '2026-08-20', shiftId: 'HOME-SHIFT', shiftName: 'Ca cửa hàng chính',
          shiftStart: '08:00', shiftEnd: '17:00', checkIn: '08:00', checkInAt: '2026-08-20T01:00:00.000Z',
          checkOut: null, checkOutAt: null, deletedAt: null,
        }],
      })
      const blockedDestinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'home-open-destination-check-in-0001' }), env)
      expect(blockedDestinationCheckIn.status).toBe(409)
      expect(await blockedDestinationCheckIn.json()).toMatchObject({ error: { code: 'ATTENDANCE_ALREADY_OPEN' } })

      const homeCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 1,
        payload: {
          attendanceId: 'ATT-HOME-OPEN', cashRevenue: 0, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'home-open-check-out-0001' }), env)
      expect(homeCheckOut.status).toBe(200)
      expect(await homeCheckOut.json()).toMatchObject({ version: 2, attendance: { storeId: 'S01' } })
      const afterHomeCheckout = readHydratedState(env.DB.database)
      const unchangedTransfer = afterHomeCheckout.supportTransfers.find(({ id }) => id === transfer.id)
      expect(unchangedTransfer).toMatchObject({ status: 'Đã duyệt' })
      expect(unchangedTransfer).not.toHaveProperty('completedAt')

      const destinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 2,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'after-home-destination-check-in-0001' }), env)
      expect(destinationCheckIn.status).toBe(201)
      expect(await destinationCheckIn.json()).toMatchObject({
        version: 3,
        attendance: { storeId: 'S02', supportTransferId: transfer.id, shiftSource: 'support-transfer' },
      })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('derives support attendance and payroll compensation once across multiple linked records', () => {
    const transfer = {
      id: 'TR-SUPPORT-PAY-01', employeeId: 'E-SUPPORT', fromStoreId: 'S-HOME', toStoreId: 'S-RECEIVE',
      startAt: '2026-08-20T08:00', endAt: '2026-08-21T18:00', hourlySupportRate: 29_000,
      allowance: 50_000, status: 'Hoàn tất',
    }
    const attendance = [
      {
        id: 'ATT-SUPPORT-01', employeeId: 'E-SUPPORT', storeId: 'S-RECEIVE', supportTransferId: transfer.id,
        date: '2026-08-20', checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T04:00:00.000Z',
        workedSeconds: 3 * 3_600, hours: 3,
      },
      {
        id: 'ATT-SUPPORT-02', employeeId: 'E-SUPPORT', storeId: 'S-RECEIVE', supportTransferId: transfer.id,
        date: '2026-08-21', checkInAt: '2026-08-21T01:00:00.000Z', checkOutAt: '2026-08-21T03:00:00.000Z',
        workedSeconds: 2 * 3_600, hours: 2,
      },
    ]
    const state = {
      schemaVersion: 2, stateVersion: 1,
      stores: [{ id: 'S-HOME', name: 'Dosii Home' }, { id: 'S-RECEIVE', name: 'Dosii Receive' }],
      employees: [{ id: 'E-SUPPORT', storeId: 'S-HOME', unit: 'store', name: 'Nhân viên hỗ trợ' }],
      attendance, supportTransfers: [transfer], payrollPeriods: [],
    }

    expect(supportTransferPayFor({ ...state, attendance: [] }, 'E-SUPPORT', 'S-RECEIVE', '2026-08')).toBeNull()

    expect(supportCompensationForAttendance(state, attendance[0])).toMatchObject({
      transferId: transfer.id, supportStoreName: 'Dosii Receive', hourlyRate: 29_000,
      hours: 3, basePay: 87_000, allowance: 50_000, allowanceApplied: true, totalPay: 137_000,
    })
    expect(supportCompensationForAttendance(state, attendance[1])).toMatchObject({
      hours: 2, basePay: 58_000, allowance: 0, allowanceApplied: false, totalPay: 58_000,
    })
    expect(supportTransferPayFor(state, 'E-SUPPORT', 'S-RECEIVE', '2026-08')).toMatchObject({
      hours: 5, base: 145_000, allowance: 50_000, totalPay: 195_000,
      details: [{
        transferId: transfer.id, supportStoreName: 'Dosii Receive', hours: 5,
        hourlyRate: 29_000, basePay: 145_000, allowance: 50_000, totalPay: 195_000,
        attendanceIds: ['ATT-SUPPORT-01', 'ATT-SUPPORT-02'], allowanceAttendanceId: 'ATT-SUPPORT-01',
      }],
    })
    const employeeProjection = projectSharedState(state, {
      role: 'employee', employee_id: 'E-SUPPORT', user_id: 'U-SUPPORT', store_id: 'S-HOME', home_store_id: 'S-HOME',
    })
    expect(employeeProjection.stores).toEqual([{ id: 'S-HOME', name: 'Dosii Home' }])
    expect(employeeProjection.attendance).toEqual([
      expect.objectContaining({ supportActualPay: 137_000, supportCompensation: expect.objectContaining({ supportStoreName: 'Dosii Receive' }) }),
      expect.objectContaining({ supportActualPay: 58_000, supportAllowanceApplied: false }),
    ])
    const adminProjection = projectSharedState(state, { role: 'admin', user_id: 'ADMIN' })
    expect(adminProjection.attendance).toEqual([
      expect.objectContaining({ supportActualPay: 137_000, supportAllowanceApplied: true }),
      expect.objectContaining({ supportActualPay: 58_000, supportAllowanceApplied: false }),
    ])
  })

  it('normalizes store expense vouchers and enforces scoped update with Admin-only soft delete', async () => {
    expect(normalizeFixedExpenseItems([
      { category: 'Set up', amount: 1_000_000 },
      { category: 'Khác', name: 'Bảo trì máy lạnh', amount: 250_000 },
    ])).toEqual({
      totalAmount: 1_250_000,
      items: [
        { category: 'Set up', name: 'Set up', amount: 1_000_000, description: '' },
        { category: 'Khác', name: 'Bảo trì máy lạnh', amount: 250_000, description: '' },
      ],
    })
    expect(() => normalizeFixedExpenseItems([{ category: 'Khác', amount: 10_000 }]))
      .toThrow('cần nhập tên hoặc nội dung')

    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-store-expense-voucher' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'store-expense-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Dosii S01', status: 'Đang hoạt động' }],
        employees: [
          { id: 'HTKD-EXP', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'Hỗ trợ chi phí' },
          { id: 'QLCH-EXP', storeId: 'S01', unit: 'store_manager', name: 'Quản lý chi phí' },
        ],
        attendance: [], supportTransfers: [], fixedExpenses: [], expenseEntries: [], payrollPeriods: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'store-expense-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    for (const account of [
      { username: 'support.expense', password: 'support-expense-password', displayName: 'Hỗ trợ chi phí', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-EXP', role: 'business_support' },
      { username: 'manager.expense', password: 'manager-expense-password', displayName: 'Quản lý chi phí', storeId: 'S01', employeeId: 'QLCH-EXP', role: 'store_manager' },
    ]) {
      const createdUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create', payload: account,
      }, { ...adminAuthorization, 'idempotency-key': `expense-user-${account.employeeId}` }), env)
      expect(createdUser.status).toBe(201)
    }
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.expense', password: 'support-expense-password',
    }), env)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.expense', password: 'manager-expense-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'fixed_expense.create', expectedVersion: 1,
      payload: {
        storeId: 'S01', occurredAt: '2026-08-20T12:00:00.000Z', note: 'Chi phí vận hành tháng 8',
        items: [{ category: 'Mặt bằng', amount: 5_000_000 }, { category: 'Wifi', amount: 300_000 }],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-expense-voucher-create-0001' }), env)
    expect(created.status).toBe(201)
    const createdBody = await created.json()
    expect(createdBody).toMatchObject({
      version: 2,
      expense: { storeId: 'S01', totalAmount: 5_300_000, amount: 5_300_000, items: [{ category: 'Mặt bằng' }, { category: 'Wifi' }] },
      expenseEntry: { amount: 5_300_000, sourceType: 'fixed-expense', recognized: true },
    })
    const expenseId = createdBody.expense.id

    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'fixed_expense.update', expectedVersion: 2,
      payload: {
        expenseId, reason: 'Bổ sung tiền điện',
        items: [{ category: 'Mặt bằng', amount: 5_000_000 }, { category: 'Điện', amount: 700_000 }],
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-expense-voucher-update-0001' }), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      version: 3, expense: { id: expenseId, totalAmount: 5_700_000 }, expenseEntry: { amount: 5_700_000, recognized: true },
    })

    const supportDelete = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'fixed_expense.delete', expectedVersion: 3, payload: { expenseId, reason: 'Không có quyền xóa' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-expense-voucher-delete-denied-0001' }), env)
    expect(supportDelete.status).toBe(403)
    expect(await supportDelete.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })

    const deleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'fixed_expense.delete', expectedVersion: 3, payload: { expenseId, reason: 'Admin hủy phiếu nhập sai' },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-expense-voucher-delete-0001' }), env)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toMatchObject({ version: 4, expense: { id: expenseId, deletedAt: expect.any(String) } })
    const finalState = readHydratedState(env.DB.database)
    expect(finalState.fixedExpenses.find(({ id }) => id === expenseId)).toMatchObject({ deletedAt: expect.any(String) })
    expect(finalState.expenseEntries.find(({ sourceId }) => sourceId === expenseId)).toMatchObject({
      amount: 5_700_000, recognized: false, voidedAt: expect.any(String),
    })
    expect(env.DB.database.prepare("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id").all(expenseId))
      .toEqual([{ action: 'fixed_expense.create' }, { action: 'fixed_expense.update' }, { action: 'fixed_expense.delete' }])
  }, 45_000)

  it('keeps receiving-store support cost recognized exactly once after payroll payment', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-support-cost-accrual' }
    const transfer = {
      id: 'TR-COST-01', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
      startAt: '2026-08-20T08:00', endAt: '2026-08-21T18:00', hourlySupportRate: 29_000,
      allowance: 50_000, status: 'Hoàn tất',
    }
    const attendance = [
      { id: 'ATT-COST-01', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ', storeId: 'S02', supportTransferId: transfer.id, date: '2026-08-20', checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T04:00:00.000Z', workedSeconds: 10_800, hours: 3 },
      { id: 'ATT-COST-02', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ', storeId: 'S02', supportTransferId: transfer.id, date: '2026-08-21', checkInAt: '2026-08-21T01:00:00.000Z', checkOutAt: '2026-08-21T03:00:00.000Z', workedSeconds: 7_200, hours: 2 },
    ]
    const supportExpenses = [
      { id: 'EXP-COST-01', storeId: 'S02', employeeId: 'E01', amount: 137_000, sourceType: 'support-attendance-compensation', sourceId: 'ATT-COST-01', recognized: true, occurredAt: '2026-08-20T04:00:00.000Z' },
      { id: 'EXP-COST-02', storeId: 'S02', employeeId: 'E01', amount: 58_000, sourceType: 'support-attendance-compensation', sourceId: 'ATT-COST-02', recognized: true, occurredAt: '2026-08-21T03:00:00.000Z' },
    ]
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'support-cost-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Home' }, { id: 'S02', name: 'Receive' }],
        employees: [{ id: 'E01', storeId: 'S01', unit: 'store', name: 'Nhân viên hỗ trợ', employmentType: 'Part-Time', hourlyRate: 25_000 }],
        attendance, supportTransfers: [transfer], expenseEntries: supportExpenses,
        payrollPeriods: [], payrollPayments: [], cashTransactions: [], salaryAdjustments: [], salaryAdvances: [], orders: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'support-cost-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'S02', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'support-cost-payroll-close-0001' }), env)
    expect(closed.status).toBe(201)
    expect(await closed.json()).toMatchObject({
      version: 2,
      period: {
        financeSnapshot: { expense: 195_000 },
        rows: [{
          employeeId: 'E01', hours: 5, baseSalary: 145_000, supportHourlyPay: 145_000,
          supportAllowance: 50_000, supportActualPay: 195_000, gross: 195_000, remaining: 195_000,
          advancesPaid: 0,
        }],
      },
    })
    const paid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay', expectedVersion: 2, payload: { storeId: 'S02', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'support-cost-payroll-pay-0001' }), env)
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({
      version: 3, payments: [{ employeeId: 'E01', amount: 195_000, accruedExpenseAmount: 195_000 }],
    })
    const state = readHydratedState(env.DB.database)
    const recognizedCost = state.expenseEntries.filter((entry) => (
      entry.storeId === 'S02' && entry.recognized !== false && !entry.deletedAt && !entry.voidedAt
    )).reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    expect(recognizedCost).toBe(195_000)
    expect(state.expenseEntries.find(({ sourceType }) => sourceType === 'payroll-payment')).toMatchObject({
      amount: 195_000, recognized: false, accruedAmount: 195_000,
    })
    expect(state.expenseEntries.filter(({ sourceType }) => sourceType === 'payroll-accrual')).toEqual([
      expect.objectContaining({ amount: 0, recognized: true, supportCompensationAccrued: 195_000 }),
    ])
    expect(state.cashTransactions.find(({ sourceType }) => sourceType === 'payroll-payment')).toMatchObject({
      amount: 195_000, direction: 'out',
    })
  }, 45_000)

  it('excludes an unworked support transfer from destination payroll and expenses', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-unworked-support-payroll' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'unworked-support-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Home' }, { id: 'S02', name: 'Receive' }],
        employees: [{ id: 'E01', storeId: 'S01', unit: 'store', name: 'Chưa làm hỗ trợ', employmentType: 'Part-Time', hourlyRate: 25_000 }],
        supportTransfers: [{
          id: 'TR-NO-WORK', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
          startAt: '2026-08-20T08:00', endAt: '2026-08-20T17:00', hourlySupportRate: 29_000,
          allowance: 50_000, status: 'Đã duyệt',
        }],
        attendance: [], expenseEntries: [], payrollPeriods: [], payrollPayments: [], cashTransactions: [],
        salaryAdjustments: [], salaryAdvances: [], orders: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'unworked-support-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'S02', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'unworked-support-close-0001' }), env)
    expect(closed.status).toBe(201)
    expect(await closed.json()).toMatchObject({
      version: 2, period: { rows: [], financeSnapshot: { expense: 0 } },
    })
    const paid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay', expectedVersion: 2, payload: { storeId: 'S02', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'unworked-support-pay-0001' }), env)
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({ version: 3, payments: [] })
    const state = readHydratedState(env.DB.database)
    expect(state.expenseEntries).toEqual([
      expect.objectContaining({ sourceType: 'payroll-accrual', amount: 0, recognized: true }),
    ])
    expect(state.payrollPayments).toEqual([])
    expect(state.cashTransactions).toEqual([])
  }, 30_000)

  it('recognizes legacy support payroll cost at payment when no attendance accrual exists', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-legacy-support-cost' }
    const transfer = {
      id: 'TR-LEGACY-COST', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
      startAt: '2026-08-20T08:00', endAt: '2026-08-21T18:00', hourlySupportRate: 29_000,
      allowance: 50_000, status: 'Hoàn tất',
    }
    const attendance = [
      { id: 'ATT-LEGACY-COST-01', employeeId: 'E01', storeId: 'S02', supportTransferId: transfer.id, date: '2026-08-20', checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T04:00:00.000Z', hours: 3 },
      { id: 'ATT-LEGACY-COST-02', employeeId: 'E01', storeId: 'S02', supportTransferId: transfer.id, date: '2026-08-21', checkInAt: '2026-08-21T01:00:00.000Z', checkOutAt: '2026-08-21T03:00:00.000Z', hours: 2 },
      { id: 'ATT-HOME-COST-01', employeeId: 'E02', storeId: 'S02', date: '2026-08-20', checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T06:00:00.000Z', hours: 5 },
    ]
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'legacy-support-cost-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Home' }, { id: 'S02', name: 'Receive' }],
        employees: [
          { id: 'E01', storeId: 'S01', unit: 'store', name: 'Legacy support', employmentType: 'Part-Time' },
          { id: 'E02', storeId: 'S02', unit: 'store', name: 'Nhân viên cửa hàng nhận', employmentType: 'Part-Time', hourlyRate: 25_000 },
        ],
        attendance, supportTransfers: [transfer], expenseEntries: [], payrollPeriods: [], payrollPayments: [],
        cashTransactions: [], salaryAdjustments: [], salaryAdvances: [], orders: [{
          id: 'ORDER-LEGACY-COST-01', storeId: 'S02', employeeId: 'E02', amount: 500_000,
          status: 'Hoàn tất', createdAt: '2026-08-20T02:00:00.000Z',
        }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'legacy-support-cost-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'S02', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'legacy-support-cost-close-0001' }), env)
    expect(closed.status).toBe(201)
    const closedBody = await closed.json()
    expect(closedBody).toMatchObject({
      version: 2,
      period: {
        financeSnapshot: {
          revenue: 500_000, recognizedExpense: 0, supportAccrualGap: 195_000,
          nonPayrollExpense: 0, recognizedSupportExpense: 0,
          earnedPayrollExpense: 320_000, netPayrollExpense: 320_000,
          expense: 320_000, profit: 180_000,
        },
      },
    })
    expect(closedBody.period.rows.find(({ employeeId }) => employeeId === 'E01')).toMatchObject({
      supportActualPay: 195_000, gross: 195_000,
    })
    expect(closedBody.period.rows.find(({ employeeId }) => employeeId === 'E02')).toMatchObject({
      hours: 5, baseSalary: 125_000, gross: 125_000,
    })
    const paid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay', expectedVersion: 2, payload: { storeId: 'S02', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'legacy-support-cost-pay-0001' }), env)
    expect(paid.status).toBe(200)
    const state = readHydratedState(env.DB.database)
    const recognized = state.expenseEntries.filter((entry) => entry.recognized !== false && !entry.deletedAt && !entry.voidedAt)
    expect(recognized.find((entry) => entry.sourceType === 'payroll-accrual')).toMatchObject({
      sourceType: 'payroll-accrual', amount: 320_000, supportCompensationAccrued: 0,
    })
    expect(state.expenseEntries.filter((entry) => entry.sourceType === 'payroll-payment')).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: 'E01', amount: 195_000, recognized: false }),
      expect.objectContaining({ employeeId: 'E02', amount: 125_000, recognized: false }),
    ]))
    expect(recognized.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)).toBe(320_000)
  }, 30_000)

  it('recognizes only the missing support payroll delta after a partial attendance accrual', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-partial-support-cost' }
    const transfer = {
      id: 'TR-PARTIAL-COST', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
      startAt: '2026-08-20T08:00', endAt: '2026-08-20T18:00', hourlySupportRate: 29_000,
      allowance: 50_000, status: 'Hoàn tất',
    }
    const attendance = [{
      id: 'ATT-PARTIAL-COST', employeeId: 'E01', storeId: 'S02', supportTransferId: transfer.id,
      date: '2026-08-20', checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T06:00:00.000Z', hours: 5,
    }]
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'partial-support-cost-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Home' }, { id: 'S02', name: 'Receive' }],
        employees: [{ id: 'E01', storeId: 'S01', unit: 'store', name: 'Partial support', employmentType: 'Part-Time' }],
        attendance, supportTransfers: [transfer],
        expenseEntries: [{
          id: 'EXP-PARTIAL-COST', storeId: 'S02', employeeId: 'E01', amount: 100_000,
          sourceType: 'support-attendance-compensation', sourceId: 'ATT-PARTIAL-COST', recognized: true,
          occurredAt: '2026-08-20T06:00:00.000Z',
        }],
        payrollPeriods: [], payrollPayments: [], cashTransactions: [], salaryAdjustments: [], salaryAdvances: [], orders: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'partial-support-cost-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'S02', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'partial-support-cost-close-0001' }), env)
    expect(closed.status).toBe(201)
    const paid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay', expectedVersion: 2, payload: { storeId: 'S02', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'partial-support-cost-pay-0001' }), env)
    expect(paid.status).toBe(200)
    const state = readHydratedState(env.DB.database)
    const paymentExpense = state.expenseEntries.find(({ sourceType }) => sourceType === 'payroll-payment')
    expect(paymentExpense).toMatchObject({
      amount: 195_000, recognized: false, recognizedAmount: 0,
      accruedAmount: 100_000, supportExpectedAmount: 195_000,
    })
    expect(state.expenseEntries.find(({ sourceType }) => sourceType === 'payroll-accrual')).toMatchObject({
      amount: 95_000, recognized: true, supportCompensationAccrued: 100_000,
    })
    const recognizedTotal = state.expenseEntries.filter((entry) => entry.recognized !== false && !entry.deletedAt && !entry.voidedAt)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    expect(recognizedTotal).toBe(195_000)
  }, 30_000)

  it('snapshots the canonical store checklist and never lets a reason bypass incomplete active tasks', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T01:00:00.000Z'))
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-canonical-shift-checklist' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'checklist-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Store 01', status: 'Đang hoạt động' }],
        employees: [{ id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store', status: 'Đang làm việc' }],
        shiftDefinitions: [{ id: 'SHIFT-MORNING', storeId: 'S01', name: 'Ca sáng', start: '08:00', end: '12:00' }],
        schedule: [{ id: 'SCH-01', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftId: 'SHIFT-MORNING' }],
        workCatalogItems: [
          {
            id: 'CAT-CHECKLIST-FIXED', code: 'store.fixed.opening', version: 2,
            kind: 'FIXED_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng',
            name: 'Mở cửa hàng', amountVnd: 0, active: true, sortOrder: 1,
            effectiveFrom: '2026-08-01', effectiveTo: null,
          },
          {
            id: 'CAT-CHECKLIST-REWARD', code: 'store.reward.display', version: 3,
            kind: 'REWARD_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng',
            name: 'Trưng bày nhận thưởng', amountVnd: 50_000, active: true, sortOrder: 2,
            effectiveFrom: '2026-08-01', effectiveTo: null,
          },
        ],
        tasks: [], attendance: [], orders: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'checklist-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', payload: {
        role: 'employee', employeeId: 'E01', storeId: 'S01', username: 'employee.checklist',
        password: 'employee-checklist-password', displayName: 'Nhân viên checklist',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'checklist-employee-create-0001' }), env)
    expect(created.status).toBe(201)
    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.checklist', password: 'employee-checklist-password',
    }), env)
    const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
    const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.check_in', expectedVersion: 1,
      payload: { shiftId: 'SHIFT-MORNING', location: { latitude: 10.8, longitude: 106.7, accuracy: 5 } },
    }, { ...employeeAuthorization, 'idempotency-key': 'canonical-checklist-checkin-0001' }), env)
    expect(checkedIn.status).toBe(201)
    const checkedInBody = await checkedIn.json()
    const checklistTasks = checkedInBody.attendance.checklistSnapshot.tasks
    expect(checkedInBody.attendance.checklistSnapshot).toMatchObject({
      source: 'work-catalog', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-MORNING',
      tasks: expect.arrayContaining([
        expect.objectContaining({
          catalogItemId: 'CAT-CHECKLIST-FIXED', catalogCode: 'store.fixed.opening', catalogVersion: 2,
          kind: 'FIXED_TASK', amountVnd: 0, required: true, optional: false,
        }),
        expect.objectContaining({
          catalogItemId: 'CAT-CHECKLIST-REWARD', catalogCode: 'store.reward.display', catalogVersion: 3,
          kind: 'REWARD_TASK', amountVnd: 50_000, required: false, optional: true,
        }),
      ]),
    })
    expect(checklistTasks).toHaveLength(2)
    const fixedTask = checklistTasks.find(({ catalogItemId }) => catalogItemId === 'CAT-CHECKLIST-FIXED')
    const rewardTask = checklistTasks.find(({ catalogItemId }) => catalogItemId === 'CAT-CHECKLIST-REWARD')
    const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.check_out', expectedVersion: 2,
      payload: {
        attendanceId: checkedInBody.attendance.id, cashRevenue: 0, transferRevenue: 0,
        incompleteTaskReason: 'Không dùng lý do để bỏ qua checklist',
        location: { latitude: 10.8, longitude: 106.7, accuracy: 5 },
      },
    }, { ...employeeAuthorization, 'idempotency-key': 'canonical-checklist-bypass-denied-0001' }), env)
    expect(denied.status).toBe(409)
    expect(await denied.json()).toMatchObject({ error: { code: 'CHECKLIST_INCOMPLETE' } })
    const progress = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: 2,
      payload: {
        attendanceId: checkedInBody.attendance.id,
        tasks: [
          { id: fixedTask.id, completed: true },
          { id: rewardTask.id, completed: false },
        ],
      },
    }, { ...employeeAuthorization, 'idempotency-key': 'canonical-checklist-progress-0001' }), env)
    expect(progress.status).toBe(200)
    expect(await progress.json()).toMatchObject({
      version: 3, totalTasks: 2, completedTasks: 1, completionRate: 50,
      requiredTasks: 1, completedRequiredTasks: 1, rewardTasks: 1, completedRewardTasks: 0,
    })
    const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.check_out', expectedVersion: 3,
      payload: {
        attendanceId: checkedInBody.attendance.id, cashRevenue: 0, transferRevenue: 0,
        location: { latitude: 10.8, longitude: 106.7, accuracy: 5 },
      },
    }, { ...employeeAuthorization, 'idempotency-key': 'canonical-checklist-checkout-0001' }), env)
    expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 4,
        attendance: {
          id: checkedInBody.attendance.id, incompleteTaskReason: null, incompleteTasksSnapshot: [],
        },
      })

    const stateAfterFirstCheckout = readHydratedState(env.DB.database)
    const manualTask = {
      id: 'TASK-MANUAL-RECHECK', storeId: 'S01', date: '2026-08-20', shiftId: 'SHIFT-MORNING',
      employeeIds: ['E01'], title: 'Kiểm tra công việc thủ công', required: true, completedBy: {},
    }
    replaceStateCollection(env.DB.database, 'tasks', [
      manualTask,
      ...stateAfterFirstCheckout.tasks.map((task) => (
        task.id === fixedTask.id ? { ...task, checklistAttendanceId: undefined, completedBy: {} } : task
      )),
    ])
    const checkedInAgain = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.check_in', expectedVersion: 4,
      payload: { shiftId: 'SHIFT-MORNING', location: { latitude: 10.8, longitude: 106.7, accuracy: 5 } },
    }, { ...employeeAuthorization, 'idempotency-key': 'canonical-checklist-recheckin-0001' }), env)
    expect(checkedInAgain.status).toBe(201)
    const checkedInAgainBody = await checkedInAgain.json()
    const currentChecklistTasks = checkedInAgainBody.attendance.checklistSnapshot.tasks
    const currentFixedTask = currentChecklistTasks.find(({ catalogItemId }) => catalogItemId === 'CAT-CHECKLIST-FIXED')
    const currentRewardTask = currentChecklistTasks.find(({ catalogItemId }) => catalogItemId === 'CAT-CHECKLIST-REWARD')
    expect(currentChecklistTasks).toHaveLength(2)
    expect(currentChecklistTasks.map(({ id }) => id)).not.toEqual(expect.arrayContaining([fixedTask.id, rewardTask.id]))

    const beforeHistoricalTaskMutation = readHydratedState(env.DB.database)
    const rejectedHistoricalTaskMutation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.done', expectedVersion: 5, payload: { taskId: fixedTask.id, done: true },
    }, { ...employeeAuthorization, 'idempotency-key': 'canonical-checklist-old-task-done-0001' }), env)
    expect(rejectedHistoricalTaskMutation.status).toBe(409)
    expect(await rejectedHistoricalTaskMutation.json()).toMatchObject({ error: { code: 'TASK_ATTENDANCE_INVALID' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 5 })
    expect(readHydratedState(env.DB.database).tasks.find(({ id }) => id === fixedTask.id)).toEqual(
      beforeHistoricalTaskMutation.tasks.find(({ id }) => id === fixedTask.id),
    )

    const employeeState = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: employeeAuthorization,
    }), env)
    expect(employeeState.status).toBe(200)
    const employeeStateBody = await employeeState.json()
    const visibleTaskIds = employeeStateBody.state.tasks.map(({ id }) => id)
    expect(employeeStateBody.state.activeAttendanceId).toBe(checkedInAgainBody.attendance.id)
    expect(visibleTaskIds.sort()).toEqual([
      manualTask.id, currentFixedTask.id, currentRewardTask.id,
    ].sort())
    expect(new Set(visibleTaskIds).size).toBe(visibleTaskIds.length)

    const currentProgress = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: 5,
      payload: {
        attendanceId: checkedInAgainBody.attendance.id,
        tasks: [
          { id: manualTask.id, completed: true },
          { id: currentFixedTask.id, completed: true },
          { id: currentRewardTask.id, completed: false },
        ],
      },
    }, { ...employeeAuthorization, 'idempotency-key': 'canonical-checklist-current-progress-0001' }), env)
    expect(currentProgress.status).toBe(200)
    expect(await currentProgress.json()).toMatchObject({
      version: 6, attendanceId: checkedInAgainBody.attendance.id,
      totalTasks: 3, completedTasks: 2, requiredTasks: 2, completedRequiredTasks: 2,
    })

    const beforeSecondCheckout = readHydratedState(env.DB.database)
    replaceStateCollection(env.DB.database, 'tasks', beforeSecondCheckout.tasks.map((task) => (
      task.id === currentFixedTask.id
        ? { ...task, checklistAttendanceId: undefined }
        : task
    )))

    const checkedOutAgain = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.check_out', expectedVersion: 6,
      payload: {
        attendanceId: checkedInAgainBody.attendance.id, cashRevenue: 0, transferRevenue: 0,
        location: { latitude: 10.8, longitude: 106.7, accuracy: 5 },
      },
    }, { ...employeeAuthorization, 'idempotency-key': 'canonical-checklist-recheckout-0001' }), env)
    expect(checkedOutAgain.status).toBe(200)
    expect(await checkedOutAgain.json()).toMatchObject({
      version: 7, attendance: { id: checkedInAgainBody.attendance.id, incompleteTasksSnapshot: [] },
    })
    const stateAfterRecheck = readHydratedState(env.DB.database)
    expect(stateAfterRecheck.tasks).toHaveLength(5)
    expect(new Set(stateAfterRecheck.tasks.map(({ id }) => id)).size).toBe(5)
    const checklistAssignments = stateAfterRecheck.taskAssignmentHistory
      .filter(({ source }) => source === 'store-shift-checklist')
    expect(checklistAssignments).toHaveLength(2)
    expect(new Set(checklistAssignments.map(({ id }) => id)).size).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('recognizes payroll once at close while advances and payment mirrors only settle cash', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-payroll-accrual-invariant' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'payroll-accrual-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Store 01', status: 'Đang hoạt động' }],
        employees: [{
          id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store',
          employmentType: 'Full-Time', payBasis: 'monthly', monthlySalary: 24_000_000,
        }],
        orders: [{
          id: 'ORDER-ACCRUAL', storeId: 'S01', employeeId: 'E01', amount: 100_000_000,
          status: 'Hoàn tất', createdAt: '2026-08-20T02:00:00.000Z',
        }],
        violations: [{
          id: 'VIO-ACCRUAL', employeeId: 'E01', storeId: 'S01', date: '2026-08-20',
          amountVnd: 500_000, status: 'ACTIVE',
        }],
        salaryAdvances: [{
          id: 'ADV-ACCRUAL', employeeId: 'E01', storeId: 'S01', period: '2026-08',
          amount: 5_000_000, status: 'Đã chi', confirmedAt: '2026-08-20T03:00:00.000Z',
        }],
        expenseEntries: [{
          id: 'EXP-NON-PAYROLL', storeId: 'S01', amount: 50_000_000, recognized: true,
          sourceType: 'fixed-expense', sourceId: 'FIXED-01', occurredAt: '2026-08-20T02:00:00.000Z',
        }, {
          id: 'EXP-ADVANCE-MIRROR', storeId: 'S01', amount: 5_000_000, recognized: false,
          sourceType: 'salary-advance', sourceId: 'ADV-ACCRUAL', occurredAt: '2026-08-20T03:00:00.000Z',
        }],
        cashTransactions: [{
          id: 'TXN-ADVANCE', storeId: 'S01', amount: 5_000_000, direction: 'out',
          sourceType: 'salary-advance', sourceId: 'ADV-ACCRUAL', occurredAt: '2026-08-20T03:00:00.000Z',
        }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'payroll-accrual-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const closeCommand = {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'S01', period: '2026-08' },
    }
    const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', closeCommand, {
      ...authorization, 'idempotency-key': 'payroll-accrual-close-0001',
    }), env)
    expect(closed.status).toBe(201)
    const closedBody = await closed.json()
    expect(closedBody).toMatchObject({
      version: 2,
      period: {
        rows: [{ gross: 24_000_000, appliedViolationVnd: 500_000, remaining: 18_500_000 }],
        financeSnapshot: {
          revenue: 100_000_000,
          nonPayrollExpense: 50_000_000,
          earnedPayrollExpense: 23_500_000,
          recognizedSupportExpense: 0,
          netPayrollExpense: 23_500_000,
          expense: 73_500_000,
          profit: 26_500_000,
        },
      },
      payrollAccrual: { amount: 23_500_000, recognized: true, sourceType: 'payroll-accrual' },
    })
    const replay = await worker.fetch(jsonRequest('https://idosi.example/api/command', closeCommand, {
      ...authorization, 'idempotency-key': 'payroll-accrual-close-0001',
    }), env)
    expect(replay.status).toBe(201)
    expect(replay.headers.get('idempotency-replayed')).toBe('true')
    expect(await replay.json()).toEqual(closedBody)

    const paid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay', expectedVersion: 2, payload: { storeId: 'S01', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'payroll-accrual-pay-0001' }), env)
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({ payments: [{ amount: 18_500_000 }] })
    const state = readHydratedState(env.DB.database)
    expect(state.expenseEntries.filter(({ sourceType }) => sourceType === 'payroll-accrual')).toEqual([
      expect.objectContaining({ amount: 23_500_000, recognized: true }),
    ])
    expect(state.expenseEntries.find(({ sourceType }) => sourceType === 'payroll-payment')).toMatchObject({
      amount: 18_500_000, recognized: false,
    })
    const recognizedExpense = state.expenseEntries.filter((entry) => entry.recognized !== false)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    const cashOut = state.cashTransactions.filter((entry) => entry.direction === 'out')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    expect(recognizedExpense).toBe(73_500_000)
    expect(cashOut).toBe(23_500_000)
    expect(100_000_000 - recognizedExpense).toBe(26_500_000)
    expect(100_000_000 - 50_000_000 - cashOut).toBe(26_500_000)
  }, 30_000)

  it('creates violation batches atomically with scoped manager access, exact historical shifts and durable duplicate protection', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-violation-batch' }
    const historicalShiftId = `SHIFT_${'H'.repeat(120)}`
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'violation-batch-admin-password',
      initialState: {
        stores: [
          { id: 'S01', name: 'Dosii S01', status: 'Đang hoạt động' },
          { id: 'S02', name: 'Dosii S02', status: 'Đang hoạt động' },
        ],
        employees: [
          { id: 'QL-S01', name: 'Quản lý S01', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc' },
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store', status: 'Đang làm việc' },
          { id: 'E02', name: 'Nhân viên 02', storeId: 'S02', unit: 'store', status: 'Đang làm việc' },
          {
            id: 'PROFILE-E03', code: 'CODE-E03', employeeId: 'LEGACY-E03', name: 'Nhân viên alias',
            storeId: 'S02', unit: 'store', status: 'Đang làm việc',
          },
          { id: 'HTKD-BATCH', name: 'Hỗ trợ batch', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
        ],
        shiftDefinitions: [{
          id: historicalShiftId, storeId: 'S01', name: 'Ca đã đổi tên', start: '09:00', end: '13:00',
          version: 9, active: false, deletedAt: '2026-08-25T00:00:00.000Z',
        }, {
          id: 'SHIFT-S02', storeId: 'S02', name: 'Ca chiều S02', start: '12:00', end: '17:00', active: true,
        }, {
          id: 'SHIFT-LEGACY-NO-STORE', name: 'Ca legacy thiếu cửa hàng', start: '17:00', end: '21:00', active: true,
        }],
        schedule: [{
          id: 'SCH-S02', employeeId: 'E02', storeId: 'S02', date: '2026-08-20', shiftIds: ['SHIFT-S02'],
          shiftSnapshots: [{ id: 'SHIFT-S02', name: 'Ca chiều lịch sử', start: '12:00', end: '17:00', version: 4 }],
        }, {
          id: 'SCH-S02-TODAY', employeeId: 'E02', storeId: 'S02', date: '2026-08-21', shiftIds: ['SHIFT-S02'],
          shiftSnapshots: [{ id: 'SHIFT-S02', name: 'Ca chiều ngày hiện tại', start: '12:00', end: '17:00', version: 4 }],
        }, {
          id: 'SCH-S02-FUTURE', employeeId: 'E02', storeId: 'S02', date: '2026-08-22', shiftIds: ['SHIFT-S02'],
          shiftSnapshots: [{ id: 'SHIFT-S02', name: 'Ca chiều tương lai', start: '12:00', end: '17:00', version: 4 }],
        }, {
          id: 'SCH-S02-ALIAS', employeeId: 'LEGACY-E03', storeId: 'S02', date: '2026-08-20', shiftIds: ['SHIFT-S02'],
          shiftSnapshots: [{ id: 'SHIFT-S02', name: 'Ca chiều theo mã legacy', start: '12:00', end: '17:00', version: 4 }],
        }, {
          id: 'SCH-LEGACY-NO-STORE', employeeId: 'E01', date: '2026-08-20', shiftIds: ['SHIFT-LEGACY-NO-STORE'],
          shiftSnapshots: [{ id: 'SHIFT-LEGACY-NO-STORE', name: 'Ca legacy thiếu cửa hàng', start: '17:00', end: '21:00' }],
        }],
        attendance: [{
          id: 'att_historical_shift', employeeId: 'E01', storeId: 'S01', date: '2026-08-20',
          shiftId: historicalShiftId, shiftName: 'Ca sáng lịch sử', shiftStart: '08:00', shiftEnd: '12:00',
          shiftVersion: 3, checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T05:00:00.000Z',
        }],
        workCatalogItems: [{
          id: 'VIO-LATE', code: 'store.violation.late', version: 2, kind: 'VIOLATION',
          targetGroup: 'store', storeId: 'S01', shiftId: historicalShiftId, name: 'Đi trễ',
          amountVnd: 2_000, active: true, sortOrder: 1, effectiveFrom: '2026-08-01', effectiveTo: null,
        }, {
          id: 'VIO-FLOOR', code: 'store.violation.dirty_floor', version: 5, kind: 'VIOLATION',
          targetGroup: 'store', storeId: 'S01', shiftId: historicalShiftId, name: 'Sàn nhà dơ',
          amountVnd: 8_000, active: true, sortOrder: 2, effectiveFrom: '2026-08-01', effectiveTo: null,
        }, {
          id: 'VIO-CUSTOMER', code: 'store.violation.ignore_customer', version: 1, kind: 'VIOLATION',
          targetGroup: 'store', storeId: 'S01', shiftId: historicalShiftId, name: 'Không tương tác khách',
          amountVnd: 2_000, active: true, sortOrder: 3, effectiveFrom: '2026-08-01', effectiveTo: null,
        }],
        payrollPeriods: [{
          id: 'PAY-S01-2026-08', storeId: 'S01', period: '2026-08', status: 'Đã chốt',
          confirmedAt: null, lockedAt: null,
        }],
        violations: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'violation-batch-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', payload: {
        username: 'manager.s01', password: 'violation-batch-manager-password', displayName: 'Quản lý S01',
        role: 'store_manager', storeId: 'S01', employeeId: 'QL-S01',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'violation-batch-manager-user' }), env)
    expect(managerCreated.status).toBe(201)
    const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', payload: {
        username: 'support.batch', password: 'violation-batch-support-password', displayName: 'Hỗ trợ batch',
        role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-BATCH',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'violation-batch-support-user' }), env)
    expect(supportCreated.status).toBe(201)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.s01', password: 'violation-batch-manager-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.batch', password: 'violation-batch-support-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
    const currentVersion = () => Number(env.DB.database.prepare(
      "SELECT version FROM app_state WHERE scope_key = 'global'",
    ).get().version)

    const batchRequest = {
      type: 'violation.create_batch', expectedVersion: currentVersion(), payload: {
        targetUnit: 'store', storeId: 'S01', employeeId: 'E01', occurredOn: '2026-08-20',
        shiftId: historicalShiftId, catalogItemIds: ['VIO-LATE', 'VIO-FLOOR'], note: 'Đối soát cuối ca',
      },
    }
    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', batchRequest, {
      ...managerAuthorization, 'idempotency-key': 'violation-batch-create-0001',
    }), env)
    expect(created.status).toBe(201)
    const createdBody = await created.json()
    expect(createdBody).toMatchObject({
      totalAmountVnd: 10_000,
      violations: [{
        employeeId: 'E01', storeId: 'S01', attendanceId: 'att_historical_shift',
        shiftId: historicalShiftId, shiftName: 'Ca sáng lịch sử', shiftStart: '08:00', shiftEnd: '12:00',
        shiftVersion: 3, batchId: createdBody.batchId,
      }, {
        employeeId: 'E01', storeId: 'S01', attendanceId: 'att_historical_shift', batchId: createdBody.batchId,
      }],
    })
    expect(createdBody.violations.map(({ catalogItemId }) => catalogItemId).sort()).toEqual(['VIO-FLOOR', 'VIO-LATE'])
    expect(createdBody.violations.every(({ occurrenceKey }) => occurrenceKey.startsWith('violation-occurrence:v1:'))).toBe(true)
    let persisted = readHydratedState(env.DB.database)
    expect(persisted.violations).toHaveLength(2)
    expect(persisted.payrollPeriods[0]).toMatchObject({ needsReclose: true, invalidationReason: 'violation.create_batch' })
    expect(env.DB.database.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'violation.create_batch'",
    ).get()).toEqual({ count: 1 })

    const replay = await worker.fetch(jsonRequest('https://idosi.example/api/command', batchRequest, {
      ...managerAuthorization, 'idempotency-key': 'violation-batch-create-0001',
    }), env)
    expect(replay.status).toBe(201)
    expect(replay.headers.get('idempotency-replayed')).toBe('true')
    expect(await replay.json()).toEqual(createdBody)
    expect(readHydratedState(env.DB.database).violations).toHaveLength(2)

    const duplicate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...batchRequest, expectedVersion: currentVersion(),
    }, { ...managerAuthorization, 'idempotency-key': 'violation-batch-duplicate-0001' }), env)
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({ error: { code: 'VIOLATION_DUPLICATE' } })

    const duplicateViaLegacySingle = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create', expectedVersion: currentVersion(), payload: {
        targetUnit: 'store', storeId: 'S01', employeeId: 'E01', occurredOn: '2026-08-20',
        shiftId: historicalShiftId, catalogItemId: 'VIO-LATE', amountVnd: 2_000,
      },
    }, { ...adminAuthorization, 'idempotency-key': 'violation-batch-legacy-single-duplicate-0001' }), env)
    expect(duplicateViaLegacySingle.status).toBe(409)
    expect(await duplicateViaLegacySingle.json()).toMatchObject({ error: { code: 'VIOLATION_DUPLICATE' } })
    expect(readHydratedState(env.DB.database).violations).toHaveLength(2)

    const beforeAtomicFailureVersion = currentVersion()
    const atomicFailure = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create_batch', expectedVersion: beforeAtomicFailureVersion, payload: {
        storeId: 'S01', employeeId: 'E01', occurredOn: '2026-08-20', shiftId: historicalShiftId,
        catalogItemIds: ['VIO-LATE', 'VIO-NOT-ACTIVE'],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'violation-batch-atomic-0001' }), env)
    expect(atomicFailure.status).toBe(400)
    expect(await atomicFailure.json()).toMatchObject({ error: { code: 'VIOLATION_CATALOG_INVALID' } })
    expect(currentVersion()).toBe(beforeAtomicFailureVersion)
    expect(readHydratedState(env.DB.database).violations).toHaveLength(2)

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T17:05:00.000Z')) // 00:05 ngày 21/08 tại Việt Nam
      const localToday = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'violation.create_batch', expectedVersion: currentVersion(), payload: {
          storeId: 'S02', employeeId: 'E02', occurredOn: '2026-08-21', shiftId: 'SHIFT-S02',
          policyCodes: ['store.violation.forgot_attendance'],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'violation-local-today-batch-0001' }), env)
      expect(localToday.status).toBe(201)
      const versionBeforeFutureFailure = currentVersion()
      const violationCountBeforeFutureFailure = readHydratedState(env.DB.database).violations.length
      for (const [commandType, payload] of [
        ['violation.create_batch', {
          storeId: 'S02', employeeId: 'E02', occurredOn: '2026-08-22', shiftId: 'SHIFT-S02',
          policyCodes: ['store.violation.forgot_attendance'],
        }],
        ['violation.create', {
          targetUnit: 'store', storeId: 'S02', employeeId: 'E02', occurredOn: '2026-08-22',
          shiftId: 'SHIFT-S02', policyCode: 'store.violation.forgot_attendance', amountVnd: 2_000,
        }],
      ]) {
        const futureDated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type: commandType, expectedVersion: currentVersion(), payload,
        }, {
          ...adminAuthorization,
          'idempotency-key': `violation-future-${commandType.replaceAll('.', '-')}-0001`,
        }), env)
        expect(futureDated.status).toBe(400)
        expect(await futureDated.json()).toMatchObject({ error: { code: 'VIOLATION_DATE_FUTURE' } })
      }
      expect(currentVersion()).toBe(versionBeforeFutureFailure)
      expect(readHydratedState(env.DB.database).violations).toHaveLength(violationCountBeforeFutureFailure)
    } finally {
      vi.useRealTimers()
    }

    const crossStoreDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create_batch', expectedVersion: currentVersion(), payload: {
        storeId: 'S02', employeeId: 'E02', occurredOn: '2026-08-20', shiftId: 'SHIFT-S02',
        policyCodes: ['store.violation.forgot_attendance'],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'violation-batch-cross-store-0001' }), env)
    expect(crossStoreDenied.status).toBe(403)
    expect(await crossStoreDenied.json()).toMatchObject({ error: { code: 'STORE_SCOPE_FORBIDDEN' } })

    const fallback = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create_batch', expectedVersion: currentVersion(), payload: {
        storeId: 'S02', employeeId: 'E02', occurredOn: '2026-08-20', shiftId: 'SHIFT-S02',
        policyCodes: ['store.violation.forgot_attendance'],
      },
    }, { ...adminAuthorization, 'idempotency-key': 'violation-batch-policy-fallback-0001' }), env)
    expect(fallback.status).toBe(201)
    expect(await fallback.json()).toMatchObject({
      totalAmountVnd: 2_000,
      violations: [{
        policyCode: 'store.violation.forgot_attendance', title: 'Quên điểm danh', amountVnd: 2_000,
        attendanceId: null, shiftName: 'Ca chiều lịch sử', shiftStart: '12:00', shiftEnd: '17:00',
        policySnapshot: { source: 'WORKBOOK_COMPENSATION_POLICY' },
      }],
    })
    const aliasBackedShift = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create_batch', expectedVersion: currentVersion(), payload: {
        storeId: 'S02', employeeId: 'PROFILE-E03', occurredOn: '2026-08-20', shiftId: 'SHIFT-S02',
        policyCodes: ['store.violation.forgot_attendance'],
      },
    }, { ...adminAuthorization, 'idempotency-key': 'violation-batch-alias-shift-0001' }), env)
    expect(aliasBackedShift.status).toBe(201)
    expect(await aliasBackedShift.json()).toMatchObject({
      violations: [{
        employeeId: 'PROFILE-E03', storeId: 'S02',
        shiftId: 'SHIFT-S02', shiftName: 'Ca chiều theo mã legacy',
      }],
    })
    const supportBatch = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create_batch', expectedVersion: currentVersion(), payload: {
        storeId: 'S02', employeeId: 'E02', occurredOn: '2026-08-20', shiftId: 'SHIFT-S02',
        policyCodes: ['store.violation.ignore_customer'],
      },
    }, { ...supportAuthorization, 'idempotency-key': 'violation-batch-support-create-0001' }), env)
    expect(supportBatch.status).toBe(201)
    expect(await supportBatch.json()).toMatchObject({
      totalAmountVnd: 2_000,
      violations: [{ employeeId: 'E02', storeId: 'S02', policyCode: 'store.violation.ignore_customer' }],
    })

    replaceStateCollection(env.DB.database, 'employees', readHydratedState(env.DB.database).employees.map((employee) => (
      employee.id === 'E01' ? { ...employee, storeId: 'S02' } : employee
    )))
    const beforeLegacyShiftMismatchVersion = currentVersion()
    const legacyShiftMismatch = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create_batch', expectedVersion: currentVersion(), payload: {
        storeId: 'S01', employeeId: 'E01', occurredOn: '2026-08-20', shiftId: 'SHIFT-LEGACY-NO-STORE',
        policyCodes: ['store.violation.forgot_attendance'],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'violation-batch-legacy-shift-store-mismatch-0001' }), env)
    expect(legacyShiftMismatch.status).toBe(409)
    expect(await legacyShiftMismatch.json()).toMatchObject({ error: { code: 'EMPLOYEE_STORE_MISMATCH' } })
    expect(currentVersion()).toBe(beforeLegacyShiftMismatchVersion)
    const payrollBeforeTransferViolation = readHydratedState(env.DB.database).payrollPeriods
    replaceStateCollection(env.DB.database, 'payrollPeriods', [
      ...payrollBeforeTransferViolation,
      { id: 'PAY-S02-2026-08', storeId: 'S02', period: '2026-08', status: 'Đã khóa', lockedAt: '2026-08-27T00:00:00.000Z' },
    ])
    const beforeLockedHomeVersion = currentVersion()
    const lockedHome = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create_batch', expectedVersion: currentVersion(), payload: {
        storeId: 'S01', employeeId: 'E01', occurredOn: '2026-08-20', shiftId: historicalShiftId,
        catalogItemIds: ['VIO-CUSTOMER'],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'violation-batch-transferred-locked-home-0001' }), env)
    expect(lockedHome.status).toBe(409)
    expect(await lockedHome.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
    expect(currentVersion()).toBe(beforeLockedHomeVersion)

    replaceStateCollection(env.DB.database, 'payrollPeriods', readHydratedState(env.DB.database).payrollPeriods.map((period) => (
      period.storeId === 'S02'
        ? { ...period, status: 'Đã chốt', lockedAt: null, confirmedAt: null }
        : period
    )))
    const transferredEmployeeViolation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create_batch', expectedVersion: currentVersion(), payload: {
        storeId: 'S01', employeeId: 'E01', occurredOn: '2026-08-20', shiftId: historicalShiftId,
        catalogItemIds: ['VIO-CUSTOMER'],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'violation-batch-transferred-history-0001' }), env)
    expect(transferredEmployeeViolation.status).toBe(201)
    const transferredEmployeeViolationBody = await transferredEmployeeViolation.json()
    expect(transferredEmployeeViolationBody).toMatchObject({
      violations: [{
        employeeId: 'E01', storeId: 'S01', payrollStoreId: 'S02',
        employeeSnapshot: { storeId: 'S02', workStoreId: 'S01' },
        attendanceId: 'att_historical_shift', catalogItemId: 'VIO-CUSTOMER',
      }],
    })
    expect(readHydratedState(env.DB.database).payrollPeriods).toEqual(expect.arrayContaining([
      expect.objectContaining({ storeId: 'S01', needsReclose: true }),
      expect.objectContaining({ storeId: 'S02', needsReclose: true }),
    ]))

    replaceStateCollection(env.DB.database, 'payrollPeriods', readHydratedState(env.DB.database).payrollPeriods.map((period) => (
      period.storeId === 'S02'
        ? { ...period, status: 'Đã khóa', lockedAt: '2026-08-27T00:00:00.000Z' }
        : period
    )))
    const historicalViolation = transferredEmployeeViolationBody.violations[0]
    const blockedVoid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.void', expectedVersion: currentVersion(), payload: {
        id: historicalViolation.id, expectedVersion: historicalViolation.version, reason: 'Thử hủy kỳ đã khóa',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'violation-transferred-void-locked-home-0001' }), env)
    expect(blockedVoid.status).toBe(409)
    expect(await blockedVoid.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })

    replaceStateCollection(env.DB.database, 'payrollPeriods', readHydratedState(env.DB.database).payrollPeriods.map((period) => (
      period.storeId === 'S02'
        ? { ...period, status: 'Đã chốt', lockedAt: null, confirmedAt: null }
        : period
    )))
    const voided = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.void', expectedVersion: currentVersion(), payload: {
        id: historicalViolation.id, expectedVersion: historicalViolation.version, reason: 'Hủy sau đối soát',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'violation-transferred-void-success-0001' }), env)
    expect(voided.status).toBe(200)
    const voidedBody = await voided.json()
    expect(voidedBody.violation).toMatchObject({ id: historicalViolation.id, status: 'VOID', version: 2 })

    replaceStateCollection(env.DB.database, 'payrollPeriods', readHydratedState(env.DB.database).payrollPeriods.map((period) => (
      period.storeId === 'S02'
        ? { ...period, status: 'Đã khóa', lockedAt: '2026-08-27T00:00:00.000Z' }
        : period
    )))
    const semanticRetry = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.void', expectedVersion: currentVersion(), payload: {
        id: historicalViolation.id, expectedVersion: voidedBody.violation.version, reason: 'Hủy sau đối soát',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'violation-transferred-void-semantic-retry-0001' }), env)
    expect(semanticRetry.status).toBe(200)
    expect(await semanticRetry.json()).toMatchObject({ existing: true, violation: { id: historicalViolation.id, status: 'VOID' } })

    const legacyViolation = {
      id: 'VIO-LEGACY-NO-PAYROLL-STORE', targetUnit: 'store', employeeId: 'E01', storeId: 'S01',
      occurredOn: '2026-08-20', period: '2026-08', title: 'Vi phạm legacy', amountVnd: 2_000,
      status: 'ACTIVE', version: 1,
    }
    replaceStateCollection(env.DB.database, 'violations', [legacyViolation, ...readHydratedState(env.DB.database).violations])
    const blockedLegacyVoid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.void', expectedVersion: currentVersion(), payload: {
        id: legacyViolation.id, expectedVersion: legacyViolation.version, reason: 'Không được xuyên kỳ khóa',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'violation-legacy-void-locked-current-store-0001' }), env)
    expect(blockedLegacyVoid.status).toBe(409)
    expect(await blockedLegacyVoid.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
    persisted = readHydratedState(env.DB.database)
    expect(persisted.violations).toHaveLength(8)
    expect(persisted.violations.find((violation) => violation.id === historicalViolation.id)).toMatchObject({ status: 'VOID' })
    expect(persisted.violations.find((violation) => violation.id === legacyViolation.id)).toMatchObject({ status: 'ACTIVE' })
  }, 30_000)

  it('materializes one deterministic work reward claim, rejects conflicting duplicates and fences payroll transitions', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-work-reward-progress' }
    const rewardSnapshot = {
      catalogItemId: 'CAT-REWARD-CLEAN', catalogCode: 'store.reward.clean', catalogVersion: 3,
      kind: 'REWARD_TASK', targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-AM', shiftName: 'Ca sáng',
      name: 'Lau nhà nhận thưởng', amountVnd: 8_000, required: false, optional: true,
      sortOrder: 1, effectiveDate: '2026-08-20',
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'work-reward-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Dosii S01', status: 'Đang hoạt động' }],
        employees: [{ id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store', status: 'Đang làm việc' }],
        attendance: [{
          id: 'att_reward_01', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftId: 'SHIFT-AM',
          shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', shiftVersion: 2,
          checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: null,
        }],
        tasks: [{
          id: 'TASK-REWARD-ASSIGNED', assignmentId: 'ASSIGN-01', employeeIds: ['E01'], storeId: 'S01',
          date: '2026-08-20', shiftId: 'SHIFT-AM', title: rewardSnapshot.name, required: false,
          catalogItemId: rewardSnapshot.catalogItemId, catalogCode: rewardSnapshot.catalogCode,
          catalogVersion: rewardSnapshot.catalogVersion, catalogKind: 'REWARD_TASK', amountVnd: 8_000,
          catalogSnapshot: rewardSnapshot, completedBy: {},
        }, {
          id: 'TASK-REWARD-CHECKLIST', assignmentId: 'ASSIGN-02', employeeIds: ['E01'], storeId: 'S01',
          date: '2026-08-20', shiftId: 'SHIFT-AM', title: rewardSnapshot.name, required: false,
          catalogItemId: rewardSnapshot.catalogItemId, catalogCode: rewardSnapshot.catalogCode,
          catalogVersion: rewardSnapshot.catalogVersion, catalogKind: 'REWARD_TASK', amountVnd: 8_000,
          catalogSnapshot: rewardSnapshot, completedBy: {}, checklistAttendanceId: 'att_reward_01',
        }],
        taskAssignmentHistory: [{
          id: 'ASSIGN-01', assignmentId: 'ASSIGN-01', employeeIds: ['E01'], tasks: [], progressHistory: [],
        }, {
          id: 'ASSIGN-02', assignmentId: 'ASSIGN-02', employeeIds: ['E01'], tasks: [], progressHistory: [],
        }],
        workCatalogProgress: [], compensationEntries: [], payrollPeriods: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'work-reward-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const employeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', payload: {
        username: 'employee.reward', password: 'work-reward-employee-password', displayName: 'Nhân viên 01',
        role: 'employee', storeId: 'S01', employeeId: 'E01',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'work-reward-employee-user' }), env)
    expect(employeeCreated.status).toBe(201)
    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.reward', password: 'work-reward-employee-password',
    }), env)
    const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
    const currentVersion = () => Number(env.DB.database.prepare(
      "SELECT version FROM app_state WHERE scope_key = 'global'",
    ).get().version)
    const progressPayload = (completed, attendanceId = 'att_reward_01') => ({
      attendanceId,
      tasks: [
        { id: 'TASK-REWARD-ASSIGNED', completed },
        { id: 'TASK-REWARD-CHECKLIST', completed },
      ],
    })
    for (const commandType of ['task.done', 'task.set_done']) {
      const versionBeforeRejectedShortcut = currentVersion()
      const rejectedShortcut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: commandType, expectedVersion: versionBeforeRejectedShortcut, payload: {
          taskId: 'TASK-REWARD-ASSIGNED', done: true,
        },
      }, {
        ...employeeAuthorization,
        'idempotency-key': `work-reward-shortcut-${commandType.replaceAll('.', '-')}-0001`,
      }), env)
      expect(rejectedShortcut.status).toBe(409)
      expect(await rejectedShortcut.json()).toMatchObject({ error: { code: 'WORK_REWARD_PROGRESS_REQUIRED' } })
      expect(currentVersion()).toBe(versionBeforeRejectedShortcut)
    }

    const historicalFingerprint = JSON.stringify({
      attendanceId: 'att_reward_01',
      tasks: [
        ['TASK-REWARD-ASSIGNED', true],
        ['TASK-REWARD-CHECKLIST', true],
      ],
      incompleteReason: '',
    })
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', [{
      id: 'ASSIGN-01', assignmentId: 'ASSIGN-01', employeeIds: ['E01'], tasks: [],
      progressHistory: [{
        action: 'progress-submitted', employeeId: 'E01', attendanceId: 'att_reward_01',
        fingerprint: historicalFingerprint, at: '2026-08-20T02:00:00.000Z',
      }],
    }, {
      id: 'ASSIGN-02', assignmentId: 'ASSIGN-02', employeeIds: ['E01'], tasks: [], progressHistory: [],
    }])
    const historicalNoopVersion = currentVersion()
    const historicalNoop = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: historicalNoopVersion, payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-historical-no-backpay-0001' }), env)
    expect(historicalNoop.status).toBe(200)
    expect(await historicalNoop.json()).toMatchObject({ existing: true, version: historicalNoopVersion })
    expect(readHydratedState(env.DB.database)).toMatchObject({
      workCatalogProgress: [], compensationEntries: [],
    })
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', [{
      id: 'ASSIGN-01', assignmentId: 'ASSIGN-01', employeeIds: ['E01'], tasks: [], progressHistory: [],
    }, {
      id: 'ASSIGN-02', assignmentId: 'ASSIGN-02', employeeIds: ['E01'], tasks: [], progressHistory: [],
    }])

    const progressRequest = {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }
    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', progressRequest, {
      ...employeeAuthorization, 'idempotency-key': 'work-reward-progress-create-0001',
    }), env)
    expect(created.status).toBe(200)
    const createdBody = await created.json()
    expect(createdBody).toMatchObject({
      rewardProgress: [{
        employeeId: 'E01', attendanceId: 'att_reward_01', catalogItemId: 'CAT-REWARD-CLEAN',
        completed: true, payable: true, amountVnd: 8_000,
        sourceTaskIds: ['TASK-REWARD-ASSIGNED', 'TASK-REWARD-CHECKLIST'],
      }],
      rewardClaims: [{
        type: 'WORK', status: 'ACTIVE', sourceType: 'work-catalog-reward', amountVnd: 8_000,
        workCatalogProgressId: expect.stringContaining('work-catalog-progress:v2:'),
      }],
    })
    let persisted = readHydratedState(env.DB.database)
    expect(persisted.workCatalogProgress).toHaveLength(1)
    expect(persisted.compensationEntries).toHaveLength(1)
    const claimId = persisted.compensationEntries[0].id
    const canonicalProgressId = persisted.workCatalogProgress[0].id
    const canonicalProgressSnapshot = persisted.workCatalogProgress[0]
    const canonicalClaimSnapshot = persisted.compensationEntries[0]
    const canonicalTaskSnapshots = persisted.tasks
    const canonicalHistorySnapshots = persisted.taskAssignmentHistory
    const legacyIdentity = {
      employeeId: 'E01', workDate: '2026-08-20', shiftRef: 'att_reward_01',
      catalogItemId: 'CAT-REWARD-CLEAN',
    }
    const legacyProgressId = workCatalogProgressKey(legacyIdentity)
    const legacyClaimId = workCatalogClaimKey(legacyIdentity)
    const legacyProgressSnapshot = {
      ...canonicalProgressSnapshot, id: legacyProgressId, attendanceId: 'att_reward_01',
    }
    const legacyClaimSnapshot = {
      ...canonicalClaimSnapshot, id: legacyClaimId, sourceId: legacyClaimId,
      workCatalogProgressId: legacyProgressId, attendanceId: 'att_reward_01',
    }
    const historyWithoutRewardSnapshots = canonicalHistorySnapshots.map((assignment) => ({
      ...assignment,
      progressHistory: assignment.progressHistory.map((event) => {
        const nextEvent = { ...event }
        delete nextEvent.rewardTaskSnapshots
        delete nextEvent.completedRewardTaskSnapshots
        return nextEvent
      }),
    }))
    expect(persisted.compensationEntries[0]).toMatchObject({ id: claimId, sourceId: claimId, status: 'ACTIVE' })
    expect(persisted.taskAssignmentHistory.every((assignment) => (
      assignment.progressHistory[0].rewardTaskSnapshots.length === 2
      && assignment.progressHistory[0].completedRewardTaskSnapshots.length === 2
    ))).toBe(true)

    replaceStateCollection(env.DB.database, 'workCatalogProgress', [canonicalProgressSnapshot, legacyProgressSnapshot])
    replaceStateCollection(env.DB.database, 'compensationEntries', [canonicalClaimSnapshot, legacyClaimSnapshot])
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', historyWithoutRewardSnapshots)
    const hybridDuplicateCleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-hybrid-duplicate-cleanup-0001' }), env)
    expect(hybridDuplicateCleanup.status).toBe(200)
    persisted = readHydratedState(env.DB.database)
    expect(persisted.compensationEntries.filter((entry) => entry.status === 'ACTIVE')).toEqual([
      expect.objectContaining({ id: claimId, amountVnd: 8_000 }),
    ])
    expect(persisted.compensationEntries.find(({ id }) => id === legacyClaimId)).toMatchObject({
      status: 'VOID', voidSource: 'reward-key-migration', migratedToClaimId: claimId,
    })
    const lineageAudit = env.DB.database.prepare(`
      SELECT before_json, after_json, metadata_json FROM audit_log
      WHERE action = 'task.progress.save' ORDER BY id DESC LIMIT 1
    `).get()
    expect(JSON.parse(lineageAudit.before_json)).toMatchObject({
      rewardProgress: expect.arrayContaining([
        expect.objectContaining({ id: canonicalProgressId }),
        expect.objectContaining({ id: legacyProgressId }),
      ]),
      rewardClaims: expect.arrayContaining([
        expect.objectContaining({ id: claimId }),
        expect.objectContaining({ id: legacyClaimId }),
      ]),
    })
    expect(JSON.parse(lineageAudit.after_json)).toMatchObject({
      rewardProgress: expect.arrayContaining([
        expect.objectContaining({ id: canonicalProgressId, status: 'COMPLETED' }),
        expect.objectContaining({ id: legacyProgressId, status: 'MIGRATED' }),
      ]),
      rewardClaims: expect.arrayContaining([
        expect.objectContaining({ id: claimId, status: 'ACTIVE' }),
        expect.objectContaining({ id: legacyClaimId, status: 'VOID' }),
      ]),
    })
    expect(JSON.parse(lineageAudit.metadata_json)).toMatchObject({
      migratedRewardProgressIds: [legacyProgressId],
      migratedRewardClaimIds: [legacyClaimId],
    })

    replaceStateCollection(env.DB.database, 'workCatalogProgress', [canonicalProgressSnapshot, legacyProgressSnapshot])
    replaceStateCollection(env.DB.database, 'compensationEntries', [canonicalClaimSnapshot, {
      ...legacyClaimSnapshot,
      status: 'VOID',
      voidedAt: '2026-08-20T04:00:00.000Z',
      voidedBy: { id: 'ADMIN-LEGACY', role: 'admin' },
      voidReason: 'Admin legacy từ chối thưởng',
      voidSource: null,
    }])
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', historyWithoutRewardSnapshots)
    const hybridManualVoidCleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-hybrid-manual-void-cleanup-0001' }), env)
    expect(hybridManualVoidCleanup.status).toBe(200)
    persisted = readHydratedState(env.DB.database)
    expect(persisted.compensationEntries.find(({ id }) => id === claimId)).toMatchObject({
      status: 'VOID', voidSource: 'manual-review-migration', voidReason: 'Admin legacy từ chối thưởng',
    })
    expect(persisted.compensationEntries.filter((entry) => entry.status === 'ACTIVE')).toEqual([])

    const secondRewardSnapshot = {
      ...rewardSnapshot,
      catalogItemId: 'CAT-REWARD-BONUS-B',
      catalogCode: 'store.reward.bonus-b',
      name: 'Thưởng thứ hai không được backpay',
      amountVnd: 5_000,
    }
    const secondRewardTask = {
      id: 'TASK-REWARD-BONUS-B', assignmentId: 'ASSIGN-03', employeeIds: ['E01'], storeId: 'S01',
      date: '2026-08-20', shiftId: 'SHIFT-AM', title: secondRewardSnapshot.name, required: false,
      catalogItemId: secondRewardSnapshot.catalogItemId, catalogCode: secondRewardSnapshot.catalogCode,
      catalogVersion: secondRewardSnapshot.catalogVersion, catalogKind: 'REWARD_TASK', amountVnd: 5_000,
      catalogSnapshot: secondRewardSnapshot, completedBy: { E01: true },
    }
    const secondProgressId = workCatalogProgressKey({
      employeeId: 'E01', workDate: '2026-08-20', storeId: 'S01', shiftId: 'SHIFT-AM',
      catalogItemId: secondRewardSnapshot.catalogItemId,
    })
    const secondProgressSnapshot = {
      ...canonicalProgressSnapshot,
      id: secondProgressId,
      catalogItemId: secondRewardSnapshot.catalogItemId,
      catalogCode: secondRewardSnapshot.catalogCode,
      catalogSnapshot: secondRewardSnapshot,
      amountVnd: 5_000,
      sourceTaskIds: [secondRewardTask.id],
    }
    const mixedFingerprint = JSON.stringify({
      attendanceId: 'att_reward_01',
      tasks: [
        ['TASK-REWARD-ASSIGNED', true],
        ['TASK-REWARD-BONUS-B', true],
        ['TASK-REWARD-CHECKLIST', true],
      ],
      incompleteReason: '',
    })
    const mixedHistoryWithoutSnapshots = [
      ...canonicalHistorySnapshots,
      { id: 'ASSIGN-03', assignmentId: 'ASSIGN-03', employeeIds: ['E01'], tasks: [], progressHistory: [] },
    ].map((assignment) => ({
      ...assignment,
      progressHistory: [{
        action: 'progress-submitted', employeeId: 'E01', attendanceId: 'att_reward_01',
        fingerprint: mixedFingerprint, at: '2026-08-20T04:30:00.000Z',
      }],
    }))
    replaceStateCollection(env.DB.database, 'tasks', [...canonicalTaskSnapshots, secondRewardTask])
    replaceStateCollection(env.DB.database, 'workCatalogProgress', [
      canonicalProgressSnapshot, legacyProgressSnapshot, secondProgressSnapshot,
    ])
    replaceStateCollection(env.DB.database, 'compensationEntries', [canonicalClaimSnapshot, {
      ...legacyClaimSnapshot,
      status: 'VOID', voidedAt: '2026-08-20T04:00:00.000Z', voidedBy: { id: 'ADMIN-LEGACY', role: 'admin' },
      voidReason: 'Admin legacy từ chối thưởng', voidSource: null,
    }])
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', mixedHistoryWithoutSnapshots)
    const mixedCleanupWithoutBackpay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: {
        attendanceId: 'att_reward_01',
        tasks: [
          { id: 'TASK-REWARD-ASSIGNED', completed: true },
          { id: 'TASK-REWARD-CHECKLIST', completed: true },
          { id: 'TASK-REWARD-BONUS-B', completed: true },
        ],
      },
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-mixed-safe-cleanup-0001' }), env)
    expect(mixedCleanupWithoutBackpay.status).toBe(200)
    persisted = readHydratedState(env.DB.database)
    expect(persisted.compensationEntries.filter((entry) => entry.status === 'ACTIVE')).toEqual([])
    expect(persisted.compensationEntries.some((entry) => (
      entry.catalogItemId === secondRewardSnapshot.catalogItemId
    ))).toBe(false)
    expect(persisted.taskAssignmentHistory.flatMap((assignment) => assignment.progressHistory)
      .every((event) => !event.rewardTaskSnapshots)).toBe(true)

    replaceStateCollection(env.DB.database, 'tasks', canonicalTaskSnapshots)

    const uncheckedFingerprint = JSON.stringify({
      attendanceId: 'att_reward_01',
      tasks: [
        ['TASK-REWARD-ASSIGNED', false],
        ['TASK-REWARD-CHECKLIST', false],
      ],
      incompleteReason: '',
    })
    const uncheckedHistoryWithoutSnapshots = historyWithoutRewardSnapshots.map((assignment) => ({
      ...assignment,
      progressHistory: assignment.progressHistory.map((event) => ({
        ...event, fingerprint: uncheckedFingerprint,
      })),
    }))
    replaceStateCollection(env.DB.database, 'workCatalogProgress', [{
      ...canonicalProgressSnapshot, completed: false, status: 'NOT_COMPLETED', completedAt: null,
    }, legacyProgressSnapshot])
    replaceStateCollection(env.DB.database, 'compensationEntries', [legacyClaimSnapshot])
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', uncheckedHistoryWithoutSnapshots)
    const hybridUncheckedCleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(false),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-hybrid-unchecked-cleanup-0001' }), env)
    expect(hybridUncheckedCleanup.status).toBe(200)
    expect(readHydratedState(env.DB.database).compensationEntries.filter((entry) => entry.status === 'ACTIVE')).toEqual([])

    replaceStateCollection(env.DB.database, 'workCatalogProgress', [canonicalProgressSnapshot, legacyProgressSnapshot])
    replaceStateCollection(env.DB.database, 'compensationEntries', [canonicalClaimSnapshot, legacyClaimSnapshot])
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', historyWithoutRewardSnapshots)
    replaceStateCollection(env.DB.database, 'payrollPeriods', [{
      id: 'PAY-HYBRID-LOCKED', storeId: 'S01', period: '2026-08', status: 'Đã khóa',
      lockedAt: '2026-09-01T00:00:00.000Z',
    }])
    const beforeLockedHybrid = readHydratedState(env.DB.database)
    const lockedHybridCleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-hybrid-locked-cleanup-0001' }), env)
    expect(lockedHybridCleanup.status).toBe(409)
    expect(await lockedHybridCleanup.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
    expect(readHydratedState(env.DB.database)).toMatchObject({
      workCatalogProgress: beforeLockedHybrid.workCatalogProgress,
      compensationEntries: beforeLockedHybrid.compensationEntries,
    })

    replaceStateCollection(env.DB.database, 'employees', [{
      ...persisted.employees[0], id: 'PROFILE-E01', code: 'E01', employeeId: 'LEGACY-E01',
    }])
    replaceStateCollection(env.DB.database, 'workCatalogProgress', [canonicalProgressSnapshot])
    replaceStateCollection(env.DB.database, 'compensationEntries', [canonicalClaimSnapshot])
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', historyWithoutRewardSnapshots)
    const lockedAliasAttribution = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-alias-v2-locked-0001' }), env)
    expect(lockedAliasAttribution.status).toBe(409)
    expect(await lockedAliasAttribution.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
    expect(readHydratedState(env.DB.database).compensationEntries).toEqual([
      expect.objectContaining({ id: claimId, employeeId: 'E01', status: 'ACTIVE' }),
    ])
    replaceStateCollection(env.DB.database, 'payrollPeriods', [{
      id: 'PAY-ALIAS-CLOSED', storeId: 'S01', period: '2026-08', status: 'Đã chốt',
      confirmedAt: null, lockedAt: null, needsReclose: false,
    }])
    const aliasV2Cleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-alias-v2-cleanup-0001' }), env)
    expect(aliasV2Cleanup.status).toBe(200)
    persisted = readHydratedState(env.DB.database)
    const canonicalAliasProgressId = workCatalogProgressKey({
      employeeId: 'PROFILE-E01', workDate: '2026-08-20', storeId: 'S01', shiftId: 'SHIFT-AM',
      catalogItemId: 'CAT-REWARD-CLEAN',
    })
    const canonicalAliasClaimId = workCatalogClaimKey({
      employeeId: 'PROFILE-E01', workDate: '2026-08-20', storeId: 'S01', shiftId: 'SHIFT-AM',
      catalogItemId: 'CAT-REWARD-CLEAN',
    })
    expect(persisted.workCatalogProgress.filter((record) => !record.deletedAt)).toEqual([
      expect.objectContaining({ id: canonicalAliasProgressId, employeeId: 'PROFILE-E01' }),
    ])
    expect(persisted.compensationEntries.filter((entry) => entry.status === 'ACTIVE')).toEqual([
      expect.objectContaining({ id: canonicalAliasClaimId, employeeId: 'PROFILE-E01' }),
    ])
    expect(persisted.compensationEntries.find(({ id }) => id === claimId)).toMatchObject({
      status: 'VOID', voidSource: 'reward-key-migration', migratedToClaimId: canonicalAliasClaimId,
    })
    expect(persisted.payrollPeriods).toEqual([
      expect.objectContaining({
        id: 'PAY-ALIAS-CLOSED', needsReclose: true, invalidationReason: 'task.progress.save',
      }),
    ])
    expect(persisted.tasks.every((task) => (
      JSON.stringify(task.completedBy) === JSON.stringify({ 'PROFILE-E01': true })
    ))).toBe(true)
    expect(persisted.taskAssignmentHistory.every((assignment) => (
      Object.keys(assignment.completionByEmployee || {}).every((identifier) => identifier === 'PROFILE-E01')
      && assignment.progressHistory.length === 1
    ))).toBe(true)
    const aliasOnlyRewardProgress = persisted.workCatalogProgress
    const aliasOnlyRewardClaims = persisted.compensationEntries
    const aliasOnlyNotificationCount = persisted.notifications.length
    const aliasOnlyProgressHistoryLengths = persisted.taskAssignmentHistory
      .map((assignment) => assignment.progressHistory.length)
    replaceStateCollection(env.DB.database, 'tasks', persisted.tasks.map((task) => ({
      ...task,
      completedBy: { 'PROFILE-E01': false, E01: true },
    })))
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', persisted.taskAssignmentHistory.map((assignment) => ({
      ...assignment,
      tasks: persisted.tasks
        .filter((task) => String(task.assignmentId || '') === String(assignment.assignmentId || assignment.id || ''))
        .map((task) => ({ ...task, completedBy: { 'PROFILE-E01': false, E01: true } })),
      completionByEmployee: Object.keys(assignment.completionByEmployee || {}).length
        ? {
            'PROFILE-E01': {
              ...Object.values(assignment.completionByEmployee)[0],
              completedTasks: 0,
              completionRate: 0,
            },
            E01: Object.values(assignment.completionByEmployee)[0],
          }
        : assignment.completionByEmployee,
    })))
    const aliasOnlyCleanupVersion = currentVersion()
    const aliasOnlyCleanup = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: aliasOnlyCleanupVersion, payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-alias-map-only-cleanup-0001' }), env)
    expect(aliasOnlyCleanup.status).toBe(200)
    expect(await aliasOnlyCleanup.json()).toMatchObject({
      completedTasks: 2,
      completionRate: 100,
      rewardProgress: [],
      rewardClaims: [],
    })
    expect(currentVersion()).toBe(aliasOnlyCleanupVersion + 1)
    persisted = readHydratedState(env.DB.database)
    expect(persisted.workCatalogProgress).toEqual(aliasOnlyRewardProgress)
    expect(persisted.compensationEntries).toEqual(aliasOnlyRewardClaims)
    expect(persisted.notifications).toHaveLength(aliasOnlyNotificationCount)
    expect(persisted.tasks.every((task) => (
      JSON.stringify(task.completedBy) === JSON.stringify({ 'PROFILE-E01': true })
    ))).toBe(true)
    expect(persisted.taskAssignmentHistory.every((assignment) => (
      Object.keys(assignment.completionByEmployee || {}).every((identifier) => identifier === 'PROFILE-E01')
      && assignment.completionByEmployee['PROFILE-E01'].completedTasks === 1
      && assignment.completionByEmployee['PROFILE-E01'].completionRate === 100
      && assignment.tasks.every((task) => (
        JSON.stringify(task.completedBy) === JSON.stringify({ 'PROFILE-E01': true })
      ))
    ))).toBe(true)
    expect(persisted.taskAssignmentHistory.map((assignment) => assignment.progressHistory.length))
      .toEqual(aliasOnlyProgressHistoryLengths)
    const aliasOnlyAudit = env.DB.database.prepare(`
      SELECT after_json FROM audit_log
      WHERE action = 'task.progress.save' ORDER BY id DESC LIMIT 1
    `).get()
    expect(JSON.parse(aliasOnlyAudit.after_json).tasks).toEqual([
      { id: 'TASK-REWARD-ASSIGNED', completed: true },
      { id: 'TASK-REWARD-CHECKLIST', completed: true },
    ])
    const aliasEmployeeProjectionResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: employeeAuthorization,
    }), env)
    expect(aliasEmployeeProjectionResponse.status).toBe(200)
    const aliasEmployeeProjection = await aliasEmployeeProjectionResponse.json()
    expect(aliasEmployeeProjection.state).toMatchObject({
      employees: [expect.objectContaining({ id: 'PROFILE-E01', code: 'E01', employeeId: 'LEGACY-E01' })],
      workCatalogProgress: expect.arrayContaining([
        expect.objectContaining({ id: canonicalAliasProgressId, employeeId: 'PROFILE-E01' }),
      ]),
      compensationEntries: expect.arrayContaining([
        expect.objectContaining({ id: canonicalAliasClaimId, employeeId: 'PROFILE-E01', status: 'ACTIVE' }),
      ]),
    })
    replaceStateCollection(env.DB.database, 'payrollPeriods', [])
    const aliasUnchecked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(false),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-alias-uncheck-0001' }), env)
    expect(aliasUnchecked.status).toBe(200)
    const aliasUncheckedState = readHydratedState(env.DB.database)
    expect(aliasUncheckedState.tasks.every((task) => (
      JSON.stringify(task.completedBy) === JSON.stringify({ 'PROFILE-E01': false })
    ))).toBe(true)
    expect(aliasUncheckedState.taskAssignmentHistory.every((assignment) => (
      Object.keys(assignment.completionByEmployee || {}).every((identifier) => identifier === 'PROFILE-E01')
    ))).toBe(true)

    replaceStateCollection(env.DB.database, 'employees', [{
      ...persisted.employees[0], id: 'E01', code: undefined, employeeId: undefined,
    }])
    replaceStateCollection(env.DB.database, 'workCatalogProgress', [legacyProgressSnapshot])
    replaceStateCollection(env.DB.database, 'compensationEntries', [{
      ...legacyClaimSnapshot,
      status: 'VOID',
      voidedAt: '2026-08-20T04:45:00.000Z',
      voidedBy: { id: 'E01', role: 'employee' },
      voidReason: 'Nhân viên đã bỏ chọn trước đó',
      voidSource: 'task-progress',
    }])
    replaceStateCollection(env.DB.database, 'taskAssignmentHistory', canonicalHistorySnapshots)
    const legacySystemVoidReactivated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-legacy-system-void-reactivate-0001' }), env)
    expect(legacySystemVoidReactivated.status).toBe(200)
    expect(readHydratedState(env.DB.database).compensationEntries.filter((entry) => entry.status === 'ACTIVE')).toEqual([
      expect.objectContaining({ id: claimId, amountVnd: 8_000 }),
    ])

    replaceStateCollection(env.DB.database, 'workCatalogProgress', [legacyProgressSnapshot])
    replaceStateCollection(env.DB.database, 'compensationEntries', [{
      ...legacyClaimSnapshot, storeId: 'S02',
    }])
    const conflictingLegacyClaim = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-legacy-conflict-0001' }), env)
    expect(conflictingLegacyClaim.status).toBe(409)
    expect(await conflictingLegacyClaim.json()).toMatchObject({ error: { code: 'WORK_REWARD_LEGACY_CONFLICT' } })

    replaceStateCollection(env.DB.database, 'workCatalogProgress', [legacyProgressSnapshot])
    replaceStateCollection(env.DB.database, 'compensationEntries', [legacyClaimSnapshot])
    const originalAttendance = persisted.attendance[0]
    const originalRewardTasks = readHydratedState(env.DB.database).tasks
    replaceStateCollection(env.DB.database, 'tasks', originalRewardTasks.map((task) => (
      task.checklistAttendanceId
        ? { ...task, checklistAttendanceId: 'att_reward_02' }
        : task
    )))
    replaceStateCollection(env.DB.database, 'attendance', [{
      ...originalAttendance,
      checkOutAt: '2026-08-20T03:00:00.000Z',
    }, {
      ...originalAttendance,
      id: 'att_reward_02',
      checkInAt: '2026-08-20T03:05:00.000Z',
      checkOutAt: null,
    }])
    const sameShiftResubmission = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true, 'att_reward_02'),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-same-shift-second-attendance-0001' }), env)
    expect(sameShiftResubmission.status).toBe(200)
    persisted = readHydratedState(env.DB.database)
    expect(persisted.workCatalogProgress.filter((record) => !record.deletedAt)).toEqual([
      expect.objectContaining({ id: canonicalProgressId, attendanceId: 'att_reward_02' }),
    ])
    expect(persisted.workCatalogProgress.find(({ id }) => id === legacyProgressId)).toMatchObject({
      status: 'MIGRATED', migratedToProgressId: canonicalProgressId, deletedAt: expect.any(String),
    })
    expect(persisted.compensationEntries.filter((entry) => entry.status === 'ACTIVE')).toEqual([
      expect.objectContaining({ id: claimId, status: 'ACTIVE', amountVnd: 8_000 }),
    ])
    expect(persisted.compensationEntries.find(({ id }) => id === legacyClaimId)).toMatchObject({
      status: 'VOID', voidSource: 'reward-key-migration', migratedToClaimId: claimId,
    })
    replaceStateCollection(env.DB.database, 'attendance', [originalAttendance])
    replaceStateCollection(env.DB.database, 'tasks', originalRewardTasks)

    replaceStateCollection(env.DB.database, 'workCatalogProgress', [])
    replaceStateCollection(env.DB.database, 'compensationEntries', [])
    const reconciledVersion = currentVersion()
    const reconciled = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...progressRequest, expectedVersion: reconciledVersion,
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-progress-reconcile-0001' }), env)
    expect(reconciled.status).toBe(200)
    expect(await reconciled.json()).toMatchObject({
      rewardProgress: [{ id: expect.stringContaining('work-catalog-progress:v2:') }],
      rewardClaims: [{ id: claimId, status: 'ACTIVE', amountVnd: 8_000 }],
    })
    expect(currentVersion()).toBe(reconciledVersion + 1)
    persisted = readHydratedState(env.DB.database)
    expect(persisted.workCatalogProgress).toHaveLength(1)
    expect(persisted.compensationEntries).toHaveLength(1)

    const replay = await worker.fetch(jsonRequest('https://idosi.example/api/command', progressRequest, {
      ...employeeAuthorization, 'idempotency-key': 'work-reward-progress-create-0001',
    }), env)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('idempotency-replayed')).toBe('true')
    expect(readHydratedState(env.DB.database).compensationEntries).toHaveLength(1)

    const noOpVersion = currentVersion()
    const noOp = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...progressRequest, expectedVersion: noOpVersion,
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-progress-noop-0001' }), env)
    expect(noOp.status).toBe(200)
    expect(await noOp.json()).toMatchObject({ existing: true, version: noOpVersion })
    expect(currentVersion()).toBe(noOpVersion)

    const conflict = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: {
        attendanceId: 'att_reward_01', tasks: [
          { id: 'TASK-REWARD-ASSIGNED', completed: true },
          { id: 'TASK-REWARD-CHECKLIST', completed: false },
        ],
      },
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-progress-conflict-0001' }), env)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'WORK_REWARD_STATUS_CONFLICT' } })
    expect(readHydratedState(env.DB.database).compensationEntries).toHaveLength(1)

    replaceStateCollection(env.DB.database, 'payrollPeriods', [{
      id: 'PAY-LOCKED', storeId: 'S01', period: '2026-08', status: 'Đã khóa', lockedAt: '2026-09-01T00:00:00.000Z',
    }])
    const locked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(false),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-progress-locked-0001' }), env)
    expect(locked.status).toBe(409)
    expect(await locked.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
    expect(readHydratedState(env.DB.database).compensationEntries[0]).toMatchObject({ id: claimId, status: 'ACTIVE' })

    replaceStateCollection(env.DB.database, 'payrollPeriods', [])
    const voided = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(false),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-progress-void-0001' }), env)
    expect(voided.status).toBe(200)
    persisted = readHydratedState(env.DB.database)
    expect(persisted.compensationEntries).toHaveLength(1)
    expect(persisted.compensationEntries[0]).toMatchObject({ id: claimId, status: 'VOID', version: 2 })

    const reactivated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-progress-reactivate-0001' }), env)
    expect(reactivated.status).toBe(200)
    persisted = readHydratedState(env.DB.database)
    expect(persisted.compensationEntries).toHaveLength(1)
    expect(persisted.compensationEntries[0]).toMatchObject({
      id: claimId, sourceId: claimId, status: 'ACTIVE', version: 3, voidedAt: null,
    })

    replaceStateCollection(env.DB.database, 'attendance', [{
      ...persisted.attendance[0],
      checkOutAt: '2026-08-20T05:00:00.000Z',
      workedSeconds: 14_400,
    }])
    const payroll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: currentVersion(), payload: { storeId: 'S01', period: '2026-08' },
    }, { ...adminAuthorization, 'idempotency-key': 'work-reward-payroll-close-0001' }), env)
    expect(payroll.status).toBe(201)
    expect(await payroll.json()).toMatchObject({
      period: {
        rows: [{ employeeId: 'E01', workBonusVnd: 8_000, bonusVnd: 8_000, gross: 8_000 }],
      },
    })
    expect(readHydratedState(env.DB.database).compensationEntries.filter((entry) => (
      entry.sourceType === 'work-catalog-reward' && entry.status === 'ACTIVE'
    ))).toHaveLength(1)

    const manuallyVoided = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'compensation_entry.void', expectedVersion: currentVersion(), payload: {
        id: claimId, version: 3, reason: 'Admin từ chối khoản thưởng sau đối soát',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'work-reward-manual-void-0001' }), env)
    expect(manuallyVoided.status).toBe(200)
    replaceStateCollection(env.DB.database, 'attendance', readHydratedState(env.DB.database).attendance.map((record) => ({
      ...record,
      checkOutAt: null,
      checkOut: null,
    })))

    const uncheckedAfterManualVoid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(false),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-after-manual-void-uncheck-0001' }), env)
    expect(uncheckedAfterManualVoid.status).toBe(200)
    const recheckedAfterManualVoid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.progress.save', expectedVersion: currentVersion(), payload: progressPayload(true),
    }, { ...employeeAuthorization, 'idempotency-key': 'work-reward-after-manual-void-recheck-0001' }), env)
    expect(recheckedAfterManualVoid.status).toBe(200)
    expect(readHydratedState(env.DB.database).compensationEntries).toEqual([
      expect.objectContaining({
        id: claimId,
        status: 'VOID',
        voidReason: 'Admin từ chối khoản thưởng sau đối soát',
        voidedBy: expect.objectContaining({ role: 'admin' }),
        voidSource: null,
      }),
    ])
  }, 30_000)

  it('validates and snapshots the exact store shift on a new violation', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-violation-shift' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'violation-shift-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Dosii S01', status: 'Đang hoạt động' }],
        employees: [{
          id: 'E01', code: 'CODE-E01', employeeId: 'LEGACY-E01', name: 'Nhân viên 01',
          storeId: 'S01', unit: 'store', status: 'Đang làm việc',
        }],
        shiftDefinitions: [{
          id: 'SHIFT-MORNING', storeId: 'S01', name: 'Ca sáng', start: '08:00', end: '12:00', active: true,
        }],
        schedule: [{ id: 'SCH-01', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftId: 'SHIFT-MORNING' }],
        workCatalogItems: [{
          id: 'VIO-LATE', code: 'store.violation.late', version: 1, kind: 'VIOLATION',
          targetGroup: 'store', storeId: 'S01', shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng',
          name: 'Đi trễ', amountVnd: 2_000, active: true, sortOrder: 1,
          effectiveFrom: '2026-08-01', effectiveTo: null,
        }],
        violations: [], payrollPeriods: [], attendance: [], orders: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'violation-shift-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const invalid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create', expectedVersion: 1, payload: {
        targetUnit: 'store', employeeId: 'E01', storeId: 'S01', catalogItemId: 'VIO-LATE',
        amountVnd: 2_000, occurredOn: '2026-08-20', shiftId: 'SHIFT-UNKNOWN',
      },
    }, { ...authorization, 'idempotency-key': 'violation-shift-invalid-0001' }), env)
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: 'VIOLATION_SHIFT_INVALID' } })

    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create', expectedVersion: 1, payload: {
        targetUnit: 'store', employeeId: 'E01', storeId: 'S01', catalogItemId: 'VIO-LATE',
        amountVnd: 2_000, occurredOn: '2026-08-20', shiftId: 'SHIFT-MORNING',
      },
    }, { ...authorization, 'idempotency-key': 'violation-shift-valid-0001' }), env)
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      violation: {
        occurrenceKey: expect.stringContaining('violation-occurrence:v1:'),
        shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
      },
    })

    replaceStateCollection(env.DB.database, 'violations', readHydratedState(env.DB.database).violations.map((violation) => ({
      ...violation,
      employeeId: 'CODE-E01',
      occurrenceKey: String(violation.occurrenceKey || '').replace(':E01:', ':CODE-E01:'),
    })))

    const duplicateSingle = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create', expectedVersion: 2, payload: {
        targetUnit: 'store', employeeId: 'E01', storeId: 'S01', catalogItemId: 'VIO-LATE',
        amountVnd: 2_000, occurredOn: '2026-08-20', shiftId: 'SHIFT-MORNING',
      },
    }, { ...authorization, 'idempotency-key': 'violation-shift-duplicate-single-0001' }), env)
    expect(duplicateSingle.status).toBe(409)
    expect(await duplicateSingle.json()).toMatchObject({ error: { code: 'VIOLATION_DUPLICATE' } })

    replaceStateCollection(env.DB.database, 'violations', readHydratedState(env.DB.database).violations.map((violation) => ({
      ...violation,
      employeeId: 'LEGACY-E01',
      occurrenceKey: String(violation.occurrenceKey || '').replace(':CODE-E01:', ':LEGACY-E01:'),
    })))

    const duplicateBatch = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'violation.create_batch', expectedVersion: 2, payload: {
        storeId: 'S01', employeeId: 'E01', occurredOn: '2026-08-20', shiftId: 'SHIFT-MORNING',
        catalogItemIds: ['VIO-LATE'],
      },
    }, { ...authorization, 'idempotency-key': 'violation-shift-duplicate-batch-0001' }), env)
    expect(duplicateBatch.status).toBe(409)
    expect(await duplicateBatch.json()).toMatchObject({ error: { code: 'VIOLATION_DUPLICATE' } })
    expect(readHydratedState(env.DB.database).violations).toHaveLength(1)
  }, 30_000)

  it('keeps hot milestones pending until an authorized cross-store approval and protects coworker allocations', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-revenue-hot-approval' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'revenue-hot-admin-password',
      initialState: {
        stores: [
          { id: 'S01', name: 'Dosii S01', status: 'Đang hoạt động' },
          { id: 'S02', name: 'Dosii S02', status: 'Đang hoạt động' },
        ],
        employees: [
          { id: 'HTKD-BONUS', name: 'Hỗ trợ toàn hệ thống', unit: 'business_support', storeId: 'BUSINESS_SUPPORT', status: 'Đang làm việc' },
          { id: 'QL-S02', name: 'Quản lý S02', unit: 'store_manager', storeId: 'S02', status: 'Đang làm việc' },
          { id: 'E-S02', name: 'Nhân viên S02', unit: 'store', storeId: 'S02', status: 'Đang làm việc' },
        ],
        orders: [{
          id: 'ORDER-HOT-01', storeId: 'S02', employeeId: 'E-S02', amount: 16_000_001,
          status: 'Hoàn tất', createdAt: '2026-08-20T03:00:00.000Z',
        }],
        attendance: [{
          id: 'ATT-HOT-MANAGER', storeId: 'S02', employeeId: 'QL-S02', date: '2026-08-20',
          checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T05:00:00.000Z', workedSeconds: 14_400,
        }, {
          id: 'ATT-HOT-EMPLOYEE', storeId: 'S02', employeeId: 'E-S02', date: '2026-08-20',
          checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T05:00:00.000Z', workedSeconds: 14_400,
        }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'revenue-hot-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    for (const account of [
      { username: 'support.bonus', password: 'support-bonus-password', displayName: 'Hỗ trợ thưởng', role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-BONUS' },
      { username: 'manager.bonus', password: 'manager-bonus-password', displayName: 'Quản lý S02', role: 'store_manager', storeId: 'S02', employeeId: 'QL-S02' },
      { username: 'employee.bonus', password: 'employee-bonus-password', displayName: 'Nhân viên S02', role: 'employee', storeId: 'S02', employeeId: 'E-S02' },
    ]) {
      const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create', payload: account,
      }, { ...adminAuthorization, 'idempotency-key': `revenue-hot-user-${account.role}` }), env)
      expect(created.status, account.role).toBe(201)
    }
    const loginAs = async (username, password) => {
      const response = await worker.fetch(jsonRequest('https://idosi.example/api/login', { username, password }), env)
      expect(response.status).toBe(200)
      return { authorization: `Bearer ${(await response.json()).token}` }
    }
    const supportAuthorization = await loginAs('support.bonus', 'support-bonus-password')
    const managerAuthorization = await loginAs('manager.bonus', 'manager-bonus-password')
    const employeeAuthorization = await loginAs('employee.bonus', 'employee-bonus-password')

    const managerDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'revenue_bonus.calculate_day', expectedVersion: 1,
      payload: { storeId: 'S02', businessDate: '2026-08-20' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-revenue-hot-denied-0001' }), env)
    expect(managerDenied.status).toBe(403)

    const calculated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'revenue_bonus.calculate_day', expectedVersion: 1,
      payload: { storeId: 'S02', businessDate: '2026-08-20' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-revenue-hot-calculate-0001' }), env)
    expect(calculated.status).toBe(201)
    const calculatedBody = await calculated.json()
    expect(calculatedBody.revenueBonus).toMatchObject({
      storeId: 'S02', milestoneId: 'dosii.daily.over_15_000_000', milestonePoolVnd: 0,
      pendingMilestonePoolVnd: 250_000, milestoneStatus: 'PENDING',
    })
    expect(calculatedBody.revenueBonus.totalPoolVnd).toBe(calculatedBody.revenueBonus.percentagePoolVnd)
    expect(calculatedBody.teamClaim).toMatchObject({ status: 'PENDING', amountVnd: 250_000 })
    expect(calculatedBody.allocations.every(({ milestonePoolVnd, amountVnd, percentagePoolVnd }) => (
      milestonePoolVnd === 0 && amountVnd === percentagePoolVnd
    ))).toBe(true)
    expect(calculatedBody.teamParticipants.every(({ status, amountVnd }) => status === 'PENDING' && amountVnd === 0)).toBe(true)

    const managerStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', { headers: managerAuthorization }), env)
    expect(managerStateResponse.status).toBe(200)
    const managerState = (await managerStateResponse.json()).state
    expect(managerState.revenueBonusDaily).toEqual([expect.not.objectContaining({ allocations: expect.anything() })])
    expect(managerState.revenueBonusAllocations.map(({ employeeId }) => employeeId)).toEqual(['QL-S02'])
    expect(managerState.teamRewardParticipants.map(({ employeeId }) => employeeId)).toEqual(['QL-S02'])
    expect(JSON.stringify({
      daily: managerState.revenueBonusDaily,
      allocations: managerState.revenueBonusAllocations,
      participants: managerState.teamRewardParticipants,
    })).not.toContain('E-S02')

    const employeeStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', { headers: employeeAuthorization }), env)
    expect(employeeStateResponse.status).toBe(200)
    const employeeState = (await employeeStateResponse.json()).state
    expect(employeeState.revenueBonusDaily).toEqual([expect.objectContaining({ pendingMilestonePoolVnd: 250_000 })])
    expect(employeeState.revenueBonusDaily[0]).not.toHaveProperty('allocations')
    expect(employeeState.revenueBonusAllocations.map(({ employeeId }) => employeeId)).toEqual(['E-S02'])
    expect(employeeState.teamRewardParticipants.map(({ employeeId }) => employeeId)).toEqual(['E-S02'])
    expect(JSON.stringify({
      daily: employeeState.revenueBonusDaily,
      allocations: employeeState.revenueBonusAllocations,
      participants: employeeState.teamRewardParticipants,
    })).not.toContain('QL-S02')

    replaceStateCollection(env.DB.database, 'payrollPeriods', [{
      id: 'PAY-HOT-S02-2026-08', storeId: 'S02', period: '2026-08', status: 'Đã chi',
      confirmedAt: '2026-08-27T00:00:00.000Z', lockedAt: null,
    }])
    const blockedApproval = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'revenue_bonus.approve_milestone', expectedVersion: calculatedBody.version,
      payload: { claimId: calculatedBody.teamClaim.id, expectedEntityVersion: 1 },
    }, { ...supportAuthorization, 'idempotency-key': 'support-revenue-hot-paid-approve-0001' }), env)
    expect(blockedApproval.status).toBe(409)
    expect(await blockedApproval.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })
    const stateAfterBlockedApproval = readHydratedState(env.DB.database)
    expect(stateAfterBlockedApproval.teamRewardClaims).toEqual([
      expect.objectContaining({ id: calculatedBody.teamClaim.id, status: 'PENDING', amountVnd: 250_000 }),
    ])
    expect(stateAfterBlockedApproval.revenueBonusDaily).toEqual([
      expect.objectContaining({ pendingMilestonePoolVnd: 250_000, milestonePoolVnd: 0 }),
    ])
    expect(stateAfterBlockedApproval.teamRewardParticipants.every(({ status, amountVnd }) => (
      status === 'PENDING' && amountVnd === 0
    ))).toBe(true)
    expect(stateAfterBlockedApproval.revenueBonusAllocations.every(({ milestonePoolVnd, amountVnd, percentagePoolVnd }) => (
      milestonePoolVnd === 0 && amountVnd === percentagePoolVnd
    ))).toBe(true)

    replaceStateCollection(env.DB.database, 'payrollPeriods', [{
      id: 'PAY-HOT-S02-2026-08', storeId: 'S02', period: '2026-08', status: 'Đã chốt',
      confirmedAt: null, lockedAt: null, needsReclose: false,
    }])

    const approved = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'revenue_bonus.approve_milestone', expectedVersion: calculatedBody.version,
      payload: { claimId: calculatedBody.teamClaim.id, expectedEntityVersion: 1 },
    }, { ...supportAuthorization, 'idempotency-key': 'support-revenue-hot-approve-0001' }), env)
    expect(approved.status).toBe(200)
    const approvedBody = await approved.json()
    expect(approvedBody.teamClaim).toMatchObject({ status: 'APPROVED', amountVnd: 250_000 })
    expect(approvedBody.revenueBonus).toMatchObject({
      milestonePoolVnd: 250_000, pendingMilestonePoolVnd: 0, milestoneStatus: 'APPROVED',
    })
    expect(approvedBody.revenueBonus.totalPoolVnd).toBe(
      approvedBody.revenueBonus.percentagePoolVnd + 250_000,
    )
    expect(approvedBody.allocations.reduce((sum, record) => sum + record.milestonePoolVnd, 0)).toBe(250_000)
    expect(readHydratedState(env.DB.database).payrollPeriods).toEqual([
      expect.objectContaining({
        storeId: 'S02', period: '2026-08', needsReclose: true,
        invalidationReason: 'revenue_bonus.approve_milestone',
      }),
    ])
    const replay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'revenue_bonus.approve_milestone', expectedVersion: calculatedBody.version,
      payload: { claimId: calculatedBody.teamClaim.id, expectedEntityVersion: 1 },
    }, { ...supportAuthorization, 'idempotency-key': 'support-revenue-hot-approve-0001' }), env)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('idempotency-replayed')).toBe('true')
    expect(await replay.json()).toEqual(approvedBody)
  }, 60_000)
})
