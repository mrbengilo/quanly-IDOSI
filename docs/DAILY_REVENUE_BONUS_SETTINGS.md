# Cấu hình thưởng doanh thu ngày theo nhóm cửa hàng

Admin cấu hình **mốc doanh thu ngày** và **tỷ lệ % thưởng** cho hai nhóm cửa hàng
độc lập: **Dosii** và **SM TNV**. Mọi cửa hàng cùng nhóm dùng chung bộ cấu hình
của nhóm đó. Phạm vi chỉ gồm phần thưởng theo %; các phần sau **không đổi**:
thưởng mốc đội nhóm (số tiền cố định), thưởng doanh thu quản lý, điều kiện chấm
công/kết ca/chốt sau 22:00, cách chia theo giờ làm, loại trừ nhân viên hỗ trợ,
điều chỉnh thủ công của Admin, điểm vi phạm, lương và khóa kỳ lương.

## 1. Hướng dẫn Admin

1. Vào menu **Cấu hình thưởng doanh thu ngày** (`/admin/revenue-bonus-settings`).
2. Chọn tab **Dosii** hoặc **SM TNV**. Bản nháp của mỗi tab được giữ riêng khi
   chuyển tab; tab có thay đổi chưa lưu hiện nhãn **Chưa lưu**. Tải lại/đóng
   trang khi còn bản nháp chưa lưu sẽ được trình duyệt hỏi xác nhận.
3. Khối **Đang áp dụng hôm nay** cho biết bảng đang có hiệu lực (bảng mặc định
   hệ thống hoặc phiên bản Admin), ngày hiệu lực, người và thời điểm cập nhật,
   cùng cấu hình **chờ áp dụng** nếu có.
4. Trong **Soạn cấu hình mới**: thêm, sửa, xóa dòng, **Sắp xếp tăng dần**, chọn
   **Ngày bắt đầu áp dụng**, rồi **Lưu cấu hình** (có hộp thoại xác nhận).
   **Hủy chỉnh sửa** đưa bản nháp về trạng thái lúc tải.
5. **Xem trước thưởng theo %** tính trên bản nháp với doanh thu giả định. Kết
   quả chỉ là phần thưởng theo %, chưa gồm thưởng mốc đội nhóm, không ghi dữ liệu
   và không chốt thưởng.
6. Thông báo thành công chỉ hiện sau khi máy chủ xác nhận. Nếu Admin khác vừa
   lưu trước, trang báo xung đột, **giữ nguyên bản nháp** và cho phép **Tải bản
   mới nhất**; máy khách không tự gửi lại.

## 2. Quy tắc mốc, tỷ lệ và công thức

Với các mốc tăng dần `t1 < t2 < … < tn` và tỷ lệ `r1 … rn`:

| Dòng | Khoảng áp dụng | Ghi chú |
| --- | --- | --- |
| 1 | **Từ** `t1` **đến** `t2` (gồm cả `t2`) | Mốc đầu tiên tính cả giá trị bằng mốc |
| k (giữa) | **Trên** `tk` **đến** `tk+1` | Tại đúng `tk` vẫn dùng tỷ lệ dòng trước |
| n (cuối) | **Trên** `tn` | Một dòng duy nhất: **Từ** `t1` **trở lên** |

- Dưới mốc đầu tiên: thưởng theo % bằng 0.
- Chỉ chọn **một** tỷ lệ theo khoảng; tính trên **toàn bộ** doanh thu ngày hợp
  lệ; không lũy tiến, không cộng dồn.
- Tỷ lệ lưu bằng basis points (1% = 100; 1,25% = 125); số tiền
  `floor(doanhThu × bp / 10 000)` bằng BigInt, làm tròn xuống đồng.
- Bảng mặc định (legacy) được giữ nguyên và tái tạo chính xác bằng quy tắc trên:
  Dosii `1.500.000 → 1%`, `2.000.000 → 2%`, `4.000.000 → 4%`;
  SM TNV `2.500.000 → 4%`, `6.000.000 → 6%`, `12.000.000 → 7%`.
  Ví dụ tại đúng 2.000.000 đ Dosii vẫn 1%; tại đúng 12.000.000 đ SM TNV vẫn 6%.
- Domain (`src/domain/revenueBonusConfig.js`), API, xem trước, màn thưởng và
  test dùng chung một quy tắc; UI không có công thức riêng.

### Validation (frontend và backend)

- Mốc: bắt buộc, số nguyên VND > 0, trong `Number.isSafeInteger`, không trùng,
  phải tăng dần (báo đúng dòng). Ô nhập dùng `MoneyInput`; parser chỉ nhận chữ
  số hoặc định dạng `1.500.000`, không dùng `parseFloat`.
- Tỷ lệ: bắt buộc, 0%–100%, tối đa 2 chữ số thập phân (`1,25` hoặc `1.25`);
  từ chối NaN, Infinity, số âm, chuỗi rác, độ chính xác vượt mức. Không áp đặt
  điều kiện "% phải tăng theo doanh thu".
- Danh sách: 1–20 dòng. Bảng trống **không** có nghĩa là tắt thưởng; không có
  tính năng bật/tắt thưởng.

