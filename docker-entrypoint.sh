#!/bin/sh
set -e

echo "[entrypoint] applying database migrations..."
(cd /app/backend && alembic upgrade head)

echo "[entrypoint] starting backend (uvicorn, internal only on 127.0.0.1:8000)..."
(cd /app/backend && exec uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

# If the backend dies, bring the whole container down with it instead of
# silently serving a frontend with no working API.
trap 'kill $BACKEND_PID 2>/dev/null' EXIT
(wait $BACKEND_PID; echo "[entrypoint] backend exited, stopping container"; kill $$) &

echo "[entrypoint] starting frontend: $*"
exec "$@"
