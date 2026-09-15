import { Card, TableWrap } from './UI'
import { formatKg, weightTotalText } from './OrderWeight'

export function OrderProductWeightTable({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return null
  return <section aria-label="Khối lượng hàng hóa theo mặt hàng">
    <Card title="Khối lượng hàng hóa theo mặt hàng">
      <small>Gộp cùng mặt hàng qua ba loại bán. Tổng kg gồm kg thực bán và kg quy đổi ước tính; không cộng lại các dòng tổng vào doanh thu.</small>
      <TableWrap tableClassName="store-statistics-product-weight" paginate={false}>
        <thead><tr><th>Mặt hàng</th><th>Số đơn</th><th>Bán thường · kg quy đổi</th><th>Sale cái · kg quy đổi</th><th>Sale ký · kg thực bán</th><th>Tổng kg</th></tr></thead>
        <tbody>{rows.map((item) => <tr key={item.productId || item.productCode || item.productName}>
          <td data-label="Mặt hàng">{item.productName || item.productCode || 'Chưa rõ mặt hàng'}</td>
          <td data-label="Số đơn">{item.orders}</td>
          <td data-label="Bán thường · kg quy đổi">{weightTotalText(item.weight?.byRevenueType.NORMAL)}</td>
          <td data-label="Sale cái · kg quy đổi">{weightTotalText(item.weight?.byRevenueType.SALE_PIECE)}</td>
          <td data-label="Sale ký · kg thực bán">{formatKg(item.weight?.byRevenueType.SALE_KG.actualKg)}</td>
          <td data-label="Tổng kg"><strong>{weightTotalText(item.weight)}</strong></td>
        </tr>)}</tbody>
      </TableWrap>
    </Card>
  </section>
}