## 3. Ngày hiệu lực, phiên bản và lịch sử

- Ngày bắt đầu áp dụng sớm nhất là **ngày mai theo giờ Việt Nam**; có thể chọn
  ngày tương lai. Không hồi tố, không đổi thưởng của ngày đang vận hành.
- Mỗi lần lưu tạo một bản ghi **bất biến** mới với `version` tăng theo từng nhóm.
  Cấu hình đã có hiệu lực không bao giờ bị sửa. Chỉ cấu hình **chưa có hiệu lực**
  (chờ áp dụng) bị thay thế khi lưu bản mới; bản cũ được giữ với trạng thái
  `SUPERSEDED` (`supersededAt/By/ByConfigId`) để truy vết.
- Resolver chọn theo **nhóm cửa hàng + businessDate cần tính**: bản `ACTIVE`
  có `effectiveFrom ≤ businessDate` lớn nhất; nếu không có, dùng bảng legacy.
  Không dựa vào giờ máy chủ hay thời điểm job chạy bù, nên chạy bù ngày cũ vẫn
  dùng cấu hình của ngày cũ và một tháng có thể gồm nhiều phiên bản.
- Ngày đã chốt (`revenueBonusDaily`) lưu snapshot `revenueBonusConfig`
  (`source`, `configId`, `version`, `storePolicy`, `programId`, `effectiveFrom`,
  toàn bộ `tiers`) cùng `tierId`, `rateBasisPoints`. Kết quả đã chốt luôn hiển
  thị theo snapshot; thay đổi cấu hình không tính lại lịch sử, không đổi kỳ
  lương đã chốt/đã chi. Ngày chốt trước khi có tính năng này không có snapshot và
  được hiển thị là bảng mặc định (đúng bảng đã dùng để tính).

### Mô hình dữ liệu `revenueBonusConfigs`

| Trường | Ý nghĩa |
| --- | --- |
| `id` | `rbc_<uuid>` do máy chủ cấp |
| `storePolicy` | `DOSII` hoặc `SM_TNV` |
| `programId` | Chương trình thưởng tương ứng (không nhận từ client) |
| `effectiveFrom` | `YYYY-MM-DD` |
| `version` | Số nguyên tăng dần theo nhóm |
| `status` | `ACTIVE` hoặc `SUPERSEDED` |
| `tiers` | `[{ thresholdVnd, rateBasisPoints }]` tăng dần |
| `supersedesConfigIds` | Bản chờ áp dụng bị thay thế |
| `createdAt/By`, `updatedAt/By`, `requestId` | Audit do máy chủ ghi |

## 4. Phân quyền và API

| Thao tác | Quyền |
| --- | --- |
| Route `/admin/revenue-bonus-settings`, menu | Chỉ Admin |
| `GET /api/revenue-bonus/configs` | Chỉ Admin (401 khi chưa đăng nhập, 403 vai trò khác) |
| Lệnh `revenue_bonus_config.save` | Chỉ Admin; HTKD bị chặn ở cổng lệnh và handler |
| `state.replace` / `state.merge` | Collection được bảo vệ (`DOMAIN_COMMAND_REQUIRED`) |
| Xem thưởng (`/api/revenue-bonus/live`, `/period`) | Giữ nguyên quyền cũ; snapshot có bảng của ngày |

Payload lệnh: `{ storePolicy, effectiveFrom, tiers, baseVersion }`. Máy chủ tự
dựng bản ghi; mọi trường khác (`id`, `version`, `createdBy`, `role`, `status`,
`requestId`, …) bị bỏ qua; `programId` nếu gửi phải khớp nhóm.

Mã lỗi:

- `400 REVENUE_BONUS_CONFIG_VALIDATION` — `details.fieldErrors`, `formErrors`,
  `rowErrors[{ index, thresholdVnd?, rateBasisPoints? }]`.
- `400 REVENUE_BONUS_CONFIG_STORE_POLICY_INVALID`, `…_PROGRAM_MISMATCH`,
  `…_BASE_VERSION_REQUIRED`.
- `409 REVENUE_BONUS_CONFIG_CONFLICT` — `baseVersion` khác phiên bản mới nhất
  của nhóm (`details.currentVersion`). Hai Admin hoặc hai yêu cầu tạo cấu hình
  đầu tiên đồng thời: chỉ một yêu cầu thành công.
- `409 IDEMPOTENCY_KEY_REUSED` — dùng lại khóa với nội dung khác. Gửi lại cùng
  khóa và cùng nội dung nhận lại đúng biên nhận cũ, không tạo thêm phiên bản/audit.
- `500 REVENUE_BONUS_CONFIG_INVALID` — dữ liệu cấu hình đã lưu bị hỏng.

Ghi nguyên tử trong một batch: trạng thái + audit (`before`, `after`, actor,
`request_id`, metadata) + biên nhận idempotency, có CAS theo version toàn cục.
Lệnh được phép rebase khi phiên bản toàn cục của client cũ vì ràng buộc nghiệp vụ
là `baseVersion` của nhóm, được kiểm tra lại ở mỗi lần thử.

