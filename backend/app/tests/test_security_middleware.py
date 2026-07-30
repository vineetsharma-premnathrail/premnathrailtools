from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.main.models.api_key import APIKey
from app.middleware.api_key import generate_api_key
from app.middleware.owasp import get_rate_store


def make_user(db, email, role="user", erp_permissions=None):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=["erp"], erp_permissions=erp_permissions or [],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


# ── A01: auth pre-check ──────────────────────────────────────────────────────

def test_unauthenticated_api_request_rejected_before_reaching_route(client):
    response = client.get("/api/v1/erp/projects")
    assert response.status_code == 401


def test_public_auth_routes_bypass_auth_precheck(client):
    # microsoft-login redirects to Microsoft — it must not 401 first.
    response = client.get("/api/v1/auth/microsoft-login", follow_redirects=False)
    assert response.status_code in (302, 307)


# ── A03: injection detection ─────────────────────────────────────────────────

def test_path_traversal_in_url_is_blocked(client, db):
    user = make_user(db, "sec1@premnathrail.com")
    response = client.get("/api/v1/erp/projects?search=../../etc/passwd", headers=auth_header(user))
    assert response.status_code == 400


def test_sqli_in_query_string_is_blocked(client, db):
    user = make_user(db, "sec2@premnathrail.com")
    response = client.get("/api/v1/erp/projects?search=1' UNION SELECT * FROM users--", headers=auth_header(user))
    assert response.status_code == 400


def test_xss_script_tag_in_query_is_blocked(client, db):
    user = make_user(db, "sec3@premnathrail.com")
    response = client.get("/api/v1/erp/projects?search=<script>alert(1)</script>", headers=auth_header(user))
    assert response.status_code == 400


def test_sqli_in_json_body_is_blocked(client, db):
    user = make_user(db, "sec4@premnathrail.com")
    response = client.post(
        "/api/v1/erp/projects",
        json={"serial_number": "1'; DROP TABLE users; --"},
        headers=auth_header(user),
    )
    assert response.status_code == 400


def test_ordinary_request_is_not_blocked_by_injection_scan(client, db):
    user = make_user(db, "sec5@premnathrail.com", erp_permissions=["project_create"])
    response = client.post(
        "/api/v1/erp/projects",
        json={"serial_number": "SN-SEC-1", "model_name": "Model Select 9000"},
        headers=auth_header(user),
    )
    # "Select" appears in ordinary product names — must not be treated as SQLi.
    assert response.status_code == 201


# ── A10: SSRF ─────────────────────────────────────────────────────────────────

def test_ssrf_private_ip_in_query_param_is_blocked(client, db):
    user = make_user(db, "sec6@premnathrail.com")
    response = client.get("/api/v1/erp/projects?search=http://169.254.169.254/latest/meta-data", headers=auth_header(user))
    assert response.status_code == 400


def test_public_url_in_query_param_is_not_blocked(client, db):
    user = make_user(db, "sec7@premnathrail.com")
    response = client.get("/api/v1/erp/projects?search=http://example.com/page", headers=auth_header(user))
    assert response.status_code == 200


# ── Bulk-delete protection ───────────────────────────────────────────────────

def test_collection_delete_without_id_is_blocked(client, db):
    user = make_user(db, "sec8@premnathrail.com")
    response = client.delete("/api/v1/erp/projects", headers=auth_header(user))
    assert response.status_code in (404, 405)  # route doesn't exist OR middleware blocks it — never a real bulk delete


def test_bulk_id_list_query_param_is_blocked(client, db):
    user = make_user(db, "sec9@premnathrail.com", role="admin")
    response = client.delete("/api/v1/erp/projects/1?ids=1,2,3", headers=auth_header(user))
    assert response.status_code == 400


# ── A07: rate limiting + IP ban ──────────────────────────────────────────────

