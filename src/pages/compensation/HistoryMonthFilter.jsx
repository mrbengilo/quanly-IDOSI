import { Button, Field, Input } from '../../components/UI'

export function HistoryMonthFilter({ label, groupLabel, value, onChange, children }) {
  return <div className={`compensation-history-filters compensation-month-filter${children ? ' compensation-month-filter--combined' : ''}`} role="group" aria-label={groupLabel}>
    {children}
    <Field label="Tháng (để trống để xem tất cả)">
      <Input type="month" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
    <Button variant="secondary" disabled={!value} onClick={() => onChange('')}>Tất cả tháng</Button>
  </div>
}
