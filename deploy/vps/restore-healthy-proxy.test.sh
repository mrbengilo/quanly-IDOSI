#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/deploy/vps/deploy-release.sh"
RECOVERY_SCRIPT="$ROOT_DIR/deploy/vps/restore-healthy-proxy.sh"

bash -n "$DEPLOY_SCRIPT"
bash -n "$RECOVERY_SCRIPT"

grep -Fq 'compose up --no-deps --no-start --force-recreate caddy' "$DEPLOY_SCRIPT"
grep -Fq 'flock -n 9' "$RECOVERY_SCRIPT"
grep -Fq 'App đang chạy không khớp release được xác nhận.' "$RECOVERY_SCRIPT"
grep -Fq 'Caddy container không khớp release được xác nhận.' "$RECOVERY_SCRIPT"
grep -Fq 'Caddy không mount static volume của release được xác nhận.' "$RECOVERY_SCRIPT"
grep -Fq 'compose start caddy' "$RECOVERY_SCRIPT"

printf 'restore-healthy-proxy tests passed\n'