def test_rate_limit_blocks_after_threshold(client, db):
    store = get_rate_store()
    store.reset()
    user = make_user(db, "sec10@premnathrail.com")
    # "default" bucket (GET) limit is 200/min — well beyond normal test traffic,
    # so exercise the store directly to keep this test fast and deterministic.
    for _ in range(200):
        assert store.is_rate_limited("default:testclient", 200, 60) is False
    assert store.is_rate_limited("default:testclient", 200, 60) is True


def test_repeated_violations_trigger_ip_ban(client, db):
    store = get_rate_store()
    store.reset()
    user = make_user(db, "sec11@premnathrail.com")
    # Each blocked injection attempt records a violation; the 10th trips the
    # ban (but is itself still answered as the 400 that caused it) — the ban
    # only takes effect starting with the request after that.
    for _ in range(10):
        response = client.get("/api/v1/erp/projects?search=<script>x</script>", headers=auth_header(user))
        assert response.status_code == 400
    banned_response = client.get("/api/v1/erp/projects?search=<script>x</script>", headers=auth_header(user))
    assert banned_response.status_code == 429

    # Now even a perfectly valid request from the same (test) IP is banned.
    response = client.get("/api/v1/erp/projects", headers=auth_header(user))
    assert response.status_code == 429
    store.reset()


# ── Security response headers ────────────────────────────────────────────────

def test_security_headers_present_on_response(client, db):
    user = make_user(db, "sec12@premnathrail.com")
    response = client.get("/api/v1/erp/projects", headers=auth_header(user))
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert "Strict-Transport-Security" in response.headers
    assert response.headers.get("Content-Security-Policy") == "default-src 'none'"
    assert response.headers.get("Cache-Control", "").startswith("no-store")
    assert "X-Request-ID" in response.headers
    assert "server" not in response.headers


# ── API key authentication ───────────────────────────────────────────────────

def test_api_key_authenticates_like_a_user(client, db):
    raw_key, key_hash = generate_api_key()
    db.add(APIKey(name="integration-bot", key_hash=key_hash, prefix=raw_key[:12], allowed_apps=["erp"], is_active=True))
    db.commit()

    response = client.get("/api/v1/erp/projects", headers={"X-API-Key": raw_key})
    assert response.status_code == 200


def test_inactive_api_key_is_rejected(client, db):
    raw_key, key_hash = generate_api_key()
    db.add(APIKey(name="revoked-bot", key_hash=key_hash, prefix=raw_key[:12], allowed_apps=["erp"], is_active=False))
    db.commit()

    response = client.get("/api/v1/erp/projects", headers={"X-API-Key": raw_key})
    assert response.status_code == 401


def test_api_key_scoped_to_allowed_apps_only(client, db):
    raw_key, key_hash = generate_api_key()
    db.add(APIKey(name="crm-only-bot", key_hash=key_hash, prefix=raw_key[:12], allowed_apps=["crm"], is_active=True))
    db.commit()

    response = client.get("/api/v1/erp/projects", headers={"X-API-Key": raw_key})
    assert response.status_code == 403


def test_admin_can_issue_and_list_api_keys(client, db):
    admin = make_user(db, "sec_admin@premnathrail.com", role="admin")
    response = client.post(
        "/api/v1/api-keys",
        json={"name": "reporting-tool", "allowed_apps": ["erp"]},
        headers=auth_header(admin),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["api_key"].startswith("pew_")

    listing = client.get("/api/v1/api-keys", headers=auth_header(admin)).json()
    assert any(k["name"] == "reporting-tool" for k in listing)
    # The raw key/hash must never be exposed in the list endpoint.
    assert all("api_key" not in k and "key_hash" not in k for k in listing)


def test_non_admin_cannot_issue_api_keys(client, db):
    user = make_user(db, "sec_notadmin@premnathrail.com")
    response = client.post(
        "/api/v1/api-keys",
        json={"name": "sneaky-tool", "allowed_apps": ["erp"]},
        headers=auth_header(user),
    )
    assert response.status_code == 403
