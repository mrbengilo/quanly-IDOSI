import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Info,
  LoaderCircle,
  Menu,
  Search,
  X,
} from 'lucide-react'
import { Children, cloneElement, Fragment, isValidElement, useEffect, useRef, useState } from 'react'
import { loadEmployeeAvatarUrl, subscribeEmployeeAvatarUpdates } from '../services/employeeAvatarCache'
import { buildPaginatedPages, DEFAULT_TABLE_PAGE_SIZE, normalizeTableDate, paginationSequence } from './tablePagination'

const TEMPORAL_INPUT_TYPES = new Set(['date', 'time', 'month', 'datetime-local'])
const TEMPORAL_PICKER_KEYS = new Set(['Enter', ' '])

export function Brand({ compact = false, blue = false, subtitle = 'hệ thống quản lý' }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''} ${blue ? 'brand--blue' : ''}`}>
      <img className="brand__mark" src="/favicon.png" alt="" aria-hidden="true" />
      <span className="brand__word">IDOSI</span>
      {!compact && <small>{subtitle}</small>}
    </div>
  )
}

export function Avatar({ name = 'IDOSI', color = '#dfece5', size = 38, src = '', employeeId = '' }) {
  const directSrc = typeof src === 'string' ? src.trim() : ''
  const normalizedEmployeeId = String(employeeId || '').trim()
  const [remoteAvatar, setRemoteAvatar] = useState({ employeeId: '', url: '' })
  const [reloadVersion, setReloadVersion] = useState(0)
  const initials = String(name || 'IDOSI')
    .split(' ')
    .slice(-2)
    .map((item) => item[0])
    .join('')
    .toUpperCase()

  useEffect(() => {
    if (directSrc || !normalizedEmployeeId) return undefined
    let active = true
    loadEmployeeAvatarUrl(normalizedEmployeeId)
      .then((url) => {
        if (active) setRemoteAvatar({ employeeId: normalizedEmployeeId, url })
      })
      .catch(() => {
        if (active) setRemoteAvatar({ employeeId: normalizedEmployeeId, url: '' })
      })
    return () => { active = false }
  }, [directSrc, normalizedEmployeeId, reloadVersion])

  useEffect(() => {
    if (!normalizedEmployeeId) return undefined
    return subscribeEmployeeAvatarUpdates((changedEmployeeId) => {
      if (!changedEmployeeId || changedEmployeeId === normalizedEmployeeId) {
        setReloadVersion((current) => current + 1)
      }
    })
  }, [normalizedEmployeeId])

  const imageSrc = directSrc || (remoteAvatar.employeeId === normalizedEmployeeId ? remoteAvatar.url : '')
  return (
    <span className="avatar" style={{ '--avatar-color': color, width: size, height: size }}>
      {imageSrc ? <img src={imageSrc} alt={`Ảnh đại diện ${name}`} /> : initials}
    </span>
  )
}

export function PageHeader({ title, subtitle, icon: Icon, actions, onMenu }) {
  return (
    <header className="page-header">
      <div className="page-header__title">
        {onMenu && (
          <button className="icon-button mobile-menu" onClick={onMenu} aria-label="Mở menu">
            <Menu size={22} />
          </button>
        )}
        {Icon && <Icon className="page-header__icon" size={31} />}
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="page-header__actions">{actions}</div>
    </header>
  )
}

export function NotificationButton({ count = 3, onClick }) {
  return (
    <button className="icon-button notification" aria-label="Thông báo" onClick={onClick} disabled={!onClick}>
      <Bell size={23} />
      {count > 0 && <span>{count}</span>}
    </button>
  )
}

export function Button({ children, variant = 'primary', icon: Icon, loading, className = '', type = 'button', onClick, disabled = false, ...props }) {
  const [internalLoading, setInternalLoading] = useState(false)
  const pendingClickRef = useRef(null)
  const mountedRef = useRef(false)
  const externallyBusy = props['aria-busy'] === true || props['aria-busy'] === 'true'
  const busy = Boolean(loading || internalLoading || externallyBusy)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const handleClick = (event) => {
    if (!onClick || busy || pendingClickRef.current) return
    const result = onClick(event)
    if (!result || typeof result.then !== 'function') return

    pendingClickRef.current = result
    setInternalLoading(true)
    const finish = () => {
      if (pendingClickRef.current !== result) return
      pendingClickRef.current = null
      if (mountedRef.current) setInternalLoading(false)
    }
    Promise.resolve(result).then(finish, finish)
  }

  return (
    <button
      type={type}
      className={`button button--${variant} ${className}`}
      {...props}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onClick ? handleClick : undefined}
    >
      {busy ? <LoaderCircle className="spin" size={18} /> : Icon ? <Icon size={18} /> : null}
      <span>{children}</span>
    </button>
  )
}

export function Card({ children, className = '', title, action }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card__header">
          {title && <h2>{title}</h2>}
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function MetricCard({ label, value, helper, icon: Icon, tone = 'green', trend, suffix, compact = false }) {
  return (
    <Card className={`metric metric--${tone} ${compact ? 'metric--compact' : ''}`}>
      <div className="metric__icon">{Icon && <Icon size={25} />}</div>
      <div className="metric__body">
        <span className="metric__label">{label}</span>
        <strong>{value}</strong>
        {suffix && <em>{suffix}</em>}
        {(helper || trend) && (
          <small>
            {trend && (trend >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />)}
            {trend != null && <b>{Math.abs(trend).toFixed(2)}%</b>}
            {helper}
          </small>
        )}
      </div>
    </Card>
  )
}

export function Badge({ children, tone = 'green' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export function Field({ label, required, hint, error, children, className = '' }) {
  return (
    <label className={`field ${error ? 'field--error' : ''} ${className}`}>
      {label && (
        <span className="field__label">
          {label} {required && <b>*</b>}
        </span>
      )}
      {children}
      {error && <small className="field__error" role="alert">{error}</small>}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Input({ icon, className = '', type, onKeyDown, ...props }) {
  const inputRef = useRef(null)
  const pickerRequestPendingRef = useRef(false)
  const isTemporal = TEMPORAL_INPUT_TYPES.has(type)
  const Icon = icon || (type === 'time' ? Clock3 : type === 'datetime-local' ? CalendarClock : isTemporal ? CalendarDays : null)

  const requestPicker = (fallbackToClick = false) => {
    const input = inputRef.current
    if (!isTemporal || !input || input.disabled || input.readOnly || pickerRequestPendingRef.current) return false

    pickerRequestPendingRef.current = true
    input.focus({ preventScroll: true })

    let opened = false
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker()
        opened = true
      } catch {
        // Browsers can reject showPicker() in embedded or unsupported contexts.
      }
    }

    if (!opened && fallbackToClick) input.click()
    queueMicrotask(() => {
      pickerRequestPendingRef.current = false
    })
    return true
  }

  const handleWrapperClick = (event) => {
    if (!isTemporal || event.defaultPrevented) return
    const clickedOutsideInput = event.target !== inputRef.current
    const pickerRequested = requestPicker(clickedOutsideInput)
    if (clickedOutsideInput && pickerRequested) event.preventDefault()
  }

  const handleKeyDown = (event) => {
    onKeyDown?.(event)
    if (
      event.defaultPrevented
      || !isTemporal
      || inputRef.current?.disabled
      || inputRef.current?.readOnly
      || (!TEMPORAL_PICKER_KEYS.has(event.key) && !(event.altKey && event.key === 'ArrowDown'))
    ) return

    event.preventDefault()
    requestPicker(true)
  }

  return (
    <span
      className={`input-wrap ${isTemporal ? 'input-wrap--temporal' : ''} ${className}`}
      onClick={handleWrapperClick}
    >
      {Icon && <Icon className={isTemporal ? 'input-wrap__temporal-icon' : ''} size={18} aria-hidden="true" />}
      <input ref={inputRef} type={type} onKeyDown={handleKeyDown} {...props} />
    </span>
  )
}

const moneyUnitValue = (value) => {
  const source = String(value ?? '').trim()
  if (!source) return ''
  const negative = source.startsWith('-')
  const digits = source.replace(/\D/gu, '')
  if (!digits) return negative ? '-' : ''
  const normalizedDigits = digits.replace(/^0+(?=\d)/u, '')
  const formatted = normalizedDigits.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
  return `${negative && !/^0+$/u.test(normalizedDigits) ? '-' : ''}${formatted}`
}

export function MoneyInput({ className = '', value = '', onChange, ...props }) {
  const displayValue = moneyUnitValue(value)
  const handleChange = (event) => {
    const source = String(event.target.value || '')
    const negative = source.trimStart().startsWith('-')
    const digits = source.replace(/\D/gu, '')
    const normalizedDigits = digits.replace(/^0+(?=\d)/u, '')
    const actualValue = digits ? `${negative && !/^0+$/u.test(normalizedDigits) ? '-' : ''}${normalizedDigits}` : ''
    onChange?.({
      target: { name: props.name, value: actualValue },
      currentTarget: { name: props.name, value: actualValue },
      nativeEvent: event.nativeEvent,
    })
  }

  return (
    <span className={`input-wrap money-input-wrap ${className}`}>
      <input {...props} inputMode="numeric" value={displayValue} onChange={handleChange} />
      {displayValue !== '' && <span className="money-input__suffix" aria-hidden="true">đ</span>}
    </span>
  )
}

export function Select({ children, icon: Icon, className = '', ...props }) {
  return (
    <span className={`input-wrap select-wrap ${className}`}>
      {Icon && <Icon size={18} />}
      <select {...props}>{children}</select>
      <ChevronDown size={17} className="select-chevron" />
    </span>
  )
}

export function DateRange({ value = '01/08/2026 - 31/08/2026', onChange }) {
  return (
    <Input
      icon={CalendarDays}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      aria-label="Khoảng thời gian"
      className="date-range"
    />
  )
}

export function SearchInput({ value, onChange, placeholder = 'Tìm kiếm...', className = '' }) {
  return (
    <Input
      icon={Search}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={className}
    />
  )
}

const flattenTableRows = (children) => {
  const rows = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === Fragment) rows.push(...flattenTableRows(child.props.children))
    else rows.push(child)
  })
  return rows
}

const tableSummaryRow = (row) => {
  if (!isValidElement(row)) return false
  if (row.props?.['data-table-summary']) return true
  return /(?:^|\s)(?:total-row|table-summary-row)(?:\s|$)/u.test(String(row.props?.className || ''))
}

const tableRowDate = (row) => normalizeTableDate(row?.props?.['data-page-date'])

const paginationDateLabel = (rows = []) => {
  const dates = [...new Set(rows.map(tableRowDate).filter(Boolean))]
  if (!dates.length) return ''
  const display = (value) => {
    const [year, month, day] = value.split('-')
    return `${day}/${month}/${year}`
  }
  if (dates.length === 1) return `Ngày ${display(dates[0])}`
  return dates.map(display).join(' và ')
}

export function TablePagination({
  page = 1,
  totalPages = 1,
  total = 0,
  shown = 0,
  from = 0,
  label = '',
  onPageChange,
}) {
  if (!onPageChange || totalPages <= 1) return null
  const sequence = paginationSequence(page, totalPages)
  const first = total > 0 ? Math.max(1, Number(from) || 1) : 0
  const last = total > 0 ? first + Math.max(0, Number(shown) || 0) - 1 : 0
  return (
    <div className="table-footer">
      <span>{label && <strong>{label} · </strong>}Hiển thị {first}–{Math.max(first, last)} / {total} bản ghi</span>
      <nav className="pagination" aria-label="Phân trang bảng dữ liệu">
        <button type="button" aria-label="Trang trước" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹</button>
        {sequence.map((item) => typeof item === 'number' ? (
          <button
            type="button"
            key={item}
            className={item === page ? 'active' : ''}
            aria-current={item === page ? 'page' : undefined}
            aria-label={`Trang ${item}`}
            onClick={() => onPageChange(item)}
          >{item}</button>
        ) : <span className="pagination__ellipsis" aria-hidden="true" key={item}>…</span>)}
        <button type="button" aria-label="Trang sau" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>›</button>
      </nav>
    </div>
  )
}

export function TableWrap({
  children,
  className = '',
  tableClassName = '',
  tableLabel,
  paginate = true,
  pageSize = DEFAULT_TABLE_PAGE_SIZE,
  firstPageDates = [],
  paginationKey = '',
  ...containerProps
}) {
  const tableChildren = flattenTableRows(children).map((child, index) => (
    child.key == null ? cloneElement(child, { key: `table-section-${index}` }) : child
  ))
  const bodyIndex = tableChildren.findIndex((child) => isValidElement(child) && child.type === 'tbody')
  const body = bodyIndex >= 0 ? tableChildren[bodyIndex] : null
  const bodyRows = flattenTableRows(body?.props?.children).map((row, index) => (
    row.key == null ? cloneElement(row, { key: `table-row-${index}` }) : row
  ))
  const summaryRows = bodyRows.filter(tableSummaryRow)
  const dataRows = bodyRows.filter((row) => !tableSummaryRow(row))
  const firstDateKey = (Array.isArray(firstPageDates) ? firstPageDates : []).join('|')
  const normalizedFirstPageDates = firstDateKey.split('|').filter(Boolean)
  const rowKey = dataRows.map((row, index) => `${String(row.key ?? index)}:${tableRowDate(row)}`).join('|')
  const pages = paginate && body
    ? buildPaginatedPages(dataRows, {
        pageSize,
        getDate: tableRowDate,
        firstPageDates: normalizedFirstPageDates,
        groupRemainingByDate: normalizedFirstPageDates.length > 0,
      })
    : [dataRows]
  const totalPages = Math.max(1, pages.length)
  const paginationIdentity = [paginationKey, rowKey, firstDateKey, pageSize].join('::')
  const [paginationState, setPaginationState] = useState({ key: '', page: 1 })
  const requestedPage = paginationState.key === paginationIdentity ? paginationState.page : 1
  const activePage = Math.min(totalPages, Math.max(1, requestedPage))
  const setPage = (nextPage) => {
    const resolvedPage = typeof nextPage === 'function' ? nextPage(activePage) : nextPage
    setPaginationState({
      key: paginationIdentity,
      page: Math.min(totalPages, Math.max(1, Number(resolvedPage) || 1)),
    })
  }
  const visibleDataRows = pages[activePage - 1] || []
  const paginated = paginate && body && totalPages > 1
  const visibleRows = paginated ? [...visibleDataRows, ...summaryRows] : bodyRows
  const visibleChildren = body
    ? tableChildren.map((child, index) => index === bodyIndex ? cloneElement(body, body.props, ...visibleRows) : child)
    : tableChildren
  const offset = pages.slice(0, activePage - 1).reduce((total, pageRows) => total + pageRows.length, 0)

  return <>
    <div {...containerProps} className={`table-scroll ${className}`}>
      <table className={tableClassName} aria-label={tableLabel}>{visibleChildren}</table>
    </div>
    {paginated && <TablePagination
      page={activePage}
      totalPages={totalPages}
      total={dataRows.length}
      shown={visibleDataRows.length}
      from={offset + 1}
      label={paginationDateLabel(visibleDataRows)}
      onPageChange={setPage}
    />}
  </>
}

export function TableFooter({ shown, total, page = 1, onPageChange, pageSize = shown }) {
  if (!onPageChange) return null
  const size = Math.max(1, Number(pageSize || shown || total || 1))
  const totalPages = Math.max(1, Math.ceil(Number(total || 0) / size))
  return <TablePagination
    page={page}
    totalPages={totalPages}
    total={total}
    shown={shown}
    from={(page - 1) * size + 1}
    onPageChange={onPageChange}
  />
}

export function Progress({ value, color = '#07883f' }) {
  return <span className="progress"><i style={{ width: `${Math.min(100, value)}%`, background: color }} /></span>
}

export function Modal({ open, onClose, title, children, footer, wide = false }) {
  if (!open) return null
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-button" aria-label="Đóng hộp thoại" onClick={onClose}><X size={21} /></button></header>
        <div className="modal__body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  )
}

export function Drawer({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div className="overlay drawer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="drawer" role="dialog" aria-modal="true">
        <header><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={22} /></button></header>
        <div className="drawer__body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  )
}

export function InfoNote({ children, tone = 'green' }) {
  return <div className={`info-note info-note--${tone}`}><Info size={18} /><div>{children}</div></div>
}

export function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`toast toast--${toast.type}`}>
      <span>{toast.type === 'success' ? <Check size={18} /> : <Info size={18} />}</span>
      {toast.message}
    </div>
  )
}

export function ExportButton({ onClick, label = 'Xuất Excel' }) {
  return <Button variant="outline" icon={Download} onClick={onClick}>{label}</Button>
}

export function StoreIllustration({ name = 'IDOSI', accent = '#076a3d' }) {
  return (
    <div className="store-illustration" style={{ '--store-accent': accent }}>
      <div className="store-sign"><img src="/favicon.png" alt="" aria-hidden="true" /><strong>IDOSI</strong><small>{name}</small></div>
      <div className="store-awning"><i /><i /><i /><i /><i /><i /></div>
      <div className="store-front"><span /><span /><span /></div>
    </div>
  )
}

export function EmptyState({ title = 'Chưa có dữ liệu', description = 'Dữ liệu sẽ hiển thị tại đây.' }) {
  return <div className="empty"><Info size={28} /><strong>{title}</strong><span>{description}</span></div>
}
