import { Component, lazy, Suspense } from 'react'

const AppRoutes = lazy(() => import('./AppRoutes'))

function RouteLoading() {
  return <div className="route-loading" role="status" aria-live="polite" aria-busy="true">Đang tải màn hình...</div>
}

export class RouteErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Không thể tải màn hình ứng dụng.', error, errorInfo)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="route-loading" role="alert">
        <section className="route-loading__error">
          <strong>Không thể tải phiên bản hiện tại</strong>
          <p>Hệ thống có thể vừa được cập nhật hoặc kết nối bị gián đoạn.</p>
          <button type="button" className="button" onClick={() => (this.props.onReload || (() => window.location.reload()))()}>
            Tải lại trang
          </button>
        </section>
      </div>
    )
  }
}

export default function App() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoading />}>
        <AppRoutes />
      </Suspense>
    </RouteErrorBoundary>
  )
}
