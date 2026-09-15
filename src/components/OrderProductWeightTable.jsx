import { Card, InfoNote, TableWrap } from './UI'
import { formatKg, weightTotalText } from './orderWeightFormat'
import './orderProductQuantity.css'

const pieceText = (value) => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('vi-VN') : '—'
const estimatedText = (weight) => !weight ? '—' : !weight.isComplete ? 'Chưa đủ dữ liệu'
  : `${weight.estimatedKg > 0 ? '≈ ' : ''}${formatKg(weight.estimatedKg)}`

export function OrderProductWeightTable({ rows, totals, scopeLabel = '' }) {
  const title = `Thống kê mặt hàng${scopeLabel ? ` • ${scopeLabel}` : ''}`
  return <section className="product-quantity-report" aria-label="Khối lượng hàng hóa theo mặt hàng">
    <Card title={title}>
      <p className="product-quantity-report__note">Mỗi mặt hàng một dòng. Số cái gồm bán thường và sale theo cái; kg ước tính quy đổi từ số cái, không gồm kg bán theo ký.</p>
      {!Array.isArray(rows) ? <InfoNote>Chưa tải được bảng mặt hàng của phạm vi này.</InfoNote> : !rows.length
        ? <InfoNote>Chưa có mặt hàng bán trong phạm vi đã chọn.</InfoNote>
        : <>
          <table className="product-quantity-table" aria-label={title}>
            <colgroup><col className="product-quantity-table__name" /><col /><col /></colgroup>
            <thead><tr><th scope="col">Mặt hàng</th><th scope="col">Số lượng đã bán (cái)</th><th scope="col">Khối lượng ước tính (kg)</th></tr></thead>
            <tbody>{rows.map((item) => <tr key={item.productId || item.productCode || item.productName}>
              <td>{item.productName || item.productCode || 'Mặt hàng'}</td>
              <td>{pieceText(item.totalQuantity)}</td>
              <td>{estimatedText(item.weight)}</td>
            </tr>)}</tbody>
            {totals && <tfoot><tr><th scope="row">Tổng</th><td>{pieceText(totals.totalQuantity)}</td><td>{estimatedText(totals.weight)}</td></tr></tfoot>}
          </table>
          {totals?.totalWeightKg > 0 && <p className="product-quantity-report__note">Bán theo ký: {formatKg(totals.totalWeightKg)} thực bán. Tổng khối lượng cả ba loại: {weightTotalText(totals.weight)}.</p>}
          <details className="product-quantity-report__details">
            <summary>Xem khối lượng chi tiết theo loại bán</summary>
            <TableWrap tableClassName="store-statistics-product-weight" paginate={false}>
              <thead><tr><th>Mặt hàng</th><th>Số đơn</th><th>Bán thường · kg quy đổi</th><th>Sale cái · kg quy đổi</th><th>Sale ký · kg thực bán</th><th>Tổng kg</th></tr></thead>
              <tbody>{rows.map((item) => <tr key={item.productId || item.productCode || item.productName}>
                <td data-label="Mặt hàng">{item.productName || item.productCode || 'Mặt hàng'}</td><td data-label="Số đơn">{item.orders}</td>
                <td data-label="Bán thường · kg quy đổi">{weightTotalText(item.weight?.byRevenueType?.NORMAL)}</td>
                <td data-label="Sale cái · kg quy đổi">{weightTotalText(item.weight?.byRevenueType?.SALE_PIECE)}</td>
                <td data-label="Sale ký · kg thực bán">{formatKg(item.weight?.byRevenueType?.SALE_KG?.actualKg)}</td>
                <td data-label="Tổng kg"><strong>{weightTotalText(item.weight)}</strong></td>
              </tr>)}</tbody>
            </TableWrap>
          </details>
        </>}
    </Card>
  </section>
}
