# IDOSI VPS Deployment Checklist

Checklist bắt buộc cho production VPS. Đây là checklist vận hành của pipeline hiện tại; không dùng quy trình cũ `git pull && docker compose up -d --build` để cập nhật production.

Luồng chuẩn:

```text
PR
→ Verify IDOSI PASS
→ merge main
→ Verify IDOSI PASS cho đúng merge SHA
→ Run workflow Deploy IDOSI VPS bằng full SHA
→ production approval
→ durable remote deployment
→ backup + rollout + local verification
→ external verification
→ finalize report SUCCESS
→ smoke test + observation
```

## A. Gate trước triển khai

- [ ] PR đã merge vào `main`.
- [ ] Có full 40-character merge commit SHA cần triển khai.
- [ ] `Verify IDOSI` trên sự kiện `push` của đúng SHA đó đã PASS.
- [ ] Không còn finding Critical/High hợp lệ chưa xử lý.
- [ ] Đã xác định release hiện tại và rollback point gần nhất.
- [ ] Đã xác định release có migration, storage, auth/session hoặc thay đổi dữ liệu hay không.
- [ ] Không có incident production hoặc deployment/rollback khác đang chạy.
- [ ] GitHub Environment `production` đã cấu hình required reviewer và secrets SSH.

Một gate bắt buộc không đạt: **DỪNG TRIỂN KHAI**.

## B. Khởi chạy đúng workflow

1. Mở GitHub **Actions**.
2. Chọn **Deploy IDOSI VPS**.
3. Chọn **Run workflow** từ branch `main`.
4. Dán đúng full merge commit SHA.
5. Kiểm tra job `release-gate` xác nhận:
   - SHA hợp lệ;
   - SHA thuộc lịch sử `origin/main`;
   - `Verify IDOSI` đã PASS cho chính SHA đó.
6. Duyệt protected environment `production`.

Không deploy trực tiếp feature branch, tag `latest`, branch head đang di chuyển hoặc SHA chưa verify.

## C. Durable remote deployment

Workflow upload đúng phiên bản script từ release đã checkout và khởi chạy deployment dưới một tiến trình tách khỏi phiên SSH.

- [ ] Workflow hiển thị `Operation ID`.
- [ ] File trạng thái remote được tạo tại:

```text
/opt/idosi/deploy/vps/backups/jobs/<operation-id>.status
```

- [ ] Log remote được ghi tại:

```text
/opt/idosi/deploy/vps/backups/jobs/<operation-id>.log
```

Nếu GitHub runner mất kết nối hoặc hết thời gian polling, tiến trình critical trên VPS **không bị kill theo SSH**. Không khởi chạy một deployment khác ngay; kiểm tra status/log remote và deployment lock trước.

## D. Preflight và build

Script phải tự kiểm tra:

- [ ] VPS repo tồn tại tại `/opt/idosi`.
- [ ] Working tree sạch, kể cả file untracked.
- [ ] Docker và Docker Compose hoạt động.
- [ ] `deploy/vps/.env` tồn tại.
- [ ] Release SHA tồn tại và thuộc `origin/main`.
- [ ] App và Caddy hiện tại tồn tại để tạo rollback point.
- [ ] Volume `/app/data` được xác định.
- [ ] Previous image được gắn rollback tag.
- [ ] Image mới được build theo exact SHA trước khi dừng traffic.
- [ ] Compose config hợp lệ và image exact-SHA tồn tại.

Không chỉnh source, dependency hoặc `.env` thủ công để chữa cháy trong lúc deploy.

## E. Backup bắt buộc

Trong cửa sổ bảo trì, script dừng Caddy và app rồi mới sao lưu volume để SQLite không còn writer.

- [ ] Caddy và app đã dừng trước backup.
- [ ] Backup archive tồn tại và không rỗng.
- [ ] Archive kiểm tra được bằng `tar -tzf`.
- [ ] Có SHA-256 checksum hợp lệ.
- [ ] Backup path và checksum được ghi trong deployment report.

Không xóa volume `idosi_data`. Không tiếp tục rollout khi backup thất bại.

## F. Rollout và migration

- [ ] App mới chạy bằng image `idosi-app:<full-release-sha>`.
- [ ] Migration khởi động không báo lỗi.
- [ ] Internal `/api/health` PASS.
- [ ] Internal `/api/release` trả đúng full release SHA.
- [ ] `.env` được cập nhật nguyên tử với `IDOSI_IMAGE` và `IDOSI_RELEASE_SHA`.
- [ ] Chỉ sau đó Caddy mới được khởi động.
- [ ] HTTPS local verification qua Caddy PASS đúng SHA.

