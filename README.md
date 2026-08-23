# HỆ THỐNG QUẢN LÝ IDOSI

Ứng dụng quản lý tập trung cho chuỗi cửa hàng IDOSI, Khối Văn Phòng và đội Hỗ trợ kinh doanh. Hệ thống dùng bốn mã quyền đăng nhập (`admin`, `business_support`, `store_manager`, `employee`) cho năm nhóm hiển thị: Admin, Nhân viên hỗ trợ KD, Quản lý cửa hàng, Nhân viên cửa hàng và Nhân viên văn phòng.

## Chạy dự án

Yêu cầu Node.js 22.13 trở lên.

```bash
npm install
npm run dev
```

Kiểm tra trước khi phát hành:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

## Tài khoản mẫu (chỉ dùng khi chạy local)

| Vai trò | Tên đăng nhập | Mật khẩu |
| --- | --- | --- |
| Admin | `admin` | `idosi123` |

Hệ thống chỉ khởi tạo sẵn tài khoản Admin. Admin tạo tài khoản Hỗ trợ KD, Quản lý cửa hàng và Nhân viên văn phòng. Quản lý cửa hàng được gán bắt buộc vào một cửa hàng và tạo tài khoản Nhân viên cửa hàng trong đúng phạm vi đó. Các tài khoản được tạo trong ứng dụng đăng nhập bằng thông tin đã khai báo.
Production được khởi tạo bằng biến môi trường riêng; không sử dụng các mật khẩu mẫu trong bảng trên.

## Phân hệ

- Admin: toàn quyền quản lý chuỗi, cửa hàng, nhân viên, Khối Văn Phòng, chính sách, đơn hàng, chấm công và dữ liệu hệ thống.
- Nhân viên hỗ trợ KD: dùng workspace vận hành ngoài Khối Văn Phòng, chỉ xem đơn hàng và có màn chấm công, lịch sử, thống kê chuyên cần riêng.
- Quản lý cửa hàng: chỉ truy cập cửa hàng được Admin gán; quản lý nhân viên, ca/lịch, giao việc, nhập hàng, tài chính và báo cáo của cửa hàng đó; chỉ xem đơn hàng.
- Nhân viên cửa hàng: điểm danh, công việc, kết ca, lịch sử, bảng lương và dòng tiền; hiển thị loại Full-Time hoặc Part-Time.
- Nhân viên văn phòng: điểm danh và ra về có vị trí, lịch sử chấm công, trạng thái sớm/đúng giờ/trễ và bảng lương.

## Dữ liệu và bảo mật

IDOSI hiện hỗ trợ hai đường triển khai production và coding agents phải xác định đúng target trước khi sửa persistence/runtime:

- **Sites/Cloudflare:** Worker API + D1 cho credential, session, shared state, chính sách, counter, idempotency và audit.
- **VPS:** frontend + API chạy bằng Node.js, dữ liệu ứng dụng dùng SQLite và ảnh được lưu trong vùng lưu trữ riêng của runtime VPS theo `deploy/vps/README.md` và `server/vps/`.

Không được giả định thay đổi persistence ở một target sẽ tự động tương thích với target còn lại. Khi task ảnh hưởng database, storage, session, auth, bootstrap hoặc runtime, phải kiểm tra cả hai đường triển khai nếu cả hai vẫn được hỗ trợ.

Mật khẩu được băm theo cơ chế hiện có của từng backend; không lưu token thô hoặc credential nhạy cảm vào client state. `localStorage` chỉ là lớp tương thích cho chế độ demo/phát triển, không phải nguồn dữ liệu production. Ảnh CCCD cần kho tệp riêng có kiểm soát truy cập và không được nhét vào shared JSON.

Vị trí điểm danh dùng quyền định vị của trình duyệt và hoạt động tốt nhất trên HTTPS. Người dùng có thể từ chối cấp vị trí; ứng dụng sẽ hiển thị thông báo phù hợp.

## Triển khai

### Sites/Cloudflare

Build Sites tạo `dist/client`, `dist/server/index.js`, cấu hình D1 và migrations. Xem [hướng dẫn API và bootstrap](server/README.md). GitHub Actions chạy lint, test, build và xác minh Sites build; GitHub Pages không thay thế Worker/D1 runtime.

### VPS

VPS production chạy Node.js 24, SQLite, vùng lưu trữ ảnh riêng và Caddy HTTPS. Xem [hướng dẫn triển khai VPS](deploy/vps/README.md). Trước cập nhật production cần sao lưu dữ liệu theo hướng dẫn VPS và không xóa volume dữ liệu như một bước deploy thông thường.
