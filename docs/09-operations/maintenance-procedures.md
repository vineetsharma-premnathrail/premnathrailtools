# ERP-PremnathRail — Maintenance Procedures

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Operations
**Document:** Maintenance Procedures
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Initial Document

---

# 1. Purpose

This document defines routine maintenance procedures for ERP-PremnathRail.

It covers:

* Database migration maintenance
* Development-server restart
* Dependency updates
* Teams application versioning
* Database backups
* Periodic technical checks
* Log management

Incident-specific procedures are covered by the **Incident Runbook**. Major-failure recovery is covered by the **Disaster Recovery Plan**.

---

# 2. Database Migration Maintenance

Whenever backend changes include files under:

```text
backend/alembic/versions/
```

apply the migrations before starting the backend:

```bash
cd backend
alembic upgrade head
```

Check migration status:

```bash
alembic current
alembic heads
```

If the revisions differ, determine whether the database requires migration before continuing.

## Production

Container startup automatically executes:

```bash
alembic upgrade head
```

before starting the backend.

## Local Development

The Windows `start-servers.bat` script does not apply migrations automatically.

Run:

```bash
cd backend
alembic upgrade head
```

before starting the application when migrations have changed.

---

# 3. Development Server Restart

The repository provides:

```text
start-servers.bat
```

It starts:

* Backend — port `8000`
* Frontend — port `3000`

## Restart Procedure

1. Stop the backend and frontend processes.
2. If a process remains stuck, identify the process using the port.
3. Terminate the process.
4. Run `start-servers.bat` again.

Example on Windows:

```powershell
Get-NetTCPConnection -LocalPort 8000 | Select-Object OwningProcess
Stop-Process -Id <pid> -Force
```

For port `3000`, use the same procedure with:

```powershell
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
```

## Production

Production runs the application as a Docker container.

Restart the container or perform a redeployment rather than restarting frontend and backend processes individually.

---

# 4. Dependency Maintenance

## 4.1 Backend

Backend dependencies are managed through:

```text
backend/requirements.txt
```

Update dependencies:

```bash
cd backend
call venv\Scripts\activate.bat
pip install -r requirements.txt --upgrade
```

After verifying compatibility:

```bash
pip freeze > requirements.txt
```

Dependency updates should be tested before being considered complete.

### NumPy

`numpy` requires particular attention because its installation depends on compatible prebuilt wheels and the Python/build environment.

Do not upgrade it blindly without confirming installation compatibility.

### Security Audit

Run:

```bash
pip-audit -r requirements.txt
```

Security dependency scanning should be treated according to the project's current CI configuration. At present, automated CI/CD is not established.

---

# 5. Frontend Dependency Maintenance

Frontend dependencies are defined in:

```text
frontend/package.json
```

Check outdated packages:

```bash
cd frontend
npm outdated
```

Update compatible minor/patch versions:

```bash
npm update
```

For an intentional major-version upgrade:

```bash
npm install <package>@latest
```

After dependency changes, verify:

```bash
npm run lint
npm run build
```

---

# 6. Microsoft Teams Application Maintenance

The Teams application maintains its own version in:

```text
teams-app/manifest.json
```

The Teams package version is independent of the web application's package version.

Whenever the Teams application package is modified:

1. Update the manifest version.
2. Validate the Teams package.
3. Rebuild/package the application.
4. Deploy the updated Teams package.

A version increment is required when submitting a new Teams application package version.

---

# 7. Database Backup Maintenance

Current database backups are manual.

Before a risky schema operation, create a PostgreSQL backup:

```bash
pg_dump -U <user> -h <host> -d <database> \
  > "db_backups/pre_<change>_$(date +%Y%m%d_%H%M%S).sql"
```

Store migration-related backups under:

```text
backend/db_backups/
```

Recommended naming pattern:

```text
pre_<change>_<YYYYMMDD>_<HHMMSS>.sql
```

Examples:

```text
pre_purchase_migration_20260730_162406.sql
pre_remove_pricing_20260730_164345.sql
```

Current repository evidence does **not** establish automated periodic backups.

---

# 8. Log Management

Application-level log rotation is not currently configured.

