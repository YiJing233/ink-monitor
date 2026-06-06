#!/usr/bin/env bash
#
# Restore the Ink Monitor SQLite database from a backup file.
#
# Usage:
#   ./scripts/restore.sh ./backups/monitor-20260607T030000Z.db.gz
#   ./scripts/restore.sh ./backups/monitor-20260607T030000Z.db.gz /var/lib/ink-monitor
#
# This script will:
#   1. Stop the running Ink Monitor process (if you started it with the
#      standard systemd unit, or skip if you manage it yourself).
#   2. Back up the CURRENT data dir to a timestamped file (so you can
#      undo a bad restore).
#   3. gunzip the backup into the data dir.
#   4. Start Ink Monitor again.
#
# If you want to restore WITHOUT service management, set SKIP_SERVICE=1.
#
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <backup-file.db.gz> [data-dir]" >&2
  exit 1
fi

BACKUP_FILE="$1"
DATA_DIR="${2:-${DATA_DIR:-./data}}"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "✗ backup not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [[ ! -d "${DATA_DIR}" ]]; then
  echo "✗ data dir not found: ${DATA_DIR}" >&2
  exit 1
fi

# Sanity check the gzip
if ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
  echo "✗ backup file is not a valid gzip: ${BACKUP_FILE}" >&2
  exit 1
fi

# 1. Stop the service (unless skipped)
if [[ "${SKIP_SERVICE:-0}" != "1" ]] && command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet ink-monitor 2>/dev/null; then
    echo "→ stopping ink-monitor"
    systemctl stop ink-monitor || true
  fi
fi

# 2. Back up current state to a recovery point
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RECOVERY_DIR="${BACKUP_DIR:-./backups}/recovery"
mkdir -p "${RECOVERY_DIR}"
if [[ -f "${DATA_DIR}/monitor.db" ]]; then
  cp "${DATA_DIR}/monitor.db" "${RECOVERY_DIR}/monitor-${TS}.db"
  echo "→ current db saved to ${RECOVERY_DIR}/monitor-${TS}.db"
fi

# 3. Restore
gunzip -c "${BACKUP_FILE}" > "${DATA_DIR}/monitor.db"
# also clear any stale -wal / -shm so the restored file is consistent
rm -f "${DATA_DIR}/monitor.db-wal" "${DATA_DIR}/monitor.db-shm"

# 4. Start the service back up
if [[ "${SKIP_SERVICE:-0}" != "1" ]] && command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files ink-monitor.service >/dev/null 2>&1; then
    echo "→ starting ink-monitor"
    systemctl start ink-monitor || true
  fi
fi

echo "✓ restored ${BACKUP_FILE} → ${DATA_DIR}/monitor.db"
echo "  if something is wrong, undo with:"
echo "  cp ${RECOVERY_DIR}/monitor-${TS}.db ${DATA_DIR}/monitor.db"
