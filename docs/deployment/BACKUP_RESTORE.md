# Backup & Restore

There is **no automated backup job** in this repo (no cron, no scheduled
task, no APScheduler job for it — `backend/app/tasks/` only contains the
CRM follow-up reminder job). Backups today are manual `pg_dump` runs,
evidenced by the two files actually present in `backend/db_backups/`:

```
backend/db_backups/pre_purchase_migration_20260730_162406.sql   (1.37 MB)
backend/db_backups/pre_remove_pricing_20260730_164345.sql       (1.38 MB)
```

The naming pattern (`<reason>_<YYYYMMDD>_<HHMMSS>.sql`) shows the real
practice in use: **a manual pre-migration safety dump taken right before
a risky schema change**, not a periodic/scheduled backup. Both are plain
SQL dumps (not custom-format), consistent with a straightforward
`pg_dump ... > file.sql` invocation. This directory is not a substitute
for real periodic backups — treat it as evidence of good habit before
migrations, not as disaster-recovery coverage.

## Connection details

`DATABASE_URL` (`backend/app/core/config.py`) is the single source of
truth for how to reach the database — same value the app and Alembic
both use. Format:

```
postgresql+psycopg://<user>:<password>@<host>:<port>/<dbname>
```

`pg_dump`/`pg_restore`/`psql` don't understand the `+psycopg` SQLAlchemy
driver suffix — strip it (or pass `-U`/`-h`/`-d` flags directly) when
using the standard Postgres CLI tools:

```bash
# given DATABASE_URL=postgresql+psycopg://portal_user:secret@db-host:5432/premnathrail
pg_dump -U portal_user -h db-host -p 5432 premnathrail > backup.sql
```

## Manual backup (recommended pattern, matching the files already in the repo)

Follow the same naming convention already established in
`backend/db_backups/` — always before running a migration or any
destructive manual change:

```bash
cd backend
mkdir -p db_backups
pg_dump -U <user> -h <host> -d <dbname> \
  > "db_backups/pre_<reason>_$(date +%Y%m%d_%H%M%S).sql"
```

For a full production backup independent of any specific migration
(recommended addition — not currently automated anywhere):

```bash
pg_dump -U <user> -h <host> -d <dbname> --format=custom \
  -f "premnathrail_$(date +%Y%m%d_%H%M%S).dump"
```

(`--format=custom` enables selective/parallel restore via `pg_restore`
and is smaller than plain SQL; the two existing files in the repo used
plain-SQL `.sql` dumps instead, which is fine for a small pre-migration
snapshot but less ideal for a full production backup.)

## Restore

Plain-SQL dump (matches the existing `db_backups/*.sql` files):

```bash
psql -U <user> -h <host> -d <dbname> < backup.sql
```

Custom-format dump:

```bash
pg_restore -U <user> -h <host> -d <dbname> --clean --if-exists backup.dump
```

## Restoring into a fresh/empty database

```bash
createdb -U <user> -h <host> <dbname>
psql -U <user> -h <host> -d <dbname> < backup.sql
cd backend && alembic upgrade head   # apply any migrations newer than the dump
```

## What's not covered here (confirmed absent)

- No automated/scheduled backup job of any kind
- No offsite/cloud backup target configured (no S3 bucket, no managed-DB
  snapshot policy referenced in this repo)
- No backup retention policy or rotation script — the two files in
  `backend/db_backups/` are just left there indefinitely
- No restore-testing procedure (i.e. no evidence backups are ever test-restored)

If disaster recovery matters for this deployment, the biggest gap to
close is turning the manual pre-migration habit into a real scheduled
job (e.g. a daily `pg_dump` via cron or the hosting platform's managed
backup feature) with offsite storage and periodic restore testing.

---

**See also:** [../runbook/RUNBOOK.md](../runbook/RUNBOOK.md#disaster-recovery)
for when to reach for this doc during an incident.
