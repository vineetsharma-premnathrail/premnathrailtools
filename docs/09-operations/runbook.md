# Runbook — Operations & Troubleshooting

**Module:** Cross-cutting (Operations)
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This runbook is the primary operational reference for the Premnathrail Portal: how to start the application locally, verify that it is healthy, diagnose common problems, and perform routine restarts and maintenance. It is based on the actual behavior of the codebase and should be updated as the application evolves.

---

# 2. Quick Start

```bash
# Terminal 1: Start backend
cd backend

python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload

# Terminal 2: Run tests
cd backend
pytest app/tests -v
```

The backend runs at:

```text
http://localhost:8000
```

Interactive API documentation:

```text
http://localhost:8000/docs
```

---

# 3. Common Tasks

## 3.1 Verify the Server Is Running

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{
  "status": "ok",
  "app": "Premnathrail Portal"
}
```

## 3.2 Test Authentication Manually

1. Open `http://localhost:8000/docs`.
2. Locate `/auth/microsoft-login`.
3. Select **Try it out**.
4. Select **Execute**.
5. Confirm that the request redirects to Microsoft login.

## 3.3 Reset the Database

**WARNING: This deletes all data.**

```bash
python -c "
from app.db.base import Base
from app.db.session import engine

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

print('Database reset')
"
```

## 3.4 Create a Test User Manually

```python
from app.db.session import SessionLocal
from app.modules.main.models.user import User
from app.auth.jwt_handler import create_access_token

db = SessionLocal()

user = User(
    email="test@example.com",
    name="Test User",
    role="user",
    is_active=True
)

db.add(user)
db.commit()
db.refresh(user)

token = create_access_token({
    "sub": str(user.id),
    "role": "user"
})

print(f"User created: {user.id}")
print(f"Token: {token}")
```

---

# 4. Troubleshooting

## 4.1 Address Already in Use — Port 8000

```bash
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

Alternatively:

```bash
uvicorn app.main:app --port 8001 --reload
```

For this repository, a stuck port should generally be cleared by terminating the process using it and restarting cleanly.

## 4.2 `ModuleNotFoundError: No module named 'app'`

```bash
cd backend
python -m uvicorn app.main:app --reload
```

## 4.3 PostgreSQL Connection Failure

```bash
psql --version
psql -U postgres -h localhost
```

If the connection fails, verify:

* PostgreSQL is running.
* `DATABASE_URL` is correct.
* The database username is correct.
* The database password is correct.

## 4.4 `ModuleNotFoundError: No module named 'msal'`

```bash
pip install -r requirements.txt
```

Or:

```bash
pip install msal python-jose httpx
```

## 4.5 Tests Fail With `ImportError`

```bash
cd backend
pytest app/tests -v
```

If necessary:

```bash
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
```

## 4.6 Microsoft OAuth Not Working

Verify the following environment variables:

```env
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
AZURE_TENANT_ID=...
AZURE_REDIRECT_URI=http://localhost:8000/auth/callback
```

Then verify in Azure App Registration:

* Application ID matches `AZURE_CLIENT_ID`.
* Tenant ID matches `AZURE_TENANT_ID`.
* Redirect URI matches the configured application value.
* Client secret is valid and has not expired.

## 4.7 `Invalid or expired state parameter`

OAuth state tokens expire after 10 minutes.

Retry the login flow and verify that the server system time is synchronized.

## 4.8 No Access Token Returned From Azure AD

Verify:

* `AZURE_CLIENT_SECRET` is not blank.
* Microsoft Graph `User.Read` permission is granted.
* Tenant ID matches the Azure tenant configuration.

## 4.9 ERP Requests Return 403 for `erp_permissions`

ERP uses granular permissions for non-admin users.

Valid permissions:

```text
project_view
project_create
project_edit
project_delete
sr_view
sr_create
sr_edit
sr_delete
```

Check the user's permissions through the admin user API.

The permissions are enforced server-side, not merely hidden in the frontend.

`project_create`, `project_edit`, and `project_delete` control project creation, editing, and deletion.

`sr_create`, `sr_edit`, and `sr_delete` control Service Request operations. Service Request editing and deletion also require the original creator or an administrator.

Administrators bypass the ERP granular permission checks.

If an administrator receives a 403 unexpectedly, a stale session role claim may be the cause; re-login.

## 4.10 CRM Activity Follow-up Reminder Not Received

The reminder is a daily scheduled job, not an immediate notification. It runs at **8:00 AM IST**.

Only activities satisfying these conditions are processed:

* Status is `Open`.
* `next_followup` is today or tomorrow.

`assigned_to` is matched against `User.name` case-insensitively. If no matching user exists, the activity creator receives the notification.

The scheduler only runs while the application process is running. A restart after 8:00 AM does not retroactively execute that day's job.

The job also deduplicates notifications by user, activity, notification type, and day.

## 4.11 Model Column Exists but Queries Fail

Adding a SQLAlchemy model column does not modify an existing database table.

A typical symptom is:

```text
sqlalchemy.exc.OperationalError
```

or:

```text
sqlalchemy.exc.ProgrammingError
```

with a message indicating that a column does not exist.

For disposable local data, recreate the database.

For retained data, create an Alembic migration:

```bash
cd backend

