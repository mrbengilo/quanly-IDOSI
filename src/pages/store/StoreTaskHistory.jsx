import { useEffect, useState } from 'react'
import { Button, Field, InfoNote, Input, Select } from '../../components/UI'
import { apiGetStoreTaskHistory, apiGetStoreScreenState } from '../../services/idosiApi'
import { useApp } from '../../state/AppContext'
import { today } from '../../utils'
import { ViolationManagementPage } from '../compensation/ViolationManagementPage'

// eslint-disable-next-line react-refresh/only-export-components
export function useStoreTaskHistory({ enabled, storeId, assignmentId, employees, shiftDefinitions }) {
  const scopeKey = JSON.stringify([storeId, assignmentId])
  const emptySelection = { scopeKey, date: '', employeeId: '', shiftId: '', cursors: [''] }
  const [storedSelection, setSelection] = useState(emptySelection)
  const selection = storedSelection.scopeKey === scopeKey ? storedSelection : emptySelection
  const [result, setResult] = useState(null)
  const [retry, setRetry] = useState(0)
  const cursor = selection.cursors.at(-1)
  const key = JSON.stringify([storeId, assignmentId, selection.date, selection.employeeId, selection.shiftId, cursor, retry])
  useEffect(() => {
    if (!enabled || !storeId) return
    const controller = new AbortController()
    let active = true
    apiGetStoreTaskHistory({ storeId, assignmentId, date: selection.date, employeeId: selection.employeeId,
      shiftId: selection.shiftId, cursor, signal: controller.signal }).then((payload) => {
      if (active) setResult({ key, payload })
    }).catch((error) => {
      if (active) setResult({ key, error: error.message || 'Không thể tải lịch sử công việc.' })
    })
    return () => { active = false; controller.abort() }
  }, [enabled, storeId, assignmentId, selection.date, selection.employeeId, selection.shiftId, cursor, key])
  const current = result?.key === key ? result : null
  const setFilter = (field, value) => setSelection({ ...selection, [field]: value, cursors: [''] })
  const controls = <>
    <div className="form-grid compensation-history-filters" role="group" aria-label="Bộ lọc lịch sử nhận thưởng">
      <Field label="Ngày"><Input type="date" aria-label="Ngày nhận thưởng" value={selection.date} onChange={(event) => setFilter('date', event.target.value)} /></Field>
      <Field label="Nhân viên"><Select aria-label="Nhân viên nhận thưởng" value={selection.employeeId} onChange={(event) => setFilter('employeeId', event.target.value)}>
        <option value="">Tất cả nhân viên</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name || employee.id}</option>)}
      </Select></Field>
      <Field label="Ca"><Select aria-label="Ca nhận thưởng" value={selection.shiftId} onChange={(event) => setFilter('shiftId', event.target.value)}>
        <option value="">Tất cả ca</option>{shiftDefinitions.map((shift) => <option key={shift.id} value={shift.id}>{shift.name || shift.id}</option>)}
      </Select></Field>
    </div>
    <InfoNote>Mỗi trang hiển thị thưởng của tối đa 10 lượt ca gần nhất. Tổng tiền và thống kê bên dưới thuộc trang đang xem.</InfoNote>
    {!current && <p role="status">Đang tải trang lịch sử...</p>}
    {current?.error && <InfoNote tone="red">{current.error} <Button onClick={() => setRetry((value) => value + 1)}>Thử lại</Button></InfoNote>}
  </>
  const pagination = <nav className="compensation-actions" aria-label="Phân trang lịch sử công việc">
    <Button variant="outline" disabled={!current?.payload || selection.cursors.length <= 1} onClick={() => setSelection({ ...selection, cursors: selection.cursors.slice(0, -1) })}>Trang trước</Button>
    <span>Trang {selection.cursors.length}</span>
    <Button variant="outline" disabled={!current?.payload?.page?.hasMore} onClick={() => setSelection({ ...selection, cursors: [...selection.cursors, current.payload.page.nextCursor] })}>Trang sau</Button>
  </nav>
  return { state: current?.payload?.state || { attendance: [], tasks: [], workCatalogProgress: [], compensationEntries: [], taskAssignmentHistory: [], violations: [] },
    ready: Boolean(current?.payload), controls, pagination }
}

export function StoreTaskViolations({ storeId }) {
  const app = useApp()
  const [scope, setScope] = useState({ period: today().slice(0, 7), occurredOn: today(), historyDate: '' })
  const [result, setResult] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const periods = [...new Set([scope.period, scope.occurredOn.slice(0, 7), scope.historyDate.slice(0, 7)].filter(Boolean))].sort().join(',')
  const key = `${storeId}:${periods}:${refresh}`
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    Promise.all(periods.split(',').map((period) => apiGetStoreScreenState(storeId, 'task-violations', { period, signal: controller.signal })))
      .then((pages) => {
        if (!active) return
        const state = { ...pages[0].state }
        for (const collection of ['attendance', 'schedule', 'violations', 'violationPointSummaries']) {
          state[collection] = [...new Map(pages.flatMap((page) => page.state[collection] || []).map((row) => [row.id, row])).values()]
        }
        setResult({ key, state })
      }).catch((error) => { if (active) setResult({ key, error: error.message }) })
    return () => { active = false; controller.abort() }
  }, [storeId, periods, key])
  const current = result?.key === key ? result : null
  const withRefresh = (action) => async (payload) => {
    const response = await action(payload)
    if (response?.ok !== false) setRefresh((value) => value + 1)
    return response
  }
  return <>
    {!current && <p role="status">Đang tải dữ liệu vi phạm theo kỳ...</p>}
    {current?.error && <InfoNote tone="red">{current.error} <Button onClick={() => setRefresh((value) => value + 1)}>Thử lại</Button></InfoNote>}
    <ViolationManagementPage targetUnit="store" storeId={storeId} embedded onScopeChange={setScope} dataLoading={!current?.state}
      data={{ ...(current?.state || { attendance: [], schedule: [], violations: [], violationPointSummaries: [] }),
        createViolationBatch: withRefresh(app.createViolationBatch), voidViolation: withRefresh(app.voidViolation) }} />
  </>
}
