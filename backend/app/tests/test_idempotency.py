"""Idempotency-Key (app/middleware/idempotency.py): a save retried after a
network failure replays the first reply instead of saving twice."""
import pytest
from sqlalchemy.orm import sessionmaker

from app.middleware import idempotency
from app.modules.crm.models.organization import Organization
from app.modules.main.models.idempotency_record import IdempotencyRecord
from app.tests.test_crm_org_scope import URL, body, h, make_user


@pytest.fixture(autouse=True)
def _test_sessions(monkeypatch, db):
    # The test database (conftest's engine), never the real one.
    monkeypatch.setattr(idempotency, "session_factory", sessionmaker(bind=db.get_bind(), autoflush=False))


def _post(client, u, key, **kw):
    return client.post(URL, json=body(**kw), headers={**h(u), "Idempotency-Key": key})


def test_retry_with_same_key_is_not_saved_twice(client, db):
    u = make_user(db, "idem_a@premnathrail.com")
    first = _post(client, u, "key-aaaa-0001", name="Idem Org")
    assert first.status_code == 201, first.text
    again = _post(client, u, "key-aaaa-0001", name="Idem Org")
    assert again.status_code == 201 and again.headers.get("idempotent-replayed") == "true"
    assert again.json()["id"] == first.json()["id"]
    assert db.query(Organization).filter(Organization.name == "Idem Org").count() == 1


def test_failed_save_frees_the_key(client, db):
    u = make_user(db, "idem_b@premnathrail.com")
    bad = _post(client, u, "key-bbbb-0001", name="Idem Fixed", org_scope="")
    assert bad.status_code == 422
    assert db.query(IdempotencyRecord).filter_by(idem_key="key-bbbb-0001").count() == 0
    ok = _post(client, u, "key-bbbb-0001", name="Idem Fixed")
    assert ok.status_code == 201, ok.text


def test_keys_are_per_user_and_new_key_saves_again(client, db):
    a = make_user(db, "idem_c@premnathrail.com")
    b = make_user(db, "idem_d@premnathrail.com")
    assert _post(client, a, "key-cccc-0001", name="Idem A").status_code == 201
    r = _post(client, b, "key-cccc-0001", name="Idem B")
    assert r.status_code == 201 and r.headers.get("idempotent-replayed") is None and r.json()["name"] == "Idem B"


def test_in_progress_and_bad_keys(client, db):
    u = make_user(db, "idem_e@premnathrail.com")
    db.add(IdempotencyRecord(user_key=f"u{u.id}", idem_key="key-eeee-0001", method="POST", path=URL, state="in_progress"))
    db.commit()
    r = _post(client, u, "key-eeee-0001", name="Idem Busy")
    assert r.status_code == 409 and r.json()["code"] == "idempotency_in_progress"
    assert _post(client, u, "bad key!", name="Idem Bad").status_code == 400
    other_path = client.patch(f"{URL}/1", json={"name": "x"}, headers={**h(u), "Idempotency-Key": "key-eeee-0001"})
    assert other_path.status_code == 422


def test_no_header_behaves_as_before(client, db):
    u = make_user(db, "idem_f@premnathrail.com")
    assert client.post(URL, json=body(name="Idem Plain"), headers=h(u)).status_code == 201
    assert db.query(IdempotencyRecord).count() == 0


def test_stale_in_progress_key_lets_the_retry_run(client, db):
    from datetime import datetime, timedelta, timezone
    u = make_user(db, "idem_g@premnathrail.com")
    db.add(IdempotencyRecord(user_key=f"u{u.id}", idem_key="key-gggg-0001", method="POST", path=URL, state="in_progress",
                             created_at=datetime.now(timezone.utc) - timedelta(minutes=10)))
    db.commit()
    r = _post(client, u, "key-gggg-0001", name="Idem Stale")
    assert r.status_code == 201, r.text
