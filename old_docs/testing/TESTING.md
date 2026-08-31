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
│                                     partial/full receiving, closing, item remarks, and
│                                     that item photos are view-only (uploaded via the ERP
│                                     route, no purchase-side upload/delete route exists) —
│                                     see ARCHITECTURE.md#purchase-module for the lifecycle
├── test_p2p_requests.py            # The standalone `p2p` module end-to-end:
│                                     any department raising a PR directly (not derived from
│                                     SR materials), category/requirement/approver workflow,
│                                     priority/required-by/reason fields, attachments, item
│                                     remarks/budget/model fields — entirely separate models/
│                                     routes from test_purchase_requisitions.py above
├── test_crm.py                    # Organizations/Inquiries/Tenders CRUD, stage logging,
│                                     duplicate-prevention, cascade delete/restore, permissions
├── test_crm_documents.py          # SharePoint-backed document upload/list/delete —
│                                     mocks upload_file_to_sharepoint/delete_file_from_sharepoint
│                                     via monkeypatch rather than hitting Microsoft Graph
├── test_crm_activities.py         # Activity list/create response enrichment (contact_names,
│                                     related_label) and the Organization Activities tab's
│                                     org_id-vs-stale-snapshot regression — see
│                                     ARCHITECTURE.md's "Why the Organization's Activities tab
│                                     joins through Inquiry/Tender"
├── test_crm_activity_attachments.py  # Activity photo gallery upload/list/delete — same
│                                        SharePoint-mocking pattern as test_crm_documents.py
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

## Test Strategy — What "Unit" vs "Integration" vs "E2E" Actually Means Here

**Honesty check:** `backend/app/tests/` contains three empty subfolders —
`e2e/`, `integration/`, `unit/`. No test files live in them. They appear to be
scaffolding left over from an earlier plan for a nested structure that was
never followed through on; every real test lives flat under
`backend/app/tests/*.py` as listed in the tree above. Don't be misled by
their presence into thinking there's an enforced layering — there isn't.
If you want that split to actually exist, it needs someone to either move
tests into those folders or delete the folders; until then, treat this
section as the honest description of what's there, not the empty dirs.

In practice, almost every test in this codebase is what most teams would
call an **integration test**: it goes through `client` (a real `TestClient`
wrapping the full FastAPI `app`, middleware included) and a real (in-memory
SQLite) database, exercising route → auth → service/model → DB → response
in one shot. There is no separate repository/service layer in this codebase
to unit-test in isolation (see `ARCHITECTURE.md#module-structure`), so
"unit tests" here mostly means tests of a single model method or pure
function with the `db` fixture but no HTTP call — e.g. `test_user_model.py`
(`User.get_apps()` logic) and `test_rnd_latex_escaping.py` (a pure string
function). `test_followup_reminders.py` is the closest thing to a scheduled-
job/"service layer" unit test — see the dedicated section below.

There are no true end-to-end tests in the sense of "spin up the real Next.js
frontend and click through it" (no Playwright/Cypress in this repo — see
`grep -r playwright cypress` returning nothing). "E2E" here would describe a
backend test that chains multiple requests into one user workflow (e.g.
create → approve → receive a purchase requisition in
`test_purchase_requisitions.py`), but no folder or naming convention
distinguishes those from single-request integration tests today.

**Where things actually stand, plainly:**
- **Unit-ish:** `test_user_model.py`, `test_rnd_latex_escaping.py`
- **Integration (the large majority):** everything else — single or few
  HTTP calls through `client` against the in-memory DB
- **Multi-step workflow tests (informally "e2e"):** the request-lifecycle
  tests inside `test_purchase_requisitions.py`, `test_teams_sso.py`
  (token → session → replay), and `test_security_middleware.py`'s
  violation-count → ban sequence
- **`e2e/`, `integration/`, `unit/` subfolders:** empty, not used

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

**Correction:** there is currently no CI pipeline in this repo — `.github/workflows/`
does not exist, and no GitLab CI config was found either. Tests are **not** run
automatically on commits or PRs today; running `pytest app/tests` is a manual
step a developer has to remember to do before merging. If you want tests to
gate merges, that requires adding a workflow file — it isn't there yet.

---

## Test Case Inventory

Ground truth from `pytest --collect-only -q` against `backend/app/tests/` on
2026-08-14: **260 tests collected**, 0 errors. Counts below are exact
(from collect-only), not estimates.

