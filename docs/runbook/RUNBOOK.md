# Runbook — Operations & Troubleshooting

## Quick Start

```bash
# Terminal 1: Start backend
cd backend
python -m venv venv && venv\Scripts\activate  # One time
pip install -r requirements.txt               # One time
uvicorn app.main:app --reload

# Terminal 2: Run tests
cd backend
pytest app/tests -v
```

Server: `http://localhost:8000`
Docs: `http://localhost:8000/docs`

---

## Common Tasks

### Verify Server is Running

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{"status": "ok", "app": "Premnathrail Portal"}
```

### Test Authentication

1. Open: `http://localhost:8000/docs`
2. Click on `/auth/microsoft-login`
3. Click "Try it out"
4. Click "Execute"
5. Should redirect to Microsoft login

### Reset Database

```bash
# WARNING: Deletes all data!
python -c "
from app.db.base import Base
from app.db.session import engine
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
print('✅ Database reset')
"
```

### Create Test User (manual)

```python
from app.db.session import SessionLocal
from app.modules.main.models.user import User
from app.auth.jwt_handler import create_access_token

db = SessionLocal()
user = User(email="test@example.com", name="Test User", role="user", is_active=True)
db.add(user)
db.commit()
db.refresh(user)

token = create_access_token({"sub": str(user.id), "role": "user"})
print(f"User created: {user.id}")
print(f"Token: {token}")
```

---

## Troubleshooting

### **Problem: "Address already in use" on port 8000**

```bash
# Find process using port 8000
netstat -ano | findstr :8000

# Kill process (replace PID)
taskkill /PID <PID> /F

# Or use different port
uvicorn app.main:app --port 8001 --reload
```

### **Problem: "ModuleNotFoundError: No module named 'app'"**

```bash
# Make sure you're in backend directory
cd backend

# Then run
python -m uvicorn app.main:app --reload
```

### **Problem: "could not connect to server" (PostgreSQL)**

```bash
# Check if PostgreSQL is running
psql --version

# If not installed, install from:
# https://www.postgresql.org/download/

# Test connection
psql -U postgres -h localhost

# If connection fails, check:
# 1. PostgreSQL service is running
# 2. DATABASE_URL in .env is correct
# 3. Username/password is correct
```

### **Problem: "ModuleNotFoundError: No module named 'msal'**

```bash
# Install missing packages
pip install -r requirements.txt

# Or install individually
pip install msal python-jose httpx
```

### **Problem: Tests fail with "ImportError"**

```bash
# Make sure pytest can find app module
cd backend
pytest app/tests -v

# Or add to .env
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
```

### **Problem: Microsoft OAuth not working**

**Check 1: Credentials in .env**
```bash
# Verify these are set in backend/.env
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
AZURE_TENANT_ID=...
AZURE_REDIRECT_URI=http://localhost:8000/auth/callback
```

