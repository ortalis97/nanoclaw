#!/bin/bash
# NanoClaw backup script
#
# Backs up critical NanoClaw data:
#   - WhatsApp auth credentials (store/auth/)       [required]
#   - SQLite message database (store/messages.db)   [required]
#   - Environment config (.env)                     [required]
#   - Group memory files (groups/)                  [optional — created on first bot use]
#   - Session data (data/sessions/)                 [optional — created on first bot use]
#
# WARNING: The backup archive includes .env which contains your API key.
#          The backup directory is created with chmod 700 (owner-only access).
#          Treat backup archives as sensitive files.
#
# Retains last 7 backups, deletes older ones.
#
# Usage:
#   /opt/nanoclaw/backup.sh
#
# Cron (daily at 3am, add via: crontab -e):
#   0 3 * * * /opt/nanoclaw/backup.sh >> /opt/nanoclaw/logs/backup.log 2>&1

set -euo pipefail

BACKUP_DIR="$HOME/nanoclaw-backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/nanoclaw-backup-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup..."

# Required paths — these must exist for a valid backup.
REQUIRED_PATHS="store/auth store/messages.db .env"

# Optional paths — included only if they exist (created on first bot use).
OPTIONAL_PATHS=()
for optional in groups data/sessions; do
  if [[ -e "/opt/nanoclaw/$optional" ]]; then
    OPTIONAL_PATHS+=("$optional")
  fi
done

# Create archive (required paths are not quoted with noglob so word-splitting is intentional here)
# shellcheck disable=SC2086
tar czf "$ARCHIVE" -C /opt/nanoclaw $REQUIRED_PATHS "${OPTIONAL_PATHS[@]+"${OPTIONAL_PATHS[@]}"}"

# Verify the archive was created and is non-empty
if [[ ! -s "$ARCHIVE" ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup archive not created or is empty: $ARCHIVE" >&2
  exit 1
fi

# Restrict archive permissions (contains API key)
chmod 600 "$ARCHIVE"

# Keep last 7 backups, delete older ones
ls -t "$BACKUP_DIR"/nanoclaw-backup-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f

SIZE=$(du -sh "$ARCHIVE" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete: $ARCHIVE ($SIZE)"
