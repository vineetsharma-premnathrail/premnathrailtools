# Maintenance Procedures

Routine maintenance tasks for this repo, derived from actual patterns found
in the codebase (not aspirational process). For incident-specific handling,
see `INCIDENT_RUNBOOK.md`; for the broader operational runbook, see
[`../runbook/RUNBOOK.md`](../runbook/RUNBOOK.md).

## After pulling backend changes: apply migrations

Any time you pull changes that touch `backend/alembic/versions/`, apply them
before starting the backend:

```bash
cd backend
alembic upgrade head
```

In production/containerized runs this already happens automatically —
`docker-entrypoint.sh` runs `alembic upgrade head` before starting uvicorn on
every container start. Locally, using `start-servers.bat` (see below) does
**not** run migrations for you — run `alembic upgrade head` manually first.

To check whether your local DB is behind:

```bash
alembic current   # what's applied
alembic heads      # what's latest in the codebase
```

If they differ, you're behind — run `alembic upgrade head`.

## Restarting the dev servers

The repo root has `start-servers.bat` (Windows-only, launches two separate
`cmd` windows):

```bat
start "Backend" cmd /k "cd /d backend && venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
start "Frontend" cmd /k "cd /d frontend && npm run dev"
```

To restart cleanly:

1. Close both spawned `cmd` windows (or `Ctrl+C` in each, then close), or
   kill the processes bound to ports 8000 (backend) and 3000 (frontend,
   Next.js default) if they're stuck.
2. Re-run `start-servers.bat` from the repo root.

If a port is stuck/in use after a crash, don't over-diagnose — kill
whatever's bound to the port and restart clean rather than debugging a stale
process:

```powershell
# find and kill whatever is holding a port on Windows
Get-NetTCPConnection -LocalPort 8000 | Select-Object OwningProcess
Stop-Process -Id <pid> -Force
```

In production, the app runs as a single container built from the repo's
Dockerfile and started via `docker-entrypoint.sh`, which runs migrations,
starts uvicorn on `127.0.0.1:8000` internally, and then execs the frontend
command — restarting means restarting the container (`docker restart` /
redeploy), not the two processes individually.

## Dependency updates

### Backend (`backend/requirements.txt`)

Pinned versions currently in use include `fastapi==0.115.0`,
`uvicorn[standard]==0.30.6`, `sqlalchemy==2.0.41`, `alembic==1.18.1`,
`pydantic==2.12.5`, among others — see the file for the full pinned list.
Note the inline comment on `numpy>=2.2.6` explaining it's left unpinned to a
patch version because no prebuilt wheel exists for the Python version in use
on this machine and there's no C compiler available to build from source —
be careful bumping numpy without checking wheel availability first.

Workflow:

```bash
cd backend
call venv\Scripts\activate.bat
pip install -r requirements.txt --upgrade   # or upgrade individual packages
pip freeze > requirements.txt                # re-pin after verifying
```

Component/dependency staleness (OWASP A06 — "Outdated Components") is
handled via `pip-audit` in CI per the comment in
`backend/app/middleware/owasp.py`, not by any runtime middleware check.
Confirm the current CI pipeline configuration for exactly when/how often
`pip-audit` runs.

### Frontend (`frontend/package.json`)

```bash
cd frontend
npm outdated
npm update            # minor/patch bumps
npm install <pkg>@latest   # for a deliberate major bump
```

`frontend/package.json` currently reports `"version": "0.1.0"` for the app
itself (the Next.js scaffold default, not bumped since project creation —
see `VERSION_HISTORY.md`) — that field is unrelated to dependency versions
and doesn't need to change as part of a dependency update.

### Teams app

`teams-app/manifest.json` has its own version field, separate from the web
app (bumped to `1.4.2` in commit `10fb435`). Bump it whenever the Teams app
package (`PremnathrailPortal-Ideal-Teams.zip`) changes, since the Teams app
store requires a version increment to accept a re-upload.

## Log rotation

**Not currently configured.** A repo-wide search for
`RotatingFileHandler` / `TimedRotatingFileHandler` (Python's standard log
rotation handlers) under `backend/app` found no matches. Logging currently
relies on uvicorn's own stdout/stderr output plus the structured security
events emitted by `backend/app/middleware/owasp.py` (see
`INCIDENT_RUNBOOK.md` for the `[A01]`–`[A09]` tag scheme) — none of it is
written to a rotated file today. If logs are being captured, it's happening
at the process/container/host level (e.g. Docker's own log driver), not
inside the application. If disk usage from logs becomes a problem, this is
the first thing to add.

## Database backups

Manual, ad hoc — see `backend/db_backups/` for existing examples
(`pre_purchase_migration_20260730_162406.sql`,
`pre_remove_pricing_20260730_164345.sql`), both taken by hand before a risky
migration, not on any schedule. There is no automated backup job in the
repo. Best practice going forward: take a manual `pg_dump` before any
migration that drops or renames columns/tables, named consistently
(`pre_<change>_<YYYYMMDD>_<HHMMSS>.sql`) to match the existing convention.

## Routine checks worth doing periodically

- `alembic current` vs `alembic heads` on the deployed database — catches
  drift early.
- `pip-audit` (backend) and `npm audit` (frontend) for known
  vulnerabilities.
- Skim `backend/app/middleware/owasp.py` logs for repeated `[A07] IP BANNED`
  entries — could indicate either an attack or a legitimate integration
  being rate-limited too aggressively.
