# HỆ THỐNG QUẢN LÝ IDOSI

Ứng dụng quản lý tập trung cho 9 cửa hàng IDOSI và Khối Văn Phòng. Dự án được phát triển trên nền giao diện hệ thống DORE, giữ nguyên các luồng quản trị, quản lý cửa hàng và nhân viên, đồng thời bổ sung quản lý tài khoản, hồ sơ nhân sự, chấm công vị trí, thưởng, phụ cấp và lương.

## Chạy dự án

Yêu cầu Node.js 20 trở lên.

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

## Tài khoản mẫu

| Vai trò | Tên đăng nhập | Mật khẩu |
| --- | --- | --- |
| Quản trị cấp cao | `admin` | `idosi123` |
| Quản lý cửa hàng | `manager` | `idosi123` |
| Nhân viên văn phòng | `office` | `idosi123` |
| Nhân viên cửa hàng | `employee` | `idosi123` |

Các tài khoản quản lý và nhân viên được tạo trong ứng dụng cũng có thể đăng nhập bằng thông tin đã khai báo.

## Phân hệ

- Quản trị cấp cao: tổng quan toàn chuỗi, 9 cửa hàng, tài khoản quản lý, Khối Văn Phòng, giao việc, dòng tiền, lương thưởng và báo cáo.
- Quản lý cửa hàng: ca làm, phân ca, nhân viên, nhập hàng, chấm công, lương, dòng tiền, báo cáo và Khối Văn Phòng.
- Nhân viên cửa hàng: điểm danh, công việc, kết ca, lịch sử, bảng lương và dòng tiền; hiển thị tag Full-time hoặc Part-time.
- Nhân viên văn phòng: điểm danh và ra về có vị trí, lịch sử chấm công, trạng thái sớm/đúng giờ/trễ và bảng lương.

## Dữ liệu và bảo mật

Bản hiện tại kế thừa kiến trúc demo DORE và lưu dữ liệu trong `localStorage` của trình duyệt. Dữ liệu mẫu có thể khôi phục tại phần Cài đặt. Khi đưa vào vận hành nhiều thiết bị, cần thay lớp lưu trữ này bằng API/cơ sở dữ liệu, băm mật khẩu và lưu ảnh CCCD trong kho tệp riêng có kiểm soát truy cập.

Vị trí điểm danh dùng quyền định vị của trình duyệt và hoạt động tốt nhất trên HTTPS. Người dùng có thể từ chối cấp vị trí; ứng dụng sẽ hiển thị thông báo phù hợp.

## Triển khai

Workflow GitHub Actions trong `.github/workflows/deploy-pages.yml` tự động kiểm tra và triển khai GitHub Pages khi nhánh `main` được cập nhật.
