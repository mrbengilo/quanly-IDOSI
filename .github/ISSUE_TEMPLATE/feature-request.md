---
name: Yêu cầu chức năng IDOSI
about: Chuẩn hóa yêu cầu để Codex phân tích và triển khai an toàn
title: "[FEATURE] "
labels: ""
assignees: ""
---

# Yêu cầu chức năng

## Mục tiêu
Mô tả ngắn gọn chức năng hoặc vấn đề cần giải quyết.

## Nghiệp vụ hiện tại
Mô tả hệ thống đang hoạt động như thế nào trước khi thay đổi.

## Nghiệp vụ mong muốn
Mô tả luồng sau khi hoàn thành.

## Công thức / quy tắc nghiệp vụ
Nếu liên quan đến doanh thu, chi phí, lợi nhuận, KPI, lương, thưởng, phụ cấp, ứng lương, chấm công hoặc kết ca, ghi công thức và điều kiện cụ thể.

## Phân quyền
- `admin`:
- `business_support`:
- `store_manager`:
- `employee`:

Ghi rõ phạm vi cửa hàng (`storeId`) nếu liên quan.

## Giao diện
Mô tả:
- Màn hình / route
- Nút
- Form
- Table
- Modal
- Loading / empty / error state
- Responsive

## Dữ liệu liên quan
Liệt kê entity, field hoặc nguồn dữ liệu hiện có.

## Điều kiện biên cần kiểm tra
Ví dụ:
- dữ liệu rỗng
- giá trị 0
- số âm
- quyền không hợp lệ
- sai cửa hàng
- kỳ đã khóa
- bản ghi đã xóa
- request lặp / idempotency

## Tiêu chí nghiệm thu
- [ ] Business rule đúng
- [ ] Phân quyền đúng ở backend
- [ ] Store isolation đúng
- [ ] Không làm hỏng dữ liệu hiện tại
- [ ] Có test phù hợp
- [ ] UI đúng yêu cầu
- [ ] `npm run lint` PASS
- [ ] `npm test` PASS
- [ ] `npm run build` PASS
- [ ] `npm run sites:verify` PASS

## Ngoài phạm vi
Ghi rõ những thứ Codex không được tự ý thay đổi trong task này.
