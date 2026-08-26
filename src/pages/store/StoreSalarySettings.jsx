import { useMemo, useState } from 'react'
import { BadgeDollarSign, Save, ShieldCheck } from 'lucide-react'
import { Badge, Button, Card, Field, InfoNote, MoneyInput, PageHeader, Select, TableWrap } from '../../components/UI'
import {
  STORE_FULL_TIME_THRESHOLD_HOURS,
  defaultStoreFullTimeSalaryPolicy,
  effectiveStoreSalaryConfig,
} from '../../domain/storeTieredPayroll'
import { useApp } from '../../state/AppContext'
import { money, today } from '../../utils'

const profileId = (profile = {}) => String(profile.id || profile.code || profile.employeeId || '')
const normalize = (value) => String(value || '').trim().toLocaleLowerCase('vi-VN')
const isActiveFullTimeStoreEmployee = (employee, storeId) => (
  String(employee?.storeId || '') === String(storeId || '')
  && normalize(employee?.unit || employee?.unitType || 'store') === 'store'
  && normalize(employee?.employmentType) === 'full-time'
  && !employee?.deletedAt
  && !['đã nghỉ việc', 'inactive'].includes(normalize(employee?.status))
)

const roleOf = (session) => normalize(session?.role) === 'manager' ? 'business_support' : normalize(session?.role)

