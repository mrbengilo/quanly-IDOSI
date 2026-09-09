import { Badge, InfoNote } from '../../components/UI'
import { assessViolationPoints, formatViolationPoints, VIOLATION_POINT_MILESTONES } from '../../domain/violationPoints'

export function ViolationPointAssessment({ assessment, period }) {
  const current = assessment || assessViolationPoints(0)
  return <section className="violation-point-assessment" aria-label="Các mốc điểm vi phạm">
    {assessment && <div className="violation-point-total">
      <span>Kỳ {period?.split('-').reverse().join('/')} · {assessment.count || 0} vi phạm đang hiệu lực</span>
      <strong>{formatViolationPoints(current.points)} <Badge tone={current.tone}>{current.label}</Badge></strong>
    </div>}
    <table className="violation-milestones">
      <caption>Các mốc đánh giá trong kỳ</caption>
      <thead><tr><th>Điểm</th><th>Đánh giá và áp dụng</th></tr></thead>
      <tbody>{VIOLATION_POINT_MILESTONES.map((milestone) => <tr key={milestone.points} data-reached={current.points >= milestone.points} aria-current={current.threshold === milestone.points ? 'step' : undefined}>
        <td><strong>≥ {milestone.points}</strong></td>
        <td><strong>{milestone.label}</strong><span>{milestone.description}</span>{current.threshold === milestone.points && <b className="violation-current-label">Mốc hiện tại</b>}</td>
      </tr>)}</tbody>
    </table>
    {assessment && current.threshold >= 3 && <div role="alert"><InfoNote tone={current.tone}>{current.label}: {formatViolationPoints(current.points)} trong kỳ.{current.workBonusBlocked && ' Thưởng doanh thu và thưởng công việc của cả kỳ đều bằng 0, kể cả khoản phát sinh sau đó.'}</InfoNote></div>}
    <p className="violation-point-help">Điểm cộng dồn theo tháng, gồm cả ca hỗ trợ cửa hàng khác. Vi phạm đã hủy không tính điểm.</p>
  </section>
}
