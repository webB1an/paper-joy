#!/usr/bin/env bash
set -euo pipefail
APP_ROOT=/www/wwwroot/paper-joy
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
umask 077
mkdir -p "$APP_ROOT/shared/backups"
mysqldump --defaults-extra-file="$APP_ROOT/shared/backup.cnf" --single-transaction --no-tablespaces --skip-lock-tables paper_joy | gzip > "$APP_ROOT/shared/backups/paper_joy-$STAMP.sql.gz"
gzip -t "$APP_ROOT/shared/backups/paper_joy-$STAMP.sql.gz"
find "$APP_ROOT/shared/backups" -maxdepth 1 -name 'paper_joy-*.sql.gz' -type f -mtime +14 -delete
echo "PaperJoy backup complete: $STAMP"
