# Quy đổi hàng hóa từ cái sang kg

## Quy tắc được duyệt

Bảng hiện hành: `IDOSI-2026-09-15-v2`, gồm 25 mặt hàng. Nguồn dùng chung cho giao diện và backend là `src/domain/orderWeight.js`.

- Bán thường (`NORMAL`) và sale theo cái (`SALE_PIECE`) áp dụng hệ số theo mặt hàng đã được backend đối chiếu với danh mục.
- 24 mặt hàng giữ hệ số **cái trên một kg**. Ví dụ Đầm: 3 cái = 1 kg, khối lượng = số cái / 3.
- **Chăn, ga, bao gối, nệm gòn: chính xác 1 cái = 3 kg**, khối lượng = số cái * 3. Quy tắc lưu `kgPerPiece: 3`, `piecesPerKg: null`; không sử dụng 0,3 cái/kg hoặc giá trị 1/3 làm tròn.
- Sale theo ký (`SALE_KG`) lấy nguyên khối lượng của dòng bán. Bán 5 kg là 5 kg, không nhân/chia lại hệ số. Nút +/- vẫn bước 0,5 kg; nhập tay vẫn hỗ trợ 0,001 kg.
- Kg từ số cái là ước tính, không phải kết quả cân. Không sửa số lượng gốc, đơn giá, thành tiền, doanh thu hoặc chính sách thưởng.

| Mặt hàng | Bán thường | Sale cái | Sale ký | Tổng |
| --- | --- | --- | --- | --- |
| Đầm | 3 cái -> 1 kg quy đổi | 6 cái -> 2 kg quy đổi | 5 kg thực bán | 8 kg |
| Chăn, ga, bao gối, nệm gòn | 1 cái -> 3 kg quy đổi | 2 cái -> 6 kg quy đổi | 5 kg thực bán | 14 kg |

## Lưu trên dòng đơn

Backend tạo `weightConversion` từ tên mặt hàng đã xác thực; không tin hệ số, tên hoặc khối lượng tính sẵn do trình duyệt gửi. Ví dụ:

```json
{
  "version": "IDOSI-2026-09-15-v2",
  "status": "MAPPED",
  "ruleId": "bedding",
  "piecesPerKg": null,
  "kgPerPiece": 3
}
```

Dòng bán kg không cần snapshot quy đổi. Khi chỉnh số lượng trên đơn đã có snapshot, giữ nguyên snapshot của dòng cũ. Đơn chưa có snapshot được đối chiếu tên mặt hàng đã lưu với bảng v2, không ghi đè lại hàng loạt đơn cũ. Một snapshot v1 được lưu rõ ràng vẫn được đọc theo lịch sử v1; thêm phiên bản mới thay vì âm thầm sửa snapshot. PR này là lần phát hành chức năng quy đổi, không có migration mới.

Tên không khớp chính xác sau chuẩn hóa Unicode/khoảng trắng/chữ hoa thường thì `UNMAPPED`. Không tự đoán theo mã hoặc tên gần giống. Snapshot hỏng/không biết phiên bản báo `INVALID`.

## Trường thống kê/API

Các endpoint `GET /api/order-summary`, `GET /api/integrations/warehouse/order-statistics` và `GET /api/integrations/warehouse/v1/order-statistics` dùng cùng bộ tổng hợp. Bộ lọc cửa hàng/kỳ/ngày/ca, phân quyền và khóa tích hợp không đổi.

- `totals.weight`: `actualKg`, `estimatedKg`, `knownKg`, `totalKg`, `isComplete`, các số đếm lỗi/thiếu hệ số, `byRevenueType` và phiên bản bộ quy đổi hiện hành.
- `groups.shift/day/month/employee[].weight`: khối lượng trong cùng phạm vi nhóm đó.
- `products.items[].weight`: từng dòng mặt hàng/loại doanh thu.
- `products.weightByProduct[]`: gộp cùng mã mặt hàng qua cả ba loại, một đơn chỉ đếm một lần/mặt hàng.
- `products.weight`: cùng khối lượng tổng.

**Giữ tương thích:** `products.totalWeightKg` vẫn chỉ là kg bán theo ký; `products.totalQuantity` vẫn là số cái. Không đổi ý nghĩa trường cũ thành tổng khối lượng mới. Các trường tiền `revenue` và `revenueByType` giữ nguyên.

API làm tròn kg đến 6 chữ số thập phân sau khi cộng bằng phân số chính xác; giao diện hiển thị tối đa 3. Không cộng các số đã làm tròn từng dòng rồi coi là tổng chính xác. Dòng 1/3 kg lặp ba lần phải tổng 1 kg.

Nếu thiếu dữ liệu, `totalKg: null`, `isComplete: false`, `knownKg` giữ phần tính được. Không chuyển null thành 0. Phân biệt đơn cũ chưa có mặt hàng với ngày thật sự không có đơn (tổng bằng 0 và đủ dữ liệu).

API trả snapshot tổng hợp theo cửa hàng/kỳ/ngày/ca; phía kho cập nhật/ghi đè cùng phạm vi, không cộng dồn mỗi lần gọi. Không cộng cả số tổng và số nhóm. Việc kiểm thử API ở SQLite cô lập không xác nhận máy chủ kho đã cấu hình khóa production.

## Giao diện và kiểm thử

Bảng quy đổi mở/thu gọn có ở form đơn và trang Số liệu thống kê. Dòng mặt hàng, tổng đơn, thống kê từng ca/ngày/tháng và bảng khối lượng theo mặt hàng cùng dùng bộ quy đổi. Khối lượng tính ra có nhãn truy cập khác với ô nhập kg; cảnh báo dữ liệu thiếu là ghi chú, không lấn thông báo trạng thái thao tác.

Kiểm thử bổ sung: hệ số 25 mặt hàng; 1/2/3 cái chăn = 3/6/9 kg; số kg không quy đổi lần hai; bảo toàn tiền; số lẻ chính xác; metadata giả mạo; lưu/sửa/đọc lại SQLite; gửi lặp không tăng trùng; xóa mềm; giới hạn cửa hàng/nhân viên; đối soát API kho theo ca/ngày/tháng. Kết quả thực thi và source SHA phải kiểm tra trong CI, không suy ra PASS từ tài liệu này.

Chỉ phát hành sau Verify IDOSI và browser flow đạt. Merge xong phải chờ Verify push/main, Deploy VPS đúng SHA, backup SQLite, health/release/root công khai và finalizer SUCCESS.
