import assert from 'node:assert/strict'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import {
  advisoriesAtOrAbove,
  buildBulkAdvisoryPayload,
  collectAdvisories,
  decodeBulkAdvisoryBody,
  requestBulkAdvisories,
  requestGitHubAdvisories,
} from './audit-npm-bulk.mjs'

test('buildBulkAdvisoryPayload omits dev-only packages without losing production versions', () => {
  const lockfile = {
    packages: {
      '': { name: 'app', version: '1.0.0' },
      'node_modules/react': { version: '19.2.8' },
      'node_modules/tool': { version: '2.0.0', dev: true },
      'node_modules/a/node_modules/shared': { version: '1.0.0' },
      'node_modules/b/node_modules/shared': { version: '1.1.0' },
      'node_modules/link': { link: true, resolved: '../link' },
    },
  }

  assert.deepEqual(buildBulkAdvisoryPayload(lockfile, { omitDev: true }), {
    react: ['19.2.8'],
    shared: ['1.0.0', '1.1.0'],
  })
  assert.deepEqual(buildBulkAdvisoryPayload(lockfile), {
    react: ['19.2.8'],
    shared: ['1.0.0', '1.1.0'],
    tool: ['2.0.0'],
  })
})

test('decodeBulkAdvisoryBody handles an npm response whose gzip header is missing', () => {
  const report = { react: [{ id: 1, severity: 'high', title: 'Example' }] }
  assert.deepEqual(decodeBulkAdvisoryBody(gzipSync(JSON.stringify(report))), report)
})

test('collectAdvisories deduplicates findings and applies the configured severity threshold', () => {
  const findings = collectAdvisories({
    react: [
      { id: 1, severity: 'moderate', title: 'Moderate', vulnerable_versions: '<19.0.0' },
      { id: 1, severity: 'moderate', title: 'Moderate', vulnerable_versions: '<19.0.0' },
      { id: 2, severity: 'critical', title: 'Critical', vulnerable_versions: '<19.2.8' },
    ],
  })
  assert.equal(findings.length, 2)
  assert.deepEqual(advisoriesAtOrAbove(findings, 'high').map((finding) => finding.id), ['2'])
})

test('requestBulkAdvisories retries a transient failure and decodes a gzipped success', async () => {
  let calls = 0
  const expected = { react: [] }
  const fetchImpl = async () => {
    calls += 1
    if (calls === 1) throw new Error('temporary registry failure')
    return new Response(gzipSync(JSON.stringify(expected)), { status: 200 })
  }

  const result = await requestBulkAdvisories({ react: ['19.2.8'] }, {
    attempts: 2,
    timeoutMs: 5_000,
    fetchImpl,
  })
  assert.equal(calls, 2)
  assert.deepEqual(result, expected)
})

test('requestGitHubAdvisories checks exact package versions and normalizes active findings', async () => {
  const requests = []
  const fetchImpl = async (input, init) => {
    const url = new URL(input)
    const affects = url.searchParams.get('affects')
    requests.push({ affects, authorization: new Headers(init.headers).get('authorization') })
    if (affects === 'react@19.2.8') {
      return new Response(JSON.stringify([
        {
          ghsa_id: 'GHSA-active',
          severity: 'high',
          summary: 'Active advisory',
          html_url: 'https://github.com/advisories/GHSA-active',
          withdrawn_at: null,
          vulnerabilities: [{
            package: { ecosystem: 'npm', name: 'react' },
            vulnerable_version_range: '<=19.2.8',
          }],
        },
        {
          ghsa_id: 'GHSA-withdrawn',
          severity: 'critical',
          summary: 'Withdrawn advisory',
          withdrawn_at: '2026-01-01T00:00:00Z',
          vulnerabilities: [{
            package: { ecosystem: 'npm', name: 'react' },
            vulnerable_version_range: '<=19.2.8',
          }],
        },
      ]), { status: 200 })
    }
    if (affects === '@scope/pkg@1.0.0') return new Response('[]', { status: 200 })
    return new Response(JSON.stringify({ message: 'unexpected package' }), { status: 400 })
  }

  const report = await requestGitHubAdvisories({
    react: ['19.2.8'],
    '@scope/pkg': ['1.0.0'],
  }, {
    attempts: 1,
    timeoutMs: 5_000,
    concurrency: 2,
    token: 'test-token',
    fetchImpl,
  })

  assert.equal(requests.length, 2)
  assert.ok(requests.some((request) => request.affects === '@scope/pkg@1.0.0'))
  assert.ok(requests.every((request) => request.authorization === 'Bearer test-token'))
  assert.deepEqual(report, {
    react: [{
      id: 'GHSA-active',
      source: 'GHSA-active',
      severity: 'high',
      title: 'Active advisory',
      url: 'https://github.com/advisories/GHSA-active',
      vulnerable_versions: '<=19.2.8',
    }],
  })
})
