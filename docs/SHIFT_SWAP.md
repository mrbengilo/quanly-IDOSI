# Đổi ca trong Lịch phân ca

## Người dùng và thao tác

Mở **Cửa hàng → Lịch phân ca → Đổi ca** (`/store/schedule`). Chọn ngày ở bộ
lọc đầu trang, chọn nhân viên A và B, chọn ca của từng người, kiểm tra phần
**Xem trước kết quả**, rồi bấm **Đổi ca**. Không có bước duyệt hoặc xác nhận phụ.

- Một ca đủ điều kiện: form chọn sẵn và hiển thị ca/giờ.
- Nhiều ca đủ điều kiện: phải chọn một ca cụ thể. B không được là A.
- Ví dụ một ca: A `[Sáng]`, B `[Chiều]` thành A `[Chiều]`, B `[Sáng]`.
- Ví dụ nhiều ca: A `[Sáng, Tối]`, B `[Chiều, Cuối ngày]`; chỉ đổi Sáng với
  Chiều thì Tối/Cuối ngày vẫn giữ nguyên.
- Đổi ngày/cửa hàng làm mới form; đổi A làm mới B. Phím mũi tên, Home/End
  chuyển giữa các tab; Tab đi qua các trường và nút lưu.
- Chỉ thông báo thành công sau response server. Nếu mất mạng, thử lại cùng
  lựa chọn để dùng lại idempotency key. Nếu báo lịch đã thay đổi, dữ liệu được
  refresh và phải chọn lại, không tự áp dụng lựa chọn cũ.

Backend cho phép `admin`, `business_support`, `store_manager`, theo
`OPERATIONS_ROLES` hiện có. Quản lý cửa hàng chỉ thao tác cửa hàng do server
gán; HTKD bị chặn Khối văn phòng/đơn vị nội bộ. `employee` và role chỉ xem
không được gọi command. Chuỗi role legacy `manager` xuất hiện ở một số UI cũ
nhưng không thuộc `OPERATIONS_ROLES`/schema tài khoản hiện tại; tính năng này
không mở rộng quyền cho chuỗi đó.

Chức năng cần kết nối API. Chế độ local/demo không ghi đổi ca vì không có
nguồn authoritative để kiểm tra đầy đủ khóa lương và dữ liệu ở cửa hàng khác.
Lỗi API không được fallback thành lưu local.

## Điều kiện và dữ liệu giữ nguyên

Hai assignment phải thực sự tồn tại trong **cùng ngày, cùng cửa hàng**,
không bị xóa/hủy và không là `projectionReadOnly`. Nhân viên phải khác danh
tính sau chuẩn hóa ID/code/alias, thuộc đơn vị cửa hàng và đang làm việc.

Ca nhận phải có definition còn hoạt động (đúng chính sách phân thêm ca hiện
có). **Giờ/tên lấy từ snapshot đã được phân**, không thay bằng definition đã
sửa. Snapshot thiếu, trùng hoặc giờ không hợp lệ bị chặn với
`SCHEDULE_SNAPSHOT_INVALID`: cần đối soát lịch bằng luồng quản lý hiện có,
không đoán giờ hoặc tự phục hồi definition đã nghỉ. Legacy `shiftId` vẫn hỗ
trợ khi có snapshot hợp lệ.

Hệ thống từ chối:

- cùng ca/no-op hoặc ca nhận đã có trong các ca còn lại;
- xung đột giờ với ca còn lại, cửa hàng khác hoặc ngày liền kề/qua đêm;
- ca được chọn đã điểm danh (`SCHEDULE_STARTED_IMMUTABLE`);
- assignment/snapshot bị khóa hoặc dữ liệu công việc/đơn hàng legacy liên
  kết trực tiếp với nhân viên, ngày, cửa hàng và ca được chọn;
- ca hỗ trợ nhận vào không nằm trọn cửa sổ điều chuyển được phép;
- kỳ lương cửa hàng thao tác hoặc cửa hàng chính của nhân viên hỗ trợ đã
  khóa/đã chi, theo `assertPayrollNotPaidOrLocked` hiện có.

Hai ca chạm biên giờ được phép. Không cấm toàn bộ ngày quá khứ. Điểm danh
của ca không được chọn không khóa cả ngày. Ca công việc do nhân viên chọn
thủ công được nhận diện qua attendance liên kết; không đánh đồng ca công việc
đó với ca lịch khác trong ngày.

Giữ nguyên ID bản ghi, employeeId, storeId, date, ghi chú, nguồn gốc và mọi
ca/snapshot không được chọn. Chỉ cập nhật hai ca, `shiftIds`, `shiftId` legacy,
snapshot tương ứng và thông tin người/thời điểm sửa. `supportTransferId` của
snapshot nhận được tính lại cho người nhận; không mang ID hỗ trợ của người
cũ sang. Không sửa `shiftDefinitions`, attendance, task progress, checklist,
đơn hàng, doanh thu hay lương; không đổi `selectedTaskShiftId`.

## Contract và transaction

`POST /api/command`, type `schedule.swap`, `includeState: false`:

