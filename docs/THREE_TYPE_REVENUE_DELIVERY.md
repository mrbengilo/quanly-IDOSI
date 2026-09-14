# Triển khai 3 loại doanh thu IDOSI — 14/09/2026

## Phạm vi bắt buộc

| Vai trò/màn hình | Hành vi |
|---|---|
| Nhân viên / Tạo đơn | 3 mục Bán thường, Sale theo ký, Sale theo cái; hai sale cùng nhóm Hàng sale; có thể kết hợp trong một đơn. |
| Nhân viên / Đơn hàng | Chỉ đơn do chính nhân viên tạo thuộc ca đang mở và cửa hàng thực tế của ca. Không hiển thị doanh thu toàn ca cửa hàng. |
| Cửa hàng / Đơn hàng | Toàn bộ đơn trong phạm vi cửa hàng được phép; đủ 3 khoản doanh thu + tổng cho tháng, ca, ngày và nhóm nhân viên. |
| Cửa hàng / Số liệu thống kê | Theo tháng → từng ngày, theo ngày → từng ca, theo ca → tổng và mặt hàng. Làm mới, trạng thái tải/lỗi, không lấy số trang hiện tại làm tổng. |
| Website kho | API chỉ đọc thống kê từng cửa hàng. UI và API dùng chung `summarizeOrders`. Không trả PII. |

## Task và commit theo thứ tự

| Task | Commit | File/phần chính | Điều kiện nghiệm thu |
|---|---|---|---|
| T01 | `feat(orders): add canonical three-type revenue and precise sale quantities` | `orderRevenue.js`, `orderItems.js`, `orderSummary.js` + unit tests | Ba mã cố định, kg tới 3 số lẻ, cái nguyên, phép tính đồng nguyên, đơn kết hợp chỉ đếm một lần. |
| T02 | `feat(api): validate sale revenue and expose scoped warehouse summaries` | Commands create/update; summary/history authorization; VPS env; real SQLite integration tests | Chặn dữ liệu giả, đối soát tổng, idempotency, không lộ đơn người khác, sửa/xóa mềm cập nhật báo cáo. |
| T03 | `feat(ui): add three-section order editor and personal shift revenue` | Component chọn hàng/3 loại, summary4 ô, AppContext, EmployeeOrdersPage + tests | Chuyển mục giữ dữ liệu, sale tự tính, ca/cửa hàng/người tạo đúng, lưu thành công mới đóng modal, nút khóa khi đang lưu. |
| T04 | `feat(store): show three revenue types by shift day and month` | StoreOrdersPage, StoreStatisticsPage + tests | Chi tiết mỗi ca có4 chỉ số; tháng/ngày/ca cùng API; cache theo phiên bản; không nhận phản hồi cũ; lọc không làm đổi tổng toàn phạm vi. |
| T05 | `test(revenue): reconcile existing dashboards and document warehouse contract` | Regression assertions + tài liệu API, kế hoạch nghiệm thu | Lint, tests, build, sites:verify; kiểm tra trình duyệt và API thật trên SQLite thử nghiệm; PR không tự tuyên bố đã lên production. |

## Dữ liệu và tiền

Không tạo hệ thống đơn thứ hai, không thêm ba bảng đơn tách rời. Hệ thống hiện lưu
đơn dưới dạng JSON trong `state_entities`; trường mới đi cùng đơn, không cần
migration phá dữ liệu hoặc backfill tiền.

Đơn thường giữ tiền nhập thủ công hiện tại. Sale lưu ở từng dòng:
`revenueType`, `unit`, `quantity`, `unitPrice`, `lineAmount`. Tổng đơn vẫn là
`amount` để tương thích thu chi và thưởng. Phân loại khi đọc:

```
SALE_KG    = tổng lineAmount các dòng kg
SALE_PIECE = tổng lineAmount các dòng cái sale
NORMAL     = order.amount - SALE_KG - SALE_PIECE
Tổng       = NORMAL + SALE_KG + SALE_PIECE
```

