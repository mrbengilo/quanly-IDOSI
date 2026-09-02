# IDOSI Sites API

Worker này phục vụ SPA và API dùng chung trên Sites. GitHub Pages chỉ phục vụ
file tĩnh và **không chạy** Worker/D1.

## Khởi tạo môi trường mới

1. Tạo D1 binding logic tên `DB` và chạy migration trong `drizzle/`.
2. Tạo R2 binding riêng tư tên `IDENTITY_IMAGES` cho ảnh CCCD; bucket không
   được public trực tiếp.
3. Đặt secret runtime `BOOTSTRAP_TOKEN` đủ dài và ngẫu nhiên.
4. Nếu bật gợi ý địa chỉ Google Maps, đặt secret runtime
   `GOOGLE_MAPS_API_KEY`; tuyệt đối không đưa khóa này vào mã frontend.
5. Deploy bằng Sites, sau đó gọi đúng một lần:

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

`POST /api/login` nhận `username`, `password`; cả tên đăng nhập và mật khẩu đều
phân biệt chữ hoa/thường. Lưu `token` trả về ở bộ nhớ phiên và gửi
`Authorization: Bearer <token>`. Không lưu token vào shared state.
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

- Worker chỉ lưu bốn role code: `admin`, `business_support`, `store_manager`,
  `employee`. Role `employee` được tách nhóm hiển thị bằng `employees.unit`
  (`store` hoặc `office`), nên hệ thống có năm nhóm nhân sự trên giao diện.
  `business_support` kế thừa projection đọc toàn hệ thống giống Admin, gồm cả
  `OFFICE`, tài chính, đơn hàng và lịch sử, nhưng chỉ nhận account settings của
  chính họ và không nhận credential/secret. Ngoài thao tác tự phục vụ, role này
  được tạo mới hồ sơ+tài khoản `store_manager`, `office` và `store`, sửa/xóa đơn hàng,
  chỉnh chấm công nhân viên cửa hàng, quản lý điều chuyển, khôi phục lần
  sửa/xóa vận hành gần nhất và cập nhật công việc Admin giao cho chính mình.
  Trong workspace cửa hàng thật, Hỗ trợ KD có cùng lệnh vận hành với Quản lý
  cửa hàng (cập nhật cửa hàng/nhân viên cửa hàng, ca, phân ca, giao việc, nhập
  hàng, chi phí, ứng/điều chỉnh/chốt lương) nhưng được chọn bất kỳ cửa hàng;
  họ vẫn không được xóa nhân viên hoặc quản trị credential trực tiếp;
  `store_manager` bắt buộc có `store_id` thật và chỉ nhận/ghi dữ liệu đúng cửa
  hàng đó. Cả hai không thể gọi `state.merge|replace` hoặc xóa cửa hàng/nhân viên;
  Hỗ trợ KD được đọc/ghi chính sách như Admin nhưng không được gọi
  `system.reset_demo`. `store_manager` không được sửa/xóa
  đơn hàng; hai thao tác này chỉ dành cho Admin và Hỗ trợ KD.
- `store.create`: chỉ admin; `store.update`: admin, business_support hoặc
  store_manager của đúng cửa hàng; `store.delete`: chỉ admin. `store.update`
  nhận `storeId` cùng `name`, `short`, `location`, `address`, `phone`, `email`,
  `tax`, `opening`, `closing`, `accent`, `status` cần đổi. Giờ mở/đóng theo 24
  giờ và giờ đóng phải sau giờ mở; server cũng chấp nhận alias `taxCode`,
  `openingTime`, `closingTime` hoặc `operatingHours {opening,closing}`. State/projection
  canonical luôn trả đủ `opening`, `openingTime`, `closing`, `closingTime` và
  `operatingHours`, nên giờ hoạt động là dữ liệu đã lưu chứ không phải UI tĩnh.
