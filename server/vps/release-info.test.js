import { describe, expect, it } from 'vitest'
import { createReleaseInfoResponse, normalizeReleaseSha } from './release-info.mjs'
import { verifyRelease } from './verify-release.mjs'

const RELEASE_SHA = '1234567890abcdef1234567890abcdef12345678'

describe('VPS release identity', () => {
  it('normalizes only complete commit SHAs', () => {
    expect(normalizeReleaseSha(RELEASE_SHA.toUpperCase())).toBe(RELEASE_SHA)
    expect(normalizeReleaseSha('1234')).toBe('unknown')
  })

  it('returns the running release without caching it', async () => {
    const response = createReleaseInfoResponse(new Request('https://idosi.io.vn/api/release'), {
      releaseSha: RELEASE_SHA,
      startedAt: '2026-08-30T00:00:00.000Z',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        service: 'idosi-vps',
        releaseSha: RELEASE_SHA,
        startedAt: '2026-08-30T00:00:00.000Z',
      },
    })
  })

  it('supports HEAD and rejects mutating methods', async () => {
    const head = createReleaseInfoResponse(new Request('https://idosi.io.vn/api/release', { method: 'HEAD' }), {
      releaseSha: RELEASE_SHA,
    })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    const post = createReleaseInfoResponse(new Request('https://idosi.io.vn/api/release', { method: 'POST' }), {
      releaseSha: RELEASE_SHA,
    })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })

  it('verifies health and the exact production release', async () => {
    const fetchImpl = async (url) => new Response(JSON.stringify(
      url.pathname === '/api/health'
        ? { ok: true, data: { service: 'idosi-api' } }
        : { ok: true, data: { releaseSha: RELEASE_SHA, startedAt: 'now' } },
    ), { status: 200, headers: { 'content-type': 'application/json' } })

    await expect(verifyRelease({
      baseUrl: 'https://idosi.io.vn',
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl,
    })).resolves.toMatchObject({ ok: true, releaseSha: RELEASE_SHA })
  })

  it('fails when production is running another release', async () => {
    const fetchImpl = async (url) => new Response(JSON.stringify(
      url.pathname === '/api/health'
        ? { ok: true }
        : { ok: true, data: { releaseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
    ), { status: 200, headers: { 'content-type': 'application/json' } })

    await expect(verifyRelease({
      baseUrl: 'https://idosi.io.vn',
      expectedReleaseSha: RELEASE_SHA,
      fetchImpl,
    })).rejects.toThrow('không phải')
  })
})
