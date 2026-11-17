"""CRM and Service: the role-matrix tick + the role's scopes alone decide who
sees and changes a record (owner, 2026-11-03 / 2026-11-14 — "role ke permission
di hai fir bhi show nahi hota"). No hardcoded creator-only or admin-only gate
sits on top of a grant; "change only your own" is the role's Edit scope
(Role.data_scopes["<module>:edit"], default own + assigned)."""
from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.main.models.role import Role
from app.modules.main.models.user import User

API = "/api/v1"
CRM_FULL = ["crm:*:*"]


def _user(db, email, name=None, department=None):
    u = User(email=email, name=name or email.split("@")[0], role="user", is_active=True, department=department)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _role(db, user, perms, scopes):
    role = Role(name=f"Role {user.id} {sorted(scopes.items())}", permissions=list(perms), data_scopes=dict(scopes))
    db.add(role)
    db.commit()
    user.roles = [role]
    db.commit()
    return role


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _org(db, owner, name):
    org = Organization(name=name, org_scope="domestic", country="India", created_by_id=owner.id)
    db.add(org)
    db.commit()
    return org


def _inquiry(db, org, creator, uid, **kw):
    inq = Inquiry(universal_id=uid, org_id=org.id, created_by_id=creator.id, **kw)
    db.add(inq)
    db.commit()
    return inq


# ── CRM ──────────────────────────────────────────────────────────────────

def test_assigned_bd_owner_not_creator_can_edit_the_inquiry(client, db):
    creator = _user(db, "es.creator@premnathrail.com", "Creator One")
    bd = _user(db, "es.bd@premnathrail.com", "Bd Owner")
    for u in (creator, bd):
        _role(db, u, CRM_FULL, {"crm": "organization"})  # no Edit scope set -> default own + assigned
    org = _org(db, creator, "Edit Scope Org A")
    inq = _inquiry(db, org, creator, "INQ-ES-1", bd_owner_id=bd.id, bd_owner="Bd Owner")

    r = client.patch(f"{API}/crm/inquiries/{inq.id}", json={"priority": "Urgent"}, headers=_h(bd))
    assert r.status_code == 200, r.text
    # The detail read tells the screen it may show Edit.
    assert client.get(f"{API}/crm/inquiries/{inq.id}", headers=_h(bd)).json()["can_change"] is True


def test_default_role_cannot_edit_an_unrelated_colleagues_inquiry(client, db):
    creator = _user(db, "es.c2@premnathrail.com", "Creator Two")
    other = _user(db, "es.o2@premnathrail.com", "Other Two")
    for u in (creator, other):
        _role(db, u, CRM_FULL, {"crm": "organization"})
    org = _org(db, creator, "Edit Scope Org B")
    inq = _inquiry(db, org, creator, "INQ-ES-2")

    assert client.get(f"{API}/crm/inquiries/{inq.id}", headers=_h(other)).status_code == 200  # may see it
    detail = client.get(f"{API}/crm/inquiries/{inq.id}", headers=_h(other)).json()
    assert detail["can_change"] is False
    r = client.patch(f"{API}/crm/inquiries/{inq.id}", json={"priority": "Urgent"}, headers=_h(other))
    assert r.status_code == 403
    assert "Edit scope" in r.json()["detail"] and "Own + assigned" in r.json()["detail"]
    r = client.patch(f"{API}/crm/organizations/{org.id}", json={"city": "Pune"}, headers=_h(other))
    assert r.status_code == 403 and "Edit scope" in r.json()["detail"]


def test_organization_edit_scope_edits_a_colleagues_org(client, db):
    owner = _user(db, "es.owner3@premnathrail.com", "Owner Three")
    editor = _user(db, "es.ed3@premnathrail.com", "Editor Three")
    _role(db, owner, CRM_FULL, {"crm": "organization"})
    _role(db, editor, CRM_FULL, {"crm": "organization", "crm:edit": "organization"})
    org = _org(db, owner, "Edit Scope Org C")

    r = client.patch(f"{API}/crm/organizations/{org.id}", json={"city": "Pune"}, headers=_h(editor))
    assert r.status_code == 200, r.text
    assert client.get(f"{API}/crm/organizations/{org.id}/detail", headers=_h(editor)).json()["can_change"] is True


def test_department_edit_scope_edits_a_department_colleagues_org_only(client, db):
    owner = _user(db, "es.owner4@premnathrail.com", "Owner Four", department="Sales")
    peer = _user(db, "es.peer4@premnathrail.com", "Peer Four", department="Sales")
    outsider = _user(db, "es.out4@premnathrail.com", "Out Four", department="Stores")
    _role(db, owner, CRM_FULL, {"crm": "organization"})
    _role(db, outsider, CRM_FULL, {"crm": "organization"})
    _role(db, peer, CRM_FULL, {"crm": "organization", "crm:edit": "department"})
    same_dept = _org(db, owner, "Edit Scope Org D1")
    other_dept = _org(db, outsider, "Edit Scope Org D2")

    assert client.patch(f"{API}/crm/organizations/{same_dept.id}", json={"city": "Pune"}, headers=_h(peer)).status_code == 200
    r = client.patch(f"{API}/crm/organizations/{other_dept.id}", json={"city": "Pune"}, headers=_h(peer))
    assert r.status_code == 403 and "'Department'" in r.json()["detail"]


