import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'

const root = process.cwd()
const dist = resolve(root, 'dist')
const client = resolve(dist, 'client')
const server = resolve(dist, 'server')
const workerSource = resolve(root, 'server', 'worker.js')
const migrationsSource = resolve(root, 'drizzle')
const hostingSource = resolve(root, '.openai', 'hosting.json')
const hostingTarget = resolve(dist, '.openai', 'hosting.json')
const migrationsTarget = resolve(dist, '.openai', 'drizzle')

await rm(client, { recursive: true, force: true })
await rm(server, { recursive: true, force: true })
await rm(resolve(dist, 'src'), { recursive: true, force: true })
await rm(resolve(dist, '.openai'), { recursive: true, force: true })
await mkdir(client, { recursive: true })

for (const entry of await readdir(dist, { withFileTypes: true })) {
  if (['client', 'server', '.openai'].includes(entry.name)) continue
  await cp(resolve(dist, entry.name), resolve(client, entry.name), { recursive: true })
}

await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  ssr: {
    target: 'webworker',
    noExternal: true,
  },
  build: {
    ssr: workerSource,
    outDir: server,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
})

await mkdir(resolve(dist, '.openai'), { recursive: true })
await cp(hostingSource, hostingTarget)
await cp(migrationsSource, migrationsTarget, { recursive: true })
