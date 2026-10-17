#!/usr/bin/env bash
# Daily online backup of the IDOSI VPS data volume, without stopping traffic.
#
# 1. The running app writes a transactionally consistent SQLite snapshot with
#    VACUUM INTO (server/vps/online-backup.mjs) and verifies integrity.
# 2. The snapshot and the CCCD/avatar image directory are archived on the host
#    in the same layout as the data volume, so deploy/rollback restore works.
# 3. Optional encryption (IDOSI_BACKUP_ENCRYPTION_KEY_FILE) and off-site copy
#    (IDOSI_BACKUP_RCLONE_REMOTE); daily archives beyond the retention count are
#    removed. Deployment backups and reports are never touched.
#
# Install on the VPS (runs 02:17 server time):
#   17 2 * * * bash /opt/idosi/deploy/vps/backup-daily.sh >> /opt/idosi/deploy/vps/backups/daily/backup.log 2>&1
set -Eeuo pipefail
umask 077

log() {
  printf '[idosi-backup] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Thiếu lệnh bắt buộc: $1"
}

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_DIR="$IDOSI_ROOT/deploy/vps"
BACKUP_ROOT="${IDOSI_BACKUP_DIR:-$COMPOSE_DIR/backups}"
DAILY_DIR="$BACKUP_ROOT/daily"
KEEP_DAILY="${IDOSI_BACKUP_KEEP_DAILY:-14}"
DEPLOY_LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"
BACKUP_LOCK_FILE="${IDOSI_BACKUP_LOCK:-/tmp/idosi-daily-backup.lock}"
ENCRYPTION_KEY_FILE="${IDOSI_BACKUP_ENCRYPTION_KEY_FILE:-}"
RCLONE_REMOTE="${IDOSI_BACKUP_RCLONE_REMOTE:-}"
CONTAINER_DATA_DIR='/app/data'
CONTAINER_SNAPSHOT_DIR="$CONTAINER_DATA_DIR/.online-backup"

[[ "$KEEP_DAILY" =~ ^[1-9][0-9]*$ ]] || die 'IDOSI_BACKUP_KEEP_DAILY phải là số nguyên dương.'
for command_name in docker flock tar sha256sum awk date mktemp mv rm ls sort head mkdir; do
  require_command "$command_name"
done
[[ -f "$COMPOSE_DIR/compose.yml" ]] || die 'Không tìm thấy deploy/vps/compose.yml.'
if [[ -n "$ENCRYPTION_KEY_FILE" ]]; then
  require_command openssl
  [[ -s "$ENCRYPTION_KEY_FILE" ]] || die 'IDOSI_BACKUP_ENCRYPTION_KEY_FILE không tồn tại hoặc rỗng.'
fi
if [[ -n "$RCLONE_REMOTE" ]]; then
  require_command rclone
fi
mkdir -p "$DAILY_DIR"

exec 8>"$BACKUP_LOCK_FILE"
flock -n 8 || die 'Đang có một lần backup hằng ngày khác chạy.'
# Never snapshot in the middle of a deployment: the deploy script stops the
# app, backs up the volume itself and may run migrations.
exec 9>"$DEPLOY_LOCK_FILE"
flock -n 9 || { log 'Đang có deployment chạy; bỏ qua backup lần này.'; exit 0; }
flock -u 9

compose() {
  (cd "$COMPOSE_DIR" && docker compose -f compose.yml "$@")
}

