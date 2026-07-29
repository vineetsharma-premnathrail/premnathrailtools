"""
Tests for the R&D module (backend/app/modules/rnd) — ported from legacy's
app/api/v1/rnd/*: seven stateless calculation tools (braking, hydraulic, qmax,
load_distribution, tractive_effort, vehicle_performance, spline) mounted under
/api/v1/rnd/tools/<name>/*, plus a shared cross-tool save/rename/list/delete
history log at /api/v1/rnd/history/*.

The tools themselves do no DB access — every route requires only
`require_app_access("rnd")`. History is the only part that touches the
database, and is shared across all seven tools via `tool_name`.
"""
from app.modules.main.models.user import User
from app.modules.rnd.models.calculation_history import CalculationHistory
from app.auth.jwt_handler import create_access_token

BRAKING_PAYLOAD = {
    "mass_kg": 5000, "reaction_time": 1.5, "num_wheels": 4, "calc_mode": "Rail",
    "rail_speed_input": "10,20,30", "rail_gradient_input": "0,1,2",
    "rail_gradient_type": "Percentage (%)", "mu": 0.7,
}

QMAX_PAYLOAD = {"d": "800", "sigma_b_selection": "custom", "sigma_b_custom": "600", "v_head": "1.5"}


def make_user(db, email, assigned_apps=None, role="user"):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=assigned_apps if assigned_apps is not None else ["rnd"],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


# ── Access control ────────────────────────────────────────────────────────

def test_rnd_tool_requires_rnd_app_access(client, db):
    user = make_user(db, "no-rnd@premnathrail.com", assigned_apps=["erp"])
    response = client.post(
        "/api/v1/rnd/tools/braking/braking_calculate",
        json=BRAKING_PAYLOAD,
        headers=auth_header(user),
    )
    assert response.status_code == 403


def test_rnd_tool_requires_auth(client):
    response = client.post("/api/v1/rnd/tools/braking/braking_calculate", json=BRAKING_PAYLOAD)
    assert response.status_code == 401


def test_admin_bypasses_rnd_app_check(client, db):
    admin = make_user(db, "admin-rnd@premnathrail.com", assigned_apps=[], role="admin")
    response = client.post(
        "/api/v1/rnd/tools/qmax/calculate", json=QMAX_PAYLOAD, headers=auth_header(admin),
    )
    assert response.status_code == 200


# ── Braking tool (calculate + PDF) ───────────────────────────────────────────

def test_braking_calculate_returns_rows_and_summary(client, db):
    user = make_user(db, "braking@premnathrail.com")
    response = client.post(
        "/api/v1/rnd/tools/braking/braking_calculate", json=BRAKING_PAYLOAD, headers=auth_header(user),
    )
    assert response.status_code == 200
    body = response.json()
    assert "rows" in body and len(body["rows"]) > 0
    assert "gbr" in body and "max_force" in body


def test_braking_pdf_report_generates_a_real_pdf(client, db):
    user = make_user(db, "braking-pdf@premnathrail.com")
    response = client.post(
        "/api/v1/rnd/tools/braking/braking_report_pdf", json=BRAKING_PAYLOAD, headers=auth_header(user),
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


# ── Qmax tool ────────────────────────────────────────────────────────────────

def test_qmax_calculate(client, db):
    user = make_user(db, "qmax@premnathrail.com")
    response = client.post("/api/v1/rnd/tools/qmax/calculate", json=QMAX_PAYLOAD, headers=auth_header(user))
    assert response.status_code == 200
    assert "status" in response.json() or len(response.json()) > 0


# ── History (shared across all tools) ────────────────────────────────────────

def test_history_save_auto_names_sequentially_per_tool(client, db):
    user = make_user(db, "hist1@premnathrail.com")
    first = client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "braking", "inputs": {"a": 1}, "results": {"b": 2}},
        headers=auth_header(user),
    )
    second = client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "braking", "inputs": {"a": 1}, "results": {"b": 2}},
        headers=auth_header(user),
    )
    assert first.json()["calculation_name"] == "Braking #1"
    assert second.json()["calculation_name"] == "Braking #2"


