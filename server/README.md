# IDOSI Sites API

Worker này phục vụ SPA và API dùng chung trên Sites. GitHub Pages chỉ phục vụ
file tĩnh và **không chạy** Worker/D1.

## Khởi tạo môi trường mới

1. Tạo D1 binding logic tên `DB` và chạy migration trong `drizzle/`.
2. Đặt secret runtime `BOOTSTRAP_TOKEN` đủ dài và ngẫu nhiên.
3. Deploy bằng Sites, sau đó gọi đúng một lần:

```bash
curl -X POST https://<site>/api/bootstrap \
  -H "content-type: application/json" \
  -H "x-idosi-bootstrap-token: <BOOTSTRAP_TOKEN>" \
  --data '{"username":"admin","password":"<mat-khau-tu-8-ky-tu>","displayName":"Quản trị IDOSI","initialState":{}}'
```

Không đưa `BOOTSTRAP_TOKEN` hoặc mật khẩu vào Git. Sau khi khởi tạo thành công,
có thể xoay hoặc gỡ secret bootstrap. API băm mật khẩu bằng PBKDF2-SHA256 và chỉ
lưu hash, salt, số vòng lặp.

## Hợp đồng frontend

`POST /api/login` nhận `username`, `password`; lưu `token` trả về ở bộ nhớ phiên
và gửi `Authorization: Bearer <token>`. Không lưu token vào shared state.

`GET /api/bootstrap` trả `user`, `state`, `version`, `policies`. `state` đã được
chiếu theo quyền. Client phải coi key bị thiếu/mảng rỗng là authoritative; không
được trộn projection với demo seed. `policies` ở top-level là nguồn chính thức
từ D1, không đọc `state.policies`.

Mọi `POST /api/command` cần `Idempotency-Key` duy nhất và `expectedVersion` khi
lệnh sửa shared state. Khi nhận `VERSION_CONFLICT`, tải lại `/api/state` rồi yêu
cầu người dùng thử lại; không tự ghi đè.

Các lệnh chính:

- `order.create`: payload `storeId`, `customerName`, `customerPhone?`,
  `customerAge?`, `amount` (số nguyên VND), `paymentMethod`. Với employee, server
  cố định employee/store từ session và tự gắn attendance/ca đang mở. Mã đơn và
  timestamp được sinh trong cùng transaction với state, counter, audit, receipt.
- `attendance.check_in`: payload `shiftId`, `location { latitude, longitude,
  accuracy?, label? }`. Server dùng giờ Việt Nam, policy đi sớm/đi trễ và snapshot
  ca; không nhận giờ từ client.
- `attendance.check_out`: payload `attendanceId?`, `location`, `expense?`,
  `tiktok?`. Server tự tính thời lượng và doanh thu đơn gắn với lượt
  chấm công; chi phí ca nếu có được ghi cùng transaction.
- `order.update`: admin, payload `orderId`, các trường khách hàng/
  `amount`/`paymentMethod` cần sửa và `reason` bắt buộc. `order.delete`
  nhận `orderId`, `reason` và chỉ xóa mềm. Cả hai tính lại tổng ca.
- `task.done` (alias `task.set_done`): employee, payload `taskId`, `done`.
  Server lấy nhân viên/cửa hàng từ session và chỉ đổi cờ của chính actor.
- `fixed_expense.create|update|delete`: admin; create nhận `storeId`, `type`,
  `amount`, `note?`, `occurredAt?`; update/delete dùng `expenseId` và `reason`.
  Lệnh `expense.create|update|delete` có cùng envelope cho chi phí thủ công.
- `import.create`: admin, payload `storeId`, `items[{name,category,quantity,
  price,note?}]`, `shippingAmount?`, `relatedAmount?`. Server sinh mã
  `PN-DDMMYYYY-XXXXX` theo giờ Việt Nam bằng counter toàn cục. `import.update`
  và `import.delete` nhận `voucherId`, `reason`; xóa là xóa mềm và void
  expense liên kết. Có alias `import_voucher.*`.
- `salary_advance.create`: admin, payload `employeeId`, `period` (`YYYY-MM`),
  `amount`, `note?`; update dùng `advanceId`, `amount?`, `note?`; confirm dùng
  `advanceId` và cùng lúc ghi cash-out + expense.
- `salary_adjustment.create`: admin, payload `employeeId`, `period`, `type`
  (`Thưởng khác`, `Phụ cấp khác` hoặc `Khấu trừ`), `amount`, `note?`.
- `payroll.close|pay|lock`: admin, payload `storeId`, `period`. Server tự chốt
  attendance, lương, KPI, ứng lương và finance; `pay` chỉ chi phần còn
  lại, `lock` chỉ áp dụng sau khi đã chi. Nếu nguồn tài chính/lương
  đổi sau khi chốt, `pay` trả `PAYROLL_NEEDS_RECLOSE` cho đến khi chốt lại.
- `policy.set`: admin, payload `key`, `value`, dùng version riêng của policy.
  Khi lưu nhiều ô cùng lúc, dùng `policies.set` với payload
  `updates: [{ key, value, expectedVersion }]` để toàn bộ thay đổi cùng commit
  hoặc cùng rollback.
- `user.create`, `user.update`, `user.set_status`, `user.reset_password`: admin
  quản lý credential employee. `employeeId` bất biến; đổi đơn vị sẽ thu hồi session.
- `user.change_password`: chính người dùng, payload `currentPassword`,
  `newPassword`; giữ session hiện tại và thu hồi các session còn lại.
- `state.merge`/`state.replace`: chỉ admin; là cầu nối cho dữ liệu chưa có domain
  command, không dùng cho mutation employee.

Response ghi thành công luôn có `serverTime`, `requestId`; lệnh tạo mới trả 201.
Gửi lại cùng idempotency key và cùng body nhận lại response cũ kèm header
`Idempotency-Replayed: true`.

`state.replace` được lọc đệ quy trước khi lưu: password, token, API key,
secret, cookie/authorization và credential envelope không được phép đi vào
shared state. Client không được coi shared state là kho credential.

## Giới hạn cần xử lý trước tải lớn

- Shared JSON hiện giới hạn 768 KiB; request JSON giới hạn 1 MiB. Ảnh CCCD không
  được đưa vào state; cần object storage có kiểm soát quyền trước khi bật upload.
- Cần rate-limit/WAF cho `/api/login` và smoke-test chi phí PBKDF2 trên plan chạy.
- Cần retention cho audit/command receipts và chuẩn hóa các collection tăng dài
  (đơn hàng, chấm công) thành bảng domain trước khi vận hành dữ liệu lớn.
