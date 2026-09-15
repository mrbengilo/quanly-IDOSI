# IDOSI — Ba loại doanh thu đơn hàng

## Phạm vi và điều kiện nghiệm thu

- `NORMAL`: bán thường, giữ luồng chọn mặt hàng/số cái và nhập tổng tiền hiện tại.
- `SALE_KG`: hàng sale bán theo kg (tối đa 3 số thập phân).
- `SALE_PIECE`: hàng sale bán theo cái (số nguyên).
- Một đơn có thể chứa nhiều loại. Mỗi cặp mặt hàng/loại bán chỉ có một dòng; cùng mặt hàng ở loại khác được phép.
- Đơn có hàng sale hoặc đơn giá dòng phải nhập đơn giá cho **tất cả** dòng, gồm hàng thường. Backend tính lại thành tiền, không tin `lineTotal` từ trình duyệt. Tổng gửi lên phải khớp tổng dòng.
- Nhân viên chỉ xem đơn do chính mình tạo và doanh thu của mình trong ca; không dùng doanh thu toàn ca/cửa hàng. Backend lọc người tạo trước khi phân trang và tổng hợp, không chỉ ẩn UI.
- Cửa hàng xem đơn và 4 chỉ số (bán thường, sale kg, sale cái, tổng) trong đúng cửa hàng, theo ca/ngày/tháng. Tổng không phụ thuộc trang danh sách hiện tại.
- Bốn thẻ nằm một hàng desktop, hai cột mobile. Loại không phát sinh vẫn 0đ; đang tải/không có breakdown là dấu `—`, lỗi phải báo lỗi, không biến thành 0đ.

## Cấu trúc dòng hàng

Giữ trường hiện tại `productId`, `productCode`, `productName` và `quantity`. Dòng có giá thêm:

```json
{
  "productId": "order-product-001",
  "productCode": "NAM",
  "productName": "Đồ nam",
  "revenueType": "SALE_KG",
  "unit": "KG",
  "quantity": 2.5,
  "unitPrice": 20000,
  "discountAmount": 0,
  "lineTotal": 50000
}
```

`NORMAL`/`SALE_PIECE` dùng `PIECE`; `SALE_KG` dùng `KG`. Không cho gửi loại/đơn vị mâu thuẫn. Kg được đổi sang số gram nguyên để tính tiền bằng BigInt, làm tròn nửa lên tại dòng, sau đó trừ giảm giá dòng. VND là số nguyên, không âm; giảm giá không vượt tiền dòng. Tiền tối đa mỗi đơn 100.000.000.000đ.

Đơn thường cũ không có đơn giá: giữ nguyên dữ liệu và tổng tiền, phân loại tổng vào NORMAL. Không bịa phân bổ giá cho mặt hàng cũ. Không có SQL migration vì dòng hàng vẫn được lưu trong JSON `state_entities`; không reset/xóa dữ liệu. Không tự thay đổi doanh thu tính lương/thưởng. Các quy tắc khóa kỳ, audit chỉnh sửa và xóa mềm hiện có vẫn áp dụng.

Giao diện hiển thị giảm giá **từng dòng**. Phạm vi này không bổ sung giảm giá toàn đơn/hoàn hàng một phần hoặc tự trừ tồn kho; đó không phải chức năng đã hoàn thành trong thay đổi này.

## API cho KHOHANG-IDOSI

Mở rộng endpoint hiện có, không tạo một nguồn tính khác:

```http
GET /api/integrations/warehouse/order-statistics?storeId=S01&period=2026-09
Authorization: Bearer <WAREHOUSE_API_KEY>
```

Máy chủ kho gọi máy chủ IDOSI. Khóa cấu hình server `WAREHOUSE_API_KEY` tối thiểu 32 ký tự; không đưa vào mã frontend hoặc repo. Có thể dùng `X-IDOSI-Warehouse-Key` thay Bearer. Thiếu cấu hình trả 503, sai khóa trả 401, origin không được phép trả 403. CORS chỉ cho origin được cấu hình. Khóa này chỉ cấp quyền đọc thống kê, không dùng để tạo/sửa đơn.

`storeId` và `period` bắt buộc, mỗi request một cửa hàng đang hoạt động. Bộ lọc bổ sung: `date=YYYY-MM-DD`, `shiftId`, `paymentMethod`. Ngày phải thuộc tháng; tham số lạ hoặc lặp bị từ chối. Kiểm tra envelope thành công/lỗi của API trước khi sử dụng số liệu.

Các trường trong payload thành công (ví dụ số liệu một đơn kết hợp):

