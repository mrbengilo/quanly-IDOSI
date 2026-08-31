import { describe, expect, it } from 'vitest'
import { verifyPublicRelease } from './verify-public-release.mjs'

const RELEASE_SHA = '1234567890abcdef1234567890abcdef12345678'
const ORIGIN = 'https://idosi.io.vn'
const staticHeaders = {
  'x-idosi-static-release': RELEASE_SHA,
}

const responseJson = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

const createFetch = ({
  health = {
    ok: true,
    databaseConfigured: true,
    identityImageStorageConfigured: true,
    accountAvatarStorageConfigured: true,
  },
  releaseSha = RELEASE_SHA,
  html = `<!doctype html>
    <link rel="shortcut icon" href="./favicon.png">
    <script crossorigin type="module" src="./assets/index-A1.js"></script>`,
  markerStatus = 404,
  statusOverrides = {},
  headerOverrides = {},
  assetBodies = {},
} = {}) => {
  const requests = []
  const fetchImpl = async (input, init) => {
    const url = new URL(input)
    requests.push({ url, init })
    if (url.pathname === '/api/health') return responseJson(health, statusOverrides.health)
    if (url.pathname === '/api/release') {
      return responseJson(
        { ok: true, data: { releaseSha, startedAt: '2026-08-31T00:00:00.000Z' } },
        statusOverrides.release,
      )
    }
    if (url.pathname === '/') {
      return new Response(html, {
        status: statusOverrides.root ?? 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          ...staticHeaders,
          ...headerOverrides.root,
        },
      })
    }
    if (url.pathname === '/.idosi-release-sha') return new Response('Not found', { status: markerStatus })
    if (url.pathname === '/assets/index-A1.js') {
      return new Response(assetBodies.entry ?? 'console.log("IDOSI")', {
        status: statusOverrides.entry ?? 200,
        headers: { 'content-type': 'text/javascript; charset=utf-8', ...staticHeaders, ...headerOverrides.entry },
      })
    }
    if (url.pathname === '/favicon.png') {
      return new Response(assetBodies.favicon ?? 'png', {
        status: statusOverrides.favicon ?? 200,
        headers: { 'content-type': 'image/png', ...staticHeaders, ...headerOverrides.favicon },
      })
    }
    throw new Error(`Unexpected request: ${url.href}`)
  }
  return { fetchImpl, requests }
}

