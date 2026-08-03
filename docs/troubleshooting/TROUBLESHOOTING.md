# Troubleshooting Guide

## Common Issues & Solutions

### **Issue 1: Server won't start**

**Error:**
```
ModuleNotFoundError: No module named 'app'
```

**Cause:** Wrong directory

**Fix:**
```bash
# Make sure you're in backend directory
cd D:\Desktop\PremnathrailPortal-Ideal\backend

# Then run
python -m uvicorn app.main:app --reload
```

---

### **Issue 2: Port already in use**

**Error:**
```
OSError: [Errno 48] Address already in use
```

**Cause:** Another process using port 8000

**Fix Option A - Kill existing process:**
```powershell
# Find process using port 8000
netstat -ano | findstr :8000

# Kill it (replace PID)
taskkill /PID <PID> /F

# Or search for uvicorn
Get-Process | Where-Object {$_.ProcessName -like "*python*"}
```

**Fix Option B - Use different port:**
```bash
uvicorn app.main:app --port 8001 --reload
```

---

### **Issue 3: Database connection error**

**Error:**
```
could not connect to server: No such file or directory
```

**Cause 1: PostgreSQL not running**

```bash
# Check if running
pg_isready -h localhost -p 5432

# If not running, start it
# Windows: Services → PostgreSQL
# Or: net start postgresql-x64-18
```

**Cause 2: Wrong DATABASE_URL in .env**

```env
# Check .env file
DATABASE_URL=postgresql+psycopg://postgres:password@localhost:5432/premnathrail_ideal

# Test connection
psql -U postgres -h localhost -d premnathrail_ideal
```

**Cause 3: Wrong password**

```bash
# Reset password
psql -U postgres -h localhost
ALTER USER postgres PASSWORD 'newpassword';
```

---

### **Issue 4: Import error in tests**

**Error:**
```
ModuleNotFoundError: No module named 'app'
ImportError: cannot import name 'User' from 'app.modules.main.models.user'
```

**Fix:**
```bash
# Make sure backend directory is in PYTHONPATH
cd backend

# Run pytest from backend directory
pytest app/tests -v

# Or set PYTHONPATH
set PYTHONPATH=%PYTHONPATH%;%cd%
pytest app/tests -v
```

---

### **Issue 5: Tests failing with mocking issues**

**Error:**
```
AttributeError: <MagicMock> does not have attribute 'json'
```

**Cause:** Mock not configured correctly

**Fix:**
```python
# Wrong
mock_response = MagicMock()

# Correct
mock_response = MagicMock()
mock_response.json.return_value = {"key": "value"}

# Or use patch with context
@patch('module.function')
def test_something(mock_func):
    mock_func.return_value = {...}
```

---

### **Issue 6: Microsoft OAuth not working**

**Error:**
```
OAuth not configured. Set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID
```

**Fix:**

1. **Check .env file exists:**
   ```bash
   cat backend/.env
   ```

2. **Verify credentials:**
   ```env
   AZURE_CLIENT_ID=<from Azure Portal>
   AZURE_CLIENT_SECRET=<from Azure Portal>
   AZURE_TENANT_ID=<from Azure Portal>
   AZURE_REDIRECT_URI=http://localhost:8000/auth/callback
   ```

3. **Check Azure Portal:**
   - Go to Azure AD → App registrations
   - Find your app
   - Copy Client ID (AZURE_CLIENT_ID)
   - Copy Tenant ID (AZURE_TENANT_ID)
   - Go to Certificates & secrets
   - Copy Client secret (AZURE_CLIENT_SECRET)

4. **Test credentials:**
   ```python
   from app.core.config import settings
   print(f"Client ID: {settings.AZURE_CLIENT_ID}")
   print(f"Client Secret: {settings.AZURE_CLIENT_SECRET[:10]}...")
   ```

---

### **Issue 7: Invalid state parameter**

**Error:**
```
Invalid or expired state parameter
```

**Cause:** State token expired (>10 minutes old)

**Fix:**
- Try logging in again
- Check server time is synchronized

---

### **Issue 8: User not created after login**

**Error:**
```
No user in database after OAuth callback
```

**Cause 1: External domain**
```
Check user email is @premnathrail.com
If hacker@gmail.com → Will be rejected
```

**Cause 2: OAuth callback not executed**
```
Check redirect_uri matches Azure Portal configuration
```

**Fix:**
```bash
# Check database
psql -U postgres -h localhost -d premnathrail_ideal
SELECT * FROM users;

# If empty, check logs for error
# Look at server terminal for error messages
```

