import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './UI'

export function PaginationControls({
  page = 0,
  pageCount = 1,
  onPageChange,
  label = 'danh sách',
}) {
  if (pageCount <= 1) return null
  return (
    <nav className="table-pagination" aria-label={`Phân trang ${label}`}>
      <Button
        type="button"
        variant="outline"
        icon={ChevronLeft}
        disabled={page <= 0}
        onClick={() => onPageChange?.(Math.max(0, page - 1))}
      >TRƯỚC</Button>
      <span className="table-pagination__status" aria-live="polite">
        Trang <strong>{page + 1}</strong> / {pageCount}
      </span>
      <Button
        type="button"
        variant="outline"
        icon={ChevronRight}
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange?.(Math.min(pageCount - 1, page + 1))}
      >SAU</Button>
    </nav>
  )
}
