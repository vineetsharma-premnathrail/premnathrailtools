"""Organization › Department: set who a member reports to (User.reporting_manager_id)
from the department tree — loop check, permission, audit."""
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.tests.test_cov_org_structure import ORG, admin, auth, make_user  # noqa: F401 (fixture)


def _setup(client, db, admin):  # noqa: F811
    h = auth(admin)
    d = client.post(f"{ORG}/departments", json={"name": "R&D"}, headers=h).json()
    lead = make_user(db, "rd_lead@premnathrail.com", name="Lead")
    eng = make_user(db, "rd_eng@premnathrail.com", name="Engineer")
    for u in (lead, eng):
        assert client.post(f"{ORG}/departments/{d['id']}/members", json={"user_id": u.id}, headers=h).status_code == 201
    return h, d, lead, eng


def test_set_reporting_manager_shows_in_tree_and_audit(client, db, admin):  # noqa: F811
    h, d, lead, eng = _setup(client, db, admin)
    r = client.put(f"{ORG}/departments/{d['id']}/members/{eng.id}/manager", json={"reporting_manager_id": lead.id}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["reporting_manager_name"] == "Lead"
    members = {m["name"]: m for m in client.get(f"{ORG}/departments/{d['id']}/members", headers=h).json()}
    assert members["Engineer"]["reporting_manager_id"] == lead.id
    assert members["Lead"]["reporting_manager_id"] is None
    db.expire_all()
    assert db.get(User, eng.id).reporting_manager_id == lead.id
    assert db.query(AuditLog).filter(AuditLog.action == "member_manager_changed").count() == 1
    # Clearing works too.
    r = client.put(f"{ORG}/departments/{d['id']}/members/{eng.id}/manager", json={"reporting_manager_id": None}, headers=h)
    assert r.status_code == 200 and r.json()["reporting_manager_id"] is None


def test_reporting_loop_self_and_non_member_are_refused(client, db, admin):  # noqa: F811
    h, d, lead, eng = _setup(client, db, admin)
    url = f"{ORG}/departments/{d['id']}/members"
    assert client.put(f"{url}/{eng.id}/manager", json={"reporting_manager_id": lead.id}, headers=h).status_code == 200
    r = client.put(f"{url}/{lead.id}/manager", json={"reporting_manager_id": eng.id}, headers=h)
    assert r.status_code == 422 and "loop" in r.json()["detail"]
    r = client.put(f"{url}/{eng.id}/manager", json={"reporting_manager_id": eng.id}, headers=h)
    assert r.status_code == 422
    outsider = make_user(db, "rd_out@premnathrail.com")
    assert client.put(f"{url}/{outsider.id}/manager", json={"reporting_manager_id": lead.id}, headers=h).status_code == 404


def test_admin_may_set_own_manager_but_not_without_edit_permission(client, db, admin):  # noqa: F811
    h, d, lead, eng = _setup(client, db, admin)
    url = f"{ORG}/departments/{d['id']}/members"
    assert client.post(url, json={"user_id": admin.id}, headers=h).status_code == 201
    assert client.put(f"{url}/{admin.id}/manager", json={"reporting_manager_id": lead.id}, headers=h).status_code == 200
    plain = make_user(db, "rd_plain@premnathrail.com", apps=("erp",))
    assert client.put(f"{url}/{eng.id}/manager", json={"reporting_manager_id": lead.id}, headers=auth(plain)).status_code == 403
