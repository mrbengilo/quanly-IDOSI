import { Plus, Trash2 } from 'lucide-react'
import { Button, Field, InfoNote, Input } from '../../components/UI'
import {
  MAX_PROFILE_WORK_SHIFTS,
  WORK_TIME_TYPES,
  nextAvailableWorkShift,
  normalizeWorkingTimeForm,
} from './workingTime'
import './working-time.css'

export function WorkingTimeFields({ form, onChange }) {
  const normalized = normalizeWorkingTimeForm(form, form.employmentType)
  const fixed = normalized.workTimeType === WORK_TIME_TYPES.fixed
  const updateShift = (index, field, value) => {
    const workShifts = normalized.workShifts.map((shift, shiftIndex) => (
      shiftIndex === index ? { ...shift, [field]: value } : shift
    ))
    onChange({
      ...normalized,
      workStart: workShifts[0].start,
      workEnd: workShifts[0].end,
      workShifts,
    })
  }
  const addShift = () => {
    if (normalized.workShifts.length >= MAX_PROFILE_WORK_SHIFTS) return
    const workShifts = [...normalized.workShifts, nextAvailableWorkShift(normalized.workShifts)]
    onChange({ ...normalized, workShifts })
  }
  const removeShift = (index) => {
    if (normalized.workShifts.length <= 1) return
    const workShifts = normalized.workShifts.filter((_, shiftIndex) => shiftIndex !== index)
    onChange({ ...normalized, workStart: workShifts[0].start, workEnd: workShifts[0].end, workShifts })
  }

  return <section className="working-time-fields" aria-label="Cấu hình thời gian làm việc">
    <InfoNote>
      <strong>{fixed ? 'Full-Time · khung giờ cố định' : `${form.employmentType} · ca làm linh hoạt`}</strong>
      <span>{fixed ? ' Thiết lập một giờ bắt đầu và kết thúc áp dụng hằng ngày.' : ' Có thể thêm một hoặc nhiều ca có tên để nhân viên chọn khi điểm danh.'}</span>
    </InfoNote>
    <div className="working-time-fields__list">
      {normalized.workShifts.map((shift, index) => <div className="working-time-fields__row" key={shift.id || index}>
        <Field label={fixed ? 'Tên khung giờ' : `Tên ca ${index + 1}`} required>
          <Input value={shift.name} onChange={(event) => updateShift(index, 'name', event.target.value)} placeholder={fixed ? 'Giờ hành chính' : `Ca ${index + 1}`} />
        </Field>
        <Field label="Giờ bắt đầu (24 giờ)" required>
          <Input type="time" value={shift.start} onChange={(event) => updateShift(index, 'start', event.target.value)} />
        </Field>
        <Field label="Giờ kết thúc (24 giờ)" required>
          <Input type="time" value={shift.end} onChange={(event) => updateShift(index, 'end', event.target.value)} />
        </Field>
        {!fixed && <button className="working-time-fields__remove" type="button" onClick={() => removeShift(index)} disabled={normalized.workShifts.length <= 1} aria-label={`Xóa ${shift.name || `ca ${index + 1}`}`} title="Xóa ca"><Trash2 size={18} /></button>}
      </div>)}
    </div>
    {!fixed && <Button type="button" variant="outline" icon={Plus} onClick={addShift} disabled={normalized.workShifts.length >= MAX_PROFILE_WORK_SHIFTS}>Thêm ca làm việc</Button>}
  </section>
}
