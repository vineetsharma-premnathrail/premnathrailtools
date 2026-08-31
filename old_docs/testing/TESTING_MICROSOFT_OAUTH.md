# Testing Microsoft OAuth Authentication

How to test that users are logging in via Microsoft SSO correctly.

## Overview

Microsoft OAuth has 3 steps:
1. **Redirect to Microsoft** — User clicks "Login with Microsoft"
2. **Microsoft authenticates user** — User enters credentials
3. **Redirect back to app** — App gets authorization code, exchanges for token, creates user

We test all 3 steps.

---

## Test Types

### 1. Unit Tests (Mocked)

**What:** Test each function in isolation
**When:** Always — fast, don't need real Microsoft account
**How:** Mock Microsoft API responses
**File:** `app/tests/test_microsoft_oauth.py`

---

### 2. Integration Tests (Real Microsoft)

**What:** Test full flow with real Microsoft account
**When:** Before deployment to production
**How:** Use real Azure AD app + test account
**File:** `app/tests/integration/test_oauth_real.py` (manual)

---

## Running Unit Tests

### Run all OAuth tests

```bash
pytest app/tests/test_microsoft_oauth.py -v
```

### Run specific test

```bash
pytest app/tests/test_microsoft_oauth.py::test_oauth_callback_creates_new_user -v
```

### Run with output (see print statements)

```bash
pytest app/tests/test_microsoft_oauth.py -v -s
```

---

## Understanding the Tests

### Test 1: Microsoft Login Redirect

**What:** Verify `/auth/microsoft-login` redirects to Microsoft

```python
def test_microsoft_login_redirects_to_microsoft(client):
    response = client.get("/auth/microsoft-login", allow_redirects=False)
    assert response.status_code == 302
    assert "login.microsoftonline.com" in response.headers["location"]
```

**Why:** Users must be sent to Microsoft login page

**Passes when:**
- ✅ Status code is 302 (redirect)
- ✅ Redirect URL contains Microsoft domain
- ✅ URL includes client_id (app identifier)
- ✅ URL requests `User.Read` scope

---

### Test 2: OAuth Callback Creates New User

**What:** First-time login creates user in database

```python
@patch('app.modules.main.routes.auth.exchange_code_for_token')
@patch('app.modules.main.routes.auth.get_microsoft_user_profile')
def test_oauth_callback_creates_new_user(mock_get_profile, mock_exchange_code, client, db):
    # Mock Microsoft responses
    mock_exchange_code.return_value = {
        "access_token": "mock-token"
    }
    mock_get_profile.return_value = {
        "id": "azure-123",
        "mail": "john@premnathrail.com",
        "displayName": "John Doe"
    }
    
    # Simulate OAuth callback
    response = client.get("/auth/callback?code=code&state=state")
    
    # Verify user created
    user = db.query(User).filter(User.email == "john@premnathrail.com").first()
    assert user is not None
```

**Why:** New employees should be auto-provisioned

**What's mocked:**
- `exchange_code_for_token()` — Returns fake access token
- `get_microsoft_user_profile()` — Returns fake profile

**Passes when:**
- ✅ User created in database
- ✅ Email matches Microsoft account
- ✅ User is active by default
- ✅ User role is "user" (not admin)
- ✅ JWT token returned

---

### Test 3: OAuth Callback Updates Existing User

**What:** Repeat login updates user profile

```python
def test_oauth_callback_updates_existing_user(...):
    # Create user first
    existing_user = User(email="john@...", name="John Smith")
    db.add(existing_user)
    
    # Simulate second login with updated name
    mock_get_profile.return_value = {
        "displayName": "John Doe (Updated)"
    }
    
    # Verify user updated, not duplicated
    user = db.query(User).filter(User.email == "john@...").first()
    assert user.name == "John Doe (Updated)"
```

**Why:** Profile changes in Azure should sync to app

**Passes when:**
- ✅ User not duplicated (same ID)
- ✅ Profile fields updated
- ✅ No error on repeat login

---

### Test 4: Domain Restriction

**What:** Only @premnathrail.com accounts allowed

```python
def test_oauth_callback_rejects_external_domain(...):
    # External user
    mock_get_profile.return_value = {
        "mail": "hacker@gmail.com"  # ← External!
    }
    
    response = client.get("/auth/callback?code=code&state=state")
    
    # Should reject
    assert response.status_code == 403
    user = db.query(User).filter(User.email == "hacker@gmail.com").first()
    assert user is None
```

**Why:** Security — prevent external accounts from logging in

**Passes when:**
- ✅ Status 403 (Forbidden)
- ✅ User NOT created
- ✅ No token issued

---

### Test 5: JWT Token Validation

**What:** Token returned is valid and usable

```python
def test_oauth_callback_returns_valid_jwt(...):
    response = client.get("/auth/callback?code=code&state=state")
    token = response.json()["access_token"]
    
    # Verify token
    payload = verify_access_token(token)
    assert payload is not None
    assert payload["email"] == "alice@premnathrail.com"
    
    # Use token to access /auth/me
    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
```