- `employee.create|update`: admin cho mọi nhóm; store_manager chỉ cho nhân viên
  `unit: store` thuộc đúng cửa hàng; business_support được thêm/cập nhật
  `unit: store` ở mọi cửa hàng và vẫn được tạo mới `unit: store_manager|office`.
  Admin tạo mọi nhóm. Create nhận
  hồ sơ trực tiếp cùng `username`, `password`; Worker
  tự sinh mã cửa hàng, kiểm tra điện thoại `0` + 9 số và commit hồ sơ + tài khoản
  đăng nhập trong cùng transaction. `employee.delete` chỉ admin. Update có thể
  nhận `username`, `password` để cập nhật credential nguyên tử với hồ sơ.
  Hồ sơ `unit: business_support` tự nhận `storeId: BUSINESS_SUPPORT`, role
  `business_support`, mã toàn cục `HTKD-001...`; hồ sơ `unit: store_manager`
  bắt buộc `storeId` thật, role `store_manager`, mã toàn cục `QLCH-001...`.
  Cả hai nhận `name`, điện thoại `0` + 9 số, `cccd` đúng 12 số, `address`,
  `startDate: YYYY-MM-DD`, vị trí đúng vai trò, `username`/`password` và ảnh
  CCCD. Hỗ trợ KD nhận `employmentType` (`Full-Time`, `Part-Time`,
  `Thực Tập Sinh`). Quản lý cửa hàng chỉ nhận `Full-Time|Part-Time`, không có
  lương cơ bản: profile canonical dùng `payBasis: allowance-only`,
  `salaryUnit: none` và chỉ nhận thưởng/phụ cấp cuối tháng. Có thể tạo hồ sơ mới
  hoặc truyền `linkedEmployeeId` để phân quyền quản lý cho nhân viên bán hàng
  hiện hữu; hồ sơ bán hàng và cách tính lương cửa hàng vẫn giữ nguyên. Tài khoản
  không bị đổi vai trò gốc: lần đăng nhập kế tiếp Worker trả `availableRoles`
  để người dùng chọn `Quản lý` hoặc `Nhân viên`. Hỗ trợ KD được liên kết thêm
  cả hồ sơ bán hàng và quản lý sẽ có đủ ba lựa chọn `Quản lý`, `Nhân viên`,
  `Hỗ trợ KD`. Lựa chọn được lưu trên session qua `POST /api/session/role` và
  được xác thực lại ở mọi request; xóa hồ sơ liên kết sẽ thu hồi các session
  hiện hành nên quyền vừa xóa không thể tiếp tục sử dụng.
  Khi tạo hồ sơ `unit: store`, Admin/Hỗ trợ KD cũng có thể truyền
  `linkedEmployeeId` của hồ sơ `office|business_support`; chỉ cần bổ sung
  lương theo giờ. Hệ thống dùng chung credential/CCCD, tạo thêm lựa chọn
  `Nhân viên cửa hàng` và chặn liên kết trùng trong cùng cửa hàng.
  Hồ sơ `unit: office` bắt buộc `storeId: OFFICE`, tự sinh mã `VP-001...`, điện thoại `0` + 9 số, CCCD đúng
  12 số, bắt buộc địa chỉ, ngày bắt đầu, loại nhân viên (`Full-Time`,
  `Part-Time`, `Thực Tập Sinh`), vị trí (`Kế Toán`, `Marketing`) và cặp
  `username`/`password`; create mới bắt buộc đủ `identityImages.front|back` và
  commit hồ sơ+tài khoản trong một transaction.
  `addressDetails` tùy chọn có cấu trúc `{province,ward,street}` để lưu đúng ba
  tầng địa chỉ mà giao diện đã chọn.
  Mọi create nhân viên bắt buộc đủ ảnh CCCD trước/sau và cặp
  `username`/`password` do người tạo nhập; server không tự sinh credential.
  Khi tạo `unit: store`, Worker cố định vị trí `Nhân viên bán hàng`, bỏ qua mọi
  `id|code|employeeCode` từ client và tự sinh mã theo thương hiệu + chi nhánh,
  ví dụ `DOSSI-LVT-001`, `DOSII-TNV-001`, `SM-TNV-001`; các cửa hàng legacy vẫn
  dùng mã ngắn tương thích. Hồ sơ+tài khoản được commit nguyên tử nên tài khoản
  do Hỗ trợ KD tạo đăng nhập được ngay sau response thành công.
  Sau migration xóa credential, `employee.update` có thể nhận lại cặp
  `username`/`password` để phát hành tài khoản mới nguyên tử cho đúng
  profile hiện hữu; mã profile và lịch sử nghiệp vụ không thay đổi.
  Hồ sơ `office` và `business_support` chỉ nhận baseline giờ làm canonical khi
  `employee.create`: `workTimeType`, `workShifts:[{id,name,start,end}]` và
  `workingTime:{type,mode,shifts}`. Full-Time có đúng một khung cố định;
  Part-Time/Thực Tập Sinh có 1..12 ca đặt tên. `workStart`/`workEnd` là alias
  của ca đầu tiên để tương thích client cũ; mọi giờ theo `HH:mm`, giờ ra sau
  giờ vào trong cùng ngày, id/tên ca không trùng.
  Sau khi tạo hồ sơ, cấu hình giờ làm baseline không được sửa trực tiếp qua
  `employee.update`. Lệnh cũ `employee.working_time.set` đã ngừng sử dụng và trả
  `COMMAND_RETIRED`; dữ liệu `workTimeSchedule` lịch sử vẫn được bảo toàn để đọc
  đúng chấm công và lương lịch sử. Lịch đăng ký/phân lịch mới dùng luồng lịch làm
  việc hiện hành, không ghi đè cấu hình hoặc snapshot quá khứ.
  Khi chấm công office-like, client gửi `shiftId` của ca đã chọn; Worker chụp
  bất biến `shiftId/name/start/end` và `shiftSource: profile-work-shift` vào bản
  ghi, nên chỉnh lịch tương lai không viết lại snapshot chấm công lịch sử.
  Hồ sơ office-like còn nhận cặp `standardWorkDaysPeriod: YYYY-MM`,
  `standardWorkDays: 1..31`. Server gộp cặp này vào
  `monthlyWorkdayTargets[period]` của riêng nhân viên.
  Hồ sơ Full-Time cửa hàng nhận `standardWorkDays: 1..31`,
  `requiredMonthlyHours: >0..744` và `baseSalary` là số nguyên VND. Full-Time
  SecondMall SM234 bắt buộc đủ ba trường và lưu `payFormula: monthly-hours`.
  `identityImages.front|back` nhận data URL JPEG/PNG/WebP đã tối ưu tối đa 300 KiB/ảnh; giao diện nhận ảnh gốc tối đa 5 MiB rồi tự thu nhỏ/nén;
  Worker chỉ lưu metadata/key trong D1 và byte ảnh trong R2. Ảnh được lấy qua
  `GET /api/identity-images/:employeeId/:side` có Bearer token; Admin và Hỗ trợ
  KD xem được toàn bộ, Quản lý cửa hàng xem hồ sơ thuộc cửa hàng mình, còn nhân
  viên chỉ xem ảnh của chính mình.
