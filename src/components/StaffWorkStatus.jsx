import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge, Button, Field, Modal, Select } from './UI'
import {
  canonicalEmployeeStatus,
  EMPLOYEE_STATUS,
  employeeStatusTone,
  staffWorkStatusLabel,
} from '../domain/employeeStatus'

export function StaffWorkStatus({ employee, onSave }) {
  const [selection, setSelection] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const status = canonicalEmployeeStatus(employee.status)
  const badge = <Badge tone={employeeStatusTone(status)}>{staffWorkStatusLabel(status)}</Badge>
  if (!onSave) return badge

  const close = () => {
    if (saving) return
    setSelection(null)
    setError('')
  }
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const result = await onSave(employee.id || employee.code, selection)
      if (result?.ok) setSelection(null)
      else setError(result?.message || 'Không thể cập nhật trạng thái làm việc.')
    } catch (failure) {
      setError(failure.message || 'Không thể cập nhật trạng thái làm việc.')
    } finally {
      setSaving(false)
    }
  }
  return <>
    <Button variant="outline" icon={ChevronDown} aria-label={`Đổi trạng thái làm việc của ${employee.name}`} aria-haspopup="dialog" onClick={() => setSelection(status)}>
      {badge}
    </Button>
    <Modal open={selection !== null} onClose={close} title="Đổi trạng thái làm việc" footer={<>
      <Button variant="outline" onClick={close} disabled={saving}>Hủy</Button>
      <Button onClick={save} loading={saving} disabled={selection === status || !Object.values(EMPLOYEE_STATUS).includes(selection)}>Lưu trạng thái</Button>
    </>}>
      <p><strong>{employee.name}</strong></p>
      <Field label="Trạng thái làm việc" error={error}
        hint={selection && selection !== EMPLOYEE_STATUS.ACTIVE && selection !== status
          ? 'Tài khoản sẽ bị ngưng đăng nhập cho đến khi chuyển lại sang Đang làm việc.'
          : undefined}>
        <Select value={selection ?? status} disabled={saving} aria-label="Trạng thái làm việc" onChange={(event) => setSelection(event.target.value)}>
          {!Object.values(EMPLOYEE_STATUS).includes(status) && <option value={status} disabled>{staffWorkStatusLabel(status)}</option>}
          {Object.values(EMPLOYEE_STATUS).map((value) => <option key={value} value={value}>{staffWorkStatusLabel(value)}</option>)}
        </Select>
      </Field>
    </Modal>
  </>
}
