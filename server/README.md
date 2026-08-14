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
  --data '{"username":"admin","password":"<mat-khau-tu-8-ky-tu>","displayName":"Admin","initialState":{}}'
```

Không đưa `BOOTSTRAP_TOKEN` hoặc mật khẩu vào Git. Sau khi khởi tạo thành công,
có thể xoay hoặc gỡ secret bootstrap. API băm mật khẩu bằng PBKDF2-SHA256 và chỉ
lưu hash, salt, số vòng lặp.

## Hợp đồng frontend

`POST /api/login` nhận `username`, `password`; lưu `token` trả về ở bộ nhớ phiên
và gửi `Authorization: Bearer <token>`. Không lưu token vào shared state.
Phiên mặc định có hiệu lực 12 giờ để bao phủ một ngày chấm công;
có thể ghi đè bằng biến `SESSION_TTL_SECONDS`.

`GET /api/bootstrap` trả `user`, `state`, `version`, `policies`. `state` đã được
chiếu theo quyền. Client phải coi key bị thiếu/mảng rỗng là authoritative; không
được trộn projection với demo seed. `policies` ở top-level là nguồn chính thức
từ D1, không đọc `state.policies`.

Mọi `POST /api/command` cần `Idempotency-Key` duy nhất và `expectedVersion` khi
lệnh sửa shared state. Khi nhận `VERSION_CONFLICT`, tải lại `/api/state` rồi yêu
cầu người dùng thử lại; không tự ghi đè.

Các lệnh chính:

- Vai trò `manager` dùng projection toàn hệ thống nhưng không nhận dữ liệu Khối
  văn phòng. Manager không thể gọi `state.merge|replace`, sửa/xóa/tạo đơn hàng,
  đổi chính sách, xóa cửa hàng/nhân viên hoặc thay giờ chấm công. Các giới hạn
  này được kiểm tra ở Worker, không phụ thuộc việc ẩn nút trên giao diện.
- `store.create|update`: admin/manager; `store.delete`: chỉ admin. `store.update`
  nhận `storeId` cùng `name`, `short`, `location`, `address`, `phone`, `email`,
  `tax`, `opening`, `closing`, `accent`, `status` cần đổi. Giờ mở/đóng theo 24
  giờ; server cũng chấp nhận alias `taxCode`, `openingTime`, `closingTime` và trả
  về cả hai tên để tương thích state hiện tại.
- `employee.create|update`: admin/manager cho nhân viên cửa hàng; manager bị chặn
  với `OFFICE`. Create nhận hồ sơ trực tiếp cùng `username`, `password`; Worker
  tự sinh mã cửa hàng, kiểm tra điện thoại `0` + 9 số và commit hồ sơ + tài khoản
  đăng nhập trong cùng transaction. `employee.delete` chỉ admin. Update có thể
  nhận `username`, `password` để cập nhật credential nguyên tử với hồ sơ.
  Hồ sơ `OFFICE` nhận `workStart`, `workEnd` theo `HH:mm` (giờ ra sau
  giờ vào trong cùng ngày) và cặp `standardWorkDaysPeriod: YYYY-MM`,
  `standardWorkDays: 1..31`. Server gộp cặp này vào
  `monthlyWorkdayTargets[period]` của riêng nhân viên.
- `shift_definition.create|update|delete`: admin/manager, payload `storeId`,
  `name`, `date?`, `start`, `end` theo 24 giờ; màu sáng và thời lượng do server
  tạo. `schedule.assign` nhận `storeId`, `date`, `employeeIds[]`, `shiftIds[]`;
  `schedule.replace_day` nhận `assignments[]` để thay toàn bộ một ngày. Server
  kiểm tra ca theo đúng ngày áp dụng và lưu `shiftSnapshots[]` bất biến trong
  từng phân công để sửa/xóa định nghĩa ca không làm đổi lịch sử.
- `tasks.replace_scope`: admin/manager, payload `storeId`, `date`, `shiftId`,
  `tasks[{id?,title,detail?}]`; thay đúng phạm vi cửa hàng/ngày/ca. `shiftId`
  có thể rỗng cho việc chung; nếu có thì ca phải đang hoạt động, thuộc đúng cửa
  hàng và ngày áp dụng phải khớp `date`.
- `support_transfer.create`: admin/manager, payload `employeeId`, `toStoreId`,
  `fromDate`, `toDate`, `note?`; cửa hàng đi được lấy từ hồ sơ nhân viên.
  `support_transfer.update` nhận `transferId` và các trường cần đổi (`toStoreId`,
  ngày, ghi chú, trạng thái); `support_transfer.delete` nhận `transferId`,
  `reason` và xóa mềm. Manager không được điều chuyển Khối văn phòng. Kỳ lương
  liên quan đã khóa sẽ chặn thay đổi.
- `account_settings.update`: admin/manager tự cập nhật tài khoản hiện tại với
  payload `name`, `email`, `phone`, `birthday`, `gender`, `address`, `bio`,
  `avatar?`, `notifications {tasks,dailyReport,expenseAlert}`. Ảnh là data URL
  PNG/JPEG tối đa 128 KiB sau nén; response trả `settings`, `user`, `version`.
- `notification.mark_read`: mọi tài khoản đăng nhập, payload
  `{ notificationId }`; chỉ đánh dấu thông báo nằm trong projection của actor.
  `notification.mark_all_read` nhận `{ storeId? }` và đánh dấu toàn bộ thông báo
  chưa đọc trong phạm vi đó. Employee luôn bị cố định vào cửa hàng/tài khoản của
  mình; manager không bao giờ chạm dữ liệu `OFFICE`. `notification.clear` và
  `notification.clear_all` là alias tương thích, chỉ đánh dấu đã đọc chứ không
  xóa bản ghi. Response trả `notificationIds`, `notifications`, `updatedCount`,
  `version`; lệnh không có gì để đổi trả `existing: true` và không tăng version.
- `system.reset_demo`: chỉ admin, payload `{ state: <demo snapshot> }`; server
  kiểm tra/sanitize snapshot rồi thay shared state trong một transaction. Lệnh
  không sửa/xóa bảng user, credential, session và giữ thiết lập tài khoản riêng;
  response trả state đã projection cùng `version` mới.

- `order.create`: payload `storeId`, `customerName`, `customerPhone?`,
  `customerAge?`, `amount` (số nguyên VND), `paymentMethod`. Với employee, server
  cố định employee/store từ session và tự gắn attendance/ca đang mở. Mã đơn và
  timestamp được sinh trong cùng transaction với state, counter, audit, receipt.
- `attendance.check_in`: payload `shiftId?`, `location { latitude, longitude,
  accuracy?, label? }`. Server dùng giờ Việt Nam, policy đi sớm/đi trễ và snapshot
  ca; không nhận giờ từ client.
  Nhân viên `OFFICE` không có ca được phân sẽ dùng ca
  `OFFICE_DEFAULT` do server suy ra từ hồ sơ; record snapshot ngày công
  chuẩn của tháng, `minutesEarly`, `minutesLate` và chỉ cho một lượt/ngày.
- `attendance.check_out`: payload `attendanceId?`, `location`, `expense?`,
  `tiktok?`. Server tự tính thời lượng và doanh thu đơn gắn với lượt
  chấm công; chi phí ca nếu có được ghi cùng transaction.
  Với `OFFICE`, checkout chỉ nhận thời gian server và vị trí, sau đó
  đánh dấu `workdayCredit: 1`; không nhận chi phí/TikTok.
- `attendance.update`: chỉ admin, payload `attendanceId`, `date?` (alias
  `workDate`), `checkIn`, `checkOut?` theo `HH:mm`, `reason` bắt buộc. Server tự
  dựng timestamp giờ Việt Nam, tính lại thời lượng/đi sớm-trễ nhưng giữ nguyên
  liên kết nhân viên/cửa hàng/ca và số liệu đơn hàng. Kỳ lương đã chi/khóa chặn
  sửa; kỳ đã chốt được đánh dấu cần chốt lại.
- `order.update`: admin, payload `orderId`, các trường khách hàng/
  `amount`/`paymentMethod` cần sửa và `reason` bắt buộc. `order.delete`
  nhận `orderId`, `reason` và chỉ xóa mềm. Cả hai tính lại tổng ca.
- `task.done` (alias `task.set_done`): employee, payload `taskId`, `done`.
  Server lấy nhân viên/cửa hàng từ session và chỉ đổi cờ của chính actor.
- `fixed_expense.create|update|delete`: admin/manager; create nhận `storeId`, `type`,
  `amount`, `note?`, `occurredAt?`; update/delete dùng `expenseId` và `reason`.
  Lệnh `expense.create|update|delete` có cùng envelope cho chi phí thủ công.
- `import.create`: admin/manager, payload `storeId`, `items[{name,category,
  quantity,weight,price,shippingAmount?,note?}]`, `shippingAmount?`,
  `relatedAmount?`. `quantity` là số bao; tiền hàng tính bằng `weight * price`.
  Server sinh mã `PN-dd/mm/yy-0001` theo giờ Việt Nam bằng counter toàn cục. `import.update`
  và `import.delete` nhận `voucherId`, `reason`; xóa là xóa mềm và void
  expense liên kết. Có alias `import_voucher.*`.
- `salary_advance.create`: admin/manager (manager chỉ nhân viên cửa hàng), payload `employeeId`, `period` (`YYYY-MM`),
  `amount`, `note?`; update dùng `advanceId`, `amount?`, `note?`; confirm dùng
  `advanceId` và cùng lúc ghi cash-out + expense.
- `salary_adjustment.create`: admin/manager (manager chỉ nhân viên cửa hàng), payload `employeeId`, `period`, `type`
  (`Thưởng khác`, `Phụ cấp khác` hoặc `Khấu trừ`), `amount`, `note?`.
- `payroll.close|pay|lock`: admin/manager cho cửa hàng, payload `storeId`, `period`. Server tự chốt
  attendance, lương, KPI, ứng lương và finance; `pay` chỉ chi phần còn
  lại, `lock` chỉ áp dụng sau khi đã chi. Nếu nguồn tài chính/lương
  đổi sau khi chốt, `pay` trả `PAYROLL_NEEDS_RECLOSE` cho đến khi chốt lại.
  Lương tháng `OFFICE` được chia theo ngày hoàn tất chấm công
  trên ngày công chuẩn đã snapshot; manager không thể thao tác
  payroll hoặc nhận projection `OFFICE`.
- `policy.set`: admin, payload `key`, `value`, dùng version riêng của policy.
  Khi lưu nhiều ô cùng lúc, dùng `policies.set` với payload
  `updates: [{ key, value, expectedVersion }]` để toàn bộ thay đổi cùng commit
  hoặc cùng rollback.
  Các ngưỡng chuyên cần là `attendance_maintain_max_late_count`,
  `attendance_improve_min_late_count` và `attendance_improve_min_late_minutes`.
- `user.create`, `user.update`, `user.set_status`, `user.reset_password`: admin
  quản lý manager/employee; manager chỉ quản lý credential employee ngoài
  `OFFICE`, không được đặt `inactive`. Chỉ admin được tạo/sửa tài khoản manager.
  `employeeId` bất biến; đổi đơn vị sẽ thu hồi session.
- `user.change_password`: chính người dùng, payload `currentPassword`,
  `newPassword`; giữ session hiện tại và thu hồi các session còn lại.
- `state.merge`/`state.replace`: chỉ admin; là cầu nối cho dữ liệu chưa có domain
  command, không dùng cho mutation employee. Worker luôn giữ nguyên
  `accountSettings` hiện có và từ chối payload cố sửa collection này; thiết lập
  tài khoản chỉ được lưu qua `account_settings.update`.

Response ghi thành công luôn có `serverTime`, `requestId`; lệnh tạo mới trả 201.
Gửi lại cùng idempotency key và cùng body nhận lại response cũ kèm header
`Idempotency-Replayed: true`.

`state.replace` được lọc đệ quy trước khi lưu: password, token, API key,
secret, cookie/authorization và credential envelope không được phép đi vào
shared state. Client không được coi shared state là kho credential.

## Lược đồ collection tách dòng (migration 0003)

`drizzle/0003_state_entities.sql` thêm ba bảng D1 để bỏ shared JSON
nguyên khối mà không đổi API:

- `state_collections` lưu manifest của từng mảng cấp cao, kể cả mảng rỗng.
- `state_entities` lưu từng phần tử JSON cùng `entity_order` thưa để
  dựng lại đúng thứ tự mà thao tác prepend không phải ghi lại lịch sử.
  Migration dùng khóa vị trí `legacy:*`, vì vậy phần tử thiếu/trùng ID
  vẫn được giữ nguyên.
- `command_receipt_chunks` lưu phần text UTF-8 của response idempotent quá lớn.
  `command_receipts.response_json` phải giữ một manifest JSON nhỏ (số chunk,
  tổng byte); nối chunk theo `chunk_index` mới tạo response gốc.

Migration phát hiện mọi mảng cấp cao bằng `json_each`, kể cả mảng rỗng, rồi
backfill từng phần tử. Nó **không** xóa hoặc rút gọn `app_state.value_json`;
Worker hydrate các bảng mới ngay khi đọc; lần ghi thành công kế tiếp rút
các mảng khỏi `app_state` và chỉ giữ compact shell. Mỗi `value_json` và
mỗi chunk bị giới hạn 1.500.000 byte, chừa khoảng an toàn dưới
giới hạn 2 MB của một dòng/string D1.

Khi nối Worker với các bảng này, phải giữ các bất biến sau:

1. Hydrate collection tại một điểm chung ngay sau khi đọc `app_state`, sắp xếp
   theo `(entity_order, entity_key)`; mọi projection admin/manager/employee chạy
   trên state đã hydrate.
2. Ghi CAS `app_state`, entity, audit, counter, receipt và receipt chunk trong
   cùng một D1 batch. Mỗi câu INSERT/UPDATE/DELETE entity phải tự guard bằng
   `EXISTS` khớp `scope_key`, version mới và `last_request_id`; CAS cập nhật 0
   dòng không tự làm D1 batch rollback.
3. `bootstrap`, `state.replace` và `system.reset_demo` phải đồng bộ thêm/xóa
   collection/entity trong cùng transaction. Chỉ rút các mảng khỏi legacy JSON
   sau khi hydrate, reset, replay idempotent và rollback do conflict đều đã có
   regression test.
4. Chia chunk ở biên UTF-8 và ghi manifest/chunk trong cùng transaction.
   Replay xác minh liên tục `chunk_index`, byte từng chunk và tổng byte.

## Giới hạn cần xử lý trước tải lớn

- Compact shell và mỗi entity/chunk giới hạn 1.500.000 byte; request JSON
  giới hạn 16 MiB. Ảnh CCCD không
  được đưa vào state; avatar data URL tối đa 128 KiB. Cần object storage có kiểm
  soát quyền trước khi bật upload ảnh lớn.
- Cần rate-limit/WAF cho `/api/login` và smoke-test chi phí PBKDF2 trên plan chạy.
- Cần đặt retention cho audit/command receipts và theo dõi quota D1 trước khi
  vận hành dữ liệu rất lớn.