- `shift_definition.create|update|delete`: admin/business_support/store_manager, payload `storeId`,
  `name`, `date?`, `start`, `end` theo 24 giờ; màu sáng và thời lượng do server
  tạo. `schedule.assign` nhận `storeId`, `date`, `employeeIds[]`, `shiftIds[]`;
  `schedule.replace_day` nhận `assignments[]` để thay toàn bộ một ngày. Server
  kiểm tra ca theo đúng ngày áp dụng và lưu `shiftSnapshots[]` bất biến trong
  từng phân công để sửa/xóa định nghĩa ca không làm đổi lịch sử.
- `tasks.assign`: admin/business_support/store_manager, payload
  `{storeId,date,shiftId,employeeIds[],tasks:[{id?,title,detail?}]}`. Có thể giao
  cho nhiều nhân viên thuộc cửa hàng ở bất kỳ ca/ngày tương lai, không yêu cầu
  ca đã bắt đầu hay có attendance. Mỗi lần gọi append một `assignmentId`, tạo
  notification riêng cho từng nhân viên và ghi snapshot bất biến vào
  `taskAssignmentHistory`; không ghi đè lịch sử. `tasks.replace_scope` vẫn là
  alias tương thích để thay danh sách active đúng phạm vi, nhưng before-image
  cũng được giữ trong history. `shiftId`
  có thể rỗng cho việc chung; nếu có thì ca phải đang hoạt động, thuộc đúng cửa
  hàng và ngày áp dụng phải khớp `date`.
- `support_work.assign`: chỉ Admin, payload
  `{date,targetUnit:'business_support'|'office',employeeId,tasks:[{id?,name,description}]}`;
  nhân viên đích phải thuộc đúng nhóm đã chọn. Mỗi lần gửi tạo một lượt mới, kể cả cùng nhân viên/ngày,
  để không ghi đè lịch sử. Chỉ khi Admin truyền `assignmentId` rõ ràng, một lượt
  chưa nộp mới được thay atomically; history giữ snapshot task trước/sau. State
  canonical là `supportWorkAssignments[]`; mỗi lượt có metrics, trạng thái,
  `assignedAt`, `updatedAt`, `submittedAt` và `history[]` đầy đủ task/timestamp.
  Server đồng thời tạo notification `support-work-assigned` trỏ tới
  `/support/assigned-work` hoặc `/employee/assigned-work` chỉ cho đúng nhân viên.
- `support_work.update`: chỉ nhân viên Hỗ trợ KD/Khối văn phòng của chính lượt được giao, payload
  `{assignmentId,tasks:[{id,completed,note?}],submit?,incompleteReason?}`. Thuộc tính
  `note` có thể rỗng để xóa ghi chú; nếu client cũ không gửi thuộc tính này thì server
  giữ nguyên ghi chú đã lưu. Khi `submit:true` mà còn công việc bắt buộc
  chưa hoàn thành, `incompleteReason` là bắt buộc;
  lượt đã submit bị khóa. Server lưu timestamp người tick, lịch sử đầy đủ và
  thông báo Admin khi gửi kết quả. `supportWorkAssignments` là collection được
  bảo vệ, không thể sửa qua `state.merge|replace`.
- `support_schedule.assign|delete`: Admin hoặc Nhân viên hỗ trợ KD được quản lý
  lịch của cả hai nhóm; tài khoản `employee` thuộc Khối văn phòng chỉ được tạo,
  sửa và xóa lịch của chính `employee_id` trong phiên đăng nhập. Worker ép
  `targetUnit:'office'` và trả `403 SUPPORT_SCHEDULE_SELF_ONLY` nếu tài khoản
  văn phòng gửi ID người khác hoặc thao tác trên lịch không thuộc mình. Assign
  nhận payload `{scheduleId?,targetUnit,employeeId,date,start,end,shiftName?,note?}`;
  `scheduleId` dùng khi sửa. Delete nhận `{scheduleId,reason}` và bắt buộc lý do.
  Trong đó
  `targetUnit` là `business_support` hoặc `office` (mặc định
  `business_support` để tương thích dữ liệu cũ). Nhân viên đích phải thuộc đúng
  nhóm đã chọn; Part-Time/Thực Tập Sinh bắt buộc tên ca, Full-Time dùng
  một khung giờ bắt đầu/kết thúc. Worker upsert lịch hiện hành theo
  `employeeId + date`, append snapshot vào `supportWorkScheduleHistory`, tạo
  notification cho đúng nhân viên và ưu tiên lịch ngày này khi chấm công.
  Nhân viên Khối văn phòng đọc lịch cá nhân tại `/employee/schedule`; Nhân viên
  hỗ trợ KD đọc tại `/support/my-schedule`.
