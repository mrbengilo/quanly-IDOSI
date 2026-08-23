# IDOSI Automatic Delivery

Mục tiêu: sau khi người dùng yêu cầu thay đổi mã nguồn và Codex đã triển khai đúng yêu cầu, các bước kỹ thuật giao mã không cần hỏi xác nhận lại từng lần.

## Luồng mặc định

`REQUEST -> RISK CLASSIFY -> BRANCH -> IMPLEMENT/TEST -> PR -> verify PASS -> MERGE main -> Verify IDOSI main PASS -> AUTO VPS DEPLOY -> BACKUP -> BUILD -> HEALTH CHECK`

Codex không được bỏ branch/PR/CI để đạt tự động hóa.

## Trigger production

`.github/workflows/deploy-vps.yml` chỉ deploy khi workflow `Verify IDOSI`:

- được kích hoạt bởi `push`
- chạy trên `main`
- kết thúc `success`

Vì vậy CI thành công trên một Pull Request chưa tự deploy. Chỉ commit đã thực sự merge vào `main` và được verify lại mới được đưa lên VPS.

## Hành vi deploy

Workflow SSH vào VPS và:

1. Xác nhận working tree không có tracked source edit thủ công.
2. Ghi nhận SHA đang chạy.
3. Stop container `app` trong thời gian tạo backup nhất quán.
4. Backup Docker volume `vps_idosi_data` vào `deploy/vps/backups/`.
5. Start lại `app` sau backup.
6. `git fetch origin main`.
7. Xác nhận `origin/main` đúng bằng SHA đã được GitHub verify.
8. `git checkout main` + `git pull --ff-only origin main`.
9. `docker compose up -d --build`.
10. Chờ health endpoint PASS.
11. In deployed SHA, previous SHA và backup path vào Actions log.

Nếu health check fail, workflow fail và giữ backup để xử lý rollback có kiểm soát. Workflow không tự restore DB vì restore tự động có thể ghi đè dữ liệu mới phát sinh sau thời điểm backup.

## GitHub Actions secrets — cấu hình một lần

Repository cần các Actions secrets sau:

- `IDOSI_VPS_HOST` — IP/hostname SSH của VPS.
- `IDOSI_VPS_USER` — user SSH có quyền đọc repo và chạy Docker Compose.
- `IDOSI_VPS_SSH_KEY` — private key dành riêng cho GitHub Actions deploy.

Tùy chọn:

- `IDOSI_VPS_PORT` — mặc định `22`.
- `IDOSI_VPS_PATH` — mặc định `/opt/idosi`.
- `IDOSI_VPS_HEALTH_URL` — mặc định `https://idosi.io.vn/api/health`.

Không commit private key hoặc password vào repository.

## Tạo deploy SSH key một lần

Khuyến nghị dùng key riêng chỉ cho deployment, không dùng private key cá nhân.

Trên máy quản trị/VPS có thể tạo:

```bash
ssh-keygen -t ed25519 -C "idosi-github-deploy" -f idosi_github_deploy
```

- Nội dung `idosi_github_deploy.pub` thêm vào `~/.ssh/authorized_keys` của `IDOSI_VPS_USER` trên VPS.
- Nội dung private key `idosi_github_deploy` lưu vào GitHub Actions secret `IDOSI_VPS_SSH_KEY`.
- Sau khi GitHub secret đã lưu, xóa bản private key tạm khỏi thiết bị nếu không cần giữ.

User deploy cần có quyền chạy `docker compose`, đọc `/opt/idosi`, pull repository và ghi `deploy/vps/backups` mà không cần thao tác nhập password tương tác.

## Codex delivery policy

Sau khi cấu hình secrets một lần, khi người dùng yêu cầu thêm/sửa code IDOSI, Codex mặc định:

1. Tự phân loại FAST/STANDARD/CRITICAL.
2. Tạo branch và triển khai.
3. Chạy checks cần thiết.
4. Tạo PR.
5. Chờ required check `verify` PASS.
6. Nếu không có blocking finding, merge PR vào `main` mà không hỏi xác nhận lại.
7. GitHub Actions tự verify `main` và deploy VPS.
8. Codex kiểm tra/report kết quả deploy khi công cụ cho phép.

Không tự merge nếu CI fail, PR conflict, có finding Critical/High chưa giải quyết hoặc business rule CRITICAL còn mơ hồ.

## Rollback

Khi production regression xảy ra:

- xác định previous SHA từ deploy log
- tạo hotfix/revert qua Git/PR thay vì sửa trực tiếp VPS
- nếu chỉ lỗi code và schema vẫn tương thích, deploy previous/revert code qua pipeline
- chỉ restore volume backup khi xác định data/schema cần restore và chấp nhận ảnh hưởng dữ liệu phát sinh sau backup

Backup không thay thế việc review migration.

## Không làm

- Không push trực tiếp `main`.
- Không deploy feature branch lên production.
- Không sửa source production bằng editor/SSH rồi để đó.
- Không `git reset --hard` production để vượt qua tracked changes mà chưa hiểu nguyên nhân.
- Không bypass `verify`.
- Không lưu SSH private key trong source, `.env` commit hoặc Actions log.
