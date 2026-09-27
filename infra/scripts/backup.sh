#!/usr/bin/env bash
# DB 일 1회 pg_dump + WAL 아카이브 (spec §13: RPO 1h / RTO 4h), 도안 파일 rsync.
# 사용법: infra/scripts/backup.sh [백업 디렉터리]
# prod 에서는 cron (매일 02:00 KST) 으로 실행한다. 월 1회 복구 리허설은 별도 절차.
set -euo pipefail

BACKUP_DIR="${1:-/backups}"
DB_NAME="${DB_NAME:-songwol_qr}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# TODO(배포 웨이브):
#   1. pg_dump -Fc "$DB_NAME" > "$BACKUP_DIR/db/${DB_NAME}_${STAMP}.dump"
#   2. WAL 아카이브 디렉터리 정리 (archive_command 는 postgresql.conf 에서 설정)
#   3. rsync -a /data/artwork/ "$BACKUP_DIR/artwork/"
#   4. 보존: dump 30일, WAL 7일
#   5. 실패 시 알림
echo "TODO: not implemented (Phase 0 stub). BACKUP_DIR=$BACKUP_DIR DB_NAME=$DB_NAME STAMP=$STAMP" >&2
exit 1