describe('public VPS release verification', () => {
  it('verifies health, exact release, HTML, static assets and private marker', async () => {
    const { fetchImpl, requests } = createFetch()

    await expect(verifyPublicRelease({
      baseUrl: `${ORIGIN}/ignored/path`,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl,
    })).resolves.toEqual({
      ok: true,
      baseUrl: ORIGIN,
      releaseSha: RELEASE_SHA,
      startedAt: '2026-08-31T00:00:00.000Z',
      assets: {
        entry: { url: `${ORIGIN}/assets/index-A1.js?_idosi_release=${RELEASE_SHA}`, bytes: 20 },
        favicon: { url: `${ORIGIN}/favicon.png?_idosi_release=${RELEASE_SHA}`, bytes: 3 },
      },
    })

    expect(requests.map(({ url }) => url.pathname).sort()).toEqual([
      '/',
      '/.idosi-release-sha',
      '/api/health',
      '/api/release',
      '/assets/index-A1.js',
      '/favicon.png',
    ].sort())
    expect(requests.every(({ init }) => init.method === 'GET' && init.redirect === 'error')).toBe(true)
    expect(requests
      .filter(({ url }) => ['/assets/index-A1.js', '/favicon.png'].includes(url.pathname))
      .every(({ url }) => url.searchParams.get('_idosi_release') === RELEASE_SHA)).toBe(true)
  })

  it('retries one transport failure and then completes verification', async () => {
    const stable = createFetch()
    let calls = 0
    const fetchImpl = async (...args) => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return stable.fetchImpl(...args)
    }

    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl,
    })).resolves.toMatchObject({ ok: true, releaseSha: RELEASE_SHA })
    expect(calls).toBe(7)
  })

  it('stops after two persistent transport failures', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      throw new TypeError('persistent network failure')
    }

    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl,
    })).rejects.toThrow('persistent network failure')
    expect(calls).toBe(2)
  })

  it.each([
    ['databaseConfigured', 'database'],
    ['identityImageStorageConfigured', 'identity image storage'],
    ['accountAvatarStorageConfigured', 'account avatar storage'],
  ])('fails when required health field %s is not configured', async (field, message) => {
    const { fetchImpl } = createFetch({
      health: {
        ok: true,
        databaseConfigured: true,
        identityImageStorageConfigured: true,
        accountAvatarStorageConfigured: true,
        [field]: false,
      },
    })

    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl,
    })).rejects.toThrow(message)
  })

  it('requires the exact API release SHA', async () => {
    const wrongApi = createFetch({ releaseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl: wrongApi.fetchImpl,
    })).rejects.toThrow('không phải')

  })

  it.each(['root', 'entry', 'favicon'])('requires the exact static release header on %s', async (target) => {
    const wrongStatic = createFetch({ headerOverrides: { [target]: { 'x-idosi-static-release': 'other' } } })
    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl: wrongStatic.fetchImpl,
    })).rejects.toThrow('X-IDOSI-Static-Release=other')
  })

  it.each([
    ['health', '/api/health'],
    ['release', '/api/release'],
    ['root', '/'],
    ['entry', '/assets/index-A1.js'],
    ['favicon', '/favicon.png'],
  ])('requires HTTP 200 from %s', async (target, pathname) => {
    const failed = createFetch({ statusOverrides: { [target]: 503 } })

    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl: failed.fetchImpl,
    })).rejects.toThrow(`${pathname} trả về HTTP 503`)
    expect(failed.requests.filter(({ url }) => url.pathname === pathname)).toHaveLength(1)
  })

  it.each([
    ['entry', '/assets/index-A1.js', 'JavaScript'],
    ['favicon', '/favicon.png', 'image/*'],
  ])('rejects an HTML SPA fallback returned for %s', async (target, pathname, expectedType) => {
    const fallback = createFetch({
      headerOverrides: { [target]: { 'content-type': 'text/html; charset=utf-8' } },
    })

    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl: fallback.fetchImpl,
    })).rejects.toThrow(`${pathname} có Content-Type=text/html, mong đợi ${expectedType}`)
  })

  it.each([
    ['JavaScript cross-origin', '<link rel="icon" href="/favicon.png"><script type="module" src="https://evil.example/app.js"></script>', 'cùng origin'],
    ['Favicon cross-origin', '<link rel="icon" href="//evil.example/icon.png"><script type="module" src="/assets/index-A1.js"></script>', 'cùng origin'],
    ['JavaScript traversal', '<link rel="icon" href="/favicon.png"><script type="module" src="/assets/%2e%2e/private.js"></script>', 'không an toàn'],
    ['Favicon traversal', '<link rel="icon" href="/%252e%252e/secret"><script type="module" src="/assets/index-A1.js"></script>', 'không an toàn'],
  ])('rejects unsafe %s references', async (_name, html, message) => {
    const { fetchImpl, requests } = createFetch({ html })

    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl,
    })).rejects.toThrow(message)
    expect(requests.some(({ url }) => url.origin !== ORIGIN)).toBe(false)
  })

  it('fails for empty static assets and an exposed release marker', async () => {
    const emptyEntry = createFetch({ assetBodies: { entry: '' } })
    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl: emptyEntry.fetchImpl,
    })).rejects.toThrow('nội dung rỗng')

    const publicMarker = createFetch({ markerStatus: 200 })
    await expect(verifyPublicRelease({
      baseUrl: ORIGIN,
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl: publicMarker.fetchImpl,
    })).rejects.toThrow('/.idosi-release-sha trả về HTTP 200')
  })
})