```json
{
  "apiVersion": 1,
  "revenueSchemaVersion": 1,
  "timezone": "Asia/Ho_Chi_Minh",
  "currency": "VND",
  "store": { "id": "S01", "name": "Cửa hàng minh họa" },
  "filters": { "period": "2026-09", "date": null, "shiftId": null, "paymentMethod": null },
  "totals": {
    "orders": 1,
    "revenue": 180000,
    "revenueByType": { "NORMAL": 100000, "SALE_KG": 50000, "SALE_PIECE": 30000 },
    "totalSaleRevenue": 80000,
    "cash": 180000,
    "transfer": 0,
    "cashOrders": 1,
    "transferOrders": 0
  }
}
```

Payload thực tế còn có `generatedAt`, `products`, `groups.shift`, `groups.day` và envelope/version hiện có. Mỗi nhóm ca/ngày có cùng `revenueByType` và `totalSaleRevenue`; `totals` là toàn phạm vi lọc. `products.totalQuantity` chỉ là **cái**, `products.totalWeightKg` chỉ là **kg**; từng product item có `revenueType`/`unit`. Không cộng kg với cái.

Bất biến đối soát:

```text
NORMAL + SALE_KG + SALE_PIECE = totals.revenue
SALE_KG + SALE_PIECE = totals.totalSaleRevenue
Cùng cửa hàng + cùng bộ lọc => thống kê cửa hàng = API kho
```

Một đơn kết hợp chỉ tăng `orders` một lần. Tiền mặt/chuyển khoản là chiều thanh toán độc lập, không phải loại doanh thu. Kho lưu **ảnh chụp tổng hợp thay thế** theo cửa hàng/kỳ/bộ lọc; gọi lại không cộng dồn kết quả vào lần trước. Khi timeout/lỗi, giữ lần đồng bộ thành công có nhãn thời gian cũ, không ghi số 0 thay thế.

Endpoint không trả danh sách khách/nhân viên, không trả dữ liệu từng đơn. Khóa thống kê là khóa tích hợp tin cậy có thể yêu cầu từng cửa hàng hợp lệ, không phải token nhân viên. Không dùng token nhân viên để vượt phạm vi dữ liệu.

## Phân chia task/commit

| Task | Nội dung | Kiểm thử chính |
|---|---|---|
| 1 — Domain | Mã loại, đơn vị, kg chính xác, tiền/giảm giá dòng, tương thích cũ, tổng hợp theo loại | Đơn thường, mixed, sai tổng/đơn vị/giá, làm tròn, không cộng kg/cái |
| 2 — Backend/API | Lưu canonical fields, validate create/edit, retry không trùng, scope người tạo, API kho cùng bộ tổng hợp | SQLite tạo/sửa/xóa, idempotency, cross-user/store 403, API kho khớp |
| 3 — UI | Selector 3 mục; nhân viên cá nhân theo ca; cửa hàng 4 chỉ số; ca/ngày/tháng; Xem đơn đúng bộ lọc | Nút chọn/lưu, readonly tiền sale, menu/link/filter, lỗi/loading/refresh |
| 4 — Regression/performance | Cập nhật assertions cho vị trí thẻ mới, giữ lazy load/login budget, lịch sử product ngừng dùng | Pagination và tìm kiếm không làm lệch tổng, support store, bảo toàn mã cũ |
| 5 — Hợp đồng API/tài liệu | Ví dụ payload, phạm vi quyền, đồng bộ snapshot, rollout/rollback | Đối chiếu tài liệu với handler thực tế |

## Kiểm tra và phát hành

Chạy `npm run lint`, `npm test`, `npm run build`, `npm run sites:verify` và Verify IDOSI trên đúng SHA trước merge. Kiểm tra UI desktop/mobile và tạo đơn với backend thật trên dữ liệu thử tách biệt; không nhập đơn thử vào production.

Lưu ý môi trường local Node 22.16: assertion kế hoạch truy vấn SQLite `bounds employee home orders to the signed-in employee open attendance` cũng fail trên baseline chưa sửa. Không thay đổi/bỏ assertion đó để báo xanh; CI Node 22.13 của repo phải xác nhận riêng.

Trước production: backup SQLite, xác nhận revision đã verify và đồng bộ frontend/backend trong cùng release. Khi rollback không chạy bản cũ tự bỏ metadata của đơn sale: giữ database backup, chặn ghi các đơn sale phát sinh nếu rollback về mã chưa hiểu schema, kiểm tra lại với release hỗ trợ schema. Không xóa những dòng sale đã phát sinh để phục vụ rollback.

KHOHANG-IDOSI cần cấu hình máy chủ/khóa hợp lệ và đọc trường mới; repo kho chưa được sửa trong thay đổi này. API trên website production chỉ được xem là đã cập nhật sau khi release đúng SHA được triển khai và kiểm tra trực tiếp.
