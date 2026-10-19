"""A01 — record-ID guessing is caught per account (middleware/owasp.py
OBJECT_DENIAL_*), including for @company users who skip the per-IP limits."""
from app.auth.jwt_handler import create_access_token
from app.middleware import owasp
from app.modules.main.models.user import User


def make_user(db, email):
    user = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=["erp"])
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_walking_record_ids_pauses_only_that_account(client, db):
    prober = make_user(db, "prober@premnathrail.com")
    colleague = make_user(db, "colleague@premnathrail.com")

    for record_id in range(90001, 90001 + owasp.OBJECT_DENIAL_LIMIT):
        r = client.get(f"/api/v1/erp/projects/{record_id}", headers=auth_header(prober))
        assert r.status_code in (403, 404)

    paused = client.get("/api/v1/erp/projects", headers=auth_header(prober))
    assert paused.status_code == 429
    assert "record IDs being guessed" in paused.json()["detail"]
    assert paused.headers["Retry-After"] == str(owasp.OBJECT_PAUSE_SECONDS)

    # Same office IP, different account — unaffected.
    assert client.get("/api/v1/erp/projects", headers=auth_header(colleague)).status_code != 429


def test_repeat_misses_on_one_record_count_once(client, db):
    user = make_user(db, "refresher@premnathrail.com")
    # A page polling one deleted record, plus its sub-resources, is one record.
    for _ in range(owasp.OBJECT_DENIAL_LIMIT + 5):
        client.get("/api/v1/erp/projects/90001", headers=auth_header(user))
        client.get("/api/v1/erp/projects/90001/audit", headers=auth_header(user))
    assert client.get("/api/v1/erp/projects", headers=auth_header(user)).status_code != 429
