#!/bin/bash
# Restore an encrypted backup into a NEW database (never over the live one), then compare counts.
# Usage: sudo ./restore.sh /var/backups/premnathrail/premnathrail_db_<stamp>.dump.gpg [target_db]
set -Eeuo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

FILE="${1:?Usage: restore.sh <premnathrail_db_*.dump.gpg> [target_db]}"
TARGET="${2:-premnathrail_restored}"
[ -f "$FILE" ] || { echo "File not found: $FILE" >&2; exit 1; }
if [ "$TARGET" = "$DB_NAME" ]; then
    echo "Refusing to restore over the live database '$DB_NAME'. Restore into a new DB, check it, then switch DATABASE_URL in Dokploy." >&2
    exit 1
fi

CONTAINER="$(resolve_container)"
if [ -n "$(pg_in "$CONTAINER" psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'")" ]; then
    echo "Database '$TARGET' already exists. Drop it first or pass another name." >&2
    exit 1
fi

log "Creating '$TARGET' in '$CONTAINER' and restoring $(basename "$FILE")"
pg_in "$CONTAINER" createdb "$TARGET"
gpg "${gpg_args[@]}" -d "$FILE" | pg_in "$CONTAINER" pg_restore -d "$TARGET" --no-owner --no-privileges

COUNTS="SELECT 'alembic', version_num FROM alembic_version
        UNION ALL SELECT 'tables', count(*)::text FROM information_schema.tables WHERE table_schema = 'public'
        UNION ALL SELECT 'users', count(*)::text FROM users"
echo "--- restored: $TARGET"; pg_in "$CONTAINER" psql -d "$TARGET" -Atc "$COUNTS"
echo "--- live: $DB_NAME";    pg_in "$CONTAINER" psql -d "$DB_NAME" -Atc "$COUNTS"
log "Restore finished. Drop the test copy when done: docker exec <container> dropdb -U <user> $TARGET"
