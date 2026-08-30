# IDOSI VPS Deployment Checklist

Checklist bắt buộc cho pipeline tự động. Không dùng quy trình cũ
`git pull && docker compose up -d --build` để phát hành production.

```text
PR
→ Verify IDOSI PASS
→ merge main
→ Verify IDOSI push/main PASS cho exact merge SHA
→ Deploy IDOSI VPS tự khởi chạy
→ durable backup/rollout/local verification
→ external verification
→ report SUCCESS
→ smoke test + observation
```

## A. Thiết lập một lần

- [ ] `main` bắt buộc Pull Request và required check `verify`.
- [ ] Environment `production` chỉ cho branch `main`.
- [ ] Để tự động hoàn toàn: Required reviewers OFF, Wait timer OFF.
- [ ] Có đủ secrets `IDOSI_VPS_HOST`, `IDOSI_VPS_PORT`, `IDOSI_VPS_USER`,
  `IDOSI_VPS_SSH_PRIVATE_KEY`, `IDOSI_VPS_KNOWN_HOSTS`.
- [ ] SSH private key đăng nhập non-interactive bằng deploy user riêng.
- [ ] ED25519 host fingerprint đã được đối chiếu trực tiếp trên VPS.
- [ ] Deploy user đọc `/opt/idosi`, `.env`, ghi `backups/` và chạy Docker.
- [ ] Manual deployment thử đã PASS, `/api/release` đúng SHA.

## B. Automatic release gate

Sau mỗi merge, kiểm tra `Verify IDOSI` của sự kiện `push` trên `main`:

- [ ] conclusion `success`;
- [ ] head branch `main`;
- [ ] head SHA là full 40-character merge SHA;
- [ ] không còn finding Critical/High hợp lệ;
- [ ] workflow `Deploy IDOSI VPS` tự xuất hiện với event `workflow_run`.

Automatic deploy phải bỏ qua PR verify, workflow-dispatch verify, branch khác và
verify thất bại. Không deploy trực tiếp từ `push` hoặc `pull_request`; chỉ chain từ
workflow xác minh đã hoàn tất.

## C. Manual fallback

Chỉ dùng **Actions → Deploy IDOSI VPS → Run workflow** khi cần re-deploy/recovery.
Manual SHA phải thuộc `main` và đã có `Verify IDOSI` push/main PASS. Không dùng để
bỏ qua CI.

## D. Durable remote deployment

- [ ] Workflow hiển thị Trigger mode, Verify run ID và Operation ID.
- [ ] Remote job status nằm tại `backups/jobs/<operation-id>.status`.
- [ ] Remote log nằm tại `backups/jobs/<operation-id>.log`.
- [ ] Critical process chạy detached; runner disconnect/timeout không kill nó.
- [ ] `concurrency: idosi-production`, `cancel-in-progress: false`.

Nếu runner hết polling, không khởi động deployment mới trước khi kiểm tra remote
status/log và lock.

## E. Preflight và build

- [ ] VPS repo `/opt/idosi` tồn tại và working tree sạch kể cả untracked files.
- [ ] Docker, Compose và `deploy/vps/.env` hoạt động.
- [ ] Release SHA tồn tại và thuộc `origin/main`.
- [ ] App/Caddy hiện tại và data volume được xác định.
- [ ] Previous image được giữ làm rollback point.
- [ ] Image exact-SHA được build trước downtime.

## F. Backup và rollout

- [ ] Caddy/app dừng trước backup.
- [ ] Archive tồn tại, không rỗng và `tar -tzf` PASS.
- [ ] SHA-256 checksum hợp lệ và được ghi report.
- [ ] App mới chạy image `idosi-app:<full-sha>`.
- [ ] Migration/startup không lỗi.
- [ ] Internal health và exact `/api/release` PASS.
- [ ] `.env` lưu `IDOSI_IMAGE`/`IDOSI_RELEASE_SHA` nguyên tử.
- [ ] Caddy chỉ mở sau internal verification.
- [ ] Local HTTPS exact-SHA PASS.
- [ ] Report ở trạng thái `LOCAL_READY`, chưa phải `SUCCESS`.

## G. External verification và finalize

- [ ] External `/api/health` PASS.
- [ ] External `/api/release` đúng exact merge SHA.
- [ ] Trang chính tải thành công.
- [ ] Remote finalizer kiểm tra lại public endpoint.
- [ ] Report đổi nguyên tử thành `STATUS=SUCCESS`.
- [ ] Pending report pointer được xóa.

External verification fail sau khi traffic mở: không tự restore snapshot vì có
thể ghi đè dữ liệu mới; giữ report `LOCAL_READY` và xử lý incident có kiểm soát.

## H. Smoke test production

Theo phạm vi thay đổi, kiểm tra các mục áp dụng:

- [ ] Login Admin, Business Support, store manager và employee.
- [ ] Dashboard/static assets tải đúng.
- [ ] Role denied path và store isolation đúng.
- [ ] Orders/attendance/payroll/bonus đúng nếu release liên quan.
- [ ] Mutation chính hoạt động.
- [ ] Image/file storage hoạt động nếu liên quan.
- [ ] Desktop/mobile hoạt động nếu thay UI.

Không tạo dữ liệu lương/thưởng/vi phạm/tài chính giả không có kế hoạch void/dọn.

## I. Quan sát và bằng chứng hoàn thành

```bash
cd /opt/idosi/deploy/vps
docker compose ps
docker compose logs --since=10m --tail=300 app caddy
curl -fsS https://idosi.io.vn/api/health
curl -fsS https://idosi.io.vn/api/release
```

Chỉ báo `DEPLOYED/VERIFIED/DONE` khi:

- [ ] main Verify PASS;
- [ ] auto deploy workflow PASS;
- [ ] production exact SHA khớp;
- [ ] report `SUCCESS`;
- [ ] container healthy, không restart loop/5xx/migration/SQLite/auth/storage lỗi;
- [ ] smoke test PASS;
- [ ] backup/checksum/report/rollback point tồn tại.

## J. Rollback có kiểm soát

```bash
cd /opt/idosi
bash deploy/vps/rollback-release.sh \
  /opt/idosi/deploy/vps/backups/deploy-YYYYMMDDTHHMMSSZ-abcdef123456.env
```

Rollback phải khóa deployment, dừng traffic, tạo emergency backup, kiểm tra
checksum, restore volume, chạy previous image, exact-release verify, lưu config/Git
SHA và chỉ mở Caddy khi mọi bước PASS. Recovery lỗi phải fail closed, giữ app/Caddy
dừng và ghi incident report.
