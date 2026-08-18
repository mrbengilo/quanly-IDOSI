import { readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const safeAssetPath = (root, pathname) => {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const relativeName = decoded.replace(/^\/+?/u, '') || 'index.html'
  const target = resolve(root, ...relativeName.split('/'))
  const relativePath = relative(root, target)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) return null
  return target
}

export const createStaticAssets = (rootDirectory) => {
  const root = resolve(rootDirectory)
  return {
    async fetch(request) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', { status: 405 })
      const target = safeAssetPath(root, new URL(request.url).pathname)
      if (!target) return new Response('Not Found', { status: 404 })
      try {
        const details = await stat(target)
        if (!details.isFile()) return new Response('Not Found', { status: 404 })
        const headers = new Headers({
          'content-type': CONTENT_TYPES.get(extname(target).toLowerCase()) || 'application/octet-stream',
          'content-length': String(details.size),
          'cache-control': target.endsWith('index.html')
            ? 'no-cache, no-store, must-revalidate'
            : (target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'),
          'x-content-type-options': 'nosniff',
        })
        return new Response(request.method === 'HEAD' ? null : await readFile(target), { headers })
      } catch (error) {
        if (error?.code === 'ENOENT') return new Response('Not Found', { status: 404 })
        throw error
      }
    },
  }
}