- `support_transfer.create|update`: `admin` hoặc `business_support`; `support_transfer.delete`
  chỉ dành cho `admin`, các role còn lại nhận `403`. Create nhận
  `{employeeId,fromStoreId?,toStoreId,fromDate,toDate,hourlySupportRate,allowance,note?}`;
  chấp nhận alias `startDate/endDate`, `startAt/endAt`, `date` và `hourlyRate`, nhưng
  response canonical luôn là `fromDate/toDate/hourlySupportRate`. Cửa hàng đi phải
  khớp hồ sơ nhân viên cửa hàng; cửa hàng nhận phải khác và không được
  có lịch active trùng ngày cho cùng nhân viên. Update nhận `transferId`
  cùng các trường cần đổi; delete nhận `transferId`, `reason` và xóa mềm.
  Kỳ lương đã chi/khóa ở cửa hàng đi hoặc nhận chặn thay đổi; kỳ đã
  chốt được invalidation để chốt lại. Trong khoảng điều chuyển, session nhân
  viên tự chuyển sang cửa hàng nhận; cửa hàng nhận thấy hồ sơ cùng thời gian,
  lương giờ hỗ trợ, phụ cấp và có thể xếp ca/giao việc. Chấm công, đơn hàng,
  doanh thu và chi phí lương hỗ trợ được ghi vào cửa hàng nhận. Lương hỗ trợ =
  giờ làm thực tế × `hourlySupportRate`, cộng `allowance`. Nếu thời gian điều chuyển
  đã hết nhưng ca hỗ trợ còn mở, session vẫn giữ tại cửa hàng nhận để nhập đơn và
  kết ca; chỉ sau khi kết ca hỗ trợ mới tự trở về cửa hàng gốc. Mọi lệnh commit state + audit +
  receipt idempotency nguyên tử.
- `account_settings.update`: mọi tài khoản đăng nhập tự cập nhật tài khoản hiện tại với
  payload `name`, `email`, `phone`, `birthday`, `gender`, `address`, `bio`,
  `avatar?`, `notifications {tasks,dailyReport,expenseAlert}`. Giao diện nhận ảnh gốc
  JPG/PNG/WebP tối đa 5 MiB, tự resize/nén trước khi gửi. API chỉ nhận data URL
  JPG/PNG/WebP có chữ ký ảnh đúng MIME và dung lượng giải mã tối đa 300 KiB;
  response trả `settings`, `user`, `version`.
- `notification.mark_read`: mọi tài khoản đăng nhập, payload
  `{ notificationId }`; chỉ đánh dấu thông báo nằm trong projection của actor.
  `notification.mark_all_read` nhận `{ storeId? }` và đánh dấu toàn bộ thông báo
  chưa đọc trong phạm vi đó. Employee luôn bị cố định vào cửa hàng/tài khoản của
  mình; store_manager bị cố định vào `store_id` của session. `notification.clear` và
  `notification.clear_all` là alias tương thích, chỉ đánh dấu đã đọc chứ không
  xóa bản ghi. Response trả `notificationIds`, `notifications`, `updatedCount`,
  `version`; lệnh không có gì để đổi trả `existing: true` và không tăng version.
- `system.reset_demo`: chỉ admin, payload `{ state: <demo snapshot> }`; server
  kiểm tra/sanitize snapshot rồi thay shared state trong một transaction.
  Cùng transaction, Worker xóa mọi user không phải Admin; session/receipt
  cascade, tham chiếu audit được giữ với `actor_id = NULL`, và chỉ giữ
  account settings của Admin. Response trả state đã projection cùng
  `version` mới và `nonAdminAccountsPurged: true`.

- `system.reset_all`: chỉ Admin, payload chính xác
  `{confirmation:'RESET_ALL_DATA'}` và vẫn cần `expectedVersion`. Lệnh xóa mọi
  state nghiệp vụ (kể cả private scope/entity), **mọi tài khoản trừ đúng Admin
  đang gọi lệnh** (bao gồm xóa các Admin khác), mọi
  session trừ phiên Admin đang gọi, receipt/chunk, audit cũ, counter và đưa
  policy về mặc định. Chỉ credential và account settings của caller được giữ
  lại; mã nghiệp vụ phát sinh lại từ đầu. Namespace R2 duy
  nhất bị xóa là `identity-images/`; object ngoài prefix này không bị chạm tới.
  Reset dùng hai pha: D1 lưu marker pending sau khi purge, sau đó Worker liệt kê
  phân trang, xóa và xác minh prefix ảnh rỗng. Chỉ khi xác minh thành công mới
  ghi đúng một audit + receipt thành công và xóa marker. Nếu R2 lỗi, API trả
  `503 RESET_CLEANUP_PENDING`, giữ phiên Admin hiện tại, khóa các lệnh ghi khác
  và **không** ghi success receipt. Client nên giữ `Idempotency-Key` trong
  `sessionStorage` để retry ổn định; nếu trang bị tải lại hoặc key đổi, đúng
  Admin đã khởi tạo vẫn có thể gửi lại confirmation chính xác để tiếp tục
  cleanup/finalize receipt gốc (không chạy thêm lần purge D1). Response thành
  công trả `reset.purged`, danh sách Admin được giữ, số policy mặc định và
  `identityImageStorageVerifiedEmpty: true`.