---

### **Issue 9: Tests timing out**

**Error:**
```
FAILED - Timeout
```

**Cause:** Mock not set up, trying to hit real Microsoft

**Fix:**
```python
# Make sure @patch decorators are in place
@patch('app.modules.main.routes.auth.get_microsoft_user_profile')
@patch('app.modules.main.routes.auth.exchange_code_for_token')
def test_something(mock_exchange, mock_get_profile):  # Order reversed!
    mock_get_profile.return_value = {...}
    mock_exchange.return_value = {...}
```

---

### **Issue 10: Inactive user can access API**

**Error:**
```
Inactive user can call /auth/me
```

**Cause:** User.is_active not checked

**Fix:** Verify route checks is_active:
```python
# In get_current_user():
if not user or not user.is_active:
    raise HTTPException(status_code=401, detail="User not found or inactive")
```

---

## CRM Module Issues

### **Issue 11: Document upload returns 503**

**Error:**
```json
{ "detail": "SharePoint site is not configured" }
```

**Cause:** `SHAREPOINT_SITE_ID` is empty/unset in `backend/.env`. This applies to both the
ERP module's project/service-request attachments and the CRM module's document uploads —
they share the same SharePoint integration (`app/utils/sharepoint.py`).

**Fix:**
```env
# backend/.env
SHAREPOINT_SITE_ID=<your SharePoint site ID>
SHAREPOINT_FOLDER=ERP-media   # root folder name, optional
```

**Verify without a real upload** — check the config is loaded:
```python
from app.core.config import settings
print(settings.SHAREPOINT_SITE_ID)
```

**Testing locally without SharePoint access:** the test suite mocks the upload/delete
functions directly (`app.modules.crm.routes.documents.upload_file_to_sharepoint` /
`delete_file_from_sharepoint`) via `monkeypatch` rather than hitting Microsoft Graph — see
`app/tests/test_crm_documents.py` for the pattern. Reuse it for any new document-upload
route instead of mocking `httpx` at a lower level.

---

### **Issue 12: 403 on Inquiry/Tender workflow sub-routes (tasks, approvals, quotations, POs, competitors)**

**Error:**
```json
{ "detail": "Only the creator or an admin can edit this task." }
```

**Cause:** This is intentional — every CRM mutation route (including the nested workflow
sub-entities under `/inquiries/{id}/...` and `/tenders/{id}/...`) checks
`user.role == "admin" or record.created_by_id == user.id`. Only the
record's own creator or an admin can update/delete it. A user with plain `"crm"` app
access can still `GET`/list and create new sub-records, just not modify someone else's.

**Fix:** Log in as the record's creator, or use an admin account. Do not
"fix" this by weakening the check — it was deliberately added everywhere (the legacy app
this was rebuilt from left permission checks off these specific sub-routes, which was a
real gap, not a feature to replicate).

---

### **Issue 13: Duplicate Organization/Tender rejected with 409**

**Error:**
```json
{ "detail": "An organization with this name already exists" }
{ "detail": "A tender with this number already exists for this zone/division" }
```

**Cause:** Organizations are deduped by case-insensitive `name` OR `gst_number`. Tenders
are deduped by the combination of `tender_number` + `railway_zone` + `division` — the
same tender number IS allowed again under a different zone/division (matches how the
same real-world tender can have separate zonal filings).

**Fix:** Use `GET /api/v1/crm/organizations/search-name?q=...` before creating, to check
for an existing match first, or edit the existing record instead of creating a new one.

---

### **Issue 14: Inquiry/Tender `current_stage` didn't visually update / stage history missing an entry**

**Cause:** Stage changes are only auto-logged (`CrmStageLog` row + notification) when the
`current_stage` field is present in a `PATCH` payload AND differs from the current value.
Sending the same value as a no-op update logs nothing (by design — see
`_log_stage`/`stage_changed` checks in `app/modules/crm/routes/inquiries.py` and
`tenders.py`). To manually append a stage entry without going through the normal
`current_stage` diff check, use `POST /{id}/stages` instead, which always logs and also
overwrites `current_stage` unconditionally.

---

## Debugging Commands

### **View server logs**

```bash
# Basic logs
uvicorn app.main:app --reload

# Detailed logs
uvicorn app.main:app --reload --log-level=debug

# With timestamps
uvicorn app.main:app --reload --log-level=debug --access-log
```

### **Check database state**

