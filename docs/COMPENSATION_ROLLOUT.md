# IDOSI Compensation Rollout

Tài liệu này là ma trận truy vết và cổng an toàn cho đợt triển khai lương, thưởng,
vi phạm, checklist ca và loại bỏ KPI. Nguồn nghiệp vụ là
`Prompt_Codex_IDOSI_Update.md`, workbook `idosiupdate.xlsx` và quyết định mới
nhất của chủ hệ thống: **Nhân viên hỗ trợ KD (HTKD) quản lý tất cả cửa hàng
vật lý đang hoạt động**.

## Decision register

| ID | Quyết định canonical | Bất biến cần giữ |
| --- | --- | --- |
| D1 | Thưởng doanh thu tính theo cửa hàng/ngày, phân bổ theo giờ làm thực tế đã duyệt và cộng vào kỳ lương tháng. Mốc nóng chỉ lấy mốc cao nhất và chỉ có hiệu lực sau duyệt. | Pool và allocation không được cộng chi phí hai lần; tổng allocation phải bằng pool. |
| D2 | Thưởng team chia cho danh sách participant không trùng bằng largest-remainder; cùng bằng chứng chỉ lấy mốc cao nhất. | Không tự duyệt khoản do chính mình gửi; retry không tạo trùng. |
| D3 | Vi phạm trừ thưởng, rồi phụ cấp, rồi lương; phần vượt thu nhập chuyển thành phải thu kỳ sau. | Lương thực nhận không âm; carry-forward không mất hoặc áp dụng hai lần. |
| D4 | HTKD có phạm vi toàn bộ cửa hàng đang hoạt động; quản lý chỉ cửa hàng của mình; Admin toàn hệ thống. Admin/HTKD được chốt và ghi nhận chi, chỉ Admin được khóa. | Backend/data boundary luôn kiểm tra quyền; không dùng `assignedStoreIds` để giới hạn HTKD. |
| D5 | KPI bị loại bỏ hoàn toàn, không đổi tên thành loại thưởng khác. | Actual payment/bank evidence không bị xóa; non-KPI delta phải bằng 0. |
| D6 | UI rõ ràng, responsive, accessible và không gửi dữ liệu trái quyền xuống client. | Kiểm tra 360/390/768/1280 px và cả allowed/denied state. |

## Requirement traceability matrix

| ID | Nguồn dữ liệu / domain | API và persistence | Màn hình | Regression trọng yếu |
| --- | --- | --- | --- | --- |
| R1 Checklist ca | `storeShiftTaskTemplates`, snapshot task theo ca, 59 mục workbook | Seed idempotent, lưu tiến độ, backend chặn checkout khi còn mục active | Công việc được giao của nhân viên; quản trị template của Admin | Đủ 20/19/20 mục; lý do không bypass; ca cũ vẫn đọc được |
| R2 Thưởng công việc | `WORK`, claim/evidence/participant | Idempotency key, approve/revoke có audit | Tiền thưởng công việc và tổng team/phần cá nhân | Không double click; mốc cao nhất; tổng allocation khớp pool |
| R3 Thưởng doanh thu | `REVENUE`, daily pool/allocation | Calculate/version/approve; tie doanh thu và giờ duyệt | Thưởng doanh thu ngày; phần cá nhân | Boundary DOSII/SM; 0 giờ thành UNALLOCATED; pending không vào payroll |
| R4 Thưởng/phụ cấp quản lý | `MANUAL` và `ALLOWANCE` riêng | Admin/HTKD tạo cho mọi cửa hàng active; manager read-own | Thưởng và Phụ cấp Quản lý | Một mutation chỉ tạo một tác động chi phí; manager bị từ chối mutation |
| R5 Vi phạm | debit/receivable, không phải bonus âm | Admin/HTKD toàn cửa hàng; employee/manager read-own | Kiểm tra vi phạm theo nhóm và Danh sách vi phạm của tôi | Waterfall, carry-forward, zero-income và access denied |
| R6 Kỳ lương | 9-state monthly workflow, snapshot/reconciliation | Manager review own store; Admin/HTKD close/pay; Admin lock | Tổng kết tháng, rà soát, chốt/chi/khóa | Retry kỳ không trùng; locked không sửa; payment không tính expense lần hai |
| R7 Avatar | object key/URL/metadata, không base64 trong state DB | Upload/view chống IDOR, rollback-safe | Danh sách/hồ sơ đúng người và modal phóng to | Refresh/relogin, wrong-user denied, avatar cũ không mất khi upload lỗi |
| R8 Loại bỏ KPI | exact key/type/source inventory | Forward migration + backup/restore/dry-run/reconciliation | Không còn menu/cột/cài đặt KPI | Actual payments giữ nguyên; non-KPI count/sum giữ nguyên |

## Role / permission matrix