- `order.create`: payload `storeId`, `customerName`, `customerPhone?`,
  `customerAge?`, `gender` (`Nam|Nữ|Khác`), `occupation` bắt buộc,
  `acquisitionChannel` (`Facebook|Tiktok|Zalo|Bạn Bè|Người thân|Khác`),
  `amount` (số nguyên VND), `paymentMethod`. Với employee, server
  cố định employee/store từ session và tự gắn attendance/ca đang mở. Mã đơn và
  timestamp được sinh trong cùng transaction với state, counter, audit, receipt.
- `attendance.check_in`: payload `shiftId?`, `location { latitude, longitude,
  accuracy?, label? }`. Server dùng giờ Việt Nam, policy đi sớm/đi trễ và snapshot
  ca; không nhận giờ từ client.
  Với nhân viên cửa hàng, giờ điểm danh thực tế chọn đúng một danh mục công việc
  bắt buộc (`<12:00` ca sáng, `12:00–16:59` ca chiều, `>=17:00` ca tối); snapshot
  đồng thời giữ toàn bộ công việc tính thưởng đang áp dụng cho ca. Snapshot đã chốt
  là bất biến: sửa danh mục sau đó không thêm việc ngược vào ca đang mở. Dữ liệu cũ
  thiếu toàn bộ checklist chuẩn (kể cả khi có việc tùy chỉnh/thưởng) được phục hồi
  một lần bằng commit tăng phiên bản có audit trước khi trả projection. Nếu các dòng
  công việc/lịch sử bị thiếu, server dựng lại từ snapshot bất biến ngay cả khi danh
  mục hiện tại đã bị tắt hoặc xóa; giờ vào không hợp lệ thì chưa chốt snapshot để lần
  chỉnh chấm công có audit sau đó tạo đúng danh sách đầy đủ.
  Nhân viên `OFFICE` không có ca được phân sẽ dùng ca
  `OFFICE_DEFAULT` do server suy ra từ hồ sơ; record snapshot ngày công
  chuẩn của tháng, `minutesEarly`, `minutesLate` và chỉ cho một lượt/ngày.
  Role `business_support` và `store_manager` cũng được chấm công khi tài khoản
  đã liên kết profile; server dùng ca mặc định `08:00-17:00` cho hai vai trò.
  Nhân viên cửa hàng đang trong thời gian điều chuyển có thể điểm danh trực tiếp
  tại cửa hàng nhận mà không cần lịch phân ca; server tạo snapshot ca hỗ trợ từ
  giờ hoạt động cửa hàng. Ca hỗ trợ đang mở tiếp tục giữ session tại cửa hàng nhận
  dù phiếu đã hết giờ; sau khi kết ca hỗ trợ, session tự trở lại cửa hàng gốc.
- `attendance.check_out`: payload `attendanceId?`, `location`, `expense?`,
  `tiktok?`. Với nhân viên cửa hàng, bắt buộc thêm `cashRevenue` và
  `transferRevenue`; server chỉ tổng hợp đơn `Hoàn tất` đúng employee/store/
  attendance rồi so khớp **từng kênh**. Sai trả `409 SHIFT_REVENUE_MISMATCH`
  và không commit. Nếu còn task đúng ngày/ca chưa tick, payload phải có
  `incompleteTaskReason`, đồng thời attendance lưu snapshot task/lý do và kết
  quả reconciliation. Server tự tính thời lượng; chi phí ca nếu có được ghi
  cùng transaction. Với ca điều chuyển, attendance trả và lưu
  `supportCompensation {transferId,homeStoreId,supportStoreId,transferStartAt,
  transferEndAt,hourlyRate,hours,basePay,allowance,allowanceApplied,totalPay,
  expenseEntryId}`. Phụ cấp chỉ gắn vào lượt hoàn tất sớm nhất của phiếu;
  `totalPay = floor(hours * hourlyRate) + allowance` được ghi một lần thành
  expense `support-attendance-compensation` của cửa hàng nhận hỗ trợ.
  Với `OFFICE`, checkout chỉ nhận thời gian server và vị trí, sau đó
  đánh dấu `workdayCredit: 1`; không nhận chi phí/TikTok.
