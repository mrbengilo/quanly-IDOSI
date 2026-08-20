import { useMemo, useState } from 'react'
import { CalendarClock, Save, UserRound } from 'lucide-react'
import { Button, Field, InfoNote, Input, Modal, Select } from '../../components/UI'
import { resolveEffectiveWorkingTime } from '../../domain/workTimeSchedule'
import { shortDate, today } from '../../utils'
import { WorkingTimeFields } from './WorkingTimeFields'
import {
  normalizeWorkingTimeForm,
  validateWorkingTime,
  workingTimePayload,
} from './workingTime'

const profileId = (profile = {}) => String(profile.id || profile.code || profile.employeeCode || '')
const employmentType = (profile = {}) => {
  const value = String(profile.employmentType || profile.officeEmployeeType || profile.officeEmploymentType || 'Full-Time')
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('vi-VN')
  if (normalized.includes('thuc tap')) return 'Thực Tập Sinh'
  return normalized.includes('part') ? 'Part-Time' : 'Full-Time'
}

export function WorkingTimeSettingsModal({
  open,
  ...props
}) {
  if (!open) return null
  return <WorkingTimeSettingsDialog {...props} />
}

function WorkingTimeSettingsDialog({
  initialEmployeeId = '',
  onClose,
  onSave,
  profiles = [],
  title = 'Cài đặt thời gian làm việc',
}) {
  const initialDate = today()
  const initialSelectedId = profiles.some((profile) => profileId(profile) === initialEmployeeId)
    ? initialEmployeeId
    : ''
  const [effectiveFrom, setEffectiveFrom] = useState(initialDate)
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const [form, setForm] = useState(() => {
    const profile = profiles.find((item) => profileId(item) === initialSelectedId)
    if (!profile) return null
    const type = employmentType(profile)
    return {
      employmentType: type,
      ...normalizeWorkingTimeForm(resolveEffectiveWorkingTime(profile, initialDate), type),
    }
  })
  const [errors, setErrors] = useState([])
  const [saving, setSaving] = useState(false)
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profileId(profile) === selectedId) || null,
    [profiles, selectedId],
  )
  const resolved = selectedProfile
    ? resolveEffectiveWorkingTime(selectedProfile, effectiveFrom)
    : null

  const loadConfiguration = (employeeId, date) => {
    const profile = profiles.find((item) => profileId(item) === employeeId)
    if (!profile) {
      setForm(null)
      return
    }
    const type = employmentType(profile)
    const effective = resolveEffectiveWorkingTime(profile, date)
    setForm({ employmentType: type, ...normalizeWorkingTimeForm(effective, type) })
  }

  const changeEffectiveFrom = (event) => {
    const date = event.target.value
    setEffectiveFrom(date)
    setErrors([])
    if (selectedId) loadConfiguration(selectedId, date)
  }

  const changeEmployee = (event) => {
    const employeeId = event.target.value
    setSelectedId(employeeId)
    setErrors([])
    loadConfiguration(employeeId, effectiveFrom)
  }

  const save = async () => {
    if (!selectedProfile || !form || saving) return
    const validationErrors = validateWorkingTime(form)
    if (!effectiveFrom) validationErrors.unshift('Cần chọn ngày áp dụng.')
    if (validationErrors.length) {
      setErrors([...new Set(validationErrors)])
      return
    }
    setSaving(true)
    try {
      const result = await onSave?.(profileId(selectedProfile), {
        effectiveFrom,
        ...workingTimePayload(form),
      })
      if (result?.ok === false) {
        setErrors([result.message || 'Không thể lưu thời gian làm việc.'])
        return
      }
      onClose?.()
    } catch (error) {
      setErrors([error?.message || 'Không thể lưu thời gian làm việc.'])
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    wide
    open
    onClose={onClose}
    title={title}
    footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Hủy</Button><Button icon={Save} onClick={save} loading={saving} disabled={!selectedProfile || !form || saving}>LƯU</Button></>}
  >
    <div className="form-stack working-time-settings">
      {errors.length > 0 && <InfoNote tone="orange"><strong>Chưa thể lưu cài đặt</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></InfoNote>}
      <div className="form-grid working-time-settings__selectors">
        <Field label="Ngày áp dụng" required hint="Cấu hình có hiệu lực từ ngày này cho đến khi có mốc mới.">
          <Input icon={CalendarClock} type="date" value={effectiveFrom} onChange={changeEffectiveFrom} aria-label="Ngày áp dụng thời gian làm việc" />
        </Field>
        <Field label="Nhân viên" required hint="Chọn nhân viên trước khi cài đặt khung giờ hoặc ca làm.">
          <Select icon={UserRound} value={selectedId} onChange={changeEmployee} aria-label="Chọn nhân viên cài đặt thời gian làm việc">
            <option value="">Chọn nhân viên</option>
            {profiles.map((profile) => <option key={profileId(profile)} value={profileId(profile)}>{profileId(profile)} — {profile.name} · {employmentType(profile)}</option>)}
          </Select>
        </Field>
      </div>
      {!selectedProfile && <InfoNote>Chọn nhân viên để hiển thị cấu hình đang có hiệu lực tại ngày đã chọn.</InfoNote>}
      {selectedProfile && form && <>
        <InfoNote>
          <strong>{selectedProfile.name} · {form.employmentType}</strong>
          <span>{resolved?.workTimeEffectiveFrom
            ? ` Đang hiển thị cấu hình có hiệu lực từ ${shortDate(resolved.workTimeEffectiveFrom)}.`
            : ' Đang dùng giờ làm mặc định trong hồ sơ.'}</span>
        </InfoNote>
        <WorkingTimeFields form={form} onChange={(workingTime) => setForm((current) => ({ ...current, ...workingTime }))} />
      </>}
      <InfoNote>Từ mốc đã lưu, hệ thống tự dùng lại giờ làm cho các ngày sau. Các lượt chấm công cũ giữ nguyên bản chụp ca làm đã ghi nhận.</InfoNote>
    </div>
  </Modal>
}
