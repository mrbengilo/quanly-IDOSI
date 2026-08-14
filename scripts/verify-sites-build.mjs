import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const root = process.cwd()
const client = resolve(root, 'dist', 'client')
const workerPath = resolve(root, 'dist', 'server', 'index.js')
const hostingPath = resolve(root, 'dist', '.openai', 'hosting.json')
const migrationPath = resolve(root, 'dist', '.openai', 'drizzle', '0000_idosi_core.sql')
const migrationJournalPath = resolve(root, 'dist', '.openai', 'drizzle', 'meta', '_journal.json')

await access(workerPath)
await access(hostingPath)
await access(migrationPath)
await access(migrationJournalPath)

const hosting = JSON.parse(await readFile(hostingPath, 'utf8'))
assert.equal(hosting.d1, 'DB')
const migration = await readFile(migrationPath, 'utf8')
const migrationJournal = JSON.parse(await readFile(migrationJournalPath, 'utf8'))
assert.equal(migrationJournal.dialect, 'sqlite')
assert.equal(migrationJournal.entries.at(-1)?.tag, '0000_idosi_core')
for (const table of ['system_metadata', 'users', 'app_state', 'policies', 'audit_log', 'counters', 'sessions', 'command_receipts']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`))
}

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
