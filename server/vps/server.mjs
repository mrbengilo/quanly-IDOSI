import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import worker, { finalizeAutomaticRevenueBonuses } from '../worker.js'
import { createAutomaticRevenueBonusRunner } from './automatic-revenue-bonus-runner.mjs'
import { FileR2 } from './file-r2.mjs'
import { createReleaseInfoResponse } from './release-info.mjs'
import { createSqliteD1, runWithSqliteMetrics } from './sqlite-d1.mjs'
import { createStaticAssets } from './static-assets.mjs'

const MAX_REQUEST_BYTES = 20 * 1024 * 1024
const KEEP_ALIVE_TIMEOUT_MS = 65_000
const HEADERS_TIMEOUT_MS = 70_000
const SLOW_REQUEST_MS = 5_000

const roundedMs = (value) => Math.round(Number(value || 0) * 10) / 10

const observablePath = (url = '/') => {
  const pathname = new URL(url, 'http://localhost').pathname
  if (/^\/api\/account-avatars\/[^/]+$/u.test(pathname)) return '/api/account-avatars/:employeeId'
  const identityImage = pathname.match(/^\/api\/identity-images\/[^/]+\/(front|back)$/u)
  if (identityImage) return `/api/identity-images/:employeeId/${identityImage[1]}`
  return pathname
}

const defaultRequestLogger = process.env.NODE_ENV === 'test'
  ? null
  : (entry) => console.info(JSON.stringify(entry))

