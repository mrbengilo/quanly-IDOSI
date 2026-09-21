import { WEIGHT_CONVERSION_RULES, WEIGHT_TABLE_VERSION, itemWeight } from '../domain/orderWeight'
import { formatKg, weightRuleText, weightTotalText } from './orderWeightFormat'
import './orderWeight.css'

export function OrderWeightSummary({ weight, label = 'Khối lượng hàng hóa', compact = false }) {
  if (!weight) return null
  return <section className={`order-weight-summary ${compact ? 'is-compact' : ''}`} aria-label={label}>
    <div><span>Kg thực bán</span><strong>{formatKg(weight.actualKg)}</strong></div>
    <div><span>Kg quy đổi từ cái</span><strong>≈ {formatKg(weight.estimatedKg)}</strong></div>
    <div className="order-weight-summary__total"><span>Tổng khối lượng</span><strong>{weightTotalText(weight)}</strong></div>
    {!weight.isComplete && <small className="order-weight-summary__warning" role="note" aria-label="Dữ liệu khối lượng chưa đầy đủ">
      Đã xác định {formatKg(weight.knownKg)}. {weight.missingFactorLines > 0 && `${weight.missingFactorLines} dòng chưa có hệ số phù hợp. `}
      {weight.invalidLines > 0 && `${weight.invalidLines} dòng có số lượng chưa hợp lệ. `}
      {weight.unclassifiedOrders > 0 && `${weight.unclassifiedOrders} đơn chưa ghi nhận mặt hàng. `}
      Không coi phần thiếu là 0 kg.
    </small>}
  </section>
}

export function OrderItemWeight({ item }) {
  const weight = itemWeight(item)
  const name = item?.productName || item?.productCode || 'Mặt hàng'
  if (weight.basis === 'INVALID') return <small className="order-item-weight">Chưa đủ số lượng để tính kg</small>
  if (weight.kilograms === null) return <small className="order-item-weight order-item-weight--missing" aria-label={`Kết quả khối lượng ${name}`}>Chưa có hệ số quy đổi phù hợp</small>
  return <small className="order-item-weight" aria-label={`Kết quả khối lượng ${name}`}>
    {weight.basis === 'ACTUAL_KG'
      ? `${formatKg(weight.kilograms)} thực bán`
      : `${weightRuleText(weight)} → ≈ ${formatKg(weight.kilograms)}`}
  </small>
}

export function WeightConversionTable() {
  return <details className="order-weight-conversion">
    <summary>Bảng quy đổi cái → kg <span>{WEIGHT_CONVERSION_RULES.length} mặt hàng</span></summary>
    <p>Bán thường và sale theo cái áp dụng tỷ lệ từng mặt hàng. Riêng Chăn, ga, bao gối, nệm gòn: số cái × 3 kg. Sale theo ký giữ nguyên kg thực bán, không quy đổi lại.</p>
    <div role="table" aria-label="Bảng quy đổi cái sang kg" className="order-weight-conversion__table">
      <div role="row" className="order-weight-conversion__row is-heading"><span role="columnheader">Mặt hàng</span><span role="columnheader">Quy đổi</span></div>
      {WEIGHT_CONVERSION_RULES.map((rule) => <div role="row" className="order-weight-conversion__row" key={rule.id}>
        <span role="cell">{rule.productName}</span><span role="cell">{weightRuleText(rule)}</span>
      </div>)}
    </div>
    <small>Phiên bản {WEIGHT_TABLE_VERSION}. Kg quy đổi là ước tính, không phải kết quả cân; không thay đổi giá bán hoặc doanh thu. Đơn cũ được đối chiếu tên mặt hàng với bảng hiện hành; tên cũ hiển thị theo tên đang sử dụng. Snapshot gốc trên đơn vẫn được giữ để đối soát.</small>
  </details>
}
