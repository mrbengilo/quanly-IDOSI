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
import { useEffect, useRef, useState } from 'react'
import { loadEmployeeAvatarUrl, subscribeEmployeeAvatarUpdates } from '../services/employeeAvatarCache'

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

export function TableWrap({ children, className = '' }) {
  return (
    <div className={`table-scroll ${className}`}>
      <table>{children}</table>
    </div>
  )
}

export function TableFooter({ shown, total, page = 1, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(Number(total || 0) / Math.max(1, Number(shown || total || 1))))
  return (
    <div className="table-footer">
      <span>Hiển thị 1 - {shown} của {total} bản ghi</span>
      <div className="pagination">
        <button disabled={!onPageChange || page <= 1} onClick={() => onPageChange?.(page - 1)}>‹</button>
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
          <button
            key={pageNumber}
            className={pageNumber === page ? 'active' : ''}
            disabled={!onPageChange}
            onClick={() => onPageChange?.(pageNumber)}
          >{pageNumber}</button>
        ))}
        <button disabled={!onPageChange || page >= totalPages} onClick={() => onPageChange?.(page + 1)}>›</button>
      </div>
    </div>
  )
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
