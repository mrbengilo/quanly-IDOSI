import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  Info,
  LoaderCircle,
  Menu,
  Search,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { money } from '../utils'

export function Brand({ compact = false, blue = false, subtitle = 'hệ thống quản lý' }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''} ${blue ? 'brand--blue' : ''}`}>
      <span className="brand__mark" aria-hidden="true">I</span>
      <span className="brand__word">IDOSI</span>
      {!compact && <small>{subtitle}</small>}
    </div>
  )
}

export function Avatar({ name = 'IDOSI', color = '#dfece5', size = 38 }) {
  const initials = name
    .split(' ')
    .slice(-2)
    .map((item) => item[0])
    .join('')
    .toUpperCase()
  return (
    <span className="avatar" style={{ '--avatar-color': color, width: size, height: size }}>
      {initials}
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

export function Button({ children, variant = 'primary', icon: Icon, loading, className = '', ...props }) {
  return (
    <button className={`button button--${variant} ${className}`} {...props}>
      {loading ? <LoaderCircle className="spin" size={18} /> : Icon ? <Icon size={18} /> : null}
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

export function Input({ icon: Icon, className = '', ...props }) {
  return (
    <span className={`input-wrap ${className}`}>
      {Icon && <Icon size={18} />}
      <input {...props} />
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

const chartColors = { revenue: '#07883f', expense: '#f27018', profit: '#1476f2', hours: '#13a04c' }

export function FinancialChart({ data, type = 'line', keys = ['revenue', 'expense', 'profit'], height = 260, hideLegend = false }) {
  const common = {
    data,
    margin: { top: 8, right: 12, left: -18, bottom: 0 },
  }
  const content = keys.map((key) =>
    type === 'bar' ? (
      <Bar key={key} dataKey={key} fill={chartColors[key] || '#07883f'} radius={[5, 5, 0, 0]} />
    ) : type === 'area' ? (
      <Area
        key={key}
        type="monotone"
        dataKey={key}
        stroke={chartColors[key] || '#07883f'}
        fill={chartColors[key] || '#07883f'}
        fillOpacity={0.1}
        strokeWidth={2.3}
      />
    ) : (
      <Line
        key={key}
        type="monotone"
        dataKey={key}
        stroke={chartColors[key] || '#07883f'}
        strokeWidth={2.4}
        dot={{ r: 3 }}
        activeDot={{ r: 5 }}
      />
    ),
  )
  const axis = (
    <>
      <CartesianGrid stroke="#e9eeeb" strokeDasharray="2 2" vertical={false} />
      <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
      <YAxis tickLine={false} axisLine={false} fontSize={11} />
      <Tooltip formatter={(value) => [`${value} triệu`, '']} contentStyle={{ borderRadius: 10, borderColor: '#dfe7e2' }} />
      {!hideLegend && <Legend iconType="circle" />}
    </>
  )
  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {type === 'bar' ? (
          <BarChart {...common}>{axis}{content}</BarChart>
        ) : type === 'area' ? (
          <AreaChart {...common}>{axis}{content}</AreaChart>
        ) : (
          <LineChart {...common}>{axis}{content}</LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

export function DonutChart({ data, center, subcenter, height = 250 }) {
  const colors = ['#07883f', '#0fb278', '#f28b16', '#1976ed', '#6f48e8', '#ef4444']
  return (
    <div className="donut-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="60%" outerRadius="88%" paddingAngle={1}>
            {data.map((entry, index) => <Cell key={entry.name} fill={entry.color || colors[index % colors.length]} />)}
          </Pie>
          <Tooltip formatter={(value) => money(value)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center"><strong>{center}</strong><span>{subcenter}</span></div>
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
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true">
        <header><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={21} /></button></header>
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
      <div className="store-sign"><span>✦</span> IDOSI <small>{name.replace(/^IDOSI\s*/i, '')}</small></div>
      <div className="store-awning"><i /><i /><i /><i /><i /><i /></div>
      <div className="store-front"><span /><span /><span /></div>
    </div>
  )
}

export function EmptyState({ title = 'Chưa có dữ liệu', description = 'Dữ liệu sẽ hiển thị tại đây.' }) {
  return <div className="empty"><Info size={28} /><strong>{title}</strong><span>{description}</span></div>
}
