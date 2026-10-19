"""Extra coverage for Organization structure: plants (branches) CRUD and who
may change them, departments with multiple heads, cost centres, the audit
log screen, and hard-vs-soft delete (ERP review C-12).
Complements test_master_data_delete_guards.py and test_audit_trail.py."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department

ORG = "/api/v1/organization"


def make_user(db, email, role="user", apps=(), branch_id=None, name=None):
    u = User(email=email, name=name or email.split("@")[0], role=role, is_active=True,
             assigned_apps=list(apps), branch_id=branch_id)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def admin(db):
    return make_user(db, "org_admin@premnathrail.com", role="admin", name="Org Admin")


def new_branch(client, admin, code="U1", name="Unit 1", **extra):
    r = client.post(f"{ORG}/branches", json={"code": code, "name": name, **extra}, headers=auth(admin))
    assert r.status_code == 201, r.text
    return r.json()


def logs(db, entity_type, entity_id):
    return db.query(AuditLog).filter(AuditLog.entity_type == entity_type, AuditLog.entity_id == entity_id).order_by(AuditLog.id).all()


# --- Plants (branches) -------------------------------------------------------

def test_only_admin_can_create_edit_or_delete_plants(client, db, admin):
    b = new_branch(client, admin)
    store_user = make_user(db, "org_store@premnathrail.com", apps=("store",))
    plain = make_user(db, "org_plain@premnathrail.com", apps=("erp",))
    for u in (store_user, plain):
        h = auth(u)
        assert client.post(f"{ORG}/branches", json={"code": "X", "name": "X"}, headers=h).status_code == 403
        assert client.patch(f"{ORG}/branches/{b['id']}", json={"name": "Hacked"}, headers=h).status_code == 403
        assert client.delete(f"{ORG}/branches/{b['id']}", headers=h).status_code == 403
        assert client.get(f"{ORG}/branches/{b['id']}", headers=h).status_code == 403
    # Store users may read the list (warehouse form needs it); others may not.
    assert client.get(f"{ORG}/branches", headers=auth(store_user)).status_code == 200
    assert client.get(f"{ORG}/branches", headers=auth(plain)).status_code == 403
    db.expire_all()
    assert db.get(Branch, b["id"]).name == "Unit 1"


def test_plant_crud_with_validation(client, db, admin):
    h = auth(admin)
    head = make_user(db, "plant_head@premnathrail.com", name="Plant Head")
    b = new_branch(client, admin, head_user_id=head.id, plant_type="Manufacturing")
    assert b["status"] == "active" and b["head_user_name"] == "Plant Head"
    assert client.post(f"{ORG}/branches", json={"code": "U1", "name": "Dup"}, headers=h).status_code == 409
    assert client.post(f"{ORG}/branches", json={"code": "U9", "name": "Bad", "status": "open"}, headers=h).status_code == 422

    other = new_branch(client, admin, code="U2", name="Unit 2")
    r = client.patch(f"{ORG}/branches/{other['id']}", json={"code": "U1"}, headers=h)
    assert r.status_code == 409
    assert client.patch(f"{ORG}/branches/{b['id']}", json={"status": "closed_down"}, headers=h).status_code == 422
    r = client.patch(f"{ORG}/branches/{b['id']}", json={"status": "inactive", "name": "Unit One"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "inactive" and r.json()["name"] == "Unit One"
    # Same code on itself is not a clash.
    assert client.patch(f"{ORG}/branches/{b['id']}", json={"code": "U1"}, headers=h).status_code == 200
    assert client.get(f"{ORG}/branches/99999", headers=h).status_code == 404
    assert [x["code"] for x in client.get(f"{ORG}/branches", headers=h).json()] == ["U2", "U1"]  # by name


def test_plant_changes_are_audited(client, db, admin):
    b = new_branch(client, admin)
    client.patch(f"{ORG}/branches/{b['id']}", json={"status": "under_maintenance"}, headers=auth(admin))
    rows = logs(db, "branch", b["id"])
    assert [r.action for r in rows] == ["created", "updated"]
    assert all(r.performed_by_id == admin.id and r.module_key == "organization" for r in rows)
    assert "under_maintenance" in rows[1].new_value

    screen = client.get(f"{ORG}/audit-logs", params={"entity_type": "branch", "entity_id": b["id"]}, headers=auth(admin)).json()
    assert {r["action"] for r in screen} == {"created", "updated"}
    assert all(r["performed_by_name"] == "Org Admin" for r in screen)


def test_plant_user_assignment_keeps_one_primary_branch(client, db, admin):
    h = auth(admin)
    b1, b2 = new_branch(client, admin), new_branch(client, admin, code="U2", name="Unit 2")
    u = make_user(db, "assign@premnathrail.com")
    a1 = client.post(f"{ORG}/branches/{b1['id']}/user-assignments", json={"user_id": u.id, "is_primary_branch": True}, headers=h).json()
    a2 = client.post(f"{ORG}/branches/{b2['id']}/user-assignments", json={"user_id": u.id, "is_primary_branch": True}, headers=h).json()
    first = client.get(f"{ORG}/branches/{b1['id']}/user-assignments", headers=h).json()
    assert first[0]["id"] == a1["id"] and first[0]["is_primary_branch"] is False
    assert a2["is_primary_branch"] is True and a2["user_name"] == "assign"
    # Assignment can't be edited/deleted through another plant's URL.
    assert client.patch(f"{ORG}/branches/{b1['id']}/user-assignments/{a2['id']}", json={"role": "x"}, headers=h).status_code == 404
    assert client.delete(f"{ORG}/branches/{b1['id']}/user-assignments/{a2['id']}", headers=h).status_code == 404


@pytest.mark.xfail(strict=True, reason="BUG: hard delete — organization/routes/branch.py:202 db.delete(branch); "
                                       "plant master should be deactivated/soft-deleted (ERP review C-12)")
def test_plant_delete_is_soft(client, db, admin):
    b = new_branch(client, admin)
    assert client.delete(f"{ORG}/branches/{b['id']}", headers=auth(admin)).status_code in (200, 204)
    db.expire_all()
    row = db.get(Branch, b["id"])
    assert row is not None, "plant row was hard-deleted"
    assert row.status in ("inactive", "closed")


# --- Departments with multiple heads -------------------------------------------

def test_department_with_multiple_heads(client, db, admin):
    h = auth(admin)
    b = new_branch(client, admin)
    h1, h2, h3, h4 = (make_user(db, f"dh{i}@premnathrail.com", branch_id=b["id"], name=f"Head {i}") for i in range(1, 5))
    member = make_user(db, "dmember@premnathrail.com", branch_id=b["id"], name="Member")
    member.department = "Service"
    db.commit()
    r = client.post(f"{ORG}/departments", json={
        "name": "Service", "branch_id": b["id"], "head_user_id": h1.id, "secondary_head_user_id": h2.id,
        "additional_head_user_ids": [h3.id, h4.id],
    }, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["head_user_name"] == "Head 1 / Head 2 / Head 3 / Head 4"
    assert d["code"] == "Service" and d["branch_name"] == "Unit 1"

    members = client.get(f"{ORG}/departments/{d['id']}/members", headers=h).json()
    assert {m["name"]: m["is_head"] for m in members} == {
        "Member": False, "Head 1": True, "Head 2": True, "Head 3": True, "Head 4": True}

    r = client.patch(f"{ORG}/departments/{d['id']}", json={"additional_head_user_ids": [h3.id]}, headers=h)
    assert r.json()["head_user_name"] == "Head 1 / Head 2 / Head 3"

    # Still headed → can't be deleted.
    r = client.delete(f"{ORG}/departments/{d['id']}", headers=h)
    assert r.status_code == 409 and "head" in r.json()["detail"]


def test_department_head_from_another_unit_is_rejected(client, db, admin):
    h = auth(admin)
    u1, u2 = new_branch(client, admin), new_branch(client, admin, code="U2", name="Unit 2")
    local = make_user(db, "local_head@premnathrail.com", branch_id=u1["id"])
    outsider = make_user(db, "outsider_head@premnathrail.com", branch_id=u2["id"], name="Outsider")
    r = client.post(f"{ORG}/departments", json={"name": "Stores", "branch_id": u1["id"],
                                                 "head_user_id": local.id, "additional_head_user_ids": [outsider.id]}, headers=h)
    assert r.status_code == 400 and "Outsider (Unit 2)" in r.json()["detail"]
    assert db.query(Department).count() == 0

    d = client.post(f"{ORG}/departments", json={"name": "Stores", "branch_id": u1["id"], "head_user_id": local.id}, headers=h).json()
    r = client.patch(f"{ORG}/departments/{d['id']}", json={"secondary_head_user_id": outsider.id}, headers=h)
    assert r.status_code == 400
    db.expire_all()
    assert db.get(Department, d["id"]).secondary_head_user_id is None  # rolled back
    # Moving the department to the outsider's unit while keeping the local head is rejected too.
    assert client.patch(f"{ORG}/departments/{d['id']}", json={"branch_id": u2["id"]}, headers=h).status_code == 400

    # A department with no unit can be headed by anyone.
    r = client.post(f"{ORG}/departments", json={"name": "Corporate", "head_user_id": outsider.id,
                                                 "secondary_head_user_id": local.id}, headers=h)
    assert r.status_code == 200


def test_department_rejects_unknown_head_user(client, db, admin):
    b = new_branch(client, admin)
    r = client.post(f"{ORG}/departments", json={"name": "Ghost", "branch_id": b["id"], "head_user_id": 424242}, headers=auth(admin))
    assert r.status_code in (400, 404, 422)


def test_same_department_name_in_two_units_gets_unique_codes(client, db, admin):
    h = auth(admin)
    u1, u2 = new_branch(client, admin), new_branch(client, admin, code="U2", name="Unit 2")
    a = client.post(f"{ORG}/departments", json={"name": "Quality", "branch_id": u1["id"]}, headers=h).json()
    b = client.post(f"{ORG}/departments", json={"name": "Quality", "branch_id": u2["id"]}, headers=h).json()
    assert a["code"] != b["code"]
    assert [d["id"] for d in client.get(f"{ORG}/departments", params={"branch_id": u2["id"]}, headers=h).json()] == [b["id"]]


def test_departments_are_admin_only(client, db, admin):
    d = client.post(f"{ORG}/departments", json={"name": "HR"}, headers=auth(admin)).json()
    u = make_user(db, "dept_plain@premnathrail.com", apps=("erp", "hr"))
    h = auth(u)
    assert client.get(f"{ORG}/departments", headers=h).status_code == 403
    assert client.post(f"{ORG}/departments", json={"name": "X"}, headers=h).status_code == 403
    assert client.patch(f"{ORG}/departments/{d['id']}", json={"name": "Y"}, headers=h).status_code == 403
    assert client.delete(f"{ORG}/departments/{d['id']}", headers=h).status_code == 403
    assert client.post(f"{ORG}/departments/{d['id']}/members", json={"user_id": u.id}, headers=h).status_code == 403


def test_department_member_with_other_branch_is_moved_into_its_unit(client, db, admin):
    h = auth(admin)
    u1, u2 = new_branch(client, admin), new_branch(client, admin, code="U2", name="Unit 2")
    d = client.post(f"{ORG}/departments", json={"name": "Assembly", "branch_id": u1["id"]}, headers=h).json()
    worker = make_user(db, "worker@premnathrail.com", branch_id=u2["id"])
    assert client.post(f"{ORG}/departments/{d['id']}/members", json={"user_id": worker.id}, headers=h).status_code == 201
    db.expire_all()
    w = db.get(User, worker.id)
    assert w.department == "Assembly" and w.branch_id == u1["id"]
    assert client.post(f"{ORG}/departments/{d['id']}/members", json={"user_id": 99999}, headers=h).status_code == 404
    assert client.delete(f"{ORG}/departments/{d['id']}/members/99999", headers=h).status_code == 404
    # Members block deletion.
    assert client.delete(f"{ORG}/departments/{d['id']}", headers=h).status_code == 409


@pytest.mark.xfail(strict=True, reason="BUG: hard delete — organization/routes/department.py:206 db.delete(department); "
                                       "department master should be soft-deleted/deactivated (ERP review C-12)")
def test_department_delete_is_soft(client, db, admin):
    d = client.post(f"{ORG}/departments", json={"name": "Temp"}, headers=auth(admin)).json()
    assert client.delete(f"{ORG}/departments/{d['id']}", headers=auth(admin)).status_code == 204
    db.expire_all()
    assert db.get(Department, d["id"]) is not None, "department row was hard-deleted"


# --- Cost centres -------------------------------------------------------------

def test_cost_centre_crud_and_guards(client, db, admin):
    h = auth(admin)
    b = new_branch(client, admin)
    dept = client.post(f"{ORG}/departments", json={"name": "Service", "branch_id": b["id"]}, headers=h).json()
    parent = client.post(f"{ORG}/cost-centers", json={"code": "CC-100", "name": "Operations", "branch_id": b["id"]}, headers=h)
    assert parent.status_code == 201
    parent = parent.json()
    child = client.post(f"{ORG}/cost-centers", json={
        "code": "CC-110", "name": "Field Service", "branch_id": b["id"], "department_id": dept["id"],
        "parent_cost_center_id": parent["id"], "annual_budget": 500000,
    }, headers=h).json()
    assert child["parent_cost_center_name"] == "Operations" and child["department_name"] == "Service"
    assert child["branch_name"] == "Unit 1" and child["status"] == "active"

    assert client.post(f"{ORG}/cost-centers", json={"code": "CC-100", "name": "Dup"}, headers=h).status_code == 409
    assert client.patch(f"{ORG}/cost-centers/{child['id']}", json={"code": "CC-100"}, headers=h).status_code == 409
    r = client.patch(f"{ORG}/cost-centers/{child['id']}", json={"status": "inactive"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "inactive"
    assert client.patch(f"{ORG}/cost-centers/99999", json={"name": "x"}, headers=h).status_code == 404

    r = client.delete(f"{ORG}/cost-centers/{parent['id']}", headers=h)
    assert r.status_code == 409 and "parent" in r.json()["detail"]
    client.patch(f"{ORG}/branches/{b['id']}", json={"default_cost_center_id": child["id"]}, headers=h)
    r = client.delete(f"{ORG}/cost-centers/{child['id']}", headers=h)
    assert r.status_code == 409 and "default cost center" in r.json()["detail"]
    assert client.get(f"{ORG}/branches/{b['id']}", headers=h).json()["default_cost_center_name"] == "Field Service"

    assert [c["code"] for c in client.get(f"{ORG}/cost-centers", params={"branch_id": b["id"]}, headers=h).json()] == ["CC-110", "CC-100"]

    actions = [r.action for r in logs(db, "cost_center", child["id"])]
    assert actions[:2] == ["created", "updated"]


def test_cost_centres_readable_by_finance_but_not_writable(client, db, admin):
    # Finance pages (ledger, payments, assets, masters) use the list as a
    # picker, so Finance users may read it; maintaining cost centres needs
    # Organization > Branches 'Edit'.
    u = make_user(db, "cc_plain@premnathrail.com", apps=("accounts",))
    h = auth(u)
    assert client.get(f"{ORG}/cost-centers", headers=h).status_code == 200
    outsider = make_user(db, "cc_out@premnathrail.com", apps=("erp",))
    assert client.get(f"{ORG}/cost-centers", headers=auth(outsider)).status_code == 403
    assert client.post(f"{ORG}/cost-centers", json={"code": "X", "name": "X"}, headers=h).status_code == 403


# --- Audit log screen ---------------------------------------------------------

def test_audit_log_screen_is_admin_only_and_filters_organization(client, db, admin):
    b = new_branch(client, admin)
    client.post(f"{ORG}/departments", json={"name": "Design", "branch_id": b["id"]}, headers=auth(admin))
    plain = make_user(db, "audit_plain@premnathrail.com", apps=("erp",))
    assert client.get(f"{ORG}/audit-logs", headers=auth(plain)).status_code == 403
    assert client.get(f"{ORG}/audit-logs/dashboard", headers=auth(plain)).status_code == 403

    rows = client.get(f"{ORG}/audit-logs", params={"module_key": "organization"}, headers=auth(admin)).json()
    assert {r["entity_type"] for r in rows} >= {"branch", "department"}
    assert all(r["module_key"] == "organization" for r in rows)
    only_created = client.get(f"{ORG}/audit-logs", params={"action": "created", "performed_by_id": admin.id}, headers=auth(admin)).json()
    assert only_created and all(r["action"] == "created" and r["performed_by_id"] == admin.id for r in only_created)


def test_department_used_by_other_records_cannot_be_deleted(client, db, admin):
    from app.modules.organization.models.cost_center import CostCenter

    h = auth(admin)
    d = client.post(f"{ORG}/departments", json={"name": "Machining"}, headers=h).json()
    db.add(CostCenter(code="CC-MCH", name="Machining CC", department_id=d["id"]))
    db.commit()
    r = client.delete(f"{ORG}/departments/{d['id']}", headers=h)
    assert r.status_code == 409
    assert "1 cost center(s)" in r.json()["detail"] and "Machining" in r.json()["detail"]
    assert db.get(Department, d["id"]) is not None


def test_department_head_block_names_the_head(client, db, admin):
    h = auth(admin)
    head = make_user(db, "dept_named_head@premnathrail.com", name="Named Head")
    d = client.post(f"{ORG}/departments", json={"name": "Paint", "head_user_id": head.id}, headers=h).json()
    r = client.delete(f"{ORG}/departments/{d['id']}", headers=h)
    assert r.status_code == 409
    assert "Named Head is set as head" in r.json()["detail"] and "clear the head fields" in r.json()["detail"]
