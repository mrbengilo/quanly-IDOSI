import { useCallback, useMemo } from 'react'
import { Card } from '../../components/UI'
import { resolveSupportEmployeeTagContext } from '../../domain/supportEmployeeTag'
import { useApp } from '../../state/AppContext'
import {
  employeesForTarget,
  entryStoreId,
  targetUnitOfViolation,
} from './compensationViewModel'
import { rewardStatistics, violationStatistics, workRewardRows } from './compensationStatistics'
import { CompensationStatisticsGrid, RewardHistoryTable } from './CompensationStatisticsTables'
import './compensation-page.css'

const UNIT_LABELS = {
  store: 'cửa hàng',
  office: 'Khối văn phòng',
  business_support: 'HTKD',
}

/**
 * Shared read-only reporting block for Store Operations, Office Management and
 * Admin HTKD screens. Mutations remain in their dedicated workflow panels.
 */
export function UnitCompensationStatistics({ targetUnit, storeId = '', employees, sections = 'all', rewardRows: providedRewardRows }) {
  const app = useApp()
  const scopedEmployees = useMemo(() => (Array.isArray(employees)
    ? employees
    : employeesForTarget({ employees: app.employees, targetUnit, storeId })), [employees, app.employees, targetUnit, storeId])
  const computedRewardRows = useMemo(() => workRewardRows({
    attendance: app.attendance,
    workCatalogProgress: app.workCatalogProgress,
    compensationEntries: app.compensationEntries,
    tasks: app.tasks,
    employees: scopedEmployees,
    targetUnit,
    storeId,
  }), [app.attendance, app.workCatalogProgress, app.compensationEntries, app.tasks, scopedEmployees, targetUnit, storeId])
  const rewardRows = Array.isArray(providedRewardRows) ? providedRewardRows : computedRewardRows
  const violationRows = useMemo(() => (Array.isArray(app.violations) ? app.violations : [])
    .filter((entry) => targetUnitOfViolation(entry) === targetUnit)
    .filter((entry) => !storeId || entryStoreId(entry) === String(storeId)), [app.violations, targetUnit, storeId])
  const rewardSummary = useMemo(() => rewardStatistics(rewardRows), [rewardRows])
  const violationSummary = useMemo(() => violationStatistics(violationRows), [violationRows])
  const unitLabel = UNIT_LABELS[targetUnit] || 'đơn vị'
  const supportTagContextForRewardRow = useCallback((row) => targetUnit === 'store'
    ? resolveSupportEmployeeTagContext({
        record: row,
        employeeId: row.employeeId,
        storeId: row.storeId || storeId,
        businessDate: row.workDate || row.businessDate || row.date,
        employees: app.employees,
        stores: app.stores,
        supportTransfers: app.supportTransfers,
      })
    : null, [app.employees, app.stores, app.supportTransfers, storeId, targetUnit])

  const showReward = sections === 'all' || sections === 'reward'
  const showViolation = sections === 'all' || sections === 'violation'

  return <div className="compensation-unit-statistics">
    {showReward && <Card title={`Lịch sử nhận thưởng — ${unitLabel}`}>
      <RewardHistoryTable
        key={`${targetUnit}:${storeId}`}
        rows={rewardRows}
        employees={scopedEmployees}
        showEmployee
        filterable={targetUnit === 'store'}
        supportTagContextForRow={supportTagContextForRewardRow}
      />
    </Card>}
    {showReward && <Card title={`Thống kê thưởng — ${unitLabel}`}>
      <CompensationStatisticsGrid statistics={rewardSummary} employees={scopedEmployees} showEmployee mode="reward" />
    </Card>}
    {showViolation && <Card title={`Thống kê vi phạm và đánh giá — ${unitLabel}`}>
      <CompensationStatisticsGrid statistics={violationSummary} employees={scopedEmployees} showEmployee mode="violation" />
    </Card>}
  </div>
}