```json
{
  "type": "schedule.swap",
  "expectedVersion": 42,
  "includeState": false,
  "payload": {
    "storeId": "STORE",
    "date": "2026-10-22",
    "a": { "assignmentId": "ASS-A", "employeeId": "A", "shiftId": "AM", "revision": "..." },
    "b": { "assignmentId": "ASS-B", "employeeId": "B", "shiftId": "PM", "revision": "..." }
  }
}
```

Header `Idempotency-Key` giữ nguyên trong retry cùng intent. `revision` được
tạo bằng `scheduleSwapRevision(assignment)` từ bản ghi đã đọc; chỉ dùng để
so sánh, **không dùng làm dữ liệu ghi**. Server tự đọc trạng thái authoritative,
kiểm tra và dựng proposed state cho cả hai bên trước khi commit.

`buildScheduleSwap` là hàm thuần, dùng `scheduleConflict`, `shiftWindow`,
`attendanceMatchesWindow`, `supportForScheduledWindow`. Command đọc các
collection cần thiết trên toàn cửa hàng/ngày để kiểm tra xung đột; không
dùng projection của client làm nguồn ghi.

`commitGlobalStateDomainCommand` CAS version và ghi hai assignment, audit,
receipt trong một batch; SQLite dùng BEGIN IMMEDIATE/COMMIT/ROLLBACK. Không
thực hiện hai request assign hay replace cả ngày. Không thêm swap vào
`STALE_VERSION_REBASE_COMMANDS`. Hai intent dùng snapshot cũ chỉ một intent
commit; cùng key khác payload bị từ chối; retry sau mất response nhận receipt
cũ và không tạo thêm audit.

Response trả `assignments` gồm đúng hai bản ghi và `version`. AppContext áp
dụng hai delta cùng một lần cập nhật state, đánh dấu cache cần xác minh và
refresh projection ngay. Delta cũ không ghi đè scope đã chuyển hoặc version
mới hơn. Các reader ngày/tuần/tháng/nhân viên dùng cùng lịch đã lưu.

Không cần migration: state_entities, app_state CAS, audit_log và
command_receipts hiện có đã đủ. Không có bảng mới hoặc reset/seed production.

## Tra cứu audit

Audit dùng action `schedule.swap`, entity type `schedule-swap`; entity ID và
metadata.operationId là request ID. Có ngày/cửa hàng, before/after hai
assignment, actor thật từ session và thời gian server. Có thể dùng API audit
hiện có (`GET /api/audit?limit=100`, tiếp tục trang bằng `beforeId`) với tài
khoản được phép rồi tìm action/request ID; giữ nguyên phân quyền API audit.
Không xây thêm màn hình lịch sử. Không sửa/xóa audit cũ.

## Kiểm thử và phát hành

Dùng Node.js 24. Các test chỉ ghi vào fixture/SQLite tạm:

```sh
npm ci --prefer-offline --no-audit --no-fund
npx vitest run src/domain/scheduleSwap.test.js src/pages/store/UnifiedSchedule.swap.test.jsx src/state/AppContext.scheduleSwap.test.jsx server/vps/schedule-swap.integration.test.js --maxWorkers=1
npx vitest run src/domain/supportScheduling.test.js src/pages/store/scheduleView.test.js src/pages/store/scheduleAssignments.test.js src/pages/store/UnifiedSchedule.layout.test.jsx src/state/AppContext.scheduleFallback.test.jsx src/pages/employee/EmployeeSchedulePage.test.jsx src/domain/taskShift.test.js server/vps/support-transfer-workflow.test.js server/vps/multi-shift-attendance.test.js server/vps/manual-task-shift.test.js server/vps/task-shift-lock.test.js server/vps/stale-version-rebase.test.js server/worker.test.js --maxWorkers=1
npm run lint
npm test
npm run build
npm run sites:verify
git diff --check
```

Browser harness: `node scripts/verify-schedule-swap-browser.mjs`. Cần cài
Playwright/Chromium ngoài dependencies production; `IDOSI_PLAYWRIGHT_MODULE`
có thể trỏ tới file `playwright/index.mjs`, `IDOSI_BROWSER_OUTPUT` là thư mục
lưu ảnh/JSON bằng chứng. Harness chạy Vite và HTTP/SQLite tạm, xác minh một
ca/nhiều ca, reload quản lý và nhân viên A/B, tên dài, bàn phím và hình học
375/768/1440px. Avatar 404 do fixture không có ảnh được ghi riêng; lỗi API
khác hoặc lỗi JavaScript làm fail. Không giả định tồn tại `npm run e2e`.

Phát hành theo [VPS checklist](VPS_DEPLOYMENT_CHECKLIST.md) và
[runbook](../deploy/vps/README.md): PR Verify → merge → Verify push/main đúng
full SHA → automatic Deploy VPS → backup/checksum → internal/external exact
SHA/static verification → report finalized SUCCESS. Không deploy thủ công
song song. Production smoke chỉ đọc; không đổi ca nhân viên thật để thử.
Ghi rõ role không có phiên đăng nhập là BLOCKED, không suy luận từ fixture.

Rollback giữ previous image/backup/audit/volume theo runbook. Rollback code
không đảo giao dịch đổi ca đã lưu. Không restore snapshot cũ chỉ để gỡ tính
năng; nếu cần recovery dữ liệu phải emergency backup và đánh giá các giao
dịch phát sinh sau backup trước khi khôi phục.