- `attendance.update`: Admin hoặc Hỗ trợ KD, payload `attendanceId`, `date?` (alias
  `workDate`), `checkIn`, `checkOut?` theo `HH:mm`, `reason` bắt buộc. Hỗ trợ KD
  chỉ được sửa record của `unit: store` tại cửa hàng thật; không thể sửa
  `OFFICE`, `BUSINESS_SUPPORT` hay đổi liên kết nhân viên/cửa hàng/ca. Server tự
  dựng timestamp giờ Việt Nam, tính lại thời lượng/đi sớm-trễ nhưng giữ nguyên
  số liệu đơn hàng. Mỗi lần sửa ghi before/after server-side vào
  `attendanceAudit`. Kỳ lương đã chi/khóa chặn sửa; kỳ đã chốt được
  đánh dấu cần chốt lại.
- `attendance.emergency_close`: chỉ Admin, payload `attendanceId`, `reason`. Máy chủ
  dùng thời điểm hiện tại để kết thúc một ca đang mở, bỏ qua lịch/khung giờ/checklist
  bắt buộc và bước khai báo doanh thu; vẫn đối soát doanh thu từ đơn hoàn tất, ghi audit,
  tính lại giờ/lương hỗ trợ và từ chối thay đổi kỳ lương đã chi hoặc đã khóa.
- `order.update`: Admin hoặc Hỗ trợ KD, payload `orderId`, các trường khách hàng/
  `amount`/`paymentMethod` cần sửa và `reason` bắt buộc. `order.delete`
  nhận `orderId`, `reason` và chỉ xóa mềm. Cả hai tính lại tổng ca và ghi
  `orderAudit`. Kỳ lương đã chi/khóa chặn sửa/xóa; kỳ đã chốt bị
  invalidation để chốt lại. Hỗ trợ KD đọc lịch sử này trong shared-state projection; nếu gọi
  `GET /api/audit` thì chỉ nhận audit `order.update|order.delete`, không nhận
  nhật ký hệ thống khác.
- `operational_reset.restore`: chỉ Admin, payload
  `{dataType:'orders'|'attendance',storeId,fromDate,toDate,employeeId?,reason}`
  (có alias `startDate/endDate` hoặc `date`). Lệnh **không xóa sạch dữ liệu**:
  với mỗi entity trong scope, server chỉ khôi phục before-image của lần sửa/xóa
  chưa khôi phục gần nhất. Server so khớp current record với audit after-image;
  nếu có thay đổi mới hơn thì toàn lệnh trả `409 OPERATIONAL_RESET_STALE_AUDIT`
  thay vì ghi đè. Reset đơn hàng tính lại doanh thu/tiền mặt/chuyển khoản/
  số đơn của ca; cả hai loại đều audit, invalidation kỳ đã chốt và
  chặn kỳ đã chi/khóa. Lệnh không đổi/xóa tài khoản, cửa hàng, hồ sơ
  nhân viên hay bản ghi payroll; response trả `reset`, `restoredCount`,
  `restoredIds`, `restored` và `version`. Để tương thích dữ liệu đã phát sinh
  trước khi có `attendanceAudit`, nhánh attendance đọc riêng các D1 audit row
  `attendance.update` trong đúng scope, sanitize before/after, gán ID ổn định
  `ata_legacy_<audit_log.id>`, loại trùng với state audit và chỉ sau khi khôi phục
  mới nhập row đó vào history. Audit D1 attendance không được mở qua
  `GET /api/audit` cho Hỗ trợ KD.
- `operational_identifier.resolve_history_alias`: chỉ Admin, payload
  `{kind:'employee'|'store',aliasIdentifier,canonicalIdentifier,reason}`. Dùng
  khi một mã lịch sử chỉ khác chữ hoa/thường với đúng một hồ sơ đang hoạt động.
  Server giữ nguyên bản ghi lịch sử, chuẩn hóa trường mã và gắn
  `identifierAliasResolution` gồm mã cũ, mã chuẩn, lý do, người và thời điểm xử
  lý; toàn bộ before/after tiếp tục được ghi audit. Lệnh không tự gộp nhiều hồ
  sơ mơ hồ.
- `task.done` (alias `task.set_done`): employee, payload `taskId`, `done`.
  Server lấy nhân viên/cửa hàng từ session, chỉ cho đúng assignee trong đúng
  ngày/ca đang mở và append lịch sử hoàn thành.
- `fixed_expense.create|update|delete`: create/update dành cho
  admin/business_support/store_manager theo phạm vi cửa hàng; **chỉ Admin** được
  delete. Create nhận `storeId`, `occurredAt?`, `note?`,
  `items[{category,name?,amount,description?}]` với category `Set up|Mặt bằng|
  Điện|Nước|Wifi|Marketing|Rác|Khác`; `Khác` bắt buộc có tên hoặc nội dung.
  Mỗi amount là số nguyên VND không âm, tổng phiếu phải dương. Update/delete dùng
  `expenseId` và `reason`; delete là xóa mềm, giữ audit và void expense liên kết.
  Payload legacy `type,amount,note?` vẫn được chuẩn hóa thành phiếu một dòng.
  Lệnh `expense.create|update|delete` có cùng envelope cho chi phí thủ công.
