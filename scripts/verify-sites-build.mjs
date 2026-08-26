import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const root = process.cwd()
const client = resolve(root, 'dist', 'client')
const workerPath = resolve(root, 'dist', 'server', 'index.js')
const workerDomainFiles = [
  'storeShiftChecklist.js',
  'compensationPolicies.js',
  'compensationAllocation.js',
  'compensationSettlement.js',
  'storeTieredPayroll.js',
  'managerRevenueBonus.js',
  'workCatalog.js',
].map((fileName) => resolve(root, 'dist', 'src', 'domain', fileName))
const hostingPath = resolve(root, 'dist', '.openai', 'hosting.json')
const coreMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0000_idosi_core.sql')
const managerMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0001_manager_role.sql')
const attendancePolicyMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0002_attendance_evaluation_policies.sql')
const stateEntitiesMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0003_state_entities.sql')
const operationalRolesMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0004_operational_roles.sql')
const adminOnlyAccountsMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0005_admin_only_accounts.sql')
const recursiveProfileSecretScrubMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0006_recursive_profile_secret_scrub.sql')
const sessionRolesMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0007_session_roles.sql')
const orderInformationOptionsMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0008_order_information_options.sql')
const compensationFoundationMigrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0009_compensation_foundation.sql')
const migrationsDirectory = resolve(root, 'dist', '.openai', 'drizzle')
const migrationJournalPath = resolve(root, 'dist', '.openai', 'drizzle', 'meta', '_journal.json')

await access(workerPath)
for (const workerDomainFile of workerDomainFiles) await access(workerDomainFile)
await access(hostingPath)
await access(coreMigrationPath)
await access(managerMigrationPath)
await access(attendancePolicyMigrationPath)
await access(stateEntitiesMigrationPath)
await access(operationalRolesMigrationPath)
await access(adminOnlyAccountsMigrationPath)
await access(recursiveProfileSecretScrubMigrationPath)
await access(sessionRolesMigrationPath)
await access(orderInformationOptionsMigrationPath)
await access(compensationFoundationMigrationPath)
await access(migrationJournalPath)

const hosting = JSON.parse(await readFile(hostingPath, 'utf8'))
assert.equal(hosting.d1, 'DB')
assert.equal(hosting.r2, 'IDENTITY_IMAGES')
const coreMigration = await readFile(coreMigrationPath, 'utf8')
const managerMigration = await readFile(managerMigrationPath, 'utf8')
const attendancePolicyMigration = await readFile(attendancePolicyMigrationPath, 'utf8')
const stateEntitiesMigration = await readFile(stateEntitiesMigrationPath, 'utf8')
const operationalRolesMigration = await readFile(operationalRolesMigrationPath, 'utf8')
const adminOnlyAccountsMigration = await readFile(adminOnlyAccountsMigrationPath, 'utf8')
const recursiveProfileSecretScrubMigration = await readFile(recursiveProfileSecretScrubMigrationPath, 'utf8')
const sessionRolesMigration = await readFile(sessionRolesMigrationPath, 'utf8')
const orderInformationOptionsMigration = await readFile(orderInformationOptionsMigrationPath, 'utf8')
const compensationFoundationMigration = await readFile(compensationFoundationMigrationPath, 'utf8')
const migrationJournal = JSON.parse(await readFile(migrationJournalPath, 'utf8'))
const workerSource = await readFile(workerPath, 'utf8')
assert.equal(migrationJournal.dialect, 'sqlite')
const migrationTags = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+.*\.sql$/u.test(name))
  .sort((left, right) => left.localeCompare(right))
  .map((name) => name.slice(0, -4))
assert.deepEqual(migrationJournal.entries.map(({ tag }) => tag), migrationTags)
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
assert.match(adminOnlyAccountsMigration, /PRAGMA defer_foreign_keys = ON/u)
assert.match(adminOnlyAccountsMigration, /DELETE FROM users\s+WHERE role <> 'admin'/u)
assert.match(adminOnlyAccountsMigration, /collection_key IN \('employees', 'deletedEmployees'\)/u)
assert.match(adminOnlyAccountsMigration, /lower\(field\.key\) NOT LIKE 'password%'/u)
assert.match(adminOnlyAccountsMigration, /'\$\.accountSettings'/u)
assert.match(adminOnlyAccountsMigration, /migration:0005:admin-only-accounts/u)
assert.match(adminOnlyAccountsMigration, /PRAGMA foreign_key_check/u)
assert.match(recursiveProfileSecretScrubMigration, /json_tree\(profile\.value_json\)/u)
assert.match(recursiveProfileSecretScrubMigration, /collection_key IN \('employees', 'deletedEmployees'\)/u)
assert.match(recursiveProfileSecretScrubMigration, /'accesstoken'.*'refreshtoken'/su)
assert.match(recursiveProfileSecretScrubMigration, /credential_envelopes/u)
assert.match(recursiveProfileSecretScrubMigration, /migration:0006:recursive-profile-secret-scrub/u)
assert.match(recursiveProfileSecretScrubMigration, /PRAGMA foreign_key_check/u)
assert.match(sessionRolesMigration, /active_role TEXT/u)
assert.match(sessionRolesMigration, /active_employee_id TEXT/u)
assert.match(orderInformationOptionsMigration, /INSERT INTO state_collections[\s\S]*'orderInformationOptions'/u)
assert.equal(new Set(orderInformationOptionsMigration.match(/order-occupation-\d{3}/gu)).size, 15)
assert.equal(new Set(orderInformationOptionsMigration.match(/OCC-\d{3}/gu)).size, 15)
assert.equal(new Set(orderInformationOptionsMigration.match(/order-payment-\d{3}/gu)).size, 2)
assert.equal(new Set(orderInformationOptionsMigration.match(/PAY-\d{3}/gu)).size, 2)
assert.match(orderInformationOptionsMigration, /'canonicalSeedCount', 17/u)
assert.match(orderInformationOptionsMigration, /WITH RECURSIVE order_information_seed[\s\S]*vietnamese_case_map/u)
assert.match(orderInformationOptionsMigration, /ON CONFLICT \(scope_key, collection_key, entity_key\) DO NOTHING/u)
assert.doesNotMatch(orderInformationOptionsMigration, /(?:UPDATE|DELETE\s+FROM)\s+(?:app_state|state_entities)\b/iu)
assert.match(compensationFoundationMigration, /'compensationEntries'/u)
assert.match(compensationFoundationMigration, /'employee_kpi_percent_30000'/u)
assert.match(compensationFoundationMigration, /json_remove\(value_json, '\$\.kpiSnapshot'\)/u)
assert.match(compensationFoundationMigration, /PRAGMA foreign_key_check/u)

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
