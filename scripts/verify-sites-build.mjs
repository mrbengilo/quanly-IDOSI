import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const root = process.cwd()
const client = resolve(root, 'dist', 'client')
const workerPath = resolve(root, 'dist', 'server', 'index.js')

await access(workerPath)
await access(resolve(root, 'dist', '.openai', 'hosting.json'))

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

console.log('Sites build verified.')