- `import.create`: admin/business_support/store_manager theo phạm vi cửa hàng, payload `storeId`, `items[{name,category,
  quantity,weight,price,shippingAmount?,note?}]`, `shippingAmount?`,
  `relatedAmount?`. `quantity` là số bao; tiền hàng tính bằng `weight * price`.
  Server sinh mã `PN-dd/mm/yy-0001` theo giờ Việt Nam bằng counter toàn cục. `import.update`
  và `import.delete` nhận `voucherId`, `reason`; xóa là xóa mềm và void
  expense liên kết. Có alias `import_voucher.*`.
- `salary_advance.create`: admin/business_support/store_manager theo phạm vi cửa hàng, payload `employeeId`, `period` (`YYYY-MM`),
  `amount`, `note?`; update dùng `advanceId`, `amount?`, `note?`; confirm dùng
  `advanceId` và cùng lúc ghi cash-out + expense.
- `salary_adjustment.create`: admin/business_support/store_manager theo phạm vi cửa hàng, payload `employeeId`, `period`, `type`
  (`Thưởng khác`, `Phụ cấp khác` hoặc `Khấu trừ`), `amount`, `note?`.
- `store_salary_config.resolve_collision`: chỉ Admin, payload
  `{storeId,employeeId,effectiveFrom,keepConfigId,reason}`. Giữ đúng cấu hình
  được chọn, chuẩn hóa mã cửa hàng/nhân viên và xóa mềm các cấu hình cùng kỳ chỉ
  khác chữ hoa/thường. Kỳ đã chi hoặc khóa chặn sửa; các kỳ chốt an toàn bị đánh
  dấu cần chốt lại. Bản ghi bị loại vẫn còn để audit.
- `payroll.close|pay`: Admin hoặc business_support; `payroll.lock`: chỉ Admin.
  HTKD áp dụng cho mọi cửa hàng vật lý đang hoạt động, còn quản lý chỉ có quyền
  rà soát cửa hàng của mình. Payload gồm `storeId`, `period`. Server tự chốt
  attendance, lương, ba nguồn thưởng hợp lệ, ứng lương và finance; `pay` chỉ chi phần còn
  lại, `lock` chỉ áp dụng sau khi đã chi. Nếu nguồn tài chính/lương
  đổi sau khi chốt, `pay` trả `PAYROLL_NEEDS_RECLOSE` cho đến khi chốt lại.
  Dòng lương điều chuyển chỉ gồm lương giờ hỗ trợ + phụ cấp phiếu, không cộng lặp
  phụ cấp hồ sơ/điều chỉnh/ứng lương ở cửa hàng chính. Payment vẫn ghi cash
  out nhưng expense payroll tương ứng không được recognize lần hai vì chi phí đã
  accrual theo attendance tại cửa hàng nhận. Khi dữ liệu attendance lịch sử chưa
  có bút toán accrual, bản chốt tự cộng `supportAccrualGap` vào finance/payroll và lúc
  chi chỉ recognize đúng phần còn thiếu; không có ca đã hoàn tất thì không phát
  sinh lương giờ hoặc phụ cấp hỗ trợ.
  Lương tháng `OFFICE` và `BUSINESS_SUPPORT` được chia theo ngày hoàn
  tất chấm công trên ngày công chuẩn đã snapshot. Admin chốt lương
  `BUSINESS_SUPPORT`; business_support và store_manager không thể thao tác
  đơn vị nội bộ. Với Full-Time SecondMall
  SM234, lương cơ bản kỳ bằng
  `floor(actualHours / requiredMonthlyHours * baseSalary)` và không áp trần;
  thưởng/phụ cấp/khấu trừ vẫn cộng sau đó. Thiếu cấu hình trả
  `SM234_PAYROLL_CONFIG_REQUIRED`; đổi cấu hình làm kỳ đã chốt cần chốt lại,
  còn kỳ hiện tại đã chi/khóa chặn cập nhật.
  Profile `unit: store_manager` bị loại khỏi lịch phân ca và bảng lương của
  nhân viên cửa hàng.
- `payroll.resolve_period_collision`: chỉ Admin, payload
  `{storeId,period,keepPayrollId,reason}`. Giữ đúng kỳ lương được chọn và đánh
  dấu các bí danh an toàn là `superseded` thay vì xóa. Server từ chối tự sửa nếu
  kỳ bị loại đã khóa/chi hoặc có bút toán, thanh toán liên kết; trường hợp đó cần
  đối soát thủ công để không làm sai số tiền hay lịch sử.
- `policy.set`: admin/business_support, payload `key`, `value`, dùng version riêng của policy.
  Khi lưu nhiều ô cùng lúc, dùng `policies.set` với payload
  `updates: [{ key, value, expectedVersion }]` để toàn bộ thay đổi cùng commit
  hoặc cùng rollback.
  Các ngưỡng chuyên cần là `attendance_maintain_max_late_count`,
  `attendance_improve_min_late_count` và `attendance_improve_min_late_minutes`.