APP_CONTAINER="$(compose ps -q app 2>/dev/null | head -n 1)"
[[ -n "$APP_CONTAINER" ]] || die 'Không tìm thấy container app đang chạy.'
[[ "$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null)" == 'true' ]] \
  || die 'Container app không ở trạng thái running.'

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT_NAME="idosi-$TIMESTAMP.sqlite"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/idosi-backup.XXXXXX")"
cleanup() {
  rm -rf -- "$WORK_DIR"
  compose exec -T app rm -f -- "$CONTAINER_SNAPSHOT_DIR/$SNAPSHOT_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log 'Tạo snapshot SQLite trực tuyến (VACUUM INTO) trong container app.'
compose exec -T app node server/vps/online-backup.mjs "$CONTAINER_SNAPSHOT_DIR/$SNAPSHOT_NAME" \
  || die 'Snapshot SQLite thất bại.'

mkdir -p "$WORK_DIR/data"
docker cp "$APP_CONTAINER:$CONTAINER_SNAPSHOT_DIR/$SNAPSHOT_NAME" "$WORK_DIR/data/idosi.sqlite" >/dev/null \
  || die 'Không sao chép được snapshot ra host.'
[[ -s "$WORK_DIR/data/idosi.sqlite" ]] || die 'Snapshot rỗng.'
for image_dir in identity-images; do
  if compose exec -T app test -d "$CONTAINER_DATA_DIR/$image_dir"; then
    docker cp "$APP_CONTAINER:$CONTAINER_DATA_DIR/$image_dir" "$WORK_DIR/data/$image_dir" >/dev/null \
      || die "Không sao chép được thư mục $image_dir."
  fi
done

ARCHIVE_NAME="idosi-daily-$TIMESTAMP.tar.gz"
tar -czf "$WORK_DIR/$ARCHIVE_NAME" -C "$WORK_DIR/data" .
tar -tzf "$WORK_DIR/$ARCHIVE_NAME" >/dev/null || die 'Archive backup không đọc lại được.'
FINAL_NAME="$ARCHIVE_NAME"
if [[ -n "$ENCRYPTION_KEY_FILE" ]]; then
  FINAL_NAME="$ARCHIVE_NAME.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
    -in "$WORK_DIR/$ARCHIVE_NAME" -out "$WORK_DIR/$FINAL_NAME" -pass "file:$ENCRYPTION_KEY_FILE" \
    || die 'Mã hóa backup thất bại.'
  rm -f -- "$WORK_DIR/$ARCHIVE_NAME"
fi
CHECKSUM="$(sha256sum "$WORK_DIR/$FINAL_NAME" | awk '{print $1}')"
[[ "$CHECKSUM" =~ ^[0-9a-f]{64}$ ]] || die 'Không tạo được checksum backup.'
mv -- "$WORK_DIR/$FINAL_NAME" "$DAILY_DIR/$FINAL_NAME"
printf '%s  %s\n' "$CHECKSUM" "$FINAL_NAME" > "$DAILY_DIR/$FINAL_NAME.sha256"
log "Backup thành công: $DAILY_DIR/$FINAL_NAME ($CHECKSUM)"

if [[ -n "$RCLONE_REMOTE" ]]; then
  rclone copy "$DAILY_DIR/$FINAL_NAME" "$RCLONE_REMOTE" \
    && rclone copy "$DAILY_DIR/$FINAL_NAME.sha256" "$RCLONE_REMOTE" \
    || die "Không đẩy được backup lên $RCLONE_REMOTE (bản local vẫn được giữ)."
  log "Đã sao chép backup ra ngoài VPS: $RCLONE_REMOTE"
fi

# Retention: only this script's own daily archives, newest first; the archive
# just written is always kept.
mapfile -t DAILY_ARCHIVES < <(ls -1 "$DAILY_DIR" | awk '/^idosi-daily-[0-9]{8}T[0-9]{6}Z\.tar\.gz(\.enc)?$/' | sort -r)
for (( index = KEEP_DAILY; index < ${#DAILY_ARCHIVES[@]}; index += 1 )); do
  old="${DAILY_ARCHIVES[$index]}"
  [[ "$old" == "$FINAL_NAME" ]] && continue
  rm -f -- "$DAILY_DIR/$old" "$DAILY_DIR/$old.sha256"
  log "Xóa backup hằng ngày cũ: $old"
done