export function StoreSalarySettings() {
  const app = useApp()
  const role = roleOf(app.session)
  const canManage = ['admin', 'business_support'].includes(role)
  const store = app.activeStore
  const storeId = String(store?.id || '')
  const period = today().slice(0, 7)
  const employees = useMemo(() => (app.employees || [])
    .filter((employee) => isActiveFullTimeStoreEmployee(employee, storeId))
    .toSorted((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'vi-VN')),
  [app.employees, storeId])
  const defaults = useMemo(() => {
    try {
      return defaultStoreFullTimeSalaryPolicy(store)
    } catch {
      return null
    }
  }, [store])
  const [employeeId, setEmployeeId] = useState('')
  const selectedId = employees.some((employee) => profileId(employee) === employeeId)
    ? employeeId
    : profileId(employees[0])
  const currentConfig = useMemo(() => {
    if (!selectedId || !storeId || !defaults) return null
    return effectiveStoreSalaryConfig(
      app.storeEmployeeSalaryConfigs || [],
      { employeeId: selectedId, storeId, period, store },
    )
  }, [app.storeEmployeeSalaryConfigs, selectedId, storeId, period, store, defaults])
  const configuredForm = useMemo(() => ({
    regular: String(currentConfig?.standardHourlyRateVnd || defaults?.standardHourlyRateVnd || ''),
    excess: String(currentConfig?.excessHourlyRateVnd || defaults?.excessHourlyRateVnd || ''),
  }), [currentConfig, defaults])
  const formKey = `${selectedId}:${configuredForm.regular}:${configuredForm.excess}`
  const [formDraft, setFormDraft] = useState(null)
  const form = formDraft?.key === formKey ? formDraft : configuredForm
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!canManage) return <InfoNote tone="red">Chỉ Admin và Nhân viên hỗ trợ KD được truy cập Cài đặt lương.</InfoNote>

  const save = async (event) => {
    event.preventDefault()
    const regularHourlyRateVnd = Number(form.regular)
    const excessHourlyRateVnd = Number(form.excess)
    if (!selectedId || ![regularHourlyRateVnd, excessHourlyRateVnd].every((value) => Number.isSafeInteger(value) && value > 0)) {
      setError('Vui lòng chọn nhân viên và nhập hai mức lương theo giờ lớn hơn 0.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await app.setStoreEmployeeSalaryConfig({
        employeeId: selectedId,
        storeId,
        thresholdHours: STORE_FULL_TIME_THRESHOLD_HOURS,
        regularHourlyRateVnd,
        excessHourlyRateVnd,
        effectiveFrom: period,
      })
      app.notify?.(`Đã lưu cấu hình lương Full-Time từ tháng ${period.slice(5, 7)}/${period.slice(0, 4)}.`)
      if (result?.salaryConfig) {
        setFormDraft({
          key: `${selectedId}:${result.salaryConfig.standardHourlyRateVnd || result.salaryConfig.regularHourlyRateVnd}:${result.salaryConfig.excessHourlyRateVnd}`,
          regular: String(result.salaryConfig.standardHourlyRateVnd || result.salaryConfig.regularHourlyRateVnd),
          excess: String(result.salaryConfig.excessHourlyRateVnd),
        })
      }
    } catch (saveError) {
      setError(saveError?.message || 'Không thể lưu cấu hình lương.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="page store-salary-settings-page">
    <PageHeader
      title="CÀI ĐẶT LƯƠNG FULL-TIME"
      subtitle={`Thiết lập lương theo giờ cho ${store?.name || 'cửa hàng đang chọn'}; lịch sử bảng lương đã chốt không bị thay đổi.`}
      icon={BadgeDollarSign}
    />
    <Card title="Cấu hình theo nhân viên">
      {!defaults && <InfoNote tone="red">Cửa hàng này chưa thuộc nhóm chính sách lương Dosii hoặc SM TNV.</InfoNote>}
      <form className="form-grid" onSubmit={save}>
        <Field label="Nhân viên Full-Time" required>
          <Select value={selectedId} onChange={(event) => {
            setEmployeeId(event.target.value)
            setFormDraft(null)
            setError('')
          }} disabled={!employees.length || busy}>
            {!employees.length && <option value="">Chưa có nhân viên Full-Time</option>}
            {employees.map((employee) => <option key={profileId(employee)} value={profileId(employee)}>{employee.name} — {profileId(employee)}</option>)}
          </Select>
        </Field>
        <Field label={`Lương/giờ khi ≤ ${STORE_FULL_TIME_THRESHOLD_HOURS} giờ`} required hint="Nhập số tiền thực tế bằng đồng">
          <MoneyInput value={form.regular} onChange={(event) => setFormDraft({ ...form, key: formKey, regular: event.target.value })} disabled={!employees.length || busy} />
        </Field>
        <Field label={`Lương/giờ phần vượt ${STORE_FULL_TIME_THRESHOLD_HOURS} giờ`} required hint="Chỉ áp dụng cho số giờ vượt ngưỡng">
          <MoneyInput value={form.excess} onChange={(event) => setFormDraft({ ...form, key: formKey, excess: event.target.value })} disabled={!employees.length || busy} />
        </Field>
        <div className="span-2"><InfoNote><strong>Công thức</strong><br />
          Tối đa {STORE_FULL_TIME_THRESHOLD_HOURS} giờ × {money(Number(form.regular) || 0)}/giờ; phần vượt × {money(Number(form.excess) || 0)}/giờ.
        </InfoNote></div>
        {error && <div className="span-2"><InfoNote tone="red">{error}</InfoNote></div>}
        <Button type="submit" icon={Save} loading={busy} disabled={!defaults || !employees.length || busy}>LƯU CẤU HÌNH</Button>
      </form>
    </Card>
    <Card title="Cấu hình đang áp dụng" action={<Badge tone="blue">Ngưỡng {STORE_FULL_TIME_THRESHOLD_HOURS} giờ/tháng</Badge>}>
      <TableWrap>
        <thead><tr><th>Nhân viên</th><th>Từ tháng</th><th>Đến {STORE_FULL_TIME_THRESHOLD_HOURS} giờ</th><th>Phần vượt</th><th>Nguồn cấu hình</th></tr></thead>
        <tbody>{employees.map((employee) => {
          const id = profileId(employee)
          const config = defaults
            ? effectiveStoreSalaryConfig(app.storeEmployeeSalaryConfigs || [], { employeeId: id, storeId, period, store })
            : null
          const policy = config || defaults
          return <tr key={id}><td><strong>{employee.name}</strong><small className="table-sub">{id}</small></td><td>{config?.effectiveFrom || 'Áp dụng mặc định'}</td><td><strong>{policy ? `${money(policy.standardHourlyRateVnd)}/giờ` : '—'}</strong></td><td><strong>{policy ? `${money(policy.excessHourlyRateVnd)}/giờ` : '—'}</strong></td><td>{config ? <Badge tone="green"><ShieldCheck size={14} /> Đã cài đặt</Badge> : <Badge tone="orange">Mặc định an toàn</Badge>}</td></tr>
        })}{!employees.length && <tr><td colSpan="5">Chưa có nhân viên Full-Time để cài đặt.</td></tr>}</tbody>
      </TableWrap>
    </Card>
  </div>
}

export default StoreSalarySettings
