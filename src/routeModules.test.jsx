import { cleanup, render, screen } from '@testing-library/react'
import { Suspense, useEffect } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { createLazyRouteComponent, preloadRouteComponent, preloadRouteModule } from './routeModules'

afterEach(cleanup)

it('does not mount a page or trigger its effects when its module is prefetched', async () => {
  const onMount = vi.fn()
  const Page = createLazyRouteComponent(async () => ({ Page: () => {
    useEffect(onMount, [])
    return <div>Ready page</div>
  } }), 'Page')
  await preloadRouteComponent(Page)
  expect(onMount).not.toHaveBeenCalled()
  render(<Suspense fallback={<div>Loading</div>}><Page /></Suspense>)
  expect(await screen.findByText('Ready page')).toBeTruthy()
  expect(onMount).toHaveBeenCalledOnce()
})

it('shares a module request between sibling pages and concurrent preloads', async () => {
  const loadModule = vi.fn().mockResolvedValue({ First: () => null, Second: () => null })
  const First = createLazyRouteComponent(loadModule, 'First')
  const Second = createLazyRouteComponent(loadModule, 'Second')
  await Promise.all([preloadRouteComponent(First), preloadRouteComponent(Second), preloadRouteComponent(First)])
  expect(loadModule).toHaveBeenCalledOnce()
})

it('allows a foreground lazy import to retry after speculative loading fails', async () => {
  const loadModule = vi.fn()
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce({ Page: () => <div>Recovered page</div> })
  const Page = createLazyRouteComponent(loadModule, 'Page')
  await expect(preloadRouteComponent(Page)).resolves.toBeUndefined()
  render(<Suspense fallback={<div>Loading</div>}><Page /></Suspense>)
  expect(await screen.findByText('Recovered page')).toBeTruthy()
  expect(loadModule).toHaveBeenCalledTimes(2)
})

it('ignores routes that do not have a page module', async () => {
  await expect(preloadRouteModule('/login')).resolves.toBeUndefined()
  await expect(preloadRouteModule('/unknown')).resolves.toBeUndefined()
})
