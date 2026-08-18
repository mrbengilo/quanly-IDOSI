import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { describe, expect, it } from 'vitest'

const expectedFaviconHash = '2196dee2fa5e4cb95c3f4aec42b8559c8eb33c48b3dcebb08cee611824e0b26e'

describe('site favicon', () => {
  it('links the PNG favicon from the document head', () => {
    const html = readFileSync(resolve(cwd(), 'index.html'), 'utf8')

    expect(html).toMatch(/<link\s+rel="icon"\s+type="image\/png"\s+href="\/favicon\.png"\s*\/>/)
    expect(html).not.toContain('type="image/jpeg"')
  })

  it('keeps the supplied favicon byte-for-byte unchanged', () => {
    const favicon = readFileSync(resolve(cwd(), 'public', 'favicon.png'))
    const hash = createHash('sha256').update(favicon).digest('hex')

    expect(favicon.byteLength).toBe(407618)
    expect(hash).toBe(expectedFaviconHash)
  })
})
