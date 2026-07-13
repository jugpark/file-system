#!/usr/bin/env bash
# 백업 (R1-2) — 대상은 딱 둘: app.db(메타·권한·휴지통 원장) + 스토리지 실체.
# 썸네일은 재생성 가능하므로 제외. cron 예시:  0 4 * * * /path/to/backup.sh
#
# ⚠ 백업은 복구해 본 것만 백업이다 — 최초 1회 복구 리허설 필수:
#   sqlite3 restored.db ".tables" && diff -r storage/ restore/storage/ | head
set -euo pipefail

DB_PATH="${DB_PATH:-./data/db/app.db}"
STORAGE_ROOT="${STORAGE_ROOT:-./data/storage}"
BACKUP_DIR="${BACKUP_DIR:-/backup/file-system}"
KEEP_DAYS="${KEEP_DAYS:-7}"

STAMP="$(date +%Y%m%d_%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"

# 1) SQLite — WAL 모드에서도 안전한 .backup 사용 (파일 복사 금지)
sqlite3 "$DB_PATH" ".backup '$DEST/app.db'"

# 2) 스토리지 — 하드링크 증분(--link-dest)으로 공간 절약
LATEST="$BACKUP_DIR/latest"
if [ -d "$LATEST/storage" ]; then
  rsync -a --delete --link-dest="$LATEST/storage" "$STORAGE_ROOT/" "$DEST/storage/"
else
  rsync -a "$STORAGE_ROOT/" "$DEST/storage/"
fi
ln -sfn "$DEST" "$LATEST"

# 3) 보존 기간 초과분 정리
find "$BACKUP_DIR" -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} +

echo "backup done: $DEST ($(du -sh "$DEST" | cut -f1))"