**Why:** Token must work for subsequent API calls

**Passes when:**
- ✅ Token is valid (not corrupted)
- ✅ Token contains email and role
- ✅ Can use token to access protected endpoints

---

### Test 6: Protected Endpoint (/auth/me)

**What:** /auth/me requires valid token

```python
def test_get_current_user_requires_valid_token(client):
    # Without token
    response = client.get("/auth/me")
    assert response.status_code == 401
    
    # With invalid token
    response = client.get(
        "/auth/me",
        headers={"Authorization": "Bearer invalid"}
    )
    assert response.status_code == 401
```

**Why:** Prevent unauthorized access

**Passes when:**
- ✅ Status 401 without token
- ✅ Status 401 with invalid token
- ✅ Status 200 with valid token

---

### Test 7: Inactive User Denied

**What:** Disabled users cannot access API

```python
def test_get_current_user_inactive_denied(client, db):
    # Create inactive user
    user = User(
        email="disabled@...",
        is_active=False  # ← Disabled!
    )
    
    # Create token for inactive user
    token = create_access_token({"sub": str(user.id)})
    
    # Try to access /auth/me
    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    # Should deny
    assert response.status_code == 401
```

**Why:** When admin disables a user, they lose access immediately

**Passes when:**
- ✅ Status 401 for inactive users
- ✅ User informed account is inactive

---

## Mocking Explained

### Why mock?

```python
@patch('app.modules.main.routes.auth.get_microsoft_user_profile')
def test_something(mock_get_profile):
    mock_get_profile.return_value = {...}
```

**Mocking replaces function with fake version**
- ✅ Don't need real Microsoft account
- ✅ Tests run instantly (no network calls)
- ✅ Can test error scenarios easily
- ✅ Tests work offline

### Where to patch

```python
# Wrong location (won't work)
@patch('app.auth.microsoft.get_microsoft_user_profile')  # ❌

# Correct location (patch where it's used)
@patch('app.modules.main.routes.auth.get_microsoft_user_profile')  # ✅
```

**Always patch where function is IMPORTED, not where it's DEFINED**

---

## Running All Tests

```bash
# Run all tests
pytest app/tests -v

# Run auth tests only
pytest app/tests/test_auth.py app/tests/test_microsoft_oauth.py -v

# Run with coverage
pytest app/tests --cov=app.modules.main --cov=app.auth

# Run and stop on first failure
pytest app/tests -x

# Run with detailed output
pytest app/tests -vv -s
```

---

## Manual Testing with Real Microsoft

**For before-deployment testing:**

### 1. Get real Microsoft credentials
- Go to [Azure Portal](https://portal.azure.com)
- Azure AD → App registrations → Your app
- Copy Client ID, Secret, Tenant ID
- Put in `.env`

### 2. Test manually via browser

```
1. Open: http://localhost:8000/docs
2. Click: GET /auth/microsoft-login
3. Click: Try it out
4. Click: Execute
5. Browser redirects to Microsoft login
6. Login with real @premnathrail.com account
7. Allow permissions
8. Redirected back with token
9. Check database: User should be created
```

### 3. Verify in database

```bash
# Login to PostgreSQL
psql -U postgres -h localhost -d premnathrail_ideal

# Check user was created
SELECT * FROM users;
```

Should show:
- email = your@premnathrail.com
- name = Your Name
- azure_id = your Azure ID
- is_active = true
- role = user

---

## Debugging Failed Tests

### See what's happening

```python
# Add print statements
def test_something(client):
    response = client.get("/auth/microsoft-login")
    print(f"Status: {response.status_code}")
    print(f"Headers: {response.headers}")
    print(f"Body: {response.json()}")
    assert response.status_code == 302
```

Run with:
```bash
pytest app/tests/test_microsoft_oauth.py::test_something -v -s
```

### Check mock was called

```python
def test_something(mock_get_profile):
    # ... do something ...
    
    # Verify mock was called
    assert mock_get_profile.called
    print(f"Called with: {mock_get_profile.call_args}")
```

### Check database state

```python
def test_something(db):
    # ... do something ...
    
    # Check what's in database
    users = db.query(User).all()
    print(f"Users in DB: {[(u.email, u.name) for u in users]}")
```

---

## CI/CD Integration

Tests run automatically when:
- Pull request created
- Code pushed to main branch
- Before deployment

If tests fail:
- ❌ Cannot merge PR
- ❌ Cannot deploy
- 🔴 Pipeline marked failed

**Must fix failing tests before merging!**

---

## Checklist

- [ ] All unit tests pass (`pytest app/tests/test_microsoft_oauth.py`)
- [ ] All auth tests pass (`pytest app/tests/test_auth.py`)
- [ ] Mock functions work correctly
- [ ] Real Microsoft login works (manual test)
- [ ] Users created correctly
- [ ] Domain restriction works
- [ ] Inactive users denied
- [ ] Tokens valid and usable

---

## References

- [pytest documentation](https://docs.pytest.org/)
- [unittest.mock documentation](https://docs.python.org/3/library/unittest.mock.html)
- [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/)
