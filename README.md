# HỆ THỐNG QUẢN LÝ IDOSI

Ứng dụng quản lý tập trung cho 9 cửa hàng IDOSI và Khối Văn Phòng. Hệ thống có ba vai trò đăng nhập: Admin, Quản lý và Nhân viên; nhân viên được gán vào cửa hàng hoặc Khối Văn Phòng.

## Chạy dự án

Yêu cầu Node.js 22.5 trở lên.

```bash
npm install
npm run dev
```

Kiểm tra trước khi phát hành:

```bash
npm run lint
npm test
npm run build
```

## Tài khoản mẫu (chỉ dùng khi chạy local)

| Vai trò | Tên đăng nhập | Mật khẩu |
| --- | --- | --- |
| Admin | `admin` | `idosi123` |
| Quản lý | `manager` | `idosi123` |
| Nhân viên văn phòng | `office` | `idosi123` |
| Nhân viên cửa hàng | `employee` | `idosi123` |

Các tài khoản nhân viên được Admin tạo trong ứng dụng cũng có thể đăng nhập bằng thông tin đã khai báo.
Production được khởi tạo bằng biến môi trường riêng; không sử dụng các mật khẩu mẫu trong bảng trên.

## Phân hệ

- Admin: toàn quyền quản lý chuỗi, cửa hàng, nhân viên, Khối Văn Phòng, chính sách, đơn hàng, chấm công và dữ liệu hệ thống.
- Quản lý: vận hành cửa hàng, nhân viên, ca/lịch, giao việc, tài chính và báo cáo; chỉ xem đơn hàng, không truy cập Khối Văn Phòng, chính sách hoặc Reset dữ liệu.
- Nhân viên cửa hàng: điểm danh, công việc, kết ca, lịch sử, bảng lương và dòng tiền; hiển thị loại Full-Time hoặc Part-Time.
- Nhân viên văn phòng: điểm danh và ra về có vị trí, lịch sử chấm công, trạng thái sớm/đúng giờ/trễ và bảng lương.

## Dữ liệu và bảo mật

Môi trường Sites dùng Worker API và D1 cho credential, session, shared state, chính sách, counter, idempotency và audit. Mật khẩu được băm PBKDF2-SHA256; token thô không được lưu vào D1. `localStorage` chỉ là lớp tương thích cho chế độ demo/phát triển, không phải nguồn dữ liệu production. Ảnh CCCD cần kho tệp riêng có kiểm soát truy cập và không được nhét vào shared JSON.

Vị trí điểm danh dùng quyền định vị của trình duyệt và hoạt động tốt nhất trên HTTPS. Người dùng có thể từ chối cấp vị trí; ứng dụng sẽ hiển thị thông báo phù hợp.

## Triển khai

Build Sites tạo `dist/client`, `dist/server/index.js`, cấu hình D1 và migrations. Xem [hướng dẫn API và bootstrap](server/README.md). GitHub Actions chỉ chạy lint, test và xác minh bản build; production được triển khai bằng Sites vì GitHub Pages không chạy Worker/D1.
