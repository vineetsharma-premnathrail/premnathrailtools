# ERP-PremnathRail — Backup & Restore

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Deployment
**Document:** Backup & Restore
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the current database backup and restore procedures for ERP-PremnathRail.

It records:

* Current backup practice
* Database connection requirements
* Manual backup procedure
* Production backup procedure
* Restore procedure
* Fresh-database restoration
* Current backup limitations

---

# 2. Current Backup State

ERP-PremnathRail currently has **no automated database backup job**.

There is currently:

* No cron-based backup
* No scheduled backup task
* No APScheduler backup job
* No automated cloud backup target
* No backup rotation mechanism
* No documented restore-testing process

The existing backup practice is manual.

Backup files are stored under:

```text
backend/db_backups/
```

Existing examples include:

```text
pre_purchase_migration_20260730_162406.sql
pre_remove_pricing_20260730_164345.sql
```

The naming pattern is:

```text
<reason>_<YYYYMMDD>_<HHMMSS>.sql
```

These backups represent pre-migration safety snapshots rather than a complete disaster-recovery system.

---

# 3. Database Connection

The application's database connection is controlled by:

```text
DATABASE_URL
```

The configured format is:

```text
postgresql+psycopg://<user>:<password>@<host>:<port>/<dbname>
```

The same database configuration is used by the application and Alembic.

---

# 4. PostgreSQL Command-Line Tools

`pg_dump`, `pg_restore`, and `psql` do not use the SQLAlchemy driver suffix:

```text
+psycopg
```

Therefore, when using PostgreSQL command-line tools, use the database components directly.

Example:

```text
DATABASE_URL=
postgresql+psycopg://portal_user:secret@db-host:5432/premnathrail_portal
```

Corresponding backup command:

```bash
pg_dump \
  -U portal_user \
  -h db-host \
  -p 5432 \
  premnathrail_portal \
  > backup.sql
```

---

# 5. Manual Pre-Migration Backup

A database backup should be taken before:

* Database migrations
* Destructive schema changes
* Large data modifications
* Risky database operations

Create the backup directory:

```bash
cd backend
mkdir -p db_backups
```

Create a timestamped backup:

```bash
pg_dump \
  -U <user> \
  -h <host> \
  -d <dbname> \
  > "db_backups/pre_<reason>_$(date +%Y%m%d_%H%M%S).sql"
```

Example:

```text
pre_purchase_migration_20260730_162406.sql
```

---

# 6. Full Production Backup

For a complete production backup, a custom-format PostgreSQL dump is recommended:

```bash
pg_dump \
  -U <user> \
  -h <host> \
  -d <dbname> \
  --format=custom \
  -f "premnathrail_portal_$(date +%Y%m%d_%H%M%S).dump"
```

Custom-format backups can be restored using `pg_restore`.

They also support selective and parallel restoration.

The existing repository backups are plain `.sql` files.

---

# 7. Backup Formats

| Format    | Extension | Restore Tool | Current Use                             |
| --------- | --------- | ------------ | --------------------------------------- |
| Plain SQL | `.sql`    | `psql`       | Existing pre-migration backups          |
| Custom    | `.dump`   | `pg_restore` | Recommended for full production backups |

---

# 8. Plain SQL Restore

For an existing `.sql` backup:

```bash
psql \
  -U <user> \
  -h <host> \
  -d <dbname> \
  < backup.sql
```

This restores the SQL statements contained in the backup.

---

# 9. Custom Backup Restore

For a custom-format backup:

```bash
pg_restore \
  -U <user> \
  -h <host> \
  -d <dbname> \
  --clean \
  --if-exists \
  backup.dump
```

---

# 10. Restore to a Fresh Database

Create the database:

```bash
createdb \
  -U <user> \
  -h <host> \
  <dbname>
```

Restore the SQL backup:

```bash
psql \
  -U <user> \
  -h <host> \
  -d <dbname> \
  < backup.sql
```

If the backup predates later application migrations, apply the required migrations:

```bash
cd backend
alembic upgrade head
```

---

# 11. Backup Before Database Migration

The recommended migration sequence is:

```text
Database Backup
      ↓
Review Migration
      ↓
Apply Migration
      ↓
Run Tests
      ↓
Verify Application
```

