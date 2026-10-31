#!/bin/bash
# Daily encrypted PostgreSQL backup -> SharePoint. Run as root (cron 02:00).
# Flow: pg_dump -Fc -> validate (tables, alembic_version) -> gpg AES-256 -> verify decrypt
#       -> upload Daily (+Weekly on Sunday, +Monthly on the 1st) -> verify size -> prune.
set -Eeuo pipefail
umask 077

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

STEP="start"
on_error() {
    local rc=$?
    log "BACKUP FAILED at step '$STEP' (exit $rc)"
    python3 "$BASE/upload.py" alert "PremnathRail DB backup FAILED on $(hostname) at $(date '+%F %T'): step '$STEP' (exit $rc). See /var/log/premnath-backup.log" || true
    exit "$rc"
}
trap on_error ERR

exec 9>"$BASE/backup.lock"
flock -n 9 || { log "Another backup is running, skipping."; exit 0; }

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
TMP_DB="$BACKUP_DIR/.db_$STAMP.dump"
TMP_GLOBALS="$BACKUP_DIR/.globals_$STAMP.sql"
OUT_DB="$BACKUP_DIR/premnathrail_db_$STAMP.dump.gpg"
OUT_GLOBALS="$BACKUP_DIR/premnathrail_globals_$STAMP.sql.gpg"
trap 'rm -f "$TMP_DB" "$TMP_GLOBALS"' EXIT

STEP="config"
[ -n "${DB_NAME:-}" ] || { log "DB_NAME is empty in .env"; false; }
[ -s "$KEY_FILE" ] || { log "Encryption key $KEY_FILE missing or empty"; false; }
CONTAINER="$(resolve_container)"
log "Backing up database '$DB_NAME' from container '$CONTAINER'"

STEP="pg_dump"
pg_in "$CONTAINER" pg_dump -d "$DB_NAME" -Fc > "$TMP_DB"
pg_in "$CONTAINER" pg_dumpall --globals-only > "$TMP_GLOBALS"
if [ ! -s "$TMP_DB" ] || [ ! -s "$TMP_GLOBALS" ]; then log "pg_dump produced an empty file"; false; fi

STEP="validate"
LIST="$(pg_in "$CONTAINER" pg_restore -l < "$TMP_DB")"
TABLES="$(grep -c ' TABLE public ' <<<"$LIST" || true)"
if ! grep -q 'TABLE DATA public alembic_version' <<<"$LIST"; then
    log "Dump has no alembic_version table - '$DB_NAME' is not the ERP database"; false
fi
if [ "$TABLES" -lt "${MIN_TABLES:-100}" ]; then
    log "Dump has only $TABLES tables (minimum ${MIN_TABLES:-100}) - wrong or empty database?"; false
fi
log "Dump OK: $TABLES tables, $(du -h "$TMP_DB" | cut -f1)"

STEP="encrypt"
for pair in "$TMP_DB:$OUT_DB" "$TMP_GLOBALS:$OUT_GLOBALS"; do
    src="${pair%%:*}"; dst="${pair#*:}"
    gpg "${gpg_args[@]}" --symmetric --cipher-algo AES256 --compress-algo none -o "$dst" "$src"
    # Prove the encrypted file decrypts back to the exact dump before trusting it
    [ "$(gpg "${gpg_args[@]}" -d "$dst" | sha256sum | cut -d' ' -f1)" = "$(sha256sum "$src" | cut -d' ' -f1)" ]
done

STEP="upload"
python3 "$BASE/upload.py" upload "$OUT_DB" "$OUT_GLOBALS"
touch "$OUT_DB.uploaded" "$OUT_GLOBALS.uploaded"

STEP="local-cleanup"
# Only delete local copies that were uploaded and verified
find "$BACKUP_DIR" -maxdepth 1 -name 'premnathrail_*.gpg' -mtime +"${LOCAL_KEEP_DAYS:-7}" -print0 |
    while IFS= read -r -d '' f; do
        if [ -f "$f.uploaded" ]; then rm -f "$f" "$f.uploaded"; fi
    done

log "Backup completed: $(basename "$OUT_DB") ($(du -h "$OUT_DB" | cut -f1))"
