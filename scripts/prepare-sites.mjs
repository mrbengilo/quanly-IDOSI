import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const dist = resolve(root, 'dist')
const client = resolve(dist, 'client')
const server = resolve(dist, 'server')
const hostingSource = resolve(root, '.openai', 'hosting.json')
const hostingTarget = resolve(dist, '.openai', 'hosting.json')

await rm(client, { recursive: true, force: true })
await mkdir(client, { recursive: true })

for (const entry of await readdir(dist, { withFileTypes: true })) {
  if (['client', 'server', '.openai'].includes(entry.name)) continue
  await cp(resolve(dist, entry.name), resolve(client, entry.name), { recursive: true })
}

await mkdir(server, { recursive: true })
await writeFile(resolve(server, 'index.js'), `const fetchAsset = (request, env) => {
  if (!env?.ASSETS?.fetch) {
    return Promise.resolve(new Response('Static asset binding is unavailable.', { status: 503 }))
  }
  return env.ASSETS.fetch(request)
}

export default {
  async fetch(request, env) {
    const response = await fetchAsset(request, env)
    if (response.status !== 404 || !['GET', 'HEAD'].includes(request.method)) return response

    const url = new URL(request.url)
    if (url.pathname.includes('.')) return response

    url.pathname = '/index.html'
    return fetchAsset(new Request(url, request), env)
  },
}
`)

await mkdir(resolve(dist, '.openai'), { recursive: true })
await writeFile(hostingTarget, await readFile(hostingSource, 'utf8'))
