"""IDOR / object-level authorization regressions for Service (erp) and
Maintenance: child records are bound to the parent in the URL, records in
the Recycle Bin 404 on their child routes, and decisions respect the data
scope."""
from datetime import date

from app.auth.jwt_handler import create_access_token
from app.modules.erp.models.project import Project
from app.modules.erp.models.project_attachment import ProjectAttachment
from app.modules.erp.models.project_letter import ProjectLetter
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.maintenance.models.work_order import MaintenanceWorkOrderTask
from app.modules.organization.models.branch import Branch

API = "/api/v1"


def _user(db, email, role="user", **kw):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _scoped(db, email, module, perms, level, **kw):
    role = Role(name=f"{module} {level} {email}", permissions=perms, data_scopes={module: level})
    db.add(role)
    db.commit()
    u = _user(db, email, **kw)
    u.roles = [role]
    db.commit()
    return u


def _letter(db, project, seq=1):
    letter = ProjectLetter(project_id=project.id, seq=seq, letter_no=f"{project.serial_number}/LTR/{seq:03d}",
                           letter_date=date.today(), recipient="Client", subject="Subject", body="Body")
    db.add(letter)
    db.commit()
    return letter


# ── Service: machines ────────────────────────────────────────────────────

def test_machine_letter_bound_to_machine_in_url(client, db):
    admin = _user(db, "idor.erp.admin@premnathrail.com", role="admin")
    a, b = Project(serial_number="IDOR-A", approval_status="approved"), Project(serial_number="IDOR-B", approval_status="approved")
    db.add_all([a, b])
    db.commit()
    letter_b = _letter(db, b)
    r = client.get(f"{API}/erp/projects/{a.id}/letters/{letter_b.id}/file", headers=h(admin))
    assert r.status_code == 404 and "not found on this machine" in r.json()["detail"]
    r = client.delete(f"{API}/erp/projects/{a.id}/letters/{letter_b.id}", headers=h(admin))
    assert r.status_code == 404


def test_deleted_machine_children_404(client, db):
    admin = _user(db, "idor.erp.admin2@premnathrail.com", role="admin")
    gone = Project(serial_number="IDOR-GONE", approval_status="approved", is_deleted=True)
    db.add(gone)
    db.commit()
    letter = _letter(db, gone)
    att = ProjectAttachment(project_id=gone.id, filename="x.pdf", sharepoint_path="x/x.pdf")
    db.add(att)
    db.commit()
    for url in (f"/erp/projects/{gone.id}/attachments/{att.id}/content",
                f"/erp/projects/{gone.id}/attachments/{att.id}/preview",
                f"/erp/projects/{gone.id}/letters/{letter.id}/file"):
        r = client.get(f"{API}{url}", headers=h(admin))
        assert r.status_code == 404, (url, r.status_code, r.text)
        assert "recycle bin" in r.json()["detail"].lower() or "deleted" in r.json()["detail"].lower()
    r = client.delete(f"{API}/erp/projects/{gone.id}/attachments/{att.id}", headers=h(admin))
    assert r.status_code == 404


def test_machine_approve_respects_data_scope(client, db):
    owner = _user(db, "idor.erp.owner@premnathrail.com", assigned_apps=["erp"])
    # Machines follow the Project Management scope since 2026-10-26 (what migration f7c3a9e1d5b2 writes for a Service wildcard role).
    outsider = _scoped(db, "idor.erp.out@premnathrail.com", "projects",
                       ["erp:*:*"] + [f"projects:service_projects:{a}" for a in ("view", "create", "edit", "delete")], "own", assigned_apps=["erp"])
    p = Project(serial_number="IDOR-PEND", approval_status="pending", created_by_id=owner.id)
    db.add(p)
    db.commit()
    r = client.post(f"{API}/erp/projects/{p.id}/approve", json={}, headers=h(outsider))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]


# ── Service: service requests ────────────────────────────────────────────

