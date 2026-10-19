"""Production default (settings.DEFAULT_DATA_SCOPE = "assigned"): with no data
access set on any role, changing the record id in the URL to a colleague's
record is refused; admins and explicitly widened roles still open it."""
import pytest

from app.core.config import settings
from app.modules.main.models.role import Role
from app.tests.test_crm_data_scope import API, FULL, _auth, _seed, _user


@pytest.fixture(autouse=True)
def _production_default(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")


def test_unset_scope_refuses_a_colleagues_record_by_id(client, db):
    alice, bob, rows = _seed(db)
    # Alice is BD owner on an inquiry of Bob's org, so she legitimately sees it;
    # Carol has nothing of Bob's.
    carol = _user(db, "ds.carol@premnathrail.com", "Carol Das")
    h = _auth(carol)
    r = client.get(f"{API}/organizations/{rows[bob.id]['org']}/detail", headers=h)
    assert r.status_code == 403
    assert "Own + assigned" in r.json()["detail"]
    assert client.get(f"{API}/inquiries/{rows[bob.id]['inq']}", headers=h).status_code == 403
    assert client.get(f"{API}/organizations/{rows[bob.id]['org']}/detail", headers=_auth(bob)).status_code == 200


def test_admin_and_widened_role_still_open_it(client, db):
    alice, bob, rows = _seed(db)
    admin = _user(db, "ds.admin@premnathrail.com", "Admin", role="admin")
    assert client.get(f"{API}/organizations/{rows[bob.id]['org']}/detail", headers=_auth(admin)).status_code == 200

    role = Role(name="CRM everything", permissions=FULL, data_scopes={"crm": "organization"})
    db.add(role)
    db.commit()
    carol = _user(db, "ds.carol2@premnathrail.com", "Carol Das")
    carol.roles = [role]
    db.commit()
    assert client.get(f"{API}/organizations/{rows[bob.id]['org']}/detail", headers=_auth(carol)).status_code == 200


def test_role_editor_reports_the_default(client, db):
    admin = _user(db, "ds.admin2@premnathrail.com", "Admin", role="admin")
    assert client.get("/api/v1/roles/catalog", headers=_auth(admin)).json()["default_scope"] == "assigned"


def test_role_api_stores_organization_scope(client, db):
    admin = _user(db, "ds.admin3@premnathrail.com", "Admin", role="admin")
    h = _auth(admin)
    r = client.post("/api/v1/roles", headers=h, json={
        "name": "CRM all records", "permissions": FULL, "data_scopes": {"crm": "organization", "p2p": ""},
    })
    assert r.status_code in (200, 201), r.text
    role_id = r.json()["id"]
    assert client.get(f"/api/v1/roles/{role_id}", headers=h).json()["data_scopes"] == {"crm": "organization"}
