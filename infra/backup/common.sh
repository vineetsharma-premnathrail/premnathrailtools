# Shared by backup.sh and restore.sh (sourced, not executed).

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$BASE/.env" ] || { echo "Missing $BASE/.env - copy .env.example to .env and fill it in." >&2; exit 1; }
set -a
# shellcheck disable=SC1091
source "$BASE/.env"
set +a

BACKUP_DIR="${BACKUP_DIR:-/var/backups/premnathrail}"
KEY_FILE="${ENCRYPTION_KEY_FILE:-/root/.premnath-backup.key}"

log() { echo "[$(date '+%F %T')] $*"; }

# Dokploy names swarm containers "<service>.1.<task-id>", so match the name or that prefix.
resolve_container() {
    local name
    name="$(docker ps --format '{{.Names}}' | grep -E "^${DB_CONTAINER}(\.|$)" | head -n1 || true)"
    if [ -z "$name" ]; then
        echo "No running container matches DB_CONTAINER='${DB_CONTAINER}'. Check the name with: docker ps --format '{{.Names}}'" >&2
        return 1
    fi
    echo "$name"
}

# Runs a postgres client tool inside the container as DB_USER (or the container's POSTGRES_USER).
# Usage: pg_in <container> <tool> [args...]   (stdin/stdout pass through)
pg_in() {
    local c="$1"; shift
    docker exec -i -e "BK_USER=${DB_USER:-}" "$c" sh -c \
        'tool="$1"; shift; PGPASSWORD="${POSTGRES_PASSWORD:-}" exec "$tool" -U "${BK_USER:-$POSTGRES_USER}" "$@"' _ "$@"
}

gpg_args=(--batch --yes --quiet --pinentry-mode loopback --passphrase-file "$KEY_FILE")
