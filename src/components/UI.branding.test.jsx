import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Login from '../pages/Login'
import { Brand, StoreIllustration } from './UI'

vi.mock('../state/AppContext', () => ({
  useApp: () => ({ login: vi.fn() }),
}))

afterEach(cleanup)

describe('visible IDOSI branding', () => {
  it('uses favicon.png for the shared shell brand and store illustration', () => {
    const { container } = render(<><Brand subtitle="Admin" /><StoreIllustration name="SecondMall SM234" /></>)
    const sources = [...container.querySelectorAll('img')].map((image) => image.getAttribute('src'))

    expect(sources).toEqual(['/favicon.png', '/favicon.png'])
    expect(screen.getByText('SecondMall SM234')).toBeTruthy()
  })

  it('uses favicon.png for both visible login logos', () => {
    const { container } = render(<MemoryRouter><Login /></MemoryRouter>)

    expect(container.querySelector('.login-hero .brand__mark')?.getAttribute('src')).toBe('/favicon.png')
    expect(screen.getByAltText('Biểu trưng IDOSI').getAttribute('src')).toBe('/favicon.png')
  })
})
