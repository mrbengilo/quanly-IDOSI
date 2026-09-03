import { Badge } from './UI'
import { resolveSupportEmployeeTagContext } from '../domain/supportEmployeeTag'

export function SupportEmployeeTag({ context = null, className = '', ...resolverInput }) {
  const resolved = context || resolveSupportEmployeeTagContext(resolverInput)
  if (!resolved) return null
  const origin = resolved.homeStoreName || resolved.homeStoreId || 'cửa hàng khác'
  const destination = resolved.supportStoreName || resolved.supportStoreId || 'cửa hàng hỗ trợ'
  const label = `Nhân viên hỗ trợ • Từ ${origin}`
  return <span
    className={`support-employee-tag ${className}`.trim()}
    data-support-employee-tag="true"
    aria-label={label}
    title={`Nhân viên được điều chuyển từ ${origin} đến ${destination}`}
  >
    <Badge tone="orange">{label}</Badge>
  </span>
}

export default SupportEmployeeTag
