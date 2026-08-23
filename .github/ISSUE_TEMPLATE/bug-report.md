---
name: Báo lỗi IDOSI
about: Ghi nhận lỗi để Codex có đủ dữ liệu phân tích nguyên nhân và regression
title: "[BUG] "
labels: ""
assignees: ""
---

# Báo lỗi

## Mô tả lỗi
Mô tả ngắn gọn lỗi đang xảy ra.

## Kết quả hiện tại
Điều gì đang xảy ra?

## Kết quả mong muốn
Hệ thống đúng ra phải hoạt động như thế nào?

## Các bước tái hiện
1.
2.
3.

## Tài khoản / vai trò
- Role:
- Store / phạm vi dữ liệu:

Không ghi mật khẩu, token hoặc secret.

## Module liên quan
- [ ] Đơn hàng
- [ ] Nhân viên
- [ ] Chấm công
- [ ] Ca làm / kết ca
- [ ] Lương / thưởng / phụ cấp / ứng lương
- [ ] Tài chính / chi phí / lợi nhuận
- [ ] KPI
- [ ] Nhập hàng
- [ ] Báo cáo
- [ ] Phân quyền
- [ ] API / backend
- [ ] Database
- [ ] UI
- [ ] Khác

## Dữ liệu mẫu an toàn
Cung cấp dữ liệu tối thiểu để tái hiện. Không đưa dữ liệu production nhạy cảm.

## Log / lỗi console
Dán phần log cần thiết và loại bỏ token/secret.

## Regression
- Lỗi bắt đầu sau thay đổi/PR/commit nào nếu biết?
- Chức năng liên quan nào vẫn hoạt động bình thường?

## Tiêu chí sửa lỗi
- [ ] Xác định được root cause
- [ ] Có test tái hiện lỗi trước khi sửa nếu phù hợp
- [ ] Sửa đúng root cause, không chỉ che triệu chứng
- [ ] Kiểm tra phân quyền/store isolation nếu liên quan
- [ ] `npm run lint` PASS
- [ ] `npm test` PASS
- [ ] `npm run build` PASS
- [ ] `npm run sites:verify` PASS
- [ ] Kiểm tra regression các module liên quan
