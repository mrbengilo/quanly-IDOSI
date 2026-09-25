// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createIdosiServer, isPrivateProxyAddress, trustedClientIp } from './server.mjs'

const withServer = async (run) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-login-throttle-'))
  const { server } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'login-throttle-bootstrap',
    automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    expect((await post('/api/bootstrap', {
      username: 'throttle.admin', password: 'throttle-admin-password', displayName: 'Throttle Admin', initialState: {},
    }, { 'x-idosi-bootstrap-token': 'login-throttle-bootstrap' })).status).toBe(201)
    await run({ post })
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}

const attempt = (post, password, ip, extraHeaders = {}) => post('/api/login', {
  username: 'throttle.admin', password,
}, { 'x-forwarded-for': ip, ...extraHeaders })

describe('login throttling', () => {
  it('locks one client after five failures without locking the account for other clients', async () => {
    await withServer(async ({ post }) => {
      for (let index = 0; index < 5; index += 1) {
        expect((await attempt(post, 'wrong-password', '203.0.113.10')).status).toBe(401)
      }
      const locked = await attempt(post, 'throttle-admin-password', '203.0.113.10')
      expect(locked.status).toBe(429)
      expect(locked.body.error).toMatchObject({ code: 'LOGIN_RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } })
      expect((await attempt(post, 'throttle-admin-password', '198.51.100.20')).status).toBe(200)
    })
  }, 60_000)

  it('resets the per-client counter after a successful login', async () => {
    await withServer(async ({ post }) => {
      for (let index = 0; index < 4; index += 1) {
        expect((await attempt(post, 'wrong-password', '203.0.113.11')).status).toBe(401)
      }
      expect((await attempt(post, 'throttle-admin-password', '203.0.113.11')).status).toBe(200)
      for (let index = 0; index < 4; index += 1) {
        expect((await attempt(post, 'wrong-password', '203.0.113.11')).status).toBe(401)
      }
      expect((await attempt(post, 'throttle-admin-password', '203.0.113.11')).status).toBe(200)
    })
  }, 60_000)

  it('ignores client-supplied cf-connecting-ip and x-real-ip headers', async () => {
    await withServer(async ({ post }) => {
      for (let index = 0; index < 5; index += 1) {
        expect((await attempt(post, 'wrong-password', '203.0.113.12', {
          'cf-connecting-ip': `192.0.2.${index}`, 'x-real-ip': `192.0.2.${index + 50}`,
        })).status).toBe(401)
      }
      expect((await attempt(post, 'throttle-admin-password', '203.0.113.12', {
        'cf-connecting-ip': '192.0.2.99',
      })).status).toBe(429)
    })
  }, 60_000)

  it('throttles unknown usernames the same way', async () => {
    await withServer(async ({ post }) => {
      for (let index = 0; index < 5; index += 1) {
        expect((await post('/api/login', { username: 'ghost.user', password: 'whatever-123' }, {
          'x-forwarded-for': '203.0.113.13',
        })).status).toBe(401)
      }
      expect((await post('/api/login', { username: 'ghost.user', password: 'whatever-123' }, {
        'x-forwarded-for': '203.0.113.13',
      })).status).toBe(429)
    })
  }, 60_000)
})

describe('trusted client IP', () => {
  it('uses X-Forwarded-For only from a private proxy peer', () => {
    expect(isPrivateProxyAddress('172.18.0.3')).toBe(true)
    expect(isPrivateProxyAddress('::ffff:10.0.0.2')).toBe(true)
    expect(isPrivateProxyAddress('203.0.113.9')).toBe(false)
    expect(trustedClientIp({
      socket: { remoteAddress: '::ffff:172.18.0.3' }, headers: { 'x-forwarded-for': '203.0.113.9' },
    })).toBe('203.0.113.9')
    expect(trustedClientIp({
      socket: { remoteAddress: '198.51.100.7' }, headers: { 'x-forwarded-for': '203.0.113.9' },
    })).toBe('198.51.100.7')
    expect(trustedClientIp({ socket: { remoteAddress: '172.18.0.3' }, headers: {} })).toBe('172.18.0.3')
  })
})
