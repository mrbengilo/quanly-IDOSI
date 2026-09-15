# Tổng khối lượng ước tính khi còn dữ liệu thiếu

## Lỗi hiển thị và cách sửa
Bảng mặt hàng đã có số kg từng dòng nhưng footer từng dùng `weight.isComplete` để ẩn toàn bộ tổng. Cờ này xét cả đơn cũ chưa có mặt hàng; vì vậy một đơn không phân loại được có thể che số cộng của các mặt hàng đã quy đổi.

`products.weight.estimatedKg` đã là tổng các phần quy đổi được từ số cái, cộng phân số trước làm tròn. Giao diện dùng trực tiếp trường này, không cộng lại số kg đã làm tròn ở các dòng và không thay bằng `actualKg`, `knownKg` hoặc ép `totalKg` từ null thành số.

## Hiển thị
- Khi đủ dữ liệu: giữ số tổng hiện tại.
- Khi còn dữ liệu thiếu nhưng có kg quy đổi: vẫn hiển thị tổng số đã tính được, kèm nhãn “Phần đã quy đổi”. Cảnh báo riêng nêu số đơn chưa ghi nhận mặt hàng, dòng thiếu hệ số hoặc dữ liệu không hợp lệ. Dòng mặt hàng có phần quy đổi được cũng hiển thị theo nguyên tắc này.
- Khi tất cả đều chưa quy đổi được: giữ “Chưa đủ dữ liệu”, không giả định 0 kg.
- Khi API không có estimatedKg hợp lệ: hiển thị dấu gạch, không tự tạo số tổng.
- Khi đổi tháng/ngày/ca: giá trị và cảnh báo theo đúng phản hồi đã tải, không giữ nhãn thiếu dữ liệu từ phạm vi cũ.

Ví dụ dữ liệu kiểm thử: 392 cái thuộc 16 mặt hàng có hệ số hợp lệ cho tổng ≈112,083 kg. Thêm một đơn cũ không có danh sách mặt hàng không làm mất tổng này; khối lượng chưa biết của đơn đó không được tự thêm hoặc coi là 0. Đây không phải số liệu sản xuất được truy vấn trực tiếp.

## Bảo toàn dữ liệu và API kho
Không đổi công thức, hệ số, số lượng, tiền hay phân quyền; không migration. API không thay đổi: `estimatedKg` là phần quy đổi biết được, `isComplete=false` và `totalKg=null` vẫn giữ nếu có phần chưa xác định. Kho phải giữ thông tin thiếu dữ liệu khi dùng subtotal, không coi là tổng khối lượng đầy đủ. SALE_KG là kg thực bán riêng, không cộng vào cột kg ước tính.

## Kiểm thử
Component tái hiện 392 cái, đơn cũ không có mặt hàng, thiếu hệ số trong cùng sản phẩm, dữ liệu không hợp lệ/thiếu, tổng phân số và kg thực bán tách riêng. SQLite/API kiểm tra số tổng và completeness theo tháng/ngày/ca/cửa hàng. Browser dùng fixture lịch sử hiện có với 2 đơn chưa ghi nhận mặt hàng; kiểm tra footer, cảnh báo, refresh/API, đổi tháng và bố cục 320/390/430/1280px. Không tạo đơn thử trên production.