Trước external verification, deployment report chỉ được ghi:

```text
STATUS=LOCAL_READY
```

Không được ghi `SUCCESS` ở giai đoạn này.

## G. External verification và finalize

Workflow từ GitHub runner phải kiểm tra:

```bash
node server/vps/verify-release.mjs https://idosi.io.vn <full-release-sha>
curl -fsS https://idosi.io.vn/ >/dev/null
```

Sau khi external verification PASS, workflow gọi remote finalizer. Finalizer kiểm tra lại public URL rồi mới đổi report nguyên tử thành:

```text
STATUS=SUCCESS
EXTERNAL_VERIFIED_AT_UTC=<timestamp>
```

- [ ] External `/api/health` PASS.
- [ ] External `/api/release` đúng exact SHA.
- [ ] Trang chính tải thành công.
- [ ] Pending report pointer đã được xóa.
- [ ] Deployment report có `STATUS=SUCCESS`.

External verification fail: report phải còn `LOCAL_READY`; không tự restore snapshot sau khi traffic đã mở vì có thể ghi đè dữ liệu mới.

## H. Smoke test production

Kiểm tra theo phạm vi thay đổi. Khi phù hợp:

- [ ] Login Admin.
- [ ] Login Business Support.
- [ ] Login store manager.
- [ ] Login employee.
- [ ] Dashboard và static assets tải đúng.
- [ ] Quyền bị từ chối đúng với role không hợp lệ.
- [ ] Store isolation đúng.
- [ ] Orders/attendance/payroll/bonus đọc đúng nếu release liên quan.
- [ ] Mutation chính của task hoạt động.
- [ ] Image/file storage hoạt động nếu release liên quan storage.
- [ ] Desktop/mobile hoạt động nếu thay UI.

Không tạo dữ liệu lương, thưởng, vi phạm hoặc tài chính giả không có kế hoạch dọn/void hợp lệ.

## I. Quan sát sau triển khai

```bash
cd /opt/idosi/deploy/vps
docker compose ps
docker compose logs --since=10m --tail=300 app caddy
curl -fsS https://idosi.io.vn/api/health
curl -fsS https://idosi.io.vn/api/release
```

Tìm:

- HTTP 5xx;
- crash/restart loop;
- migration/database/SQLite lock errors;
- auth/session/authorization errors;
- storage errors;
- lỗi chức năng vừa thay đổi;
- disk usage tăng bất thường.

## J. Release record

Mỗi deployment phải lưu được:

- release SHA;
- previous Git/release SHA;
- previous image tag;
- backup filename/path;
- backup checksum;
- data volume;
- local-ready time;
- external verified time;
- operation ID, status file và log file;
- smoke-test result;
- rollback target.

Không tuyên bố `DEPLOYED`, `VERIFIED` hoặc `DONE` nếu report chưa `SUCCESS` hoặc smoke test chưa được quan sát.

## K. Rollback có kiểm soát

Chỉ dùng `deploy/vps/rollback-release.sh` với report hợp lệ. Script chấp nhận report `SUCCESS`, `LOCAL_READY` hoặc `FAILED_AFTER_TRAFFIC` khi rollback point/checksum đầy đủ.

```bash
cd /opt/idosi
bash deploy/vps/rollback-release.sh \
  /opt/idosi/deploy/vps/backups/deploy-YYYYMMDDTHHMMSSZ-abcdef123456.env
```

Rollback phải:

1. khóa deployment;
2. dừng Caddy/app;
3. tạo emergency backup của dữ liệu hiện tại;
4. kiểm tra checksum backup mục tiêu;
5. restore volume;
6. chạy previous image;
7. health + exact release verification;
8. lưu `.env` và checkout previous Git SHA;
9. chỉ mở Caddy khi mọi bước trên PASS.

Nếu rollback thất bại sau khi dữ liệu có thể đã thay đổi, emergency restore phải PASS. Nếu emergency restore, app health, config hoặc Git checkout thất bại, script phải **fail closed**, giữ Caddy/app dừng và ghi incident report; tuyệt đối không mở traffic trên dữ liệu rỗng hoặc phục hồi dở.

Không rollback bằng `git pull`, `git checkout` và `docker compose up -d --build` thủ công. Fix-forward phải đi qua branch → test → PR → `Verify IDOSI` → merge → protected deployment workflow.