- `user.create`, `user.update`, `user.set_status`, `user.reset_password`: Admin
  quản lý credential business_support/store_manager/employee. `user.create`
  luôn bắt buộc `storeId`/`employeeId` khớp một profile hiện hữu, nên không
  thể tạo tài khoản Hỗ trợ KD “mồ côi”; luồng tạo Hỗ trợ KD/Quản lý
  cửa hàng mới phải dùng `employee.create` nguyên tử. Business support không
  được gọi trực tiếp `user.*`; quyền tạo tài khoản Quản lý cửa hàng chỉ đi qua
  `employee.create` nguyên tử. Store manager chỉ quản lý employee đúng cửa hàng
  và không được đặt `inactive`.
  `role`, `employeeId` và đơn vị là bất biến; cập nhật mật khẩu/phạm vi
  thu hồi session liên quan.
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

### Gợi ý địa chỉ Google Maps

`GET /api/address-suggestions` bắt buộc Bearer token và nhận query:
`type=province|ward|street`, `query`, `province?`, `ward?`, `sessionToken?`.
Response luôn theo dạng
`{ok,configured,suggestions:[{label,value,province?,ward?,street?,placeId?}]}`.
Nếu chưa đặt `GOOGLE_MAPS_API_KEY`, endpoint trả 200 với
`configured:false,suggestions:[]` để giao diện tiếp tục cho nhập thủ công.

Worker gọi server-side Places API (New)
`POST https://places.googleapis.com/v1/places:autocomplete` với tiếng Việt,
vùng Việt Nam và field mask tối thiểu. Khóa chỉ đi trong header upstream,
không được trả về client/log/state. Query tối đa 120 ký tự, tối thiểu 2 ký tự để
gọi upstream, tối đa 8 gợi ý và giới hạn best-effort 30 request/phút cho mỗi
tài khoản+IP trong một Worker isolate. Nên cấu hình thêm quota/restriction theo
API và project trong Google Cloud vì giới hạn trong isolate không thay thế quota
phía nhà cung cấp.

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
   theo `(entity_order, entity_key)`; mọi projection theo role chạy
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

## Chuyển đổi vai trò vận hành (migration 0004)

`drizzle/0004_operational_roles.sql` thay CHECK constraint của `users.role`
bằng bốn role code mới nhưng chỉ sao chép tài khoản `admin` sang
bảng mới. Mọi manager/employee legacy, session và receipt của họ bị xóa;
audit nghiệp vụ vẫn được giữ và bỏ tham chiếu user đã xóa. Profile
`employees`, chấm công, lương và lịch sử khác được giữ nguyên;
`username`, `authUserId`, `authVersion` và credential legacy bị gỡ khỏi
profile. Account settings chỉ còn của Admin. Sau deploy, Admin cấp lại
tài khoản bằng `employee.update` hoặc tạo hồ sơ/tài khoản mới bằng
`employee.create`.

## Xóa lại tài khoản production ngoài Admin (migration 0005)

`drizzle/0005_admin_only_accounts.sql` xử lý các tài khoản ngoài Admin đã được
tạo lại sau migration vai trò đầu tiên. Migration chỉ xóa credential
`business_support`, `store_manager`, `employee`; khóa ngoại tự cascade session,
idempotency receipt/chunk và đặt các tham chiếu lịch sử trong app state, policy,
audit thành `NULL`. Hồ sơ đang làm/đã xóa cùng toàn bộ lịch sử nghiệp vụ vẫn
được giữ, nhưng `username`, `authUserId`, `authVersion` và mọi thuộc tính bắt
đầu bằng `password` bị gỡ ở cả `state_entities` lẫn compact JSON cũ. Account
settings chỉ còn của Admin; phiên bản global state được tăng một lần với request
id `migration:0005:admin-only-accounts`. Sau migration, chỉ Admin có thể phát
hành lại tài khoản theo đúng luồng quản trị.

## Xóa đệ quy credential còn sót trong hồ sơ (migration 0006)

`drizzle/0006_recursive_profile_secret_scrub.sql` rà soát đệ quy hồ sơ
`employees` và `deletedEmployees` trong cả `state_entities` lẫn compact JSON cũ.
Migration chuẩn hóa tên khóa giống Worker rồi gỡ password, token, API key,
secret, credential, authorization, cookie và các credential envelope gồm
`hash`/`salt`/`iterations`/`algorithm`, kể cả khi nằm trong object hoặc mảng
lồng sâu. Các giá trị không nhạy cảm, thứ tự tương đối của hồ sơ/phần tử hợp lệ
và lịch sử nghiệp vụ được giữ nguyên; root credential envelope không hợp lệ bị
lọc giống runtime.
Phiên bản global state tăng một lần với request id
`migration:0006:recursive-profile-secret-scrub`.

## Giới hạn cần xử lý trước tải lớn

- Compact shell và mỗi entity/chunk giới hạn 1.500.000 byte; request JSON
  giới hạn 16 MiB. Byte ảnh CCCD nằm trong R2 private binding
  `IDENTITY_IMAGES`, không nằm trong state; avatar data URL tối đa 300 KiB
  sau giải mã (giao diện tự tối ưu từ ảnh gốc tối đa 5 MiB).
- Cần rate-limit/WAF cho `/api/login` và smoke-test chi phí PBKDF2 trên plan chạy.
- Cần đặt retention cho audit/command receipts và theo dõi quota D1 trước khi
  vận hành dữ liệu rất lớn.