```bash
# Connect to database
psql -U postgres -h localhost -d premnathrail_ideal

# View users
SELECT id, email, name, role, is_active FROM users;

# View recent logins (if audit table exists)
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10;

# Check table structure
\d users

# Exit
\q
```

### **Run specific test with debug**

```bash
# Show print statements
pytest app/tests/test_microsoft_oauth.py::test_oauth_callback_creates_new_user -v -s

# Show very detailed output
pytest app/tests/test_microsoft_oauth.py::test_oauth_callback_creates_new_user -vv -s

# Stop on first failure
pytest app/tests/test_microsoft_oauth.py -x

# Show local variables on failure
pytest app/tests/test_microsoft_oauth.py -l
```

### **Check dependencies**

```bash
# See installed versions
pip list | grep -E "fastapi|sqlalchemy|msal"

# Check for outdated packages
pip list --outdated

# Check for security issues
pip install safety
safety check
```

---

## Performance Issues

### **Slow API response**

**Check 1: Database queries**
```python
# Enable query logging
import logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

# Run your request - see SQL queries in logs
```

**Check 2: Number of queries**
```bash
# Use pytest with query counting
pip install pytest-sqlalchemy
```

**Check 3: Missing indexes**
```sql
-- Check which queries are slow
SELECT query, calls, mean_time FROM pg_stat_statements 
WHERE mean_time > 100 
ORDER BY mean_time DESC;
```

### **High memory usage**

```bash
# Monitor memory
pip install memory-profiler
python -m memory_profiler app/main.py

# Find memory leaks
pip install tracemalloc
```

---

## Database Issues

### **Migrate database**

```bash
# Create migration
alembic revision --autogenerate -m "Add user table"

# Apply migration
alembic upgrade head

# Rollback migration
alembic downgrade -1
```

### **Reset database (DESTRUCTIVE)**

```bash
# Backup first!
pg_dump -U postgres -h localhost premnathrail_ideal > backup.sql

# Reset
dropdb -U postgres -h localhost premnathrail_ideal
createdb -U postgres -h localhost premnathrail_ideal
```

---

## Security Issues

### **Someone compromised database**

1. **Stop the app**
   ```bash
   # Stop all uvicorn instances
   pkill -f uvicorn
   ```

2. **Rotate secrets**
   ```bash
   # Generate new SECRET_KEY
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   
   # Update .env
   # Restart app
   ```

3. **Check audit logs**
   ```bash
   # Who accessed what when
   SELECT * FROM audit_logs WHERE action = 'oauth_login' ORDER BY created_at DESC;
   ```

4. **Disable suspicious users**
   ```bash
   psql -U postgres -d premnathrail_ideal
   UPDATE users SET is_active = false WHERE email = 'suspicious@example.com';
   ```

---

## Getting Help

**Before asking for help:**

1. ✅ Check this troubleshooting guide
2. ✅ Check [docs/RUNBOOK.md](../runbook/RUNBOOK.md)
3. ✅ Check logs (`uvicorn ... --log-level=debug`)
4. ✅ Check error message (often has clue)
5. ✅ Search git history (`git log --grep="error"`)

**When asking for help, provide:**

```
Error message (exact):
[paste full error]

Steps to reproduce:
1. ...
2. ...

What I tried:
- ...
- ...

Context:
- OS: Windows/Mac/Linux
- Python version: python --version
- Database: PostgreSQL version: psql --version
- Logs: [paste relevant logs]
```

---

## Monitoring Checklist

### Daily
- [ ] Server running (`http://localhost:8000/health = 200`)
- [ ] Tests passing (`pytest app/tests`)
- [ ] No errors in logs

### Weekly
- [ ] Database size reasonable
- [ ] No slow queries (>1 second)
- [ ] Backup created

### Monthly
- [ ] Dependencies up to date
- [ ] Security patches applied
- [ ] Secrets rotated

---

## Quick Reference

| Problem | Command |
|---------|---------|
| Server won't start | `cd backend && python -m uvicorn app.main:app --reload` |
| Port in use | `netstat -ano \| findstr :8000` then `taskkill /PID <PID> /F` |
| DB not connecting | `pg_isready -h localhost` |
| Run tests | `pytest app/tests -v` |
| View logs | `uvicorn app.main:app --reload --log-level=debug` |
| Connect to DB | `psql -U postgres -h localhost -d premnathrail_ideal` |
| Check users | `SELECT * FROM users;` (in psql) |

---

**Still stuck?** Check server logs first — they usually tell you exactly what's wrong! 🔍