def test_sr_material_bound_to_sr_in_url(client, db):
    admin = _user(db, "idor.sr.admin@premnathrail.com", role="admin")
    m = Project(serial_number="IDOR-SRM", approval_status="approved")
    db.add(m)
    db.commit()
    sr_a = ServiceRequest(request_number="IDOR-SR-A", project_id=m.id, issue_title="A")
    sr_b = ServiceRequest(request_number="IDOR-SR-B", project_id=m.id, issue_title="B")
    db.add_all([sr_a, sr_b])
    db.commit()
    mat_b = ServiceMaterial(service_request_id=sr_b.id, material_name="Pump")
    db.add(mat_b)
    db.commit()
    r = client.patch(f"{API}/erp/service-requests/{sr_a.id}/materials/{mat_b.id}", json={"material_name": "X"}, headers=h(admin))
    assert r.status_code == 404 and "not found on this service request" in r.json()["detail"]
    r = client.delete(f"{API}/erp/service-requests/{sr_a.id}/materials/{mat_b.id}", headers=h(admin))
    assert r.status_code == 404
    db.expire_all()
    assert db.get(ServiceMaterial, mat_b.id).material_name == "Pump" and not db.get(ServiceMaterial, mat_b.id).is_deleted


def test_sr_out_of_scope_403(client, db):
    m = Project(serial_number="IDOR-SRS", approval_status="approved")
    db.add(m)
    db.commit()
    other = _user(db, "idor.sr.other@premnathrail.com")
    sr = ServiceRequest(request_number="IDOR-SR-S", project_id=m.id, issue_title="S", created_by_id=other.id)
    db.add(sr)
    db.commit()
    mine = _scoped(db, "idor.sr.own@premnathrail.com", "erp", ["erp:*:*"], "own", assigned_apps=["erp"])
    for url in (f"/erp/service-requests/{sr.id}", f"/erp/service-requests/{sr.id}/materials"):
        r = client.get(f"{API}{url}", headers=h(mine))
        assert r.status_code == 403 and "outside your data access" in r.json()["detail"], url


# ── Maintenance: work-order child lines ──────────────────────────────────

def test_wo_task_bound_to_wo_in_url(client, db):
    planner = _user(db, "idor.mnt.planner@premnathrail.com", assigned_apps=["maintenance"])
    hp = h(planner)
    b = Branch(name="Plant IDOR", code="IDR")
    db.add(b)
    db.commit()
    r = client.post(f"{API}/maintenance/assets", json={"name": "Press", "branch_id": b.id, "criticality": "B"}, headers=hp)
    assert r.status_code == 200, r.text
    asset_id = r.json()["id"]
    ids = []
    for title in ("WO A", "WO B"):
        r = client.post(f"{API}/maintenance/work-orders", json={"asset_id": asset_id, "wo_type": "inspection", "title": title}, headers=hp)
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
    wo_a, wo_b = ids
    r = client.post(f"{API}/maintenance/work-orders/{wo_b}/tasks", json={"description": "Check oil"}, headers=hp)
    assert r.status_code == 200, r.text
    task_b = db.query(MaintenanceWorkOrderTask).filter(MaintenanceWorkOrderTask.work_order_id == wo_b).first()
    r = client.patch(f"{API}/maintenance/work-orders/{wo_a}/tasks/{task_b.id}", json={"result": "ok"}, headers=hp)
    assert r.status_code == 404 and "isn't on" in r.json()["detail"]
    r = client.delete(f"{API}/maintenance/work-orders/{wo_a}/tasks/{task_b.id}", headers=hp)
    assert r.status_code == 404
    assert db.get(MaintenanceWorkOrderTask, task_b.id) is not None


def test_wo_out_of_scope_403(client, db):
    planner = _user(db, "idor.mnt.p2@premnathrail.com", assigned_apps=["maintenance"])
    b = Branch(name="Plant IDOR2", code="ID2")
    db.add(b)
    db.commit()
    asset_id = client.post(f"{API}/maintenance/assets", json={"name": "Lathe", "branch_id": b.id, "criticality": "C"},
                           headers=h(planner)).json()["id"]
    wo_id = client.post(f"{API}/maintenance/work-orders", json={"asset_id": asset_id, "wo_type": "inspection", "title": "T"},
                        headers=h(planner)).json()["id"]
    own = _scoped(db, "idor.mnt.own@premnathrail.com", "maintenance", ["maintenance:*:*"], "own", assigned_apps=["maintenance"])
    r = client.post(f"{API}/maintenance/work-orders/{wo_id}/tasks", json={"description": "x"}, headers=h(own))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]