| Capability | Admin | HTKD | Quản lý cửa hàng | Nhân viên |
| --- | --- | --- | --- | --- |
| Xem cửa hàng | Tất cả | **Tất cả cửa hàng active** | Cửa hàng của mình | Cửa hàng làm việc hợp lệ |
| Quản lý checklist template | Có | Không mở rộng nếu chưa có rule | Không | Không |
| Tick checklist ca của mình | Theo vai trò nhân viên hợp lệ | Theo vai trò nhân viên hợp lệ | Theo vai trò nhân viên hợp lệ | Có |
| Tạo thưởng/phụ cấp quản lý | Có | Tất cả cửa hàng active | Không | Không |
| Tạo/duyệt vi phạm cửa hàng | Có | Tất cả cửa hàng active | Chỉ quyền hiện có, không mở rộng | Không |
| Review kỳ | Có | Có | Cửa hàng của mình | Không |
| Chốt / ghi nhận chi | Có | Tất cả cửa hàng active | Không | Không |
| Khóa kỳ | **Có** | Không | Không | Không |
| Xem chi tiết đồng nghiệp | Theo nghiệp vụ quản trị | Theo nghiệp vụ quản trị | Không; chỉ team total + phần mình | Không; chỉ team total + phần mình |

## Financial state machine

`OPEN -> DRAFT -> UNDER_MANAGER_REVIEW -> READY_TO_CLOSE -> BOOKS_CLOSED -> PAYMENT_IN_PROGRESS -> PARTIALLY_PAID -> PAID -> LOCKED`

- `00:00` ngày 1 chỉ tạo kỳ `OPEN/DRAFT` idempotent, không tự chốt/chi/khóa.
- Manager chỉ review cửa hàng của mình.
- Admin và HTKD được chốt/chi; HTKD áp dụng toàn bộ cửa hàng active.
- Chỉ Admin được chuyển `PAID -> LOCKED`.
- Sau `LOCKED`, sai lệch chỉ được adjustment ở kỳ sau, liên kết kỳ và entry gốc.

## Canonical finance rules

```text
gross_compensation = salary + REVENUE + WORK + MANUAL + ALLOWANCE
net_payroll_expense = gross_compensation - applied_violation
final_profit = net_revenue - non_payroll_expense - net_payroll_expense
net_cash_pay = max(0, net_payroll_expense - applied_advance)
```

- `ALLOWANCE` không phải bonus; `VIOLATION` là debit/receivable.
- Ứng lương và chi lương là tất toán công nợ, không phải expense mới.
- Pool header và allocation không được `SUM` như hai nguồn độc lập.
- Tiền VND là số nguyên an toàn; không dùng float cho phân bổ.

## KPI deletion manifest

| Target | Exact identity | Replacement | Data safeguard | Rollback |
| --- | --- | --- | --- | --- |
| Policy | `employee_kpi_percent_30000`, `_15000`, `_7000` | Không có | Exact predicate + before/after count | Restore DB snapshot |
| Payroll snapshot | `kpiSnapshot`, row `kpiBonus` | Không reclassify | Preserve every other JSON field | Restore DB snapshot |
| Runtime/domain | `src/domain/kpi.*`, KPI calculator/import/export | Không có | Tests assert no runtime generation | Revert release before purge |
| UI/settings/report | KPI fields/menu/columns | Không có placeholder | Role visual tests | Revert release before purge |
| Receipts/audit cache | Exact KPI response keys and `kpi.*` actions | Không có | Exact match only | Restore DB snapshot |
| Applied migrations | Historical migration files | **Giữ nguyên để bảo toàn chain** | Non-runtime archival only | Không sửa migration đã chạy |

## Deployment and reconciliation gate

1. Freeze mutation KPI/payroll trong cửa sổ migration.
2. Sao lưu volume SQLite/D1 export ra ngoài runtime; ghi timestamp, SHA-256, byte size.
3. Restore bản sao cô lập; chạy `integrity_check`, `foreign_key_check` và đối chiếu checksum/count.
4. Ghi baseline non-KPI theo collection/store/period/user và actual payment evidence.
5. Chạy migration dry-run trên bản restore; kiểm tra exact deleted count/amount và non-KPI delta = 0.
6. Deploy app/schema tương thích; chạy migration đúng một lần.
7. Đối chiếu production sau deploy: health, schema version, FK/orphan, non-KPI count/sum, payment evidence và không còn KPI runtime/data.
8. Nếu bất kỳ predicate, tổng tiền, restore hoặc non-KPI delta không khớp: dừng deploy/purge và restore snapshot.

## Screen-role-state map

| Screen | Role | Allowed states | Denied / privacy state |
| --- | --- | --- | --- |
| Compensation management | Admin, HTKD | loading/empty/error/open/closed/locked | Manager/employee route + API denied |
| Store review | Manager own store | draft/review/ready/read locked | Other store denied without existence leak |
| My compensation / violations | Employee, Manager | own details + team total | No coworker allocation payload |
| Checklist | Employee on actual shift | pending/complete/checkout blocked | Other employee/shift denied |
| Avatar | Viewer with existing profile scope | loading/error/current/replaced | Arbitrary user/object key denied |
