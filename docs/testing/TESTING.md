# Testing Guidelines

## Overview

We use **pytest** for testing. Tests are organized by module and layer.

## Test Structure

Tests live flat under `backend/app/tests/`, one file per feature area (not nested per
module/layer — see the note in [ARCHITECTURE.md](ARCHITECTURE.md#module-structure) about
why there's no separate repository/service layer to test in isolation):

```
backend/app/tests/
├── conftest.py                    # `client`/`db` fixtures + autouse `_reset_rate_store`
│                                     (the OWASP middleware's rate limiter is a module-level
│                                     singleton shared across the whole pytest session —
│                                     without resetting it between tests, later tests start
│                                     failing with false 429s once earlier ones used up the
│                                     "testclient" IP's request budget)
├── test_auth.py
├── test_microsoft_oauth.py
├── test_teams_sso.py              # /auth/teams-token and /auth/teams-exchange — JWKS/OBO/
│                                     replay protection are mocked (see Mocking below), not
│                                     hit against real Azure AD
├── test_security_middleware.py    # OWASPMiddleware: injection detection, SSRF, rate
│                                     limiting + IP bans, security headers, API key auth
├── test_presence.py                # "who's viewing this" heartbeat/viewer-list endpoints
├── test_users.py
├── test_notifications.py
├── test_erp_projects.py
├── test_erp_service_requests.py
├── test_purchase_requisitions.py  # Raising a PR from SR materials, approve/reject/cancel,
│                                     partial/full receiving, closing, item remarks + photo
│                                     attachments (mocks SharePoint the same way
│                                     test_crm_documents.py does) — see
│                                     ARCHITECTURE.md#purchase-module for the lifecycle
├── test_crm.py                    # Organizations/Inquiries/Tenders CRUD, stage logging,
│                                     duplicate-prevention, cascade delete/restore, permissions
├── test_crm_documents.py          # SharePoint-backed document upload/list/delete —
│                                     mocks upload_file_to_sharepoint/delete_file_from_sharepoint
│                                     via monkeypatch rather than hitting Microsoft Graph
└── test_followup_reminders.py     # app/tasks/followup_reminders.py — see the dedicated
                                      section below, it isn't a route/`client` test
```

Every test module follows the same two helpers (copy this pattern for new test files):
```python
def make_user(db, email, role="user", assigned_apps=None):
    apps = ["crm"] if assigned_apps is None else assigned_apps  # pick the module's app name
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=apps)
    db.add(user); db.commit(); db.refresh(user)
    return user

def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}
```
**Watch out:** `assigned_apps=assigned_apps or ["crm"]` is a bug — `[]` is falsy in Python,
so a test meant to grant *no* access silently gets `["crm"]` instead. Always use the
`None`-check form above.

## Running Tests

### Run all tests
```bash
pytest app/tests -v
```

### Run specific file
```bash
pytest app/tests/test_auth.py -v
```

### Run specific test
```bash
pytest app/tests/test_auth.py::test_health_endpoint -v
```

### Run with coverage
```bash
pip install pytest-cov
pytest app/tests --cov=app --cov-report=html
```

### Run in watch mode
```bash
pip install pytest-watch
ptw app/tests
```

---

## Test Types

### 1. Unit Tests

**What:** Test individual functions/methods in isolation

**When:** Always — for services, repositories

**How:**
```python
def test_create_note_validates_title(service):
    """Test that create_note validates title."""
    with pytest.raises(ValueError):
        service.create_note(CreateNoteSchema(title="", description="..."))
```

**Where:** `test_*_service.py`

---

### 2. Integration Tests

**What:** Test flow through multiple layers (route → service → repository → database)

**When:** For full features (create note with validation, db save, response)

**How:**
```python
def test_create_note_endpoint(client, db):
    """Test full flow: POST /api/v1/crm/notes."""
    response = client.post(
        "/api/v1/crm/notes",
        json={"title": "Call", "description": "Follow up"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 201
    assert response.json()["title"] == "Call"
```

**Where:** `test_*_routes.py`

---

### 3. End-to-End Tests

**What:** Test complete user workflows

**When:** For critical paths (login → create note → view note)

**How:**
```python
def test_user_can_create_and_view_note(client, db):
    """Test: Login → Create note → View note."""
    # 1. Create user
    user = create_test_user(db)
    token = create_access_token({"sub": str(user.id)})
    
    # 2. Create note
    response = client.post(
        "/api/v1/crm/notes",
        json={"title": "Test", "description": "..."},
        headers={"Authorization": f"Bearer {token}"}
    )
    note_id = response.json()["id"]
    
    # 3. View note
    response = client.get(
        f"/api/v1/crm/notes/{note_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.json()["title"] == "Test"
```

**Where:** `tests/integration/test_*.py`

---

## Fixtures (conftest.py)

### `db` Fixture
Provides a test database session.

```python
def test_something(db):  # Injected automatically
    user = db.query(User).first()
    assert user is not None
```

### `client` Fixture
Provides a TestClient (FastAPI test client).

```python
def test_endpoint(client):  # Injected automatically
    response = client.get("/health")
    assert response.status_code == 200
```

---

## Writing Tests

### Best Practices

✅ **Do:**
- Test behavior, not implementation
- Use descriptive test names
- One assertion per test (or related assertions)
- Mock external services (Microsoft OAuth, etc.)
- Use fixtures for setup
- Test edge cases (empty strings, None, invalid data)

❌ **Don't:**
- Test everything (focus on business logic)
- Use real Microsoft OAuth in tests
- Leave hardcoded test data
- Test library code (SQLAlchemy, Pydantic)
- Use multiple assertions for different things

### Template

```python
def test_create_note_with_long_title(service):
    """Test: Create note with title > 255 chars."""
    # Arrange
    long_title = "x" * 300
    schema = CreateNoteSchema(title=long_title, description="...")
    
    # Act & Assert
    with pytest.raises(ValueError, match="Title too long"):
        service.create_note(schema)
```

---

## Mocking

### Mock Microsoft OAuth

```python
from unittest.mock import patch

@patch('app.auth.microsoft.get_microsoft_user_profile')
def test_login_with_mock_profile(mock_get_profile, client):
    """Test login without hitting real Microsoft API."""
    mock_get_profile.return_value = {
        "id": "123",
        "mail": "test@example.com",
        "displayName": "Test User"
    }
    # ... rest of test
```

### Mock Database

```python
@patch('app.modules.main.repositories.user.User')
def test_service_calls_repository(mock_user_model):
    """Test service calls repository correctly."""
    mock_user_model.return_value = User(id=1, email="test@example.com")
    # ... rest of test
```

---

## Test Coverage

We aim for **>80% coverage** on services and repositories.

```bash
pytest app/tests --cov=app --cov-report=term-missing
```

Output shows:
- Which lines are covered
- Which lines are NOT covered
- Overall percentage

---

## CI/CD Integration

Tests run automatically on every commit (GitHub Actions / GitLab CI).

Failing tests block merge to main.

---

## Debugging Tests

### Print debug info
```python
def test_something(client):
    response = client.get("/health")
    print(response.json())  # Visible with: pytest -s
    assert response.status_code == 200
```

### Run with more verbosity
```bash
pytest app/tests -vv -s
```

### Stop on first failure
```bash
pytest app/tests -x
```

---

## Test Data

### Create test user
```python
def create_test_user(db, email="test@example.com"):
    user = User(email=email, name="Test User", role="user", is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
```

### Create test token
```python
def create_test_token(user_id: int):
    return create_access_token({"sub": str(user_id), "role": "user"})
```

---

## Microsoft OAuth Testing

Special attention needed for testing authentication:

- **See:** [TESTING_MICROSOFT_OAUTH.md](TESTING_MICROSOFT_OAUTH.md)
- Tests verify users logging in from Microsoft
- Uses mocks to avoid needing real Microsoft account
- 8 comprehensive tests covering:
  - Login redirect to Microsoft
  - User auto-creation on first login
  - Profile sync on repeat login
  - Domain restriction (@premnathrail.com only)
  - JWT token validation
  - Protected endpoints
  - Inactive user denial
  - Invalid state parameter rejection

### Run OAuth tests

```bash
pytest app/tests/test_microsoft_oauth.py -v
pytest app/tests/test_microsoft_oauth.py::test_oauth_callback_creates_new_user -v
```

Note: since the session moved to httponly-cookie delivery, these tests read the
JWT via `response.cookies.get("session_token")` on the callback's redirect
response, not from the redirect URL — see `token_from_cookie()` in that file.

---

## Teams SSO Testing

`test_teams_sso.py` covers `/auth/teams-token` and `/auth/teams-exchange`.
Since a real Teams SSO token is signed by Azure AD (not reproducible in a unit
test), these tests:
- Build a syntactically valid but **unsigned** JWT (`make_teams_token()`) to
  exercise the audience/issuer/replay checks, which run on the raw payload
  before signature verification.
- Patch `app.modules.main.routes.auth.jose_jwt.decode` directly to stand in
  for "signature verified successfully", rather than mocking JWKS crypto.
- Patch `httpx.AsyncClient` (JWKS fetch) and `msal.ConfidentialClientApplication`
  (OBO exchange) so no network call happens.

Key behaviors under test: wrong audience/issuer → `401`, replayed `jti` → `401`,
OBO failure still completes login (cookie set, just no `ms_access_token`), and
`/auth/teams-exchange` treats its one-time code as single-use + TTL-expiring.

---

## Security Middleware Testing

`test_security_middleware.py` exercises `OWASPMiddleware` end-to-end through
real HTTP requests (not by calling its internal functions directly), because
what matters is the actual response code/headers a client sees. Notable gotcha
covered by a regression test: the injection-detection regex needs the URL
`unquote`'d first, since `union%20select` (percent-encoded) and `union+select`
would otherwise slip past a pattern written for literal whitespace.

The IP-ban test (`test_repeated_violations_trigger_ip_ban`) has a one-request
offset worth remembering if you add similar tests: the request that pushes the
violation count over `BAN_THRESHOLD` is itself still answered with the error
that *caused* the violation (e.g. `400`) — the ban only takes effect starting
with the *next* request after that.

---

## Activity Follow-up Reminder Testing

`test_followup_reminders.py` covers `app/tasks/followup_reminders.py` — a
scheduled job (see [ARCHITECTURE.md](../architecture/ARCHITECTURE.md#background-jobs--scheduled-tasks)),
not a route, so it doesn't use the `client` fixture at all.

**Why it doesn't just call `send_activity_followup_reminders()` directly:**
that's the scheduler entry point, and it opens its own session via the real
`SessionLocal()` — the same one `app/db/session.py` binds to the production
`DATABASE_URL`. Calling it in a test would silently read/write your actual
Postgres database instead of the isolated in-memory one (see the warning
at the top of `test_microsoft_oauth.py` about exactly this mistake). Instead,
tests call `_send_activity_followup_reminders(db)` — the `_`-prefixed
pure-logic function that takes the test's own `db` fixture session directly,
no monkeypatching needed. Apply the same entry-point/`_`-logic split to any
new scheduled job so it stays testable this way.

Covers: due-today vs. due-tomorrow notification wording/type, resolving
`assigned_to` (free text) to a real user by case-insensitive name match,
falling back to the activity's creator when there's no match (or the field
is blank), skipping non-`"Open"` activities and activities not yet due, the
organization name appearing in the message body, and no duplicate
notification if the job is invoked twice on the same day.

---

## Continuous Learning

- Read existing tests in `app/tests/`
- Check pytest [documentation](https://docs.pytest.org/)
- Look at test patterns for similar features
- Study Microsoft OAuth tests for mocking examples
