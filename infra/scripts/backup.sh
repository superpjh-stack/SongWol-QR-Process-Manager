#!/usr/bin/env bash
# DB 일 1회 pg_dump + 도안 파일 rsync (spec §13: RPO 1h / RTO 4h).
# WAL 아카이브 자체는 postgresql.conf 의 archive_command 로 설정한다(이 스크립트는 덤프+정리만 담당).
# 사용법: infra/scripts/backup.sh [백업 디렉터리]
# prod 에서는 cron(매일 02:00 KST, infra/scripts/crontab)으로 실행한다. 월 1회 복구 리허설은 별도 절차(수동).
set -euo pipefail

BACKUP_DIR="${1:-/backups}"
DB_NAME="${DB_NAME:-songwol_qr}"
DB_HOST="${DB_HOST:-postgres}"
DB_USER="${DB_USER:-postgres}"
ARTWORK_DIR="${ARTWORK_DIR:-/data/artwork}"
DUMP_RETAIN_DAYS="${DUMP_RETAIN_DAYS:-30}"
STAMP="$(TZ=Asia/Seoul date +%Y%m%dT%H%M%S%z)"

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/artwork"

DUMP_FILE="$BACKUP_DIR/db/${DB_NAME}_${STAMP}.dump"
echo "[backup] pg_dump -> $DUMP_FILE"
if ! pg_dump -h "$DB_HOST" -U "$DB_USER" -Fc -f "$DUMP_FILE" "$DB_NAME"; then
  echo "[backup] FAILED: pg_dump 실패 — 이전 백업은 보존됨" >&2
  rm -f "$DUMP_FILE"
  exit 1
fi

if [ -d "$ARTWORK_DIR" ]; then
  echo "[backup] rsync 도안 파일 -> $BACKUP_DIR/artwork/"
  rsync -a --delete "$ARTWORK_DIR/" "$BACKUP_DIR/artwork/"
else
  echo "[backup] 경고: ARTWORK_DIR($ARTWORK_DIR) 없음 — 도안 백업 건너뜀" >&2
fi

echo "[backup] 보존 정책 적용: dump ${DUMP_RETAIN_DAYS}일 초과분 삭제"
find "$BACKUP_DIR/db" -name "${DB_NAME}_*.dump" -mtime "+${DUMP_RETAIN_DAYS}" -print -delete

echo "[backup] 완료: $STAMP"