const readBody = (request) => new Promise((resolveBody, rejectBody) => {
  const chunks = []
  let size = 0
  let rejected = false
  request.on('data', (chunk) => {
    if (rejected) return
    size += chunk.byteLength
    if (size > MAX_REQUEST_BYTES) {
      rejected = true
      rejectBody(Object.assign(new Error('Request body too large'), { statusCode: 413 }))
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => resolveBody(chunks.length ? Buffer.concat(chunks) : null))
  request.on('error', rejectBody)
})

const publicUrl = (request) => {
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const protocol = forwardedProtocol || 'http'
  const forwardedHost = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const host = forwardedHost || request.headers.host || 'localhost'
  return `${protocol}://${host}${request.url || '/'}`
}

export const createVpsRuntime = ({
  databasePath = process.env.IDOSI_DB_PATH || resolve(process.cwd(), 'data', 'idosi.sqlite'),
  imagesDirectory = process.env.IDOSI_IMAGES_DIR || resolve(process.cwd(), 'data', 'identity-images'),
  migrationsDirectory = process.env.IDOSI_MIGRATIONS_DIR || resolve(process.cwd(), 'drizzle'),
  staticDirectory = process.env.IDOSI_STATIC_DIR || resolve(process.cwd(), 'dist', 'client'),
  bootstrapToken = process.env.BOOTSTRAP_TOKEN || '',
  googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '',
  sessionTtlSeconds = process.env.SESSION_TTL_SECONDS || '',
} = {}) => {
  const database = createSqliteD1({ databasePath, migrationsDirectory })
  const env = {
    DB: database,
    IDENTITY_IMAGES: new FileR2(imagesDirectory),
    ASSETS: createStaticAssets(staticDirectory),
    BOOTSTRAP_TOKEN: bootstrapToken,
    GOOGLE_MAPS_API_KEY: googleMapsApiKey,
    SESSION_TTL_SECONDS: sessionTtlSeconds,
  }
  return { database, env }
}

export const createIdosiServer = (options = {}) => {
  const runtime = createVpsRuntime(options)
  const automaticRevenueBonusRunner = createAutomaticRevenueBonusRunner({
    env: runtime.env,
    finalize: options.finalizeAutomaticRevenueBonuses || finalizeAutomaticRevenueBonuses,
    enabled: options.automaticRevenueBonusEnabled ?? (process.env.NODE_ENV !== 'test'),
    logger: options.automaticRevenueBonusLogger,
  })
  const releaseSha = options.releaseSha ?? process.env.IDOSI_RELEASE_SHA ?? ''
  const releaseStartedAt = options.releaseStartedAt ?? new Date().toISOString()
  const requestLogger = options.requestLogger === undefined ? defaultRequestLogger : options.requestLogger
  const server = createServer(async (nodeRequest, nodeResponse) => {
    const startedAt = performance.now()
    const method = String(nodeRequest.method || 'GET').toUpperCase()
    const path = observablePath(nodeRequest.url)
    let requestId = randomUUID()
    let responseBytes = 0
    const timing = { bodyReadMs: 0, handlerMs: 0, serializeMs: 0 }
    const databaseMetrics = { statements: 0, reads: 0, writes: 0, batches: 0, totalMs: 0, maxMs: 0 }
    let requestLogged = false
    const writeRequestLog = (aborted) => {
      if (requestLogged || !path.startsWith('/api/') || typeof requestLogger !== 'function') return
      requestLogged = true
      const durationMs = roundedMs(performance.now() - startedAt)
      try {
        requestLogger({
          event: 'idosi.api.request',
          timestamp: new Date().toISOString(),
          requestId,
          releaseSha: String(releaseSha || ''),
          method,
          path,
          status: nodeResponse.statusCode,
          responseBytes,
          durationMs,
          aborted,
          slow: durationMs >= SLOW_REQUEST_MS,
          timingMs: {
            bodyRead: roundedMs(timing.bodyReadMs),
            handler: roundedMs(timing.handlerMs),
            serialize: roundedMs(timing.serializeMs),
          },
          database: {
            ...databaseMetrics,
            totalMs: roundedMs(databaseMetrics.totalMs),
            maxMs: roundedMs(databaseMetrics.maxMs),
          },
        })
      } catch (error) {
        console.error('Unable to write IDOSI VPS request timing log', { requestId, error: String(error) })
      }
    }
    nodeResponse.once('finish', () => writeRequestLog(false))
    nodeResponse.once('close', () => writeRequestLog(!nodeResponse.writableFinished))
    try {
      const bodyStartedAt = performance.now()
      const body = ['GET', 'HEAD'].includes(method) ? null : await readBody(nodeRequest)
      timing.bodyReadMs = performance.now() - bodyStartedAt
      const headers = new Headers()
      for (const [name, value] of Object.entries(nodeRequest.headers)) {
        if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry))
        else if (value !== undefined) headers.set(name, value)
      }
      const forwardedIp = String(nodeRequest.headers['x-real-ip'] || nodeRequest.socket.remoteAddress || '').trim()
      if (forwardedIp && !headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', forwardedIp)
      const request = new Request(publicUrl(nodeRequest), {
        method,
        headers,
        ...(body ? { body } : {}),
      })
      const handlerStartedAt = performance.now()
      const response = new URL(request.url).pathname === '/api/release'
        ? createReleaseInfoResponse(request, { releaseSha, startedAt: releaseStartedAt })
        : await runWithSqliteMetrics(databaseMetrics, () => worker.fetch(request, runtime.env))
      timing.handlerMs = performance.now() - handlerStartedAt
      requestId = response.headers.get('x-request-id') || requestId
      let responseBody = null
      if (response.body && method !== 'HEAD') {
        const serializeStartedAt = performance.now()
        responseBody = Buffer.from(await response.arrayBuffer())
        timing.serializeMs = performance.now() - serializeStartedAt
        responseBytes = responseBody.byteLength
      }
      nodeResponse.statusCode = response.status
      response.headers.forEach((value, name) => nodeResponse.setHeader(name, value))
      nodeResponse.setHeader('x-request-id', requestId)
      const applicationMs = timing.bodyReadMs + timing.handlerMs + timing.serializeMs
      nodeResponse.setHeader('server-timing', `app;dur=${roundedMs(applicationMs)}`)
      if (!responseBody) {
        nodeResponse.end()
        return
      }
      nodeResponse.end(responseBody)
    } catch (error) {
      const status = Number(error?.statusCode) || 500
      nodeResponse.setHeader('x-request-id', requestId)
      nodeResponse.setHeader('server-timing', `app;dur=${roundedMs(performance.now() - startedAt)}`)
      nodeResponse.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      const errorBody = JSON.stringify({
        ok: false,
        error: {
          code: status === 413 ? 'REQUEST_TOO_LARGE' : 'VPS_RUNTIME_ERROR',
          message: status === 413 ? 'Dữ liệu gửi lên vượt quá giới hạn cho phép.' : 'Máy chủ không thể xử lý yêu cầu.',
        },
        requestId,
      })
      responseBytes = Buffer.byteLength(errorBody)
      nodeResponse.end(errorBody)
      if (status >= 500) console.error('Unhandled VPS runtime error', error)
    }
  })
  // Retire proxy connections after Caddy's 30s pool timeout, never before it.
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS
  server.headersTimeout = HEADERS_TIMEOUT_MS
  server.once('listening', () => automaticRevenueBonusRunner.start())
  server.on('close', () => {
    void automaticRevenueBonusRunner.stop()
    runtime.database.close()
  })
  return { server, runtime, automaticRevenueBonusRunner }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  const host = process.env.HOST || '0.0.0.0'
  const port = Number(process.env.PORT || 3000)
  const { server } = createIdosiServer()
  server.listen(port, host, () => console.log(`IDOSI VPS listening on http://${host}:${port}`))
  const shutdown = () => server.close(() => process.exit(0))
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
