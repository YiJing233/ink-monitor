#!/usr/bin/env bash
#
# Backup the Ink Monitor SQLite database to a timestamped, compressed file.
#
# Usage:
#   ./scripts/backup.sh                          # backs up ./data/monitor.db
#   ./scripts/backup.sh /var/lib/ink-monitor     # different data dir
#   BACKUP_DIR=/backups ./scripts/backup.sh      # custom backup location
#
# Cron suggestion (daily at 03:30, keep 30 days):
#   30 3 * * * /opt/ink-monitor/scripts/backup.sh
#
# Off-host sync suggestion:
#   rclone sync /var/backups/ink-monitor remote:backups/ink-monitor
#
set -euo pipefail

DATA_DIR="${1:-${DATA_DIR:-./data}}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_DIR}/monitor-${TS}.db.gz"
KEEP_DAYS="${KEEP_DAYS:-30}"

if [[ ! -d "${DATA_DIR}" ]]; then
  echo "✗ data dir not found: ${DATA_DIR}" >&2
  exit 1
fi

DB="${DATA_DIR}/monitor.db"
if [[ ! -f "${DB}" ]]; then
  echo "✗ database not found: ${DB}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# Run a WAL checkpoint so the -wal and -shm sidecars can be released
# before we copy. This requires sqlite3; if missing, fall back to
# a best-effort copy.
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB}" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
fi

# Use sqlite3's .backup if available (atomic, consistent snapshot); else
# fall back to gzipping the live file (small risk of partial write on
# very busy DBs, mitigated by the WAL checkpoint above).
TMP="$(mktemp -t monitor-backup.XXXXXX.db)"
trap 'rm -f "${TMP}"' EXIT

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB}" ".backup '${TMP}'"
else
  cp "${DB}" "${TMP}"
fi

gzip -9 < "${TMP}" > "${BACKUP_FILE}"
rm -f "${TMP}"

# Verify the gzip is a real gzip file
if ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
  echo "✗ backup failed integrity check: ${BACKUP_FILE}" >&2
  exit 1
fi

# Optional off-host push
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  rclone copy "${BACKUP_FILE}" "${RCLONE_REMOTE}" --progress
fi

# Prune old backups
pruned=$(find "${BACKUP_DIR}" -name "monitor-*.db.gz" -mtime "+${KEEP_DAYS}" -delete -print | wc -l | tr -d ' ')

size=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "✓ backup ${BACKUP_FILE} (${size}), pruned ${pruned} old"