def test_quotation_on_an_inquiry_follows_the_edit_scope(client, db):
    creator = _user(db, "es.c5@premnathrail.com", "Creator Five")
    bd = _user(db, "es.bd5@premnathrail.com", "Bd Five")
    other = _user(db, "es.o5@premnathrail.com", "Other Five")
    for u in (creator, bd, other):
        _role(db, u, CRM_FULL, {"crm": "organization"})
    org = _org(db, creator, "Edit Scope Org E")
    inq = _inquiry(db, org, creator, "INQ-ES-5", bd_owner_id=bd.id)

    r = client.post(f"{API}/crm/inquiries/{inq.id}/quotations", json={"client_name": "X", "items": []}, headers=_h(other))
    assert r.status_code == 403 and "Edit scope" in r.json()["detail"]
    r = client.post(f"{API}/crm/inquiries/{inq.id}/quotations", json={"client_name": "X", "items": []}, headers=_h(bd))
    assert r.status_code != 403, r.text  # the BD owner passes the rights check (payload rules may still apply)


def test_non_admin_with_import_grant_can_import(client, db):
    importer = _user(db, "es.imp@premnathrail.com", "Importer")
    _role(db, importer, ["crm:organizations:view", "crm:organizations:create", "crm:organizations:import",
                         "crm:inquiries_tenders:view", "crm:inquiries_tenders:create"], {"crm": "organization"})
    template = client.get(f"{API}/crm/bulk-import/template", headers=_h(importer))
    assert template.status_code == 200, template.text
    r = client.post(f"{API}/crm/bulk-import", headers=_h(importer),
                    files={"file": ("crm.csv", template.content, "text/csv")})
    assert r.status_code == 200, r.text


def test_duplicates_report_needs_organizations_edit_not_admin(client, db):
    editor = _user(db, "es.dup@premnathrail.com", "Dup Editor")
    viewer = _user(db, "es.dupv@premnathrail.com", "Dup Viewer")
    _role(db, editor, ["crm:organizations:view", "crm:organizations:edit"], {"crm": "organization"})
    _role(db, viewer, ["crm:organizations:view"], {"crm": "organization"})
    assert client.get(f"{API}/crm/organizations/duplicates", headers=_h(editor)).status_code == 200
    assert client.get(f"{API}/crm/organizations/duplicates", headers=_h(viewer)).status_code == 403


# ── Service ──────────────────────────────────────────────────────────────

def test_sr_form_machine_picker_loads_without_projects_grants(client, db):
    raiser = _user(db, "es.sr@premnathrail.com", "Sr Raiser")
    _role(db, raiser, ["erp:service_requests:view", "erp:service_requests:create"], {"erp": "organization"})
    m = Project(serial_number="ES-M-1", created_by_id=None)
    db.add(m)
    db.commit()

    r = client.get(f"{API}/erp/projects", params={"limit": 5000}, headers=_h(raiser))
    assert r.status_code == 200, r.text
    assert m.id in {p["id"] for p in r.json()}
    assert client.get(f"{API}/erp/projects/{m.id}", headers=_h(raiser)).status_code == 200


def test_sr_machine_list_follows_the_service_scope(client, db):
    raiser = _user(db, "es.sr2@premnathrail.com", "Sr Raiser Two")
    _role(db, raiser, ["erp:service_requests:view", "erp:service_requests:create"], {"erp": "assigned"})
    mine = Project(serial_number="ES-M-2", created_by_id=None)
    other = Project(serial_number="ES-M-3", created_by_id=None)
    db.add_all([mine, other])
    db.commit()
    db.add(ServiceRequest(request_number="SR-ES-2", project_id=mine.id, issue_title="x", created_by_id=raiser.id))
    db.commit()

    ids = {p["id"] for p in client.get(f"{API}/erp/projects", headers=_h(raiser)).json()}
    assert mine.id in ids and other.id not in ids
    assert client.get(f"{API}/erp/projects/{mine.id}", headers=_h(raiser)).status_code == 200


def test_sr_edit_follows_the_edit_scope(client, db):
    creator = _user(db, "es.src@premnathrail.com", "Sr Creator")
    engineer = _user(db, "es.sre@premnathrail.com", "Sr Engineer")
    other = _user(db, "es.sro@premnathrail.com", "Sr Other")
    perms = ["erp:service_requests:view", "erp:service_requests:create", "erp:service_requests:edit"]
    for u in (creator, engineer, other):
        _role(db, u, perms, {"erp": "organization"})
    m = Project(serial_number="ES-M-4", created_by_id=creator.id)
    db.add(m)
    db.commit()
    sr = ServiceRequest(request_number="SR-ES-4", project_id=m.id, issue_title="Brake fault", created_by_id=creator.id,
                        assigned_service_person_id=engineer.id, status="open")
    db.add(sr)
    db.commit()

    r = client.patch(f"{API}/erp/service-requests/{sr.id}", json={"issue_title": "Brake fault (rear)"}, headers=_h(other))
    assert r.status_code == 403 and "Edit scope" in r.json()["detail"]
    r = client.patch(f"{API}/erp/service-requests/{sr.id}", json={"issue_title": "Brake fault (rear)"}, headers=_h(engineer))
    assert r.status_code == 200, r.text