The application primarily produces:

* Uvicorn output
* Standard application logs
* Structured OWASP security logs

No application-level `RotatingFileHandler` or `TimedRotatingFileHandler` is currently configured.

If production logs are persisted, their rotation is therefore handled outside the application, such as by the container, host, or deployment platform.

Log storage and retention should be reviewed if production disk usage becomes a concern.

---

# 9. Periodic Technical Checks

The following checks should be performed periodically:

### Database

```bash
alembic current
alembic heads
```

Confirm the deployed schema is at the expected migration revision.

### Backend Dependencies

```bash
pip-audit -r requirements.txt
```

Review known dependency vulnerabilities.

### Frontend Dependencies

```bash
npm audit
```

Review known frontend dependency vulnerabilities.

### Security Logs

Review OWASP middleware events, especially repeated:

```text
[A07]
```

IP-ban/authentication events.

Repeated legitimate-user bans may indicate an overly aggressive rate-limit configuration.

---

# 10. Maintenance After Code Changes

For changes affecting the backend:

```text
Pull Changes
     ↓
Check Alembic Changes
     ↓
Apply Migrations
     ↓
Update Dependencies if Required
     ↓
Run Tests
     ↓
Start Application
     ↓
Verify Health
     ↓
Verify Changed Functionality
```

For frontend changes:

```text
Pull Changes
     ↓
Install Dependencies if Required
     ↓
Lint
     ↓
Build
     ↓
Run Application
     ↓
Verify Changed Functionality
```

---

# 11. Maintenance Before Production Deployment

Before a production deployment, verify:

* [ ] Required code changes are identified.
* [ ] Database migrations have been reviewed.
* [ ] Backup requirement has been assessed.
* [ ] Dependencies are compatible.
* [ ] Backend tests pass.
* [ ] Frontend lint/build passes.
* [ ] Environment configuration is correct.
* [ ] Azure authentication configuration is correct.
* [ ] SharePoint configuration is correct where applicable.
* [ ] Microsoft Graph/email configuration is correct where applicable.
* [ ] Teams configuration is updated where applicable.
* [ ] Deployment rollback approach is known.

---

# 12. Maintenance Records

Significant maintenance activities should be traceable through the project's existing records.

For significant changes, record:

```text
Date:
Performed By:
Maintenance Type:
Affected Component:
Reason:
Changes Made:
Migration:
Backup:
Tests:
Result:
Issues:
Follow-up:
```

Historical maintenance records should be retained rather than overwritten.

---

# 13. Maintenance Ownership

| Area                               | Primary Owner    |
| ---------------------------------- | ---------------- |
| Application maintenance            | Vineet Sharma    |
| Backend                            | Vineet Sharma    |
| Frontend                           | Vineet Sharma    |
| Database migrations                | Vineet Sharma    |
| Application security configuration | Vineet Sharma    |
| Production approval                | Madhav Arora Sir |
| Major operational decisions        | Madhav Arora Sir |

---

# 14. Current Maintenance Gaps

| Area                        | Current State   |
| --------------------------- | --------------- |
| Automated database backups  | Not configured  |
| Backup retention policy     | Not defined     |
| Automated restore testing   | Not configured  |
| Application log rotation    | Not configured  |
| CI/CD                       | Not configured  |
| Formal maintenance schedule | Not defined     |
| Formal maintenance log      | Not established |
| RTO/RPO                     | Not defined     |

These are documented gaps, not assumed capabilities.

---

# 15. Document Maintenance

Update this document when:

* Deployment architecture changes.
* Database migration procedures change.
* Dependency-management procedures change.
* Teams packaging changes.
* Backup procedures change.
* Logging infrastructure changes.
* Maintenance ownership changes.

Previous versions should be retained as historical records.

---

# 16. Related Documents

* Runbook
* Incident Runbook
* Disaster Recovery Plan
* Backup & Restore
* Deployment
* Docker
* Server Configuration
* Changelog
* Test Plan
* UAT

---

# 17. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 18. Document Information

**Document:** Maintenance Procedures
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Operations
**Version:** 1.0
**Status:** Initial Document
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
