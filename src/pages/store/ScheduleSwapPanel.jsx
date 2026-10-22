import { useEffect, useRef, useState } from 'react'
import { Button, Field, Select } from '../../components/UI'
import { resolveScheduleSwapSelection, scheduleSwapEmployeeKeys, scheduleSwapRevision } from '../../domain/scheduleSwap'
import { sameScheduleIdentifier as same, scheduleAssignmentIsUsable } from '../../domain/supportScheduling'
import { scheduleShiftIds, scheduleShiftTimeLabel } from './scheduleView'

const emptySelection = () => ({ employeeId: '', assignmentId: '', shiftId: '', revision: '' })
const label = (shift) => `${shift?.name || shift?.id || 'Ca'} · ${scheduleShiftTimeLabel(shift)}`

export default function ScheduleSwapPanel({ app, storeId, date, employees }) {
  const [a, setA] = useState(emptySelection)
  const [b, setB] = useState(emptySelection)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const pending = useRef(false)
  const intent = useRef(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const state = { ...app, employees }
  const records = (app.schedule || []).filter((row) => same(row.storeId, storeId)
    && (row.date || row.workDate) === date && scheduleAssignmentIsUsable(row) && !row.projectionReadOnly)
  const candidates = employees.filter((employee) => records.some((row) => scheduleSwapEmployeeKeys(employee)
    .includes(String(row.employeeId || row.employeeCode || '').trim().toLowerCase())))
  const choices = (employeeId) => records.filter((row) => {
    const employee = candidates.find((item) => same(item.id || item.code, employeeId))
    return employee && scheduleSwapEmployeeKeys(employee).includes(String(row.employeeId || row.employeeCode || '').trim().toLowerCase())
  }).flatMap((row) => scheduleShiftIds(row).map((shiftId) => {
    const selection = { employeeId, assignmentId: row.id, shiftId, revision: scheduleSwapRevision(row) }
    try {
      const resolved = resolveScheduleSwapSelection(state, { storeId, date, selection })
      return { selection, shift: resolved.snapshot, key: JSON.stringify([row.id, shiftId]) }
    } catch (error) {
      return { selection, shift: row.shiftSnapshots?.find((item) => same(item.id, shiftId)) || { id: shiftId },
        key: JSON.stringify([row.id, shiftId]), error: error.message }
    }
  }))
  const changeEmployee = (side, employeeId) => {
    const eligible = choices(employeeId).filter((choice) => !choice.error)
    const next = eligible.length === 1 ? eligible[0].selection : { ...emptySelection(), employeeId }
    if (side === 'A') { setA(next); setB(emptySelection()) } else setB(next)
    setResult(null)
    intent.current = null
  }
  const selected = (value) => choices(value.employeeId).find((choice) => same(choice.selection.assignmentId, value.assignmentId)
    && same(choice.selection.shiftId, value.shiftId))
  const first = selected(a)
  const second = selected(b)
  const stale = (first && first.selection.revision !== a.revision) || (second && second.selection.revision !== b.revision)
  const validation = stale ? 'Lịch phân ca đã thay đổi, vui lòng chọn lại nhân viên và ca.'
    : first?.error || second?.error || (first && second && same(a.shiftId, b.shiftId) ? 'Hai ca giống nhau; hãy chọn hai ca khác nhau.' : '')
  const loading = app.remoteDataReady === false
  const ready = first && second && !validation && !saving && !loading
  const submit = async (event) => {
    event.preventDefault()
    if (!ready || pending.current) return
    const payload = { storeId, date, a, b }
    const signature = JSON.stringify(payload)
    if (intent.current?.signature !== signature) intent.current = { signature, key: `schedule.swap:${crypto.randomUUID()}` }
    pending.current = true
    setSaving(true)
    setResult(null)
    try {
      const response = await app.swapScheduleShifts(payload, intent.current.key)
      if (!mounted.current) return
      setResult(response)
      if (response.ok || response.code === 'VERSION_CONFLICT') {
        setA(emptySelection()); setB(emptySelection()); intent.current = null
      }
    } catch (error) {
      if (mounted.current) setResult({ ok: false, message: error.message || 'Mất kết nối. Hãy thử lại cùng thao tác.' })
    } finally {
      pending.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const renderSelection = (side, value, setter, excluded) => <fieldset disabled={saving} className="schedule-swap__person">
    <legend>Nhân viên {side}</legend>
    <Field label={`Chọn nhân viên ${side}`}><Select value={value.employeeId} onChange={(event) => changeEmployee(side, event.target.value)}>
      <option value="">Chọn nhân viên đã có lịch</option>
      {candidates.filter((employee) => !same(employee.id || employee.code, excluded)).map((employee) => <option key={employee.id || employee.code} value={employee.id || employee.code}>{employee.name} · {employee.code || employee.id}</option>)}
    </Select></Field>
    <Field label={`Ca cần đổi của ${side}`} hint="Nếu có nhiều ca đủ điều kiện, bạn cần chọn một ca cụ thể.">
      <Select aria-label={`Ca cần đổi của ${side}`} value={value.shiftId ? JSON.stringify([value.assignmentId, value.shiftId]) : ''} disabled={!value.employeeId} onChange={(event) => {
        setter(choices(value.employeeId).find((choice) => choice.key === event.target.value)?.selection || { ...emptySelection(), employeeId: value.employeeId })
        setResult(null); intent.current = null
      }}>
        <option value="">Chọn ca cần đổi</option>
        {choices(value.employeeId).map((choice) => <option key={choice.key} value={choice.key} disabled={Boolean(choice.error)}>{label(choice.shift)}{choice.error ? ' · Không đủ điều kiện' : ''}</option>)}
      </Select>
    </Field>
    <ul className="schedule-swap__shifts">{choices(value.employeeId).map((choice) => <li key={choice.key}>
      <strong>{label(choice.shift)}</strong>{choice.error && <small>{choice.error}</small>}
    </li>)}</ul>
  </fieldset>
  return <section className="schedule-swap" role="tabpanel" id="schedule-swap-panel" aria-labelledby="schedule-swap-tab">
    <h2>Đổi ca giữa hai nhân viên</h2>
    <p>Ngày {date.split('-').reverse().join('/')} · Chỉ đổi hai ca được chọn. Các ca còn lại và lịch sử công việc được giữ nguyên.</p>
    {loading ? <p role="status">Đang tải lịch phân ca…</p> : candidates.length < 2 && <p role="status">Chưa có đủ hai nhân viên có lịch trong ngày. Hãy chọn ngày khác hoặc kiểm tra lịch đã phân.</p>}
    <form onSubmit={submit} aria-busy={saving}>
      <div className="schedule-swap__columns">{renderSelection('A', a, setA, '')}{renderSelection('B', b, setB, a.employeeId)}</div>
      {first && second && <div className="schedule-swap__preview" aria-label="Kết quả sau khi đổi">
        <h3>Xem trước kết quả</h3>
        <p><strong>{candidates.find((employee) => same(employee.id || employee.code, a.employeeId))?.name}:</strong> {label(first.shift)} → {label(second.shift)}</p>
        <p><strong>{candidates.find((employee) => same(employee.id || employee.code, b.employeeId))?.name}:</strong> {label(second.shift)} → {label(first.shift)}</p>
      </div>}
      {validation && <p role="alert">{validation}</p>}
      {result && <p role={result.ok ? 'status' : 'alert'}>{result.ok ? 'Đã đổi ca thành công. Lịch của cả hai nhân viên đã được cập nhật.' : result.message}</p>}
      <Button type="submit" disabled={!ready} loading={saving}>Đổi ca</Button>
    </form>
  </section>
}
