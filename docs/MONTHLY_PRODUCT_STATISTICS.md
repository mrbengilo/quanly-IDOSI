# Thống kê mặt hàng theo tháng

Cửa hàng → Số liệu thống kê → Xem theo: Theo tháng → chọn tháng.
Bảng **Thống kê mặt hàng • Tháng MM/YYYY** hiển thị một dòng cho mỗi mã mặt hàng:

| Mặt hàng | Số lượng đã bán (cái) | Khối lượng ước tính (kg) |
|---|---:|---:|
| Đồ nam | 300 | ≈ 100 kg |
| Đầm | 400 | ≈ 133,333 kg |

Đây là ví dụ, không phải dữ liệu sản xuất. Đầm giữ hệ số đã chốt 3 cái/kg; 400 cái không phải 200 kg. Chăn, ga, bao gối, nệm gòn giữ 3 kg/cái. Không thay đổi hệ số khi đổi cách hiển thị báo cáo.

## Phạm vi và cách cộng
- Số cái = NORMAL + SALE_PIECE. SALE_KG không cộng vào số cái.
- Kg ước tính chỉ là quy đổi các dòng bán theo cái bằng hệ số/snapshot đã xác nhận. Kg thực bán thuộc SALE_KG giữ riêng.
- Ví dụ một mặt hàng có 9 cái và 5 kg thực bán: cột cái là 9, không phải 14. Khi hệ số 3 cái/kg, cột ước tính là 3 kg; tổng khối lượng có cả sale kg là 8 kg, xem trong phần chi tiết.
- Bảng chính gộp theo mã mặt hàng, không gộp các mã khác nhau chỉ vì trùng tên. Bảng chi tiết theo loại bán vẫn truy cập được.
- Tháng dùng ngày kinh doanh Việt Nam của đơn, gồm mọi ngày/ca trong tháng và chỉ cửa hàng được phép xem. Không giữ bộ lọc date/shift khi chuyển sang tháng. Ngày/ca vẫn hoạt động riêng.
- Số cái gốc không mất khi thiếu hệ số. Khối lượng chưa đủ dữ liệu phải báo rõ, không ghi 0. Đơn cũ không có mặt hàng được cảnh báo; không tự phân chia cho sản phẩm.
- Tổng khối lượng do domain/backend cộng trước làm tròn; giao diện không cộng các số kg đã làm tròn từng dòng. Tiền, giá và doanh thu không thay đổi.

## Dữ liệu dành cho kho
Dùng endpoint hiện có với `storeId` và `period=YYYY-MM`; không truyền `date`/`shiftId` để lấy cả tháng.

Trong `products.weightByProduct[]`:
- `productId`, `productCode`, `productName`: nhận diện mặt hàng.
- `totalQuantity`: trường bổ sung, số cái NORMAL + SALE_PIECE.
- `orders`: số đơn có mặt hàng, không phải số cái.
- `weight.estimatedKg`: khối lượng quy đổi từ số cái.
- `weight.actualKg`: kg bán trực tiếp.
- `weight.totalKg`: tổng khi đủ dữ liệu; có thể null nếu thiếu dữ liệu.
- `weight.isComplete`: phải kiểm tra trước khi coi estimatedKg là kết quả đầy đủ.

Trường `products.totalQuantity` là tổng số cái cả phạm vi; `products.totalWeightKg` giữ nguyên nghĩa kg bán trực tiếp. Footer dùng `products.weight`, không cộng lại kết quả đã làm tròn. Các trường doanh thu, hợp đồng xác thực và quyền không đổi. Đồng bộ bằng cập nhật bản tổng hợp cùng cửa hàng/tháng, không cộng thêm mỗi lần gọi.

## Kiểm thử
Kiểm thử domain/component/API dùng ví dụ 300 cái đồ nam, 400 đầm, nhiều ngày/ca, ranh giới tháng, đơn xóa, cửa hàng khác, kg thực bán và thiếu hệ số. Browser dùng fixture cô lập hiện có: tháng hiện tại có 15 cái Đồ nam = 5 kg ước tính, tháng cũ có 5 cái; đối chiếu API, đổi tháng/rỗng/làm mới và kiểm tra bảng 3 cột ở 320/390/430/1280 px. Không tạo đơn test trên production.
