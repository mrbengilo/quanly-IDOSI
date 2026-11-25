import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, History, LockKeyhole, Percent, Plus, RefreshCcw, RotateCcw, Save, Trash2 } from 'lucide-react'
import './RevenueBonusSettingsPage.css'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InfoNote,
  Input,
  MoneyInput,
  PageHeader,
  Select,
  TableWrap,
} from '../../components/UI'
import { useApp } from '../../state/AppContext'
import { apiGetRevenueBonusConfigs } from '../../services/idosiApi'
import { calculateRevenueBonus, selectRevenueBonusTier } from '../../domain/compensationPolicies'
import {
  describeRevenueBonusTierRange,
  formatRateBasisPoints,
  formatRatePercent,
  parseRatePercentInput,
  parseRevenueThresholdInput,
  REVENUE_BONUS_CONFIG_SOURCE,
  REVENUE_BONUS_CONFIG_STATUS,
  REVENUE_BONUS_CONFIG_STORE_POLICIES,
  revenueBonusTiersFromThresholds,
  validateRevenueBonusEffectiveFrom,
  validateRevenueBonusTierRows,
} from '../../domain/revenueBonusConfig'
import { money, shortDateTime24 } from '../../utils'

let draftRowSequence = 0
const nextRowKey = () => {
  draftRowSequence += 1
  return `revenue-tier-${draftRowSequence}`
}

const displayDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—'
}

const actorName = (actor) => String(actor?.name || actor?.id || '').trim() || 'Không rõ'

const rowsFromThresholds = (thresholds = []) => thresholds.map((tier) => ({
  key: nextRowKey(),
  threshold: String(tier.thresholdVnd ?? tier.minimumRevenueVnd ?? ''),
  rate: formatRateBasisPoints(tier.rateBasisPoints),
}))

// A new draft starts from what will apply next: the scheduled table if one is
// waiting, otherwise the table in force today.
const initialDraft = (group, minimumEffectiveFrom) => {
  const pending = group?.pending?.[0] || null
  return {
    baseVersion: group.headVersion,
    effectiveFrom: pending?.effectiveFrom || minimumEffectiveFrom || '',
    rows: rowsFromThresholds(pending?.tiers || group?.current?.tiers || []),
  }
}

const parseDraftRows = (rows) => {
  const parsed = rows.map((row) => {
    const threshold = parseRevenueThresholdInput(row.threshold)
    const rate = parseRatePercentInput(row.rate)
    return {
      errors: {
        ...(threshold.ok ? {} : { thresholdVnd: threshold.message }),
        ...(rate.ok ? {} : { rateBasisPoints: rate.message }),
      },
      tier: { thresholdVnd: threshold.ok ? threshold.value : null, rateBasisPoints: rate.ok ? rate.basisPoints : null },
    }
  })
  const validation = validateRevenueBonusTierRows(parsed.map((entry) => entry.tier))
  const rowErrors = parsed.map((entry, index) => ({ ...validation.rowErrors[index], ...entry.errors }))
  const valid = validation.formErrors.length === 0 && rowErrors.every((errors) => !Object.keys(errors).length)
  return { valid, tiers: valid ? validation.tiers : [], rowErrors, formErrors: validation.formErrors }
}

const draftSignature = (draft) => JSON.stringify({
  effectiveFrom: draft?.effectiveFrom || '',
  rows: (draft?.rows || []).map((row) => [String(row.threshold).trim(), String(row.rate).trim()]),
})

const statusOf = (record, group, today) => {
  if (record.status === REVENUE_BONUS_CONFIG_STATUS.SUPERSEDED) return { label: 'Đã được thay thế', tone: 'red' }
  if (record.effectiveFrom > today) return { label: 'Chờ áp dụng', tone: 'orange' }
  if (group.currentRecord?.id === record.id) return { label: 'Đang áp dụng', tone: 'green' }
  return { label: 'Đã hết hiệu lực', tone: 'blue' }
}

function TierRangeTable({ tiers, label }) {
  return <TableWrap className="revenue-settings-range-table" tableLabel={label} paginate={false}>
    <thead><tr><th>Khoảng doanh thu ngày</th><th>Tỷ lệ thưởng</th></tr></thead>
    <tbody>{tiers.map((tier) => <tr key={tier.id}>
      <td>{describeRevenueBonusTierRange(tier)}</td>
      <td><strong>{formatRatePercent(tier.rateBasisPoints)}</strong></td>
    </tr>)}</tbody>
  </TableWrap>
}

