import { lazy, Suspense } from 'react'

const DEFAULT_FINANCIAL_KEYS = Object.freeze(['revenue', 'expense', 'profit'])
let implementationsPromise
const loadImplementations = () => {
  implementationsPromise ||= import('./ChartImplementations')
  return implementationsPromise
}
const LazyFinancialChart = lazy(() => loadImplementations().then((module) => ({ default: module.FinancialChart })))
const LazyDonutChart = lazy(() => loadImplementations().then((module) => ({ default: module.DonutChart })))

function ChartLoadingFallback({ height, variant }) {
  return (
    <div
      className={variant === 'donut' ? 'donut-wrap' : 'chart'}
      style={{ height }}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Đang tải biểu đồ...</span>
    </div>
  )
}

export function FinancialChart({ data, type = 'line', keys = DEFAULT_FINANCIAL_KEYS, height = 260, hideLegend = false }) {
  return (
    <Suspense fallback={<ChartLoadingFallback height={height} variant="financial" />}>
      <LazyFinancialChart data={data} type={type} keys={keys} height={height} hideLegend={hideLegend} />
    </Suspense>
  )
}

export function DonutChart({ data, center, subcenter, height = 250 }) {
  return (
    <Suspense fallback={<ChartLoadingFallback height={height} variant="donut" />}>
      <LazyDonutChart data={data} center={center} subcenter={subcenter} height={height} />
    </Suspense>
  )
}
