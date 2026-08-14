import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const root = process.cwd()
const client = resolve(root, 'dist', 'client')
const workerPath = resolve(root, 'dist', 'server', 'index.js')
const hostingPath = resolve(root, 'dist', '.openai', 'hosting.json')
const coreMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0000_idosi_core.sql')
const managerMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0001_manager_role.sql')
const attendancePolicyMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0002_attendance_evaluation_policies.sql')
const stateEntitiesMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0003_state_entities.sql')
const operationalRolesMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0004_operational_roles.sql')
const migrationJournalPath = resolve(root, 'dist', '.openai', 'drizzle', 'meta', '_journal.json')

await access(workerPath)
await access(hostingPath)
await access(coreMigrationPath)
await access(managerMigrationPath)
await access(attendancePolicyMigrationPath)
await access(stateEntitiesMigrationPath)
await access(operationalRolesMigrationPath)
await access(migrationJournalPath)

const hosting = JSON.parse(await readFile(hostingPath, 'utf8'))
assert.equal(hosting.d1, 'DB')
const coreMigration = await readFile(coreMigrationPath, 'utf8')
const managerMigration = await readFile(managerMigrationPath, 'utf8')
const attendancePolicyMigration = await readFile(attendancePolicyMigrationPath, 'utf8')
const stateEntitiesMigration = await readFile(stateEntitiesMigrationPath, 'utf8')
const operationalRolesMigration = await readFile(operationalRolesMigrationPath, 'utf8')
const migrationJournal = JSON.parse(await readFile(migrationJournalPath, 'utf8'))
const workerSource = await readFile(workerPath, 'utf8')
assert.equal(migrationJournal.dialect, 'sqlite')
assert.deepEqual(migrationJournal.entries.map(({ tag }) => tag), [
  '0000_idosi_core',
  '0001_manager_role',
  '0002_attendance_evaluation_policies',
  '0003_state_entities',
  '0004_operational_roles',
])
for (const table of ['system_metadata', 'users', 'app_state', 'policies', 'audit_log', 'counters', 'sessions', 'command_receipts']) {
  assert.match(coreMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`))
}
assert.match(managerMigration, /role IN \('admin', 'manager', 'employee'\)/u)
assert.match(managerMigration, /PRAGMA foreign_key_check/u)
for (const policyKey of [
  'attendance_maintain_max_late_count',
  'attendance_improve_min_late_count',
  'attendance_improve_min_late_minutes',
]) {
  assert.match(attendancePolicyMigration, new RegExp(`'${policyKey}'`, 'u'))
}
for (const table of ['state_collections', 'state_entities', 'command_receipt_chunks']) {
  assert.match(stateEntitiesMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'u'))
}
assert.match(stateEntitiesMigration, /json_each\(app\.value_json\)/u)
assert.match(stateEntitiesMigration, /value_bytes <= 1500000/u)
assert.match(stateEntitiesMigration, /chunk_bytes <= 1500000/u)
assert.doesNotMatch(stateEntitiesMigration, /(?:UPDATE|DELETE\s+FROM)\s+app_state\b/iu)
assert.match(workerSource, /FROM state_entities/u)
assert.match(workerSource, /INSERT INTO command_receipt_chunks/u)
assert.doesNotMatch(workerSource, /MAX_STATE_BYTES/u)
assert.match(operationalRolesMigration, /role IN \('admin', 'business_support', 'store_manager', 'employee'\)/u)
assert.match(operationalRolesMigration, /WHERE source\.role = 'admin'/u)
assert.doesNotMatch(operationalRolesMigration, /WHEN 'manager' THEN 'business_support'/u)
assert.match(operationalRolesMigration, /users_roles_receipt_chunks_backup/u)
assert.match(operationalRolesMigration, /json_remove\(/u)
assert.match(operationalRolesMigration, /'\$\.authUserId'/u)
assert.match(operationalRolesMigration, /admin-only-credentials/u)
assert.match(operationalRolesMigration, /PRAGMA foreign_key_check/u)

const { default: worker } = await import(`${new URL(`file:///${workerPath.replaceAll('\\', '/')}`).href}?v=${Date.now()}`)
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}
const env = {
  ASSETS: {
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1)
      try {
        const body = await readFile(resolve(client, relativePath))
        return new Response(body, { headers: { 'content-type': contentTypes[extname(relativePath)] || 'application/octet-stream' } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    },
  },
}

const response = await worker.fetch(new Request('https://idosi.example/quan-ly'), env)
assert.equal(response.status, 200)
assert.match(response.headers.get('content-type') || '', /^text\/html/)
assert.match(await response.text(), /<div id="root"><\/div>/)

const healthResponse = await worker.fetch(new Request('https://idosi.example/api/health'), env)
assert.equal(healthResponse.status, 200)
assert.deepEqual((await healthResponse.json()).service, 'idosi-api')

console.log('Sites build verified.')