export function RevenueBonusSettingsPage() {
  const app = useApp()
  const isAdmin = String(app.session?.role || '') === 'admin'
  const [loadState, setLoadState] = useState({ status: 'loading', data: null, error: '' })
  const [activePolicy, setActivePolicy] = useState(REVENUE_BONUS_CONFIG_STORE_POLICIES[0])
  const [selectedStoreIds, setSelectedStoreIds] = useState({})
  const [drafts, setDrafts] = useState({})
  const [baseDrafts, setBaseDrafts] = useState({})
  const [submitAttempted, setSubmitAttempted] = useState({})
  const [serverErrors, setServerErrors] = useState({})
  const [feedback, setFeedback] = useState({})
  const [saving, setSaving] = useState('')
  const [previewRevenue, setPreviewRevenue] = useState('')
  const loadSequence = useRef(0)

  const applyData = useCallback((data, { keepDraftIds = [] } = {}) => {
    setLoadState({ status: 'ready', data, error: '' })
    const stores = data.groups.flatMap((group) => group.stores)
    const keep = new Set(keepDraftIds)
    const fresh = Object.fromEntries(stores.map((store) => [store.storeId, initialDraft(store, data.minimumEffectiveFrom)]))
    const updateDrafts = (current) => Object.fromEntries(stores.map(({ storeId }) => [
      storeId, keep.has(storeId) && current[storeId] ? current[storeId] : fresh[storeId],
    ]))
    setDrafts(updateDrafts)
    setBaseDrafts(updateDrafts)
    const reset = Object.fromEntries(stores.filter(({ storeId }) => !keep.has(storeId)).map(({ storeId }) => [storeId, null]))
    setSubmitAttempted((current) => ({ ...current, ...reset }))
    setServerErrors((current) => ({ ...current, ...reset }))
  }, [])

  const load = useCallback(async ({ keepDraftIds } = {}) => {
    const sequence = loadSequence.current + 1
    loadSequence.current = sequence
    setLoadState((current) => ({ ...current, status: current.data ? 'refreshing' : 'loading', error: '' }))
    try {
      const data = await apiGetRevenueBonusConfigs()
      if (loadSequence.current !== sequence) return
      applyData(data, { keepDraftIds })
    } catch (error) {
      if (loadSequence.current !== sequence) return
      setLoadState((current) => ({
        ...current,
        status: error?.status === 403 ? 'unauthorized' : 'error',
        error: error?.message || 'Không thể tải cấu hình thưởng doanh thu.',
      }))
    }
  }, [applyData])

  useEffect(() => {
    if (!isAdmin) return undefined
    void load()
    return () => { loadSequence.current += 1 }
  }, [isAdmin, load])

  const dirtyStoreIds = useMemo(() => Object.keys(drafts).filter((id) => (
    baseDrafts[id] && draftSignature(drafts[id]) !== draftSignature(baseDrafts[id])
  )), [drafts, baseDrafts])

  useEffect(() => {
    if (!dirtyStoreIds.length) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirtyStoreIds.length])

  if (!isAdmin || loadState.status === 'unauthorized') {
    return <div className="page revenue-settings-page">
      <PageHeader
        title="Không có quyền truy cập"
        subtitle="Chỉ Admin được xem và cấu hình thưởng doanh thu ngày."
        icon={LockKeyhole}
      />
    </div>
  }

  const data = loadState.data
  const activeGroup = data?.groups.find((entry) => entry.storePolicy === activePolicy)
  const stores = activeGroup?.stores || []
  const group = stores.find((store) => store.storeId === selectedStoreIds[activePolicy])
    || (stores.length === 1 ? stores[0] : null)
  const storeId = group?.storeId || ''
  const draft = drafts[storeId] || { effectiveFrom: '', rows: [] }
  const storeName = group?.name || ''
  const parsed = parseDraftRows(draft.rows)
  const effectiveFromCheck = data ? validateRevenueBonusEffectiveFrom(draft.effectiveFrom, { now: Date.parse(`${data.today}T12:00:00+07:00`) }) : { ok: false }
  const showErrors = Boolean(submitAttempted[storeId])
  const serverError = serverErrors[storeId]
  const serverRowErrors = new Map((serverError?.details?.rowErrors || []).map(({ index, ...errors }) => [index, errors]))
  const rowErrorFor = (index) => ({
    ...(showErrors ? parsed.rowErrors[index] : {}),
    ...(serverRowErrors.get(index) || {}),
  })
  const effectiveFromError = (showErrors && !effectiveFromCheck.ok ? effectiveFromCheck.message : '')
    || serverError?.details?.fieldErrors?.effectiveFrom || ''
  const formErrors = [...new Set([...(showErrors ? parsed.formErrors : []), ...(serverError?.details?.formErrors || [])])]
  const previewTiers = parsed.valid ? revenueBonusTiersFromThresholds(parsed.tiers, { idPrefix: 'preview' }) : null
  const previewParsed = parseRevenueThresholdInput(previewRevenue)
  const previewRevenueVnd = previewRevenue === '' ? null : previewParsed.ok ? previewParsed.value : 0
  const previewResult = previewTiers && previewRevenueVnd != null && group
    ? calculateRevenueBonus({ programId: group.programId, revenueVnd: previewRevenueVnd, tiers: previewTiers })
    : null
  const previewTier = previewTiers && previewRevenueVnd != null && group
    ? selectRevenueBonusTier({ programId: group.programId, revenueVnd: previewRevenueVnd, tiers: previewTiers })
    : null
  const isDirty = dirtyStoreIds.includes(storeId)
  const isSaving = saving === storeId
  const groupFeedback = feedback[storeId] || null

  const updateDraft = (updater) => {
    setDrafts((current) => ({ ...current, [storeId]: updater(current[storeId] || draft) }))
    setServerErrors((current) => ({ ...current, [storeId]: null }))
    setFeedback((current) => ({ ...current, [storeId]: current[storeId]?.conflict ? current[storeId] : null }))
  }
  const updateRow = (key, field, value) => updateDraft((current) => ({
    ...current,
    rows: current.rows.map((row) => row.key === key ? { ...row, [field]: value } : row),
  }))
  const addRow = () => updateDraft((current) => ({ ...current, rows: [...current.rows, { key: nextRowKey(), threshold: '', rate: '' }] }))
  const removeRow = (key) => updateDraft((current) => ({ ...current, rows: current.rows.filter((row) => row.key !== key) }))
  const sortRows = () => updateDraft((current) => ({
    ...current,
    rows: current.rows.toSorted((left, right) => {
      const leftValue = parseRevenueThresholdInput(left.threshold)
      const rightValue = parseRevenueThresholdInput(right.threshold)
      if (!leftValue.ok || !rightValue.ok) return Number(rightValue.ok) - Number(leftValue.ok)
      return leftValue.value - rightValue.value
    }),
  }))
  const cancelEdit = () => {
    setDrafts((current) => ({ ...current, [storeId]: baseDrafts[storeId] }))
    setSubmitAttempted((current) => ({ ...current, [storeId]: false }))
    setServerErrors((current) => ({ ...current, [storeId]: null }))
    setFeedback((current) => ({ ...current, [storeId]: null }))
  }

  const save = async () => {
    if (saving || loadState.status !== 'ready' || !group) return
    setSubmitAttempted((current) => ({ ...current, [storeId]: true }))
    setFeedback((current) => ({ ...current, [storeId]: null }))
    if (!parsed.valid || !effectiveFromCheck.ok) return
    if (typeof app.saveRevenueBonusConfig !== 'function') {
      setFeedback((current) => ({ ...current, [storeId]: { tone: 'red', message: 'Cần kết nối máy chủ để lưu cấu hình thưởng doanh thu.' } }))
      return
    }
    const confirmed = window.confirm(
      `Lưu cấu hình thưởng doanh thu cho ${storeName} từ ${displayDate(effectiveFromCheck.value)}?`
      + (group.pending?.length ? ' Cấu hình đang chờ áp dụng sẽ được thay thế.' : '')
    )
    if (!confirmed) return
    setSaving(storeId)
    try {
      const result = await app.saveRevenueBonusConfig({
        storePolicy: activePolicy,
        storeId,
        effectiveFrom: effectiveFromCheck.value,
        tiers: parsed.tiers,
        baseVersion: draft.baseVersion,
      })
      const savedConfig = result?.revenueBonusConfig
      const keepDraftIds = dirtyStoreIds.filter((id) => id !== storeId)
      if (result?.groups) applyData(result, { keepDraftIds })
      else await load({ keepDraftIds })
      setFeedback((current) => ({
        ...current,
        [storeId]: {
          tone: 'green',
          message: `Đã lưu phiên bản ${savedConfig?.version ?? ''} cho ${storeName}, áp dụng từ ${displayDate(savedConfig?.effectiveFrom)}.`,
        },
      }))
    } catch (error) {
      if (error?.code === 'REVENUE_BONUS_CONFIG_CONFLICT') {
        setFeedback((current) => ({ ...current, [storeId]: { tone: 'red', conflict: true, message: error.message } }))
      } else if (error?.code === 'REVENUE_BONUS_CONFIG_VALIDATION') {
        setServerErrors((current) => ({ ...current, [storeId]: { details: error.details || {} } }))
        setFeedback((current) => ({ ...current, [storeId]: { tone: 'red', message: error.message } }))
      } else {
        setFeedback((current) => ({ ...current, [storeId]: { tone: 'red', message: error?.message || 'Không thể lưu cấu hình thưởng doanh thu.' } }))
      }
    } finally {
      setSaving('')
    }
  }

  const reloadLatest = async () => {
    setFeedback((current) => ({ ...current, [storeId]: null }))
    await load({ keepDraftIds: dirtyStoreIds.filter((id) => id !== storeId) })
  }

  return <div className="page revenue-settings-page">
    <PageHeader
      title="Cấu hình thưởng doanh thu ngày"
      subtitle="Chọn cửa hàng để đặt mốc doanh thu, tỷ lệ thưởng và ngày bắt đầu áp dụng."
      icon={Percent}
      actions={<Button variant="outline" icon={RefreshCcw} onClick={() => load({ keepDraftIds: dirtyStoreIds })} disabled={Boolean(saving) || loadState.status === 'loading' || loadState.status === 'refreshing'}>Tải lại</Button>}
    />

    {loadState.status === 'loading' && <Card><p className="revenue-settings-status" role="status">Đang tải cấu hình thưởng doanh thu…</p></Card>}
    {loadState.status === 'error' && <Card>
      <InfoNote tone="red">{loadState.error}</InfoNote>
      <div className="revenue-settings-actions"><Button icon={RefreshCcw} onClick={() => load()}>Thử lại</Button></div>
    </Card>}

    {data && activeGroup && <>
      <div className="tabs revenue-settings-tabs" role="tablist" aria-label="Nhóm cửa hàng">
        {(data.groups || []).map((entry) => {
          const dirty = entry.stores.some((store) => dirtyStoreIds.includes(store.storeId))
          return <button
            key={entry.storePolicy}
            type="button"
            role="tab"
            id={`revenue-settings-tab-${entry.storePolicy}`}
            aria-controls="revenue-settings-panel"
            aria-selected={entry.storePolicy === activePolicy}
            tabIndex={entry.storePolicy === activePolicy ? 0 : -1}
            className={entry.storePolicy === activePolicy ? 'active' : ''}
            onClick={() => { setActivePolicy(entry.storePolicy); setPreviewRevenue('') }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const tabs = [...event.currentTarget.parentElement.querySelectorAll('[role="tab"]')]
              const next = event.key === 'Home' ? tabs[0]
                : event.key === 'End' ? tabs.at(-1)
                  : tabs.find((tab) => tab !== event.currentTarget)
              next?.click()
              next?.focus()
            }}
          >
            {entry.label}
            {dirty && <span className="revenue-settings-dirty">Chưa lưu</span>}
          </button>
        })}
      </div>

      <div id="revenue-settings-panel" role="tabpanel" aria-labelledby={`revenue-settings-tab-${activePolicy}`} className="revenue-settings-panel">
        {stores.length ? <Card className="revenue-settings-store-picker">
          <Field label="Cửa hàng" required>
            <Select aria-label="Cửa hàng" value={storeId} onChange={(event) => {
              setSelectedStoreIds((current) => ({ ...current, [activePolicy]: event.target.value }))
              setPreviewRevenue('')
            }}>
              <option value="" disabled>Chọn cửa hàng</option>
              {stores.map((store) => <option key={store.storeId} value={store.storeId}>{store.name} · {store.code}</option>)}
            </Select>
          </Field>
        </Card> : <EmptyState title="Chưa có cửa hàng đang hoạt động trong nhóm này" />}
        {group && <>
        {groupFeedback && <InfoNote tone={groupFeedback.tone}>
          <span role={groupFeedback.tone === 'red' ? 'alert' : 'status'}>{groupFeedback.message}</span>
          {groupFeedback.conflict && <span className="revenue-settings-inline-action">
            {' '}Bản nháp của bạn vẫn được giữ trên màn hình.{' '}
            <Button variant="outline" icon={RefreshCcw} onClick={reloadLatest}>Tải bản mới nhất</Button>
          </span>}
        </InfoNote>}

        <div className="revenue-settings-grid">
          <Card
            className="revenue-settings-current"
            title={`Đang áp dụng hôm nay (${displayDate(data.today)})`}
            action={group.current.source === REVENUE_BONUS_CONFIG_SOURCE.LEGACY
              ? <Badge tone="blue">Bảng mặc định hệ thống</Badge>
              : <Badge tone="green">{group.currentRecord?.storeId ? 'Phiên bản' : 'Cấu hình nhóm · Phiên bản'} {group.current.version}</Badge>}
          >
            <p className="revenue-settings-meta">
              {group.current.source === REVENUE_BONUS_CONFIG_SOURCE.LEGACY
                ? 'Chưa có cấu hình nào của Admin có hiệu lực; hệ thống dùng bảng thưởng mặc định trước đây.'
                : <>Áp dụng từ {displayDate(group.current.effectiveFrom)} · Cập nhật bởi {actorName(group.currentRecord?.createdBy)} lúc {shortDateTime24(group.currentRecord?.createdAt)}</>}
            </p>
            <TierRangeTable tiers={group.current.tiers} label={`Cấu hình ${storeName} đang áp dụng`} />
            {group.pending?.map((record) => <InfoNote key={record.id} tone="orange">
              Cấu hình phiên bản {record.version} sẽ áp dụng từ {displayDate(record.effectiveFrom)} (bởi {actorName(record.createdBy)} lúc {shortDateTime24(record.createdAt)}). Lưu cấu hình mới sẽ thay thế bản chờ này.
            </InfoNote>)}
          </Card>

          <Card className="revenue-settings-preview" title="Xem trước thưởng theo %">
            <Field label="Doanh thu ngày giả định" hint="Chỉ tính phần thưởng theo tỷ lệ % của bản nháp bên dưới; chưa gồm thưởng mốc đội nhóm. Xem trước không lưu và không chốt thưởng.">
              <MoneyInput
                aria-label="Doanh thu ngày giả định"
                value={previewRevenue}
                onChange={(event) => setPreviewRevenue(event.target.value)}
                placeholder="Ví dụ 3.000.000"
              />
            </Field>
            {!previewTiers && <p className="revenue-settings-meta">Sửa các dòng chưa hợp lệ trong bản nháp để xem trước.</p>}
            {previewResult && <dl className="revenue-settings-preview-result" aria-live="polite">
              <div><dt>Khoảng được chọn</dt><dd>{previewTier ? describeRevenueBonusTierRange(previewTier) : 'Dưới mốc đầu tiên'}</dd></div>
              <div><dt>Tỷ lệ thưởng</dt><dd>{formatRatePercent(previewResult.rateBasisPoints)}</dd></div>
              <div><dt>Thưởng theo %</dt><dd><strong>{money(previewResult.bonusVnd)}</strong></dd></div>
            </dl>}
          </Card>
        </div>

        <Card
          className="revenue-settings-editor"
          title={`Soạn cấu hình mới cho ${storeName}`}
          action={isDirty ? <Badge tone="orange">Có thay đổi chưa lưu</Badge> : <Badge tone="blue">Chưa thay đổi</Badge>}
        >
          <fieldset className="revenue-settings-fields" disabled={Boolean(saving) || loadState.status === 'refreshing'}>
          <InfoNote tone="blue">
            Mốc đầu tiên áp dụng <strong>từ</strong> đúng mức doanh thu đó; mỗi mốc sau áp dụng khi doanh thu <strong>trên</strong> mốc. Tại đúng một mốc sau, tỷ lệ của khoảng trước vẫn được dùng. Một tỷ lệ duy nhất áp dụng cho toàn bộ doanh thu ngày, không cộng dồn hay lũy tiến; phần lẻ dưới 1 đồng được làm tròn xuống.
          </InfoNote>
          <div className="revenue-settings-date">
            <Field label="Ngày bắt đầu áp dụng" required error={effectiveFromError} hint={`Sớm nhất ${displayDate(data.minimumEffectiveFrom)} (ngày mai theo giờ Việt Nam). Không áp dụng hồi tố cho ngày đang vận hành.`}>
              <Input
                type="date"
                aria-label="Ngày bắt đầu áp dụng"
                min={data.minimumEffectiveFrom}
                value={draft.effectiveFrom}
                onChange={(event) => updateDraft((current) => ({ ...current, effectiveFrom: event.target.value }))}
              />
            </Field>
          </div>
          {formErrors.map((message) => <InfoNote key={message} tone="red"><span role="alert">{message}</span></InfoNote>)}
          {draft.rows.length ? <TableWrap className="revenue-settings-editor-table" tableLabel={`Bản nháp mốc thưởng ${storeName}`} paginate={false}>
            <thead><tr><th>STT</th><th>Mốc doanh thu (đồng)</th><th>Tỷ lệ thưởng (%)</th><th>Khoảng áp dụng thực tế</th><th>Xóa</th></tr></thead>
            <tbody>{draft.rows.map((row, index) => {
              const errors = rowErrorFor(index)
              const range = previewTiers ? describeRevenueBonusTierRange(previewTiers[index]) : '—'
              return <tr key={row.key}>
                <td>{index + 1}</td>
                <td>
                  <Field error={errors.thresholdVnd}>
                    <MoneyInput
                      aria-label={`Mốc doanh thu dòng ${index + 1}`}
                      aria-invalid={Boolean(errors.thresholdVnd) || undefined}
                      value={row.threshold}
                      onChange={(event) => updateRow(row.key, 'threshold', event.target.value)}
                    />
                  </Field>
                </td>
                <td>
                  <Field error={errors.rateBasisPoints}>
                    <Input
                      aria-label={`Tỷ lệ thưởng dòng ${index + 1} (%)`}
                      aria-invalid={Boolean(errors.rateBasisPoints) || undefined}
                      inputMode="decimal"
                      value={row.rate}
                      placeholder="Ví dụ 1,25"
                      onChange={(event) => updateRow(row.key, 'rate', event.target.value)}
                    />
                  </Field>
                </td>
                <td className="revenue-settings-range">{range}</td>
                <td>
                  <Button
                    variant="outline"
                    className="revenue-settings-icon-button"
                    icon={Trash2}
                    aria-label={`Xóa dòng ${index + 1}`}
                    title="Xóa dòng khỏi bản nháp"
                    onClick={() => removeRow(row.key)}
                  />
                </td>
              </tr>
            })}</tbody>
          </TableWrap> : <EmptyState title="Bản nháp chưa có mốc nào" description="Cần ít nhất một mốc thưởng; bảng trống không có nghĩa là tắt thưởng." />}
          <div className="revenue-settings-actions">
            <Button variant="outline" icon={Plus} onClick={addRow}>Thêm mốc</Button>
            <Button variant="outline" icon={ArrowDownUp} onClick={sortRows} disabled={draft.rows.length < 2}>Sắp xếp tăng dần</Button>
            <span className="revenue-settings-spacer" />
            <Button variant="outline" icon={RotateCcw} onClick={cancelEdit} disabled={!isDirty || isSaving}>Hủy chỉnh sửa</Button>
            <Button icon={Save} loading={isSaving} disabled={Boolean(saving) || loadState.status !== 'ready'} onClick={save}>{isSaving ? 'Đang lưu…' : 'Lưu cấu hình'}</Button>
          </div>
          </fieldset>
        </Card>

        <Card className="revenue-settings-history" title={<><History size={18} aria-hidden="true" /> Lịch sử cấu hình {storeName}</>}>
          {group.history?.length ? <TableWrap tableLabel={`Lịch sử cấu hình ${storeName}`} paginate={false}>
            <thead><tr><th>Phiên bản</th><th>Áp dụng từ</th><th>Trạng thái</th><th>Mốc và tỷ lệ</th><th>Người tạo</th></tr></thead>
            <tbody>{group.history.map((record) => {
              const status = statusOf(record, group, data.today)
              return <tr key={record.id}>
                <td><strong>{record.version}</strong></td>
                <td>{displayDate(record.effectiveFrom)}</td>
                <td><Badge tone={status.tone}>{status.label}</Badge></td>
                <td>{revenueBonusTiersFromThresholds(record.tiers).map((tier) => `${describeRevenueBonusTierRange(tier)}: ${formatRatePercent(tier.rateBasisPoints)}`).join('; ')}</td>
                <td>{actorName(record.createdBy)}<small className="revenue-settings-note">{shortDateTime24(record.createdAt)}</small></td>
              </tr>
            })}</tbody>
          </TableWrap> : <p className="revenue-settings-meta">Chưa có cấu hình riêng nào được lưu cho cửa hàng này.</p>}
        </Card>
        </>}
      </div>
    </>}
  </div>
}