alembic revision -m "describe the change"
alembic upgrade head
```

New columns require explicit migration operations such as `op.add_column(...)`.

After adding a migration, verify every route, Pydantic schema, and raw SQL operation that reads or writes the affected field.

## 4.12 Legitimate Request Returns `400 Bad request.`

This can originate from the OWASP injection/SSRF scanning middleware rather than the endpoint itself.

Check server logs for:

```text
[A03]
[A10]
```

Common causes include:

* SQL-like search terms such as `select`, `union`, or `delete`.
* URLs containing private or loopback IP addresses.
* Intentional local testing against `localhost` or `127.0.0.1`.

## 4.13 IP Receives `429 Too many violations`

The IP may have crossed the rate-limit ban threshold.

Current configuration:

```text
BAN_THRESHOLD = 10 violations
BAN_DURATION_SECONDS = 600
```

The ban lasts 600 seconds.

In local development, the in-memory rate store can be reset using:

```python
get_rate_store().reset()
```

## 4.14 Teams SSO Token Errors

For Teams SSO, verify:

* Token audience ends with `/{AZURE_CLIENT_ID}`.
* Token issuer begins with:

  * `https://login.microsoftonline.com/`
  * `https://sts.windows.net/`

A mismatch commonly indicates that the Teams manifest's `webApplicationInfo.id` does not match `AZURE_CLIENT_ID`, or that the supplied token is not the expected Teams SSO token.

## 4.15 Teams SSO Works but Graph Features Fail

Check logs around:

```text
acquire_token_on_behalf_of
```

Common causes include:

* Missing `access_as_user` exposed API scope.
* Teams desktop/web client IDs not pre-authorized.

Portal authentication can still succeed even when the Graph access-token exchange fails.

---

# 5. Performance Checks

## 5.1 Database Query Performance

```bash
export SQLALCHEMY_ECHO=True
uvicorn app.main:app --reload
```

Review generated SQL for:

* N+1 query patterns.
* Queries executed inside loops.
* Missing indexes.
* Unexpected query volume.

## 5.2 Memory Usage

```bash
pip install memory-profiler
python -m memory_profiler app/main.py
```

## 5.3 Response Time

```bash
curl -w "\nTime: %{time_total}s\n" \
  http://localhost:8000/health
```

---

# 6. Monitoring Checklist

## Daily

* [ ] Server is running.
* [ ] `/health` returns HTTP 200.
* [ ] Tests pass.
* [ ] No unexpected error logs appear.

## Weekly

* [ ] Database size is reasonable.
* [ ] No slow queries are present.
* [ ] Database backup has been performed.

## Monthly

* [ ] Error logs have been reviewed.
* [ ] Dependencies have been checked for updates.
* [ ] Dependency security audit has been performed.

Dedicated monitoring and alerting status is documented separately in `monitoring-alerting.md`.

---

# 7. Monitoring & Logging

## 7.1 Viewing Logs

```bash
uvicorn app.main:app --reload --log-level=debug
```

In Docker:

```bash
docker logs <container>
```

Log levels are:

```text
DEBUG
INFO
WARNING
ERROR
CRITICAL
```

## 7.2 Security Logs

The OWASP middleware uses structured security logging under the `owasp` logger.

Important tags include:

| Tag     | Purpose                         |
| ------- | ------------------------------- |
| `[A01]` | Access control / path scanning  |
| `[A03]` | Injection detection             |
| `[A07]` | Rate limiting / IP bans         |
| `[A09]` | Request tracing / slow requests |
| `[A10]` | SSRF detection                  |

There is currently no external log aggregation platform such as ELK, Prometheus, or Grafana. Logs remain in the local terminal or container stdout.

---

# 8. Disaster Recovery

For a major failure, refer to `disaster-recovery.md`.

Immediate actions:

1. Take a fresh database dump before destructive operations.
2. Remember that the Docker entrypoint automatically runs `alembic upgrade head` during container startup.
3. Rolling back an application image does **not** automatically roll back the database schema.
4. Decide whether to use an Alembic downgrade or restore the database from backup.
5. Note that there is currently no automated backup job.

---

# 9. Restart Procedures

## 9.1 Clean Restart

```bash
# Stop the server with Ctrl+C

# Stop lingering uvicorn processes
pkill -f uvicorn

# Optional database reset
# python -c "from app.db.base import Base; ..."

# Start again
uvicorn app.main:app --reload
```

## 9.2 Restart With a Fresh Database

**Backup first.**

```bash
pg_dump -U postgres premnathrail_ideal > backup.sql

dropdb -U postgres premnathrail_ideal
createdb -U postgres premnathrail_ideal

uvicorn app.main:app --reload
```

For complete development and production restart procedures, refer to `maintenance-procedures.md`.

---

# 10. Deployment Checklist

Before production deployment:

* [ ] All tests pass.
* [ ] `SECRET_KEY` has been changed from its default value.
* [ ] HTTPS is enabled.
* [ ] Database backups are configured.
* [ ] Monitoring and logging are configured.
* [ ] CI pipeline is configured if required.
* [ ] Deployment process is documented.
* [ ] Deployment has been tested in staging.

---

# 11. Getting Help

1. Check this runbook first.
2. Check application logs.
3. Check the tests to understand expected behavior.
4. Review the relevant documentation under `docs/`.
5. Escalate to the project team.

---

# 12. Emergency Contacts

| Area     | Initial Action                             |
| -------- | ------------------------------------------ |
| Backend  | Check backend logs and restart the server  |
| Database | Verify PostgreSQL availability             |
| OAuth    | Verify Azure configuration and credentials |
| Tests    | Run `pytest app/tests -vv`                 |

No dedicated on-call rotation or formal contact list has been established yet.

---

# 13. Related Documentation

* `monitoring-alerting.md` — monitoring and alerting status.
* `disaster-recovery.md` — major-failure recovery procedures.
* `incident-runbook.md` — incident response, severity levels, and rollback.
* `maintenance-procedures.md` — migrations, restarts, dependencies, and backups.
* `changelog.md` — dated record of shipped changes.