## 5. Đường đọc và tính thưởng

- `revenueBonusConfigs` nằm trong `REVENUE_BONUS_CONTEXT_COLLECTIONS`
  (`server/revenue-bonus-read.mjs`), nên đọc thưởng ngày/kỳ và finalizer 22:00
  đọc cấu hình trong **cùng snapshot** SQLite với đơn hàng/chấm công. Finalizer
  commit bằng CAS; lưu cấu hình đồng thời chỉ gây thử lại, không trộn phiên bản.
- Tính lương (`calculatePayrollSnapshot`) tự tải cấu hình nếu projection lệnh
  chưa có, để ngày chưa chốt trong kỳ không quay về bảng legacy.
- Lệnh tính tay legacy (`revenue_bonus.calculate_day`, chỉ cho ngày trước
  2026-09-01) dùng cùng resolver.
- Phân nhóm cửa hàng tái sử dụng `classifyStorePayrollPolicy` (không có resolver
  mới theo tên). Hành vi cũ được giữ: cửa hàng không thuộc SM TNV dùng chương
  trình Dosii. Ngày đã chốt của cửa hàng nay đã ngừng hoạt động vẫn giữ snapshot
  vì snapshot không phụ thuộc resolver hiện tại.
- Worker/D1 và VPS chạy cùng mã `server/worker.js` và cùng domain, nên validation
  và cách tính giống nhau.

## 6. Tương thích, migration và fallback

- **Không cần migration SQL**: dữ liệu dùng collection trạng thái chung
  (`state_collections`/`state_entities`) sẵn có. Không seed cấu hình, không
  reset/truncate, không backfill hay sửa thưởng/lương đã chốt.
- Chưa từng có cấu hình → bảng legacy, kết quả giống hệt trước khi triển khai
  (đã có test so sánh). Deploy lần đầu không đổi tiền thưởng.
- Đọc cấu hình thất bại hoặc dữ liệu hỏng → lỗi `REVENUE_BONUS_CONFIG_INVALID`;
  hệ thống **không** âm thầm dùng bảng legacy và finalizer không chốt ngày đó
  (kết quả `FAILED` có mã lỗi) để tránh sai tiền.

### Rollback

- Rollback image về bản trước tính năng: bản cũ **bỏ qua** collection
  `revenueBonusConfigs` (không xóa dữ liệu) và tính lại bằng bảng **legacy**.
  Nếu đã có cấu hình Admin **đang hiệu lực**, các ngày chưa chốt sau rollback sẽ
  được tính/chốt theo bảng legacy, tức **sai so với cấu hình đã duyệt**.
  "Container chạy lại" không phải là rollback thành công về nghiệp vụ.
- Biện pháp khi phải rollback: tạm dừng chốt tự động
  (`IDOSI_AUTOMATIC_REVENUE_BONUS_ENABLED=false`) trước, đối soát danh sách ngày
  đã chốt trong thời gian rollback, và chạy bù có kiểm soát sau khi khôi phục
  release mới. Rollback trước khi bất kỳ cấu hình nào có hiệu lực thì không ảnh
  hưởng tiền thưởng.
- Bản ghi đã chốt bằng release mới vẫn mang snapshot; release cũ đọc chúng như
  dữ liệu thường (trường thừa được bỏ qua).
- Release cũ không bảo vệ collection `revenueBonusConfigs` khỏi `state.replace`;
  trong thời gian chạy bản cũ, một thao tác ghi toàn bộ trạng thái có thể làm mất
  collection này. Sao lưu trước deploy (pipeline VPS đã tạo backup + checksum)
  là nguồn khôi phục; kiểm tra lại trang cấu hình sau khi quay lại release mới.

## 7. Kiểm thử

| Lớp | File |
| --- | --- |
| Domain | `src/domain/revenueBonusConfig.test.js`, `compensationPolicies.test.js`, `automaticRevenueBonus.test.js` |
| API/SQLite/phân quyền/concurrency/idempotency/restart/payroll/finalizer | `server/vps/revenue-bonus-config.test.js` |
| UI | `src/pages/admin/RevenueBonusSettingsPage.test.jsx`, `src/App.routes.test.jsx`, `src/pages/compensation/RevenueBonusCutoff.test.jsx` |

Fixture trong test (Dosii `1.000.000 → 1,25%`, `3.000.000 → 2,5%`; SM TNV
`2.000.000 → 3%`, `5.000.000 → 4,5%`) chỉ dùng để chứng minh hệ thống không còn
hard-code; **không** phải cấu hình production.

## 8. Smoke sau deploy (chỉ đọc)

- `GET /api/health`, `GET /api/release` khớp đủ 40 ký tự SHA đã deploy.
- Admin mở được trang, thấy đủ hai nhóm và bảng mặc định/đang áp dụng.
- Vai trò khác không thấy menu, bị chuyển hướng khỏi route, API trả 403.
- Màn thưởng hiển thị đúng ngày, lịch sử không mất; reload/responsive ổn.
- **Không** nhập tỷ lệ thử, không chốt thưởng thử, không sửa dữ liệu tiền thật
  trên production.