| File | Covers | Tests | Notes |
|---|---|---|---|
| `test_p2p_requests.py` | The standalone `p2p` module end-to-end (any department raising a PR directly, category/requirement/approver workflow, priority/required-by/reason, attachments, item remarks/budget/model) | 49 | Largest file — added after the module's initial buildout; closes the coverage gap previously flagged for this module (see below) |
| `test_erp_projects.py` | ERP Projects CRUD, attachments, permissions | 22 | Largest ERP file; includes private-attachment access rules |
| `test_security_middleware.py` | `OWASPMiddleware` — auth precheck, injection/SSRF/path-traversal blocking, rate limiting, IP bans, security headers, API keys | 19 | See dedicated section below |
| `test_users.py` | User admin CRUD, role changes, ERP permission grants, Azure sync | 17 | |
| `test_erp_service_requests.py` | ERP Service Requests CRUD, materials, permissions | 17 | |
| `test_purchase_requisitions.py` | **ERP-module** PR lifecycle: raise from SR materials, approve/reject/cancel, partial/full receiving, item remarks/photos | 16 | Tests `app.modules.erp...`, not the new `p2p` module — see gap note below |
| `test_rnd.py` | R&D module core routes | 15 | |
| `test_microsoft_oauth.py` | Microsoft login/callback, auto-create user, domain restriction, JWT | 14 | See `TESTING_MICROSOFT_OAUTH.md` |
| `test_crm.py` | Organizations/Inquiries/Tenders CRUD, stage logging, dup-prevention, cascade delete/restore | 12 | |
| `test_feedback.py` | Feedback submission/listing | 11 | |
| `test_teams_sso.py` | `/auth/teams-token`, `/auth/teams-exchange` — audience/issuer/replay checks, OBO | 10 | Unsigned-JWT technique, see section below |
| `test_rnd_tool_snapshots.py` | R&D tool calculation snapshot table | 9 | |
| `test_followup_reminders.py` | Scheduled activity follow-up reminder job | 9 | Not a route test, see dedicated section |
| `test_user_model.py` | `User.get_apps()` logic, uniqueness constraints | 7 | Closest thing to a true unit test |
| `test_crm_documents.py` | SharePoint-backed CRM document upload/list/delete (mocked) | 6 | |
| `test_crm_activity_attachments.py` | Activity photo gallery (mocked SharePoint) | 5 | |
| `test_audit_logs.py` | Audit log writes/queries | 5 | |
| `test_presence.py` | "Who's viewing this" heartbeat/viewer list | 4 | |
| `test_notifications.py` | In-app notifications | 4 | |
| `test_auth.py` | Base auth/health checks | 4 | |
| `test_rnd_latex_escaping.py` | Pure LaTeX-escaping helper function | 3 | Unit test, no `client`/`db` |
| `test_crm_activities.py` | Activity list/create response enrichment | 2 | Thin — only 2 tests for an area with known org_id/stale-snapshot regressions (see `ARCHITECTURE.md`) |

### API / Integration Tests
The bulk of the table above — anything going through the `client` fixture
against a real route — is what this repo's "integration test" means in
practice (see Test Strategy above). Every ERP, CRM, purchase, R&D, users,
and auth file falls in this bucket.

### Security Tests
`test_security_middleware.py` (19 tests) is the dedicated security suite. It
asserts, through real HTTP requests (not by calling middleware internals
directly):
- Unauthenticated API requests get `401` before reaching the route; public
  auth routes (e.g. `microsoft-login`) bypass that precheck.
- Path traversal, SQL injection (query string and JSON body), and XSS
  `<script>` payloads in requests are rejected with `400`.
- An ordinary request containing an innocuous word like "Select" is **not**
  falsely flagged (regression guard against overly broad injection regexes).
- SSRF: private-IP query params are blocked; public URLs are not.
- Bulk-delete guardrails: collection delete without an id, and bulk id-list
  query params, are blocked.
- Rate limiting kicks in after a threshold, and repeated violations trigger
  an IP ban (with a documented one-request offset — the request that trips
  the ban is still answered with the error that caused it; the ban itself
  starts on the *next* request).
- Standard security headers are present on responses.
- API-key auth: a valid key authenticates like a user, an inactive key is
  rejected, keys are scoped to their allowed apps, and only admins can
  issue/list API keys.

### Coverage Gaps Worth Flagging
- ~~`p2p` module has zero dedicated tests~~ — **resolved.**
  `test_p2p_requests.py` (49 tests) now covers the standalone
  `backend/app/modules/p2p/` module end-to-end (it remains
  entirely separate from the ERP-embedded purchase flow that
  `test_purchase_requisitions.py`'s 16 tests cover — the two files test two
  different modules with no model/route overlap).
- `test_crm_activities.py` (2 tests) and `test_rnd_latex_escaping.py` (3
  tests) are thin relative to the surface area they touch.
- No tests reference `app/modules/purchase/service.py`'s notification or
  SharePoint helpers directly, beyond what's exercised incidentally through
  `test_purchase_requisitions.py`.
- `backend/app/modules/{crm,main,rnd,service}/tests/` also exist as empty
  directories — same situation as `app/tests/{unit,integration,e2e}/`, likely
  leftover scaffolding, not an active convention.
- No frontend test suite was found (no Jest/Vitest/Playwright config under
  `frontend/`), so none of the Next.js pages/components listed in the
  working tree's current diff have any automated coverage.

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
- 14 tests (per `pytest --collect-only`, corrected from an earlier "8" here) covering:
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
