import { Card } from '../../components/UI'
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
export function UnitCompensationStatistics({ targetUnit, storeId = '', employees }) {
  const app = useApp()
  const scopedEmployees = Array.isArray(employees)
    ? employees
    : employeesForTarget({ employees: app.employees, targetUnit, storeId })
  const rewardRows = workRewardRows({
    attendance: app.attendance,
    workCatalogProgress: app.workCatalogProgress,
    tasks: app.tasks,
    employees: scopedEmployees,
    targetUnit,
    storeId,
  })
  const violationRows = (Array.isArray(app.violations) ? app.violations : [])
    .filter((entry) => targetUnitOfViolation(entry) === targetUnit)
    .filter((entry) => !storeId || entryStoreId(entry) === String(storeId))
  const unitLabel = UNIT_LABELS[targetUnit] || 'đơn vị'

  return <div className="compensation-unit-statistics">
    <Card title={`Lịch sử nhận thưởng — ${unitLabel}`}>
      <RewardHistoryTable rows={rewardRows} employees={scopedEmployees} showEmployee />
    </Card>
    <Card title={`Thống kê thưởng — ${unitLabel}`}>
      <CompensationStatisticsGrid statistics={rewardStatistics(rewardRows)} employees={scopedEmployees} showEmployee mode="reward" />
    </Card>
    <Card title={`Thống kê vi phạm và đánh giá — ${unitLabel}`}>
      <CompensationStatisticsGrid statistics={violationStatistics(violationRows)} employees={scopedEmployees} showEmployee mode="violation" />
    </Card>
  </div>
}
