# Incident Runbook

This document is the maintenance-side companion to the primary operational
runbook: **[`../runbook/RUNBOOK.md`](../runbook/RUNBOOK.md)**. That file is
the authoritative source for day-to-day monitoring, logging conventions, and
standard operating procedure — it is being actively maintained separately,
so this document does not duplicate it. This document focuses on the
incident-response workflow specifically: who to contact, what to check
first, and how to roll back.

## Severity levels (template — fill in real thresholds/contacts)

| Severity | Definition | Example | Notify |
|---|---|---|---|
| SEV1 | Full outage / data loss risk | Backend down, DB unreachable, migration failed mid-deploy | `<placeholder: on-call phone/Teams channel>` |
| SEV2 | Major feature broken, no data loss | Purchase Requisition submission failing for all users | `<placeholder>` |
| SEV3 | Degraded / partial | One module slow, one user's account issue | `<placeholder>` |
| SEV4 | Cosmetic / non-blocking | UI glitch, minor wording | Log it, fix in normal course |

> The specific people/channels to notify are not yet defined anywhere in the
> repo — this table uses placeholders intentionally. Fill them in with real
> names/Teams channels/phone numbers before relying on this document during
> an actual incident.

## First response checklist

1. **Confirm the app is actually down**, not just your machine. Check
   whether the FastAPI backend (`uvicorn`) process and the Next.js frontend
   are both running. In production this is the single container built from
   the repo's Dockerfile, started via `docker-entrypoint.sh`; if the
   container restarted, check `docker-entrypoint.sh`'s behavior — it runs
   `alembic upgrade head` before starting uvicorn, and it deliberately kills
   the whole container if the backend process dies (`trap ... EXIT`), so a
   backend crash takes the frontend down with it by design.
2. **Check logs.** Application logs come from uvicorn's own output plus the
   OWASP security middleware's structured logging in
   `backend/app/middleware/owasp.py`. That middleware tags every security
   event with the relevant OWASP Top-10 category so `grep` on the tag
   narrows things down fast:
   - `[A01]` — access control / path-scanning detection
   - `[A02]` — cryptographic failures (HSTS)
   - `[A03]` — injection attempts (SQLi/XSS/path traversal/template/command)
   - `[A04]` — insecure design guardrails (body size limits, disallowed HTTP
     methods, slow-request alerts)
   - `[A05]` — security misconfiguration (headers/CSP/cache-control)
   - `[A06]` — outdated components (this one is enforced via `pip-audit` in
     CI, not at runtime — nothing to grep for in logs)
   - `[A07]` — auth/session failures (rate limiting, temporary IP bans —
     look for `logger.critical("[A07] IP BANNED | ip=%s", ip)` specifically
     if you suspect a client got auto-banned)
   - `[A08]` — data integrity (Content-Type allowlist rejections)
   - `[A09]` — logging/monitoring itself (request-ID tracing, slow request
     alerts)

   If a legitimate user or integration is being blocked, `[A07]` IP-ban logs
   are the most common cause — see `owasp.py` for the ban threshold/duration
   constants and either wait it out or restart the process to clear the
   in-memory ban store (the rate/ban store is in-memory, not persisted —
   confirm current implementation in `backend/app/middleware/rate_store.py`
   before assuming a restart clears it).
3. **Check the database.** Confirm Postgres is reachable and
   `alembic current` matches `alembic heads` (i.e., migrations are fully
   applied, not stuck mid-way). See `UPGRADE_MIGRATION_GUIDE.md` for the
   migration workflow.
4. **Check recent deploys.** Since this repo has no formal release
   versioning (see `VERSION_HISTORY.md`), "what changed" means
   `git log --oneline -20` and comparing against what's actually deployed.

## Rollback procedure

Code and schema are rolled back separately — always roll back schema
*before* or *together with* code, never leave a newer schema under older
code that doesn't expect it.

### Code rollback

```bash
# Roll back to a known-good commit (creates a new commit, safe for shared branches)
git revert <bad-commit-hash>

# Or, if you control the deploy and can force the working tree:
git checkout <known-good-hash> -- .
```

Then rebuild/restart the container or dev servers (see
`MAINTENANCE_PROCEDURES.md` for the restart procedure).

### Database rollback

```bash
cd backend
alembic downgrade -1        # roll back exactly one migration
# or
alembic downgrade <revision_id>   # roll back to a specific known-good revision
```

Alembic migrations in this repo are written defensively (see
`UPGRADE_MIGRATION_GUIDE.md` for the exact pattern), but `downgrade()` still
drops columns/tables — **take a fresh backup before downgrading**, not just
before upgrading.

### Restoring from a backup

Backups observed in the repo live under `backend/db_backups/` (plain `.sql`
dumps, e.g. `pre_purchase_migration_20260730_162406.sql`,
`pre_remove_pricing_20260730_164345.sql` — timestamped, taken manually before
risky migrations, not on an automatic schedule). To restore:

```bash
psql -U <user> -d <database> < backend/db_backups/<backup_file>.sql
```

There is no automated backup job evident anywhere in the repo (no cron, no
scheduled task, no APScheduler job for backups) — backups are currently a
manual, ad hoc practice tied to specific risky migrations, not a routine
safety net. If regular automated backups are needed, that has to be set up
separately (e.g., a scheduled `pg_dump` outside this codebase).

## Post-incident

- Confirm `alembic current` matches `alembic heads` again.
- Confirm the OWASP middleware isn't still banning a legitimate IP.
- Write up what happened, when, and the fix — there is no dedicated
  incident log directory in the repo today, so add one under
  `docs/maintenance/` (e.g. a dated file) if you want a durable record, or
  fold it into this file's history via git.
