"""Security/validation coverage for /api/v1/rnd/history/* (review finding
C-01 / P1-RND-1..3): the history endpoints are gated on the "rnd" app,
tool_name is restricted to the seven real calculators, and an oversized
payload is rejected with a readable error."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User


def _user(db, email, apps=None, role="user"):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=apps if apps is not None else ["rnd"],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _h(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def _save(client, user, **overrides):
    body = {"tool_name": "braking", "inputs": {"a": 1}, "results": {"b": 2}}
    body.update(overrides)
    return client.post("/api/v1/rnd/history/save", json=body, headers=_h(user))


def test_history_endpoints_require_rnd_app(client, db):
    outsider = _user(db, "hist-outsider@premnathrail.com", apps=["erp"])
    assert _save(client, outsider).status_code == 403
    assert client.get("/api/v1/rnd/history/list", headers=_h(outsider)).status_code == 403
    assert client.get("/api/v1/rnd/history/detail/1", headers=_h(outsider)).status_code == 403
    assert client.delete("/api/v1/rnd/history/delete/1", headers=_h(outsider)).status_code == 403
    assert client.patch(
        "/api/v1/rnd/history/rename/1", json={"name": "x"}, headers=_h(outsider),
    ).status_code == 403


def test_history_lost_rnd_access_cannot_read_own_old_rows(client, db):
    user = _user(db, "hist-revoked@premnathrail.com")
    saved = _save(client, user).json()
    user.assigned_apps = ["erp"]
    db.commit()
    resp = client.get(f"/api/v1/rnd/history/detail/{saved['id']}", headers=_h(user))
    assert resp.status_code == 403


def test_history_admin_without_rnd_assignment_still_allowed(client, db):
    admin = _user(db, "hist-admin@premnathrail.com", apps=[], role="admin")
    assert _save(client, admin).status_code == 200
    assert client.get("/api/v1/rnd/history/admin/list", headers=_h(admin)).status_code == 200


def test_history_unknown_tool_name_is_rejected(client, db):
    user = _user(db, "hist-badtool@premnathrail.com")
    assert _save(client, user, tool_name="not_a_tool").status_code == 422
    assert client.get(
        "/api/v1/rnd/history/list?tool_name=not_a_tool", headers=_h(user),
    ).status_code == 422


def test_history_accepts_every_real_tool_name(client, db):
    user = _user(db, "hist-alltools@premnathrail.com")
    for tool in ("braking", "hydraulic", "qmax", "load_distribution",
                 "tractive_effort", "vehicle_performance", "spline"):
        assert _save(client, user, tool_name=tool).status_code == 200, tool


def test_history_oversize_payload_is_rejected_with_real_message(client, db):
    user = _user(db, "hist-big@premnathrail.com")
    resp = _save(client, user, inputs={"blob": "x" * (250 * 1024)})
    assert resp.status_code == 413
    detail = resp.json()["detail"]
    assert "Calculation history entry is too large" in detail
    assert "limit 200 KB" in detail
    assert client.get("/api/v1/rnd/history/list", headers=_h(user)).json() == []


def test_history_other_users_rows_stay_private(client, db):
    alice = _user(db, "hist-alice@premnathrail.com")
    bob = _user(db, "hist-bob@premnathrail.com")
    saved = _save(client, alice).json()
    assert client.delete(f"/api/v1/rnd/history/delete/{saved['id']}", headers=_h(bob)).status_code == 403
    assert client.patch(
        f"/api/v1/rnd/history/rename/{saved['id']}", json={"name": "hijack"}, headers=_h(bob),
    ).status_code == 403


SPLINE_PAYLOAD = {
    "calc_mode": "calc_spline", "number_teeth": "20", "diametral_pitch": "10",
    "pressure_angle": "30", "outer_diameter": "55", "inner_diameter": "50",
    "length_engagement": "40", "yield_strength": "800", "material_type": "EN24",
    "loco_weight": "20000", "number_axles": "2", "wheels_per_axle": "2",
    "speed": "30", "wheel_diameter": "730", "friction_coeff": "0.3",
}


def test_spline_report_failure_hides_exception_text(client, db, monkeypatch):
    # P1-RND: a LaTeX failure used to return str(exc) (file paths, compiler
    # output) to the client. Now it logs server-side and returns a clear message.
    from app.modules.rnd.tools.spline import api as spline_api

    def boom(*_a, **_kw):
        raise RuntimeError("pdflatex failed: /app/secret/path.tex line 42")

    monkeypatch.setattr(spline_api, "generate_spline_pdf", boom)
    user = _user(db, "spline-fail@premnathrail.com")
    resp = client.post("/api/v1/rnd/tools/spline/report", json=SPLINE_PAYLOAD, headers=_h(user))
    assert resp.status_code == 500
    body = resp.json()
    assert "Couldn't build the spline report PDF" in body["detail"]
    assert "/app/secret" not in resp.text and "pdflatex failed" not in resp.text