For risky migrations, the backup should be created immediately before the migration.

---

# 12. Current Backup Storage

The current repository contains:

```text
backend/db_backups/
```

The existing backups demonstrate manual pre-migration backup practice.

This directory should not be considered sufficient disaster-recovery storage.

---

# 13. Current Limitations

The current implementation does not provide:

### Automated Backups

No scheduled database backup job currently exists.

### Offsite Backup

No configured:

* S3 backup target
* Cloud backup repository
* Managed database snapshot policy

is documented in the current repository.

### Retention Policy

There is currently no automated backup rotation or retention policy.

### Restore Testing

There is currently no documented or automated periodic restore test.

---

# 14. Disaster Recovery Status

Current state:

```text
Manual Backup
     ✓

Pre-Migration Backup
     ✓

Automated Daily Backup
     ✗

Offsite Backup
     ✗

Backup Retention Policy
     ✗

Automated Restore Testing
     ✗
```

Therefore, the current backup implementation should be considered **development / migration-safety coverage**, not complete disaster-recovery coverage.

---

# 15. Future Backup Architecture

If production disaster recovery requirements increase, the backup architecture can evolve toward:

```text
PostgreSQL
    │
    ▼
Scheduled Backup
    │
    ▼
Encrypted Backup Storage
    │
    ├── Local Backup
    │
    └── Offsite Backup
          │
          ▼
     Retention Policy
          │
          ▼
    Periodic Restore Test
```

The implementation of automated backup, offsite storage, retention, and restore testing requires a future approved deployment decision.

---

# 16. Backup Naming Convention

The existing manual convention is:

```text
<reason>_<YYYYMMDD>_<HHMMSS>.sql
```

Example:

```text
pre_purchase_migration_20260730_162406.sql
```

For custom production backups:

```text
premnathrail_portal_<YYYYMMDD>_<HHMMSS>.dump
```

---

# 17. Backup Verification

Before relying on a backup for recovery, the backup should be verified through an appropriate restore process.

The current repository does not contain an established automated backup-validation or restore-testing workflow.

---

# 18. Backup Security

Database backups may contain sensitive organizational information.

Backup files should therefore be protected against unauthorized access.

They should not be:

* Publicly accessible
* Exposed through the web application
* Committed to public source repositories
* Shared without authorization

Production backup storage should use appropriate access controls.

---

# 19. Restore Decision

A restore should be performed only when authorized and after identifying:

```text
1. Backup to restore
2. Target database
3. Restoration point
4. Required application version
5. Required migrations
```

For production systems, restoration should be treated as a controlled operational activity.

---

# 20. Database and Application Compatibility

A database backup corresponds to the application/database state at the time it was created.

Therefore, after restoring an older backup, verify:

```text
Database Schema
       ↕
Application Version
       ↕
Alembic Migration State
```

Any migrations created after the backup may need to be applied.

---

# 21. Operational Procedure

### Before a risky database change

```text
1. Identify database.
2. Create backup.
3. Verify backup file exists.
4. Record backup filename.
5. Perform database change.
6. Test application.
7. Keep backup according to applicable retention requirements.
```

### If rollback is required

```text
1. Stop or restrict affected operations.
2. Identify the correct backup.
3. Restore the database.
4. Apply required compatible migrations.
5. Verify application.
6. Confirm data integrity.
7. Resume operations.
```

---

# 22. Change Management

Update this document when:

* Automated backups are introduced.
* Backup storage changes.
* A cloud backup service is introduced.
* Retention policies are established.
* Restore procedures change.
* Restore testing is introduced.
* Database architecture changes.
* Disaster-recovery requirements change.

---

# 23. Historical Versions

Previous approved versions should be retained.

Example:

```text
v1.0 — Initial backup and restore procedure
v1.1 — Backup storage update
v1.2 — Automated backup introduced
v2.0 — Disaster recovery architecture update
```

The latest approved version represents the current operational procedure.

---

# 24. Related Documents

* Deployment
* Server Configuration
* Database Schema
* Database Migrations
* Configuration
* Environment Variables
* Security Documentation
* Disaster Recovery Plan
* Operations Runbook

---

# 25. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 26. Document Information

**Document:** Backup & Restore
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Deployment
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