**Check 2: Azure app is registered**
- Go to: [Azure Portal](https://portal.azure.com)
- Check: Azure AD → App registrations
- Verify: Application ID = AZURE_CLIENT_ID
- Verify: Tenant ID = AZURE_TENANT_ID
- Verify: Redirect URI includes `http://localhost:8000/auth/callback`

**Check 3: Client secret is valid**
- Go to: App registration → Certificates & secrets
- Verify: Secret hasn't expired
- Verify: Secret value = AZURE_CLIENT_SECRET

### **Problem: "Invalid or expired state parameter" in OAuth**

- State tokens expire after 10 minutes
- **Solution:** Try logging in again
- **Also check:** Server time is synchronized with system time

### **Problem: "No access token returned from Azure AD"**

**Check 1: Is AZURE_CLIENT_SECRET correct?**
```bash
echo $AZURE_CLIENT_SECRET  # Should not be blank
```

**Check 2: Are scopes available?**
- Microsoft scopes required: `User.Read`
- Check app permissions in Azure Portal

**Check 3: Is tenant ID correct?**
- Go to Azure Portal → Azure AD → Properties
- Copy "Tenant ID" exactly

### **Problem: ERP requests return 403 with "erp_permissions" mentioned**

The caller's `role` isn't `admin`/`super_admin`, and their `erp_permissions`
list is missing the specific action's id. Sub-permissions only apply to ERP —
CRM/R&D are whole-module toggles via `assigned_apps` only. Valid ids:
`project_view`, `project_create`, `project_edit`, `project_delete`, `sr_view`,
`sr_create`, `sr_edit`, `sr_delete` (see [API.md](../api/API.md#update-a-user)).

**Check 1: does the user actually have the permission?**
```
GET /api/v1/users   # (as an admin) — check erp_permissions on the target user
```

**Check 2: is only `DELETE /erp/projects/{id}` actually enforced server-side?**
Yes — as of this writing, `project_delete` is the only ERP sub-permission
checked on its corresponding endpoint. The others (`project_create`, `sr_edit`,
etc.) are read by the frontend to show/hide nav items and buttons, but their
routes don't yet re-check them server-side. Don't assume granting/removing one
of those ids changes what a Bearer-token/API call can actually do — only
`project_delete` currently gates anything at the API layer.

**Check 3: is the caller hitting an admin route without an admin role?**
`admin`/`super_admin` bypass `erp_permissions` entirely — a `403` for an admin
account usually means the JWT's `role` claim is stale (re-login) rather than a
real permissions gap.

### **Problem: SQLAlchemy model has a column that doesn't error on import, but every query fails / a field is silently None**

`Base.metadata.create_all(bind=engine)` in `main.py` (run on every startup)
**only creates tables that don't exist yet** — it never adds a column to a
table SQLAlchemy already knows about. If you add a `mapped_column(...)` to an
existing model, the ORM will happily import and query the table, but the live
database still has the old schema underneath: any request that touches the
new column throws a raw `sqlalchemy.exc.OperationalError` / `ProgrammingError`
("column ... does not exist") instead of a clean 4xx.

**Symptom:** works perfectly against a fresh test database (in-memory SQLite,
recreated per test via the `db` fixture) but breaks against the real dev/prod
Postgres database — this asymmetry is the tell.

**Fix — pick one:**
1. **Local/dev, data is disposable:** drop and recreate (see *Reset Database*
   above) — simplest, but destroys all rows.
2. **Anywhere with data worth keeping:** hand-write the migration —
   `ALTER TABLE <table> ADD COLUMN <col> <type>` (match nullability/defaults to
   what the model declares), applied directly against the running database
   before/alongside deploying the code change. This project doesn't have
   Alembic wired up yet, so there's no `alembic upgrade head` step — schema
   changes are manual `ALTER TABLE` + the model/Pydantic-schema edit, done in
   the same change.
3. **Whenever you do #2, also grep for every place that reads/writes the
   column** (route, Pydantic schema, any raw SQL) — a manual `ALTER TABLE`
   fixes the database but nothing keeps the ORM model and Pydantic schema in
   sync with it for you.

### **Problem: A normally-fine request gets 400 "Bad request." with no other detail**

That's `OWASPMiddleware`'s injection/SSRF scan (`backend/app/middleware/owasp.py`),
not the route itself — check the server log for a `[A03]`/`[A10]` line, which
names exactly what pattern matched and where (URL, header, or body). Common
false-positive-shaped causes: a search term that happens to contain SQL
keywords (`select`, `union`, `delete`) as normal English, or a URL literally
containing `http://` pointing at a private IP (SSRF check, e.g. testing against
`localhost`/`127.0.0.1` deliberately — expected to be blocked, not a bug).

### **Problem: A previously-working IP suddenly gets 429 "Too many violations. Try again later." on every request**

That IP has hit `BAN_THRESHOLD` (10) rate-limit/injection/bulk-delete
violations within the ban window and is auto-banned for `BAN_DURATION_SECONDS`
(600s / 10 min) — this is `OWASPMiddleware`'s A07 protection working as
designed, not a bug. Wait out the ban, or in local dev call
`get_rate_store().reset()` (see `conftest.py`'s `_reset_rate_store` fixture for
the pattern) to clear it immediately.

### **Problem: Teams SSO — "Token not issued for this application" / "Token not issued by Microsoft"**

The token's `aud` (audience) must end with `/{AZURE_CLIENT_ID}`, and `iss`
(issuer) must start with `https://login.microsoftonline.com/` or
`https://sts.windows.net/` — checked before any network call, so a mismatch
here means the Teams app manifest's `webApplicationInfo.id` doesn't match
`AZURE_CLIENT_ID`, or the token being sent isn't actually the SSO token from
`microsoftTeams.authentication.getAuthToken()`.

### **Problem: Teams SSO logs in, but Graph-backed features (org directory, admin sync) don't work**

The OBO (On-Behalf-Of) exchange failed — check server logs around
`acquire_token_on_behalf_of`. Common cause: the Azure app registration is
missing the exposed API scope `access_as_user`, or the Teams desktop/web
client IDs aren't pre-authorized for it. This is non-fatal by design — the
portal login itself still succeeds (`session_token` cookie is set); only
`ms_access_token` will be absent.

---

## Performance Checks

### Database Query Performance

```bash
# Enable SQLAlchemy logging to see SQL queries
export SQLALCHEMY_ECHO=True
uvicorn app.main:app --reload
```

This shows every SQL query executed. Look for:
- ✅ Simple queries (fast)
- ❌ N+1 queries (slow — query in loop)
- ❌ Missing indexes

### Memory Usage

```bash
# Run with memory profiling
pip install memory-profiler
python -m memory_profiler app/main.py
```

### Response Time

```bash
# Test endpoint response time
curl -w "\nTime: %{time_total}s\n" http://localhost:8000/health
```

---

## Monitoring Checklist

### Daily
- [ ] Server is running (`http://localhost:8000/health` = 200)
- [ ] Tests pass (`pytest app/tests`)
- [ ] No error logs in console

### Weekly
- [ ] Database size is reasonable (`SELECT pg_database.datname, pg_size_pretty(pg_database_size(pg_database.datname)) FROM pg_database;`)
- [ ] No slow queries (check logs for >1s queries)
- [ ] Backup database

### Monthly
- [ ] Review error logs
- [ ] Update dependencies (`pip list --outdated`)
- [ ] Security audit (check for CVEs in dependencies)

---

## Logs

### View logs
```bash
# Terminal where uvicorn is running shows logs
# Use -v flag for verbose
uvicorn app.main:app --reload --log-level=debug
```

### Log levels
- `DEBUG` — Very detailed, noisy
- `INFO` — General info (default)
- `WARNING` — Something unexpected
- `ERROR` — Something failed
- `CRITICAL` — System failing

---

## Backup & Restore

### Backup database
```bash
pg_dump -U postgres -h localhost premnathrail_ideal > backup.sql
```

### Restore database
```bash
psql -U postgres -h localhost premnathrail_ideal < backup.sql
```

---

## Restart Procedures

### Clean restart
```bash
# 1. Stop server (Ctrl+C in terminal)
# 2. Stop any lingering processes
pkill -f uvicorn

# 3. Reset database (optional)
# python -c "from app.db.base import Base; ..."

# 4. Start fresh
uvicorn app.main:app --reload
```

### With fresh database
```bash
# Backup first!
pg_dump -U postgres premnathrail_ideal > backup.sql

# Drop and recreate
dropdb -U postgres premnathrail_ideal
createdb -U postgres premnathrail_ideal

# Server will create tables on startup
uvicorn app.main:app --reload
```

---

## Deployment Checklist

Before going to production:
- [ ] All tests pass
- [ ] Change SECRET_KEY in `.env` (not default)
- [ ] Enable HTTPS (use reverse proxy: Nginx)
- [ ] Set up database backups
- [ ] Configure monitoring/logging
- [ ] Set up CI/CD pipeline
- [ ] Document deploy process
- [ ] Test deploy in staging environment

---

## Getting Help

1. **Check this runbook** — You're here! 📖
2. **Check logs** — Error messages usually tell you what's wrong
3. **Check tests** — See how things should work
4. **Check documentation** — `docs/` folder has architecture, API, setup
5. **Ask the team** — Slack, email, etc.

---

## Emergency Contacts

- **Backend issues:** Check backend logs, restart server
- **Database issues:** Check PostgreSQL is running
- **OAuth issues:** Check Azure Portal credentials
- **Test failures:** Check `pytest app/tests -vv`

---

## Regular Maintenance

### Weekly
```bash
# Update dependencies (safely)
pip list --outdated
pip install --upgrade package-name

# Run tests
pytest app/tests -v

# Check code style (when added)
flake8 app/
black app/ --check
```

### Monthly
```bash
# Security audit
pip install safety
safety check

# Code quality
# (When tools added to CI/CD)
```

---

**Last updated:** 2025-07-24
**Maintained by:** Engineering Team
