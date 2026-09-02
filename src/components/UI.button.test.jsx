import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './UI'

afterEach(cleanup)

describe('Button', () => {
  it('shows a busy state and blocks duplicate clicks while an async action is pending', async () => {
    let resolveAction
    const onClick = vi.fn(() => new Promise((resolve) => { resolveAction = resolve }))
    render(<Button onClick={onClick}>Lưu</Button>)

    const button = screen.getByRole('button', { name: 'Lưu' })
    fireEvent.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('.spin')).toBeTruthy()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    resolveAction({ ok: true })
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(button.querySelector('.spin')).toBeNull()
  })

  it('keeps synchronous actions immediately reusable', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Mở</Button>)

    const button = screen.getByRole('button', { name: 'Mở' })
    fireEvent.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(false)
    expect(button.hasAttribute('aria-busy')).toBe(false)
  })
})