Nếu chỉ có hàng sale, phần NORMAL phải bằng 0. Frontend gửi `normalAmount` để
backend kiểm tra lại với tổng. Backend không tin `lineAmount` phía client.
Cùng mặt hàng được xuất hiện ở ba mục; trùng trong cùng mục bị từ chối.

Không phân bổ tùy ý tiền đơn thường cũ xuống dòng; không tự đổi hàng có giá thấp
thành sale; không cộng kg với cái. Chính sách trả/hoàn và thưởng hiện có không bị
thay thế trong thay đổi này. Đơn cũ thiếu phân loại giữ nguyên là NORMAL; cần đối
soát thủ công các giao dịch sale lịch sử chưa phân loại.

## Ma trận nghiệm thu nút và API

| Thao tác frontend | Backend/nguồn dữ liệu | Kiểm tra |
|---|---|---|
| Chọn loại bán / chọn mặt hàng / đổi lượng, giá | `normalizeRevenueItem`, `resolveOrderItems` dùng chung | Unit cố định, lỗi đầu vào, bỏ lineAmount cũ sau sửa, giữ các mục còn lại. |
| Lưu đơn nhân viên | `POST /api/command`, `order.create` | Đúng tổng3 loại; ca từ phiên; chống nhấn lặp; lỗi không mất form. |
| Sửa đơn Admin | `POST /api/command`, `order.update` | Có lý do; giá trị trước/sau được audit; báo cáo đọc lại; tổng thưởng chỉ tính amount một lần. |
| HTKD sửa thông tin | `order.update` + quyền hiện có | Không được đổi tiền hoặc phân bổ doanh thu; UI khóa phần sale và tiền. |
| Xóa đơn Admin | `order.delete` hiện có | Xóa mềm, lý do/audit và khóa kỳ giữ nguyên; không còn trong tổng. |
| Lọc đơn/đổi trang/tải thêm | History + summary độc lập | Tổng tháng và cả ca không phụ thuộc trang hiện tại. |
| Đổi tháng/ngày/ca, Xem ngày/Xem ca | `GET /api/order-summary` | storeId + period + date/shiftId khớp lựa chọn. |
| Làm mới số liệu / thử lại | Gọi lại summary | Lỗi không hiển thị 0 giả, không dùng dữ liệu cũ sai phạm vi. |
| Kho gọi số liệu | `GET /api/integrations/warehouse/v1/order-statistics` | Xác thực server-to-server, phạm vi cửa hàng, cùng4 số, HTTP lỗi rõ. |

## Kiểm thử chuẩn

```
npm run lint
npm test
npm run build
npm run sites:verify
```

Nhóm test mới: `orderRevenue.test.js`, `OrderRevenue.test.jsx`,
`server/vps/order-revenue.integration.test.js`; bổ sung kiểm thử drill-down,
cache invalidation và response race trong `StoreStatisticsPage.test.jsx`.
Các regression cũ của employee/support store, lịch sử phân trang, sửa đơn,
state, payroll và phân quyền phải tiếp tục chạy, không bỏ qua để làm CI xanh.

Visual: màn hình thật với dữ liệu tổng hợp thử nghiệm, kiểm tra desktop 1440px,
mobile390px; không dùng dữ liệu khách hàng thật. Ghi lại bằng ảnh và kết quả
HTTP khi tạo đơn qua trình duyệt, sau đó kiểm tra báo cáo và API kho.

## Phát hành và phục hồi

Đẩy feature branch/PR trước; `Verify IDOSI` là gate chính xác theo SHA. Không
đụng DB production khi phát triển. Khi phát hành, giữ endpoint cũ và cấu trúc
`amount` để client cũ vẫn đọc được; consumer kho thêm3 khóa mới và upsert ảnh
chụp tổng hợp theo phạm vi. Khóa WAREHOUSE_API_KEY chỉ cấu hình qua secret/env.
Không rollback về code chưa hiểu các dòng sale sau khi production đã phát sinh
sale mà không đánh giá tương thích và backup; không xóa dữ liệu sale để rollback.
