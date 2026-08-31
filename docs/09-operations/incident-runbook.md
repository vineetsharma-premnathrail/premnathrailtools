# ERP-PremnathRail — Incident Runbook

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Operations
**Document:** Incident Runbook
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Initial Runbook

---

# 1. Purpose

This document defines the standard response process for operational incidents affecting ERP-PremnathRail.

It covers:

* Incident classification
* Initial investigation
* Application and database checks
* Deployment rollback
* Migration rollback
* Backup restoration
* Post-incident recording

Major infrastructure or data-loss scenarios are handled by the Disaster Recovery Plan.

---

# 2. Incident Severity

| Severity | Definition                                                         | Example                                       | Initial Owner               |
| -------- | ------------------------------------------------------------------ | --------------------------------------------- | --------------------------- |
| SEV1     | Full outage, serious security issue, or significant data-loss risk | Application unavailable or database failure   | Vineet Sharma               |
| SEV2     | Major business functionality unavailable                           | Purchase submission unavailable for all users | Vineet Sharma               |
| SEV3     | Partial degradation or limited user impact                         | One module or workflow affected               | Vineet Sharma               |
| SEV4     | Minor/non-blocking issue                                           | Cosmetic UI issue or wording problem          | Normal development workflow |

Formal response-time targets and escalation contacts are currently **TBD**.

---

# 3. First Response

## 3.1 Confirm the Failure

Determine whether the issue affects:

* One user
* Multiple users
* One module
* The entire application
* Frontend
* Backend
* Database
* External integration

For production deployments, the frontend and backend run inside the same Docker container.

The backend runs internally on `127.0.0.1:8000`, while the frontend serves traffic on port `3000`.

---

# 4. Check Application Health

Check the application health endpoint:

```text
/health
```

Expected response should identify:

* Application status
* Application name
* Application version
* Environment

````

If the application is unavailable, inspect the container and application logs.

---

# 5. Check Application Logs

Review:

- Next.js logs
- Uvicorn logs
- Application exceptions
- Database errors
- Authentication errors
- Microsoft Graph/SharePoint errors
- OWASP middleware logs

OWASP middleware events use structured categories:

| Category | Area |
|---|---|
| A01 | Access control |
| A02 | Cryptographic failures |
| A03 | Injection |
| A04 | Insecure design |
| A05 | Security configuration |
| A06 | Vulnerable/outdated components |
| A07 | Authentication/session |
| A08 | Data integrity |
| A09 | Logging/monitoring |
| A10 | SSRF |

For suspected IP blocking, specifically inspect A07 events and the IP-ban logs.

---

# 6. Check Database

Verify:

```bash
cd backend
alembic current
alembic heads
````

Confirm that the current database revision matches the expected migration head.

Also verify:

* PostgreSQL is reachable.
* Database credentials are valid.
* Application can connect.
* Required tables exist.
* Recent database operations are functioning.

---

# 7. Check Recent Changes

Because the project does not currently use formal semantic release versions, inspect recent commits:

```bash
git log --oneline -20
```

Identify:

* Recently merged code
* Database migrations
* Configuration changes
* Authentication changes
* Infrastructure changes

Compare the recent changes with the time the incident started.

---

# 8. Deployment Rollback

Code and database schema must be considered separately during rollback.

Do not run older application code against a newer incompatible schema.

## 8.1 Code Rollback

Prefer a safe Git revert:

```bash
git revert <bad-commit-hash>
```

Then rebuild and redeploy the application.

For controlled local/deployment recovery, a known-good commit may also be checked out as appropriate.

---

# 9. Database Migration Rollback

Before downgrading a production database, create a fresh backup.

Rollback one migration:

```bash
cd backend
alembic downgrade -1
```

Rollback to a specific revision:

```bash
alembic downgrade <revision_id>
```

After rollback:

```bash
alembic current
alembic heads
```

Confirm that the database is at the intended revision.

---

# 10. Backup Restoration

Existing repository backups are stored under:

```text
backend/db_backups/
```

The documented backups are plain SQL dumps.

Example restoration:

```bash
psql -U <user> -d <database> < backend/db_backups/<backup_file>.sql
```

There is currently no confirmed automated backup schedule in the repository.

For complete database recovery, follow the Backup & Restore and Disaster Recovery Plan.

---

# 11. Docker Recovery

The production application uses a single Docker image containing:

* FastAPI backend
* Next.js frontend

The entrypoint:

1. Applies Alembic migrations.
2. Starts the backend.
3. Starts the Next.js frontend.
4. Stops the container if the backend process fails.

After a deployment problem, inspect:

```bash
docker ps
docker logs <container>
```

If required, rebuild and redeploy the known-good application version.

---

# 12. Authentication Incident

If users cannot log in:

1. Check Azure authentication configuration.
2. Verify Azure Client ID.
3. Verify Tenant ID.
4. Verify Client Secret.
5. Verify Redirect URI.
6. Verify application environment variables.
7. Check authentication logs.
8. Test `/auth/me` after successful authentication.

Do not change Azure configuration unnecessarily if the production domain and redirect URI have not changed.

---

# 13. Permission / Access Incident

If a user cannot access an expected module:

1. Confirm the user is active.
2. Confirm the user has the required module access.
3. Confirm the relevant role/permission.
4. Verify the backend authorization check.
5. Verify the frontend navigation reflects the same access.
6. Test the actual API endpoint.

Hiding a UI element is not sufficient security validation; backend authorization must also reject unauthorized access.

---

# 14. SharePoint / File Incident

If document upload or retrieval fails:

1. Check SharePoint configuration.
2. Check `SHAREPOINT_SITE_ID`.
3. Check `SHAREPOINT_FOLDER`.
4. Verify Microsoft Graph credentials and permissions.
5. Check application logs.
6. Test upload and retrieval with an authorized user.

---

# 15. Email Notification Incident

If notifications fail:

1. Verify `SENDER_EMAIL`.
2. Verify the relevant recipient setting.
3. Verify Microsoft Graph authentication.
4. Check application logs.
5. Test the affected notification workflow.

Notification failures should not automatically be treated as database failures.

---

# 16. Incident Escalation

| Situation                 | Action                                          |
| ------------------------- | ----------------------------------------------- |
| Single-user issue         | Investigate normally                            |
| Module-wide issue         | Treat as SEV2/SEV3 depending on business impact |
| Full application outage   | SEV1                                            |
| Database corruption/loss  | SEV1 and activate Disaster Recovery Plan        |
| Suspected security breach | SEV1 and initiate security incident response    |
| Data-loss risk            | SEV1 and stop destructive operations            |

Final major recovery decisions belong to **Madhav Arora Sir**.

Technical investigation and recovery execution are owned by **Vineet Sharma**.

---

# 17. Post-Incident Validation

After resolving an incident:

* [ ] Application is accessible.
* [ ] `/health` works.
* [ ] Database connectivity works.
* [ ] `alembic current` matches the intended revision.
* [ ] Authentication works.
* [ ] Authorization works.
* [ ] Affected module workflow works.
* [ ] Relevant integrations work.
* [ ] No legitimate user remains incorrectly blocked.
* [ ] Logs show no continuing critical errors.

---

# 18. Incident Record

Every significant incident should produce a separate historical record.

```text
Incident ID:
Date:
Severity:
Start Time:
Detection Time:
Resolution Time:

Affected System:
Affected Module:
Affected Users:

Symptoms:

Root Cause:

Recent Change:

Actions Taken:

Rollback Performed:
Database Restore Performed:

Data Loss:
Security Impact:

Resolution:

Validation:

Final Approval:

Lessons Learned:

Follow-up Actions:
```

Incident records should be retained as historical records rather than overwritten.

---

# 19. Post-Incident Review

For SEV1 and significant SEV2 incidents, record:

* Root cause
* Impact
* Detection method
* Recovery actions
* Recovery duration
* Data impact
* Security impact
* Preventive actions

Corrective actions should be tracked separately where necessary.

---

# 20. Current Operational Gaps

| Gap                                | Status                    |
| ---------------------------------- | ------------------------- |
| Formal on-call contact list        | TBD                       |
| Incident response time targets     | TBD                       |
| Automated alerting                 | Limited / TBD             |
| Automated CI/CD                    | Not currently configured  |
| Automated database backups         | Not currently configured  |
| Formal incident-history repository | Not currently established |
| RTO/RPO                            | TBD                       |

---

# 21. Related Documents

* Runbook
* Disaster Recovery Plan
* Backup & Restore
* Deployment
* Docker
* Server Configuration
* Monitoring & Alerting
* Maintenance Procedures
* Bug Tracking
* Test Plan
* UAT

---

# 22. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 23. Document Information

**Document:** Incident Runbook
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Operations
**Version:** 1.0
**Status:** Initial Runbook
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
