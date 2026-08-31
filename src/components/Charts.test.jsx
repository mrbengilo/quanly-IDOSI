import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.doUnmock('./ChartImplementations')
  vi.resetModules()
})

describe('lazy chart wrappers', () => {
  it('reserves chart height and announces loading before rendering the Recharts implementation', async () => {
    let resolveImplementations
    vi.doMock('./ChartImplementations', () => new Promise((resolve) => {
      resolveImplementations = resolve
    }))

    const { DonutChart, FinancialChart } = await import('./Charts')
    const data = [{ day: '01/08', revenue: 10 }]

    render(
      <>
        <FinancialChart data={data} type="bar" keys={['revenue']} height={180} hideLegend />
        <DonutChart data={data} center="10" subcenter="Tổng" height={190} />
      </>,
    )

    const loadingStates = screen.getAllByRole('status')
    expect(loadingStates).toHaveLength(2)
    expect(loadingStates[0].style.height).toBe('180px')
    expect(loadingStates[1].style.height).toBe('190px')
    expect(loadingStates.every((state) => state.getAttribute('aria-busy') === 'true')).toBe(true)
    expect(screen.getAllByText('Đang tải biểu đồ...')).toHaveLength(2)

    await vi.waitFor(() => {
      expect(typeof resolveImplementations).toBe('function')
    })
    await act(async () => {
      resolveImplementations({
        FinancialChart: ({ type, height }) => <div data-testid="financial-chart" data-type={type} style={{ height }} />,
        DonutChart: ({ center, subcenter, height }) => (
          <div data-testid="donut-chart" data-center={center} data-subcenter={subcenter} style={{ height }} />
        ),
      })
    })

    const financialChart = await screen.findByTestId('financial-chart')
    const donutChart = screen.getByTestId('donut-chart')
    expect(financialChart.getAttribute('data-type')).toBe('bar')
    expect(financialChart.style.height).toBe('180px')
    expect(donutChart.getAttribute('data-center')).toBe('10')
    expect(donutChart.getAttribute('data-subcenter')).toBe('Tổng')
    expect(screen.queryByRole('status')).toBeNull()
  })
})
