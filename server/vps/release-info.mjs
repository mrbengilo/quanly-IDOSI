const FULL_RELEASE_SHA = /^[0-9a-f]{40}$/u

export const normalizeReleaseSha = (value) => {
  const releaseSha = String(value || '').trim().toLowerCase()
  return FULL_RELEASE_SHA.test(releaseSha) ? releaseSha : 'unknown'
}

export const createReleaseInfoResponse = (request, {
  releaseSha,
  startedAt = new Date().toISOString(),
} = {}) => {
  const method = request?.method || 'GET'
  const headers = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  }

  if (!['GET', 'HEAD'].includes(method)) {
    return new Response(JSON.stringify({
      ok: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Phương thức không được hỗ trợ.',
      },
    }), {
      status: 405,
      headers: { ...headers, allow: 'GET, HEAD' },
    })
  }

  const payload = {
    ok: true,
    data: {
      service: 'idosi-vps',
      releaseSha: normalizeReleaseSha(releaseSha),
      startedAt: String(startedAt || ''),
    },
  }

  return new Response(method === 'HEAD' ? null : JSON.stringify(payload), {
    status: 200,
    headers,
  })
}
