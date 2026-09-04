#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

log() {
  printf '[idosi-proxy-recovery] %s\n' "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

EXPECTED_RELEASE_SHA="${1:-}"
CONFIRMATION="${2:-}"

[[ "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Release SHA không hợp lệ.'
[[ "$CONFIRMATION" == 'RESTORE_HEALTHY_PROXY' ]] || die 'Thiếu chuỗi xác nhận recovery.'

IDOSI_ROOT="${IDOSI_ROOT:-/opt/idosi}"
COMPOSE_DIR="$IDOSI_ROOT/deploy/vps"
LOCK_FILE="${IDOSI_DEPLOY_LOCK:-/tmp/idosi-production-deploy.lock}"
PUBLIC_URL="${IDOSI_PUBLIC_URL:-https://idosi.io.vn}"

for command_name in awk curl docker flock grep seq sleep tail; do
  command -v "$command_name" >/dev/null 2>&1 || die "Thiếu lệnh bắt buộc: $command_name"
done
docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin không hoạt động.'
[[ -f "$COMPOSE_DIR/compose.yml" ]] || die 'Không tìm thấy compose.yml.'
[[ -f "$COMPOSE_DIR/.env" ]] || die 'Không tìm thấy cấu hình runtime VPS.'

exec 9>"$LOCK_FILE"
flock -n 9 || die 'Đang có deployment hoặc recovery khác chạy.'

compose() {
  (cd "$COMPOSE_DIR" && docker compose -f compose.yml "$@")
}

app_container="$(compose ps -q app)"
[[ -n "$app_container" ]] || die 'Không tìm thấy app container đang chạy.'
[[ "$(docker inspect --format '{{.State.Running}}' "$app_container")" == 'true' ]] \
  || die 'App container không ở trạng thái running.'
[[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$app_container")" == 'healthy' ]] \
  || die 'App container chưa healthy.'

runtime_release="$(compose exec -T app node -e \
  "fetch('http://127.0.0.1:3000/api/release').then(r=>r.json()).then(v=>process.stdout.write(v?.data?.releaseSha||'')).catch(()=>process.exit(1))")"
[[ "$runtime_release" == "$EXPECTED_RELEASE_SHA" ]] \
  || die 'App đang chạy không khớp release được xác nhận.'

caddy_container="$(compose ps -q --all caddy)"
[[ -n "$caddy_container" ]] || die 'Không tìm thấy Caddy container hiện tại.'
configured_release="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$caddy_container" \
  | awk -F= '$1 == "IDOSI_RELEASE_SHA" { print $2 }' | tail -n 1)"
[[ "$configured_release" == "$EXPECTED_RELEASE_SHA" ]] \
  || die 'Caddy container không khớp release được xác nhận.'

expected_static_volume="idosi_static_$EXPECTED_RELEASE_SHA"
actual_static_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv/idosi"}}{{.Name}}{{end}}{{end}}' "$caddy_container")"
[[ "$actual_static_volume" == "$expected_static_volume" ]] \
  || die 'Caddy không mount static volume của release được xác nhận.'

compose start caddy
for _ in $(seq 1 12); do
  [[ "$(docker inspect --format '{{.State.Running}}' "$caddy_container")" == 'true' ]] && break
  sleep 1
done
[[ "$(docker inspect --format '{{.State.Running}}' "$caddy_container")" == 'true' ]] \
  || die 'Caddy không duy trì trạng thái running.'

public_origin="${PUBLIC_URL%/}"
public_host="${public_origin#*://}"
public_host="${public_host%%/*}"
public_host="${public_host%%:*}"
release_json="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  --resolve "$public_host:443:127.0.0.1" "$public_origin/api/release")"
grep -Fq "\"releaseSha\":\"$EXPECTED_RELEASE_SHA\"" <<<"$release_json" \
  || die 'Caddy chưa phục vụ đúng release nội bộ.'

log "Khôi phục Caddy thành công cho release $EXPECTED_RELEASE_SHA; dữ liệu không bị thay đổi."