def test_history_save_respects_explicit_name(client, db):
    user = make_user(db, "hist2@premnathrail.com")
    response = client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "qmax", "inputs": {}, "results": {}, "calculation_name": "My Custom Run"},
        headers=auth_header(user),
    )
    assert response.json()["calculation_name"] == "My Custom Run"


def test_history_list_is_scoped_to_caller_and_filterable_by_tool(client, db):
    alice = make_user(db, "alice-hist@premnathrail.com")
    bob = make_user(db, "bob-hist@premnathrail.com")

    client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "braking", "inputs": {}, "results": {}},
        headers=auth_header(alice),
    )
    client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "spline", "inputs": {}, "results": {}},
        headers=auth_header(alice),
    )
    client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "braking", "inputs": {}, "results": {}},
        headers=auth_header(bob),
    )

    alice_all = client.get("/api/v1/rnd/history/list", headers=auth_header(alice)).json()
    assert len(alice_all) == 2

    alice_braking = client.get("/api/v1/rnd/history/list?tool_name=braking", headers=auth_header(alice)).json()
    assert len(alice_braking) == 1
    assert alice_braking[0]["tool_name"] == "braking"


def test_history_detail_denies_other_users(client, db):
    alice = make_user(db, "alice-detail@premnathrail.com")
    bob = make_user(db, "bob-detail@premnathrail.com")

    saved = client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "braking", "inputs": {"x": 1}, "results": {"y": 2}},
        headers=auth_header(alice),
    ).json()

    own = client.get(f"/api/v1/rnd/history/detail/{saved['id']}", headers=auth_header(alice))
    assert own.status_code == 200
    assert own.json()["inputs"] == {"x": 1}

    other = client.get(f"/api/v1/rnd/history/detail/{saved['id']}", headers=auth_header(bob))
    assert other.status_code == 403


def test_admin_can_view_any_users_history_detail(client, db):
    alice = make_user(db, "alice-admin-view@premnathrail.com")
    admin = make_user(db, "admin-view@premnathrail.com", role="admin")

    saved = client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "qmax", "inputs": {"x": 1}, "results": {}},
        headers=auth_header(alice),
    ).json()

    response = client.get(f"/api/v1/rnd/history/detail/{saved['id']}", headers=auth_header(admin))
    assert response.status_code == 200


def test_history_rename(client, db):
    user = make_user(db, "rename@premnathrail.com")
    saved = client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "braking", "inputs": {}, "results": {}},
        headers=auth_header(user),
    ).json()

    response = client.patch(
        f"/api/v1/rnd/history/rename/{saved['id']}",
        json={"calculation_name": "Renamed Run"},
        headers=auth_header(user),
    )
    assert response.status_code == 200
    assert response.json()["calculation_name"] == "Renamed Run"


def test_history_delete_removes_record(client, db):
    user = make_user(db, "delete@premnathrail.com")
    saved = client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "braking", "inputs": {}, "results": {}},
        headers=auth_header(user),
    ).json()

    response = client.delete(f"/api/v1/rnd/history/delete/{saved['id']}", headers=auth_header(user))
    assert response.status_code == 200

    follow_up = client.get(f"/api/v1/rnd/history/detail/{saved['id']}", headers=auth_header(user))
    assert follow_up.status_code == 404


def test_admin_list_and_users_endpoints_require_admin(client, db):
    user = make_user(db, "notadmin-hist@premnathrail.com")
    assert client.get("/api/v1/rnd/history/admin/list", headers=auth_header(user)).status_code == 403
    assert client.get("/api/v1/rnd/history/admin/users", headers=auth_header(user)).status_code == 403


def test_admin_list_shows_all_users_history(client, db):
    alice = make_user(db, "alice-admin-list@premnathrail.com")
    admin = make_user(db, "admin-list@premnathrail.com", role="admin")

    client.post(
        "/api/v1/rnd/history/save",
        json={"tool_name": "hydraulic", "inputs": {}, "results": {}},
        headers=auth_header(alice),
    )

    response = client.get("/api/v1/rnd/history/admin/list", headers=auth_header(admin))
    assert response.status_code == 200
    body = response.json()
    assert any(r["user_email"] == "alice-admin-list@premnathrail.com" for r in body)
