"""Service (ERP) hardening: machine delete/serial guards, machine field
validation, SR billing validation, Permission Matrix tab checks on read
routes, SR state guards and material validation."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.erp.models.project import Project
from app.tests.p2p_workflow_helpers import master_item
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.production.models.rrv_build import ProductionRrvBuild

SR_URL = "/api/v1/erp/service-requests"
PROJ_URL = "/api/v1/erp/projects"


def make_user(db, email, role="user", erp_permissions=None, granular=None):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=["erp"], erp_permissions=erp_permissions or [],
        granular_permissions=granular or [],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_project(db, serial):
    project = Project(serial_number=serial, model_name="RRV-X")
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def hdr(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def make_sr(client, user, project):
    r = client.post(SR_URL, json={"project_id": project.id, "issue_title": "Leak", "service_type": "repair_breakdown"}, headers=hdr(user))
    assert r.status_code == 201, r.text
    return r.json()


def link_build(db, project, number="RB-T-001", status="planned"):
    build = ProductionRrvBuild(build_number=number, rrv_model="RRV-X", erp_project_id=project.id, status=status)
    db.add(build)
    db.commit()
    return build


# ── Machines ────────────────────────────────────────────────────────────────

def test_machine_linked_to_rrv_build_cannot_be_deleted(client, db):
    admin = make_user(db, "h_admin1@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-001")
    link_build(db, project)
    r = client.delete(f"{PROJ_URL}/{project.id}", headers=hdr(admin))
    assert r.status_code == 409
    assert "RB-T-001" in r.json()["detail"]


def test_machine_with_only_cancelled_build_can_be_deleted(client, db):
    admin = make_user(db, "h_admin2@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-002")
    link_build(db, project, "RB-T-002", status="cancelled")
    assert client.delete(f"{PROJ_URL}/{project.id}", headers=hdr(admin)).status_code == 204


def test_serial_rename_after_handover_is_admin_only(client, db):
    admin = make_user(db, "h_admin3@premnathrail.com", role="admin")
    editor = make_user(db, "h_editor3@premnathrail.com", erp_permissions=["project_edit"])
    project = make_project(db, "SN-H-003")
    link_build(db, project, "RB-T-003", status="handed_over")
    r = client.patch(f"{PROJ_URL}/{project.id}", json={"serial_number": "SN-H-003-NEW"}, headers=hdr(editor))
    assert r.status_code == 409
    assert "RB-T-003" in r.json()["detail"] and "admin" in r.json()["detail"]
    # Other fields still editable.
    assert client.patch(f"{PROJ_URL}/{project.id}", json={"site_name": "Itarsi"}, headers=hdr(editor)).status_code == 200
    # An admin can correct it, and the override is audited.
    r = client.patch(f"{PROJ_URL}/{project.id}", json={"serial_number": "SN-H-003-NEW"}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["serial_number"] == "SN-H-003-NEW"
    audit = client.get(f"{PROJ_URL}/{project.id}/audit", headers=hdr(admin)).json()
    assert any("Admin override" in (a["summary"] or "") for a in audit)


def test_serial_rename_frozen_after_rrv_completion(client, db):
    admin = make_user(db, "h_admin3b@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-003B")
    link_build(db, project, "RB-T-003B", status="completed")
    r = client.patch(f"{PROJ_URL}/{project.id}", json={"serial_number": "SN-H-003B-NEW"}, headers=hdr(admin))
    assert r.status_code == 409 and "reopen the RRV Completion stage" in r.json()["detail"]


def test_serial_rename_allowed_while_build_open_and_build_kept_in_step(client, db):
    admin = make_user(db, "h_admin3c@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-003C")
    build = link_build(db, project, "RB-T-003C", status="planned")
    r = client.patch(f"{PROJ_URL}/{project.id}", json={"serial_number": "SN-H-003C-NEW"}, headers=hdr(admin))
    assert r.status_code == 200, r.text
    db.refresh(build)
    assert build.vehicle_serial_number == "SN-H-003C-NEW"


def test_serial_clash_names_existing_machine(client, db):
    admin = make_user(db, "h_admin4@premnathrail.com", role="admin")
    make_project(db, "SN-H-004")
    r = client.post(PROJ_URL, json={"serial_number": "SN-H-004"}, headers=hdr(admin))
    assert r.status_code == 409
    assert "SN-H-004" in r.json()["detail"] and "machine #" in r.json()["detail"]


def test_machine_edit_can_clear_dates_but_not_required_fields(client, db):
    admin = make_user(db, "h_admin5@premnathrail.com", role="admin")
    created = client.post(PROJ_URL, json={
        "serial_number": "SN-H-005", "warranty_start_date": "2026-01-01", "warranty_end_date": "2027-01-01",
    }, headers=hdr(admin)).json()
    r = client.patch(f"{PROJ_URL}/{created['id']}", json={"warranty_start_date": None, "warranty_end_date": None, "site_name": None}, headers=hdr(admin))
    assert r.status_code == 200
    assert r.json()["warranty_start_date"] is None and r.json()["warranty_end_date"] is None
    for field in ("serial_number", "status", "is_export", "extended_warranty"):
        r = client.patch(f"{PROJ_URL}/{created['id']}", json={field: None}, headers=hdr(admin))
        assert r.status_code == 422, (field, r.text)
        assert "blank" in r.text


def test_machine_status_must_be_known(client, db):
    admin = make_user(db, "h_admin6@premnathrail.com", role="admin")
    r = client.post(PROJ_URL, json={"serial_number": "SN-H-006", "status": "flying"}, headers=hdr(admin))
    assert r.status_code == 422
    assert "manufacturing_under_progress" in r.text
    created = client.post(PROJ_URL, json={"serial_number": "SN-H-006"}, headers=hdr(admin)).json()
    assert client.patch(f"{PROJ_URL}/{created['id']}", json={"status": "flying"}, headers=hdr(admin)).status_code == 422
    assert client.patch(f"{PROJ_URL}/{created['id']}", json={"status": "standby"}, headers=hdr(admin)).status_code == 200


# ── Permission Matrix on read routes ────────────────────────────────────────

def test_sr_read_routes_respect_service_requests_tab(client, db):
    owner = make_user(db, "h_owner7@premnathrail.com", erp_permissions=["sr_create"])
    project = make_project(db, "SN-H-007")
    sr = make_sr(client, owner, project)
    # Matrix touched for erp, but no service_requests view.
    denied = make_user(db, "h_denied7@premnathrail.com", granular=["erp:projects:view"])
    for path in (f"{SR_URL}/{sr['id']}", f"{SR_URL}/{sr['id']}/audit", f"{SR_URL}/{sr['id']}/materials"):
        assert client.get(path, headers=hdr(denied)).status_code == 403, path
    allowed = make_user(db, "h_allowed7@premnathrail.com", granular=["erp:service_requests:view"])
    assert client.get(f"{SR_URL}/{sr['id']}", headers=hdr(allowed)).status_code == 200
    # SR viewers may read the SR's machine; a machines-only route stays closed.
    assert client.get(f"{PROJ_URL}/{project.id}", headers=hdr(allowed)).status_code == 200
    assert client.get(f"{PROJ_URL}/{project.id}/audit", headers=hdr(allowed)).status_code == 403


def test_audit_routes_404_for_unknown_record(client, db):
    admin = make_user(db, "h_admin8@premnathrail.com", role="admin")
    assert client.get(f"{SR_URL}/999999/audit", headers=hdr(admin)).status_code == 404
    assert client.get(f"{PROJ_URL}/999999/audit", headers=hdr(admin)).status_code == 404


# ── SR state guards ─────────────────────────────────────────────────────────

def test_raise_pr_blocked_on_closed_or_locked_sr(client, db):
    admin = make_user(db, "h_admin9@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-009")
    sr = make_sr(client, admin, project)
    row = db.get(ServiceRequest, sr["id"])
    row.status = "closed"
    db.commit()
    payload = {"items": [{"store_item_id": master_item(db, "Seal").id, "quantity": 1, "project_inhouse": "Project"}]}
    r = client.post(f"{SR_URL}/{sr['id']}/raise-pr", json=payload, headers=hdr(admin))
    assert r.status_code == 409 and "reopen" in r.json()["detail"]
    row.status = "in_progress"
    row.is_locked = True
    db.commit()
    assert client.post(f"{SR_URL}/{sr['id']}/raise-pr", json=payload, headers=hdr(admin)).status_code == 423


def test_delete_sr_twice_is_404_and_locked_sr_cannot_be_deleted(client, db):
    admin = make_user(db, "h_admin10@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-010")
    sr = make_sr(client, admin, project)
    assert client.delete(f"{SR_URL}/{sr['id']}", headers=hdr(admin)).status_code == 200
    assert client.delete(f"{SR_URL}/{sr['id']}", headers=hdr(admin)).status_code == 404
    sr2 = make_sr(client, admin, project)
    db.get(ServiceRequest, sr2["id"]).is_locked = True
    db.commit()
    assert client.delete(f"{SR_URL}/{sr2['id']}", headers=hdr(admin)).status_code == 423


def test_sr_restore_blocked_while_machine_in_recycle_bin(client, db):
    admin = make_user(db, "h_admin11@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-011")
    sr = make_sr(client, admin, project)
    assert client.delete(f"{PROJ_URL}/{project.id}", headers=hdr(admin)).status_code == 204
    r = client.post(f"{SR_URL}/{sr['id']}/restore", headers=hdr(admin))
    assert r.status_code == 409 and "SN-H-011" in r.json()["detail"]


def test_pr_linked_material_blocked_only_while_pr_live(client, db):
    from datetime import date
    from app.modules.p2p.models.p2p_request import P2PRequest
    admin = make_user(db, "h_admin12@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-012")
    sr = make_sr(client, admin, project)
    pr = P2PRequest(p2p_number="P2P-T-1", category_code="OTH", request_date=date.today(), status="approved")
    db.add(pr)
    db.commit()
    mat = ServiceMaterial(service_request_id=sr["id"], material_name="Pump", quantity=1, unit="pcs", pr_id=pr.id, pr_number="P2P-T-1")
    db.add(mat)
    db.commit()
    url = f"{SR_URL}/{sr['id']}/materials/{mat.id}"
    r = client.delete(url, headers=hdr(admin))
    assert r.status_code == 409 and "P2P-T-1" in r.json()["detail"] and "approved" in r.json()["detail"]
    r = client.patch(url, json={"quantity": 2}, headers=hdr(admin))
    assert r.status_code == 409 and "approved" in r.json()["detail"]
    # Once Purchase rejects the PR, the line is free again.
    pr.status = "rejected"
    db.commit()
    r = client.patch(url, json={"quantity": 2}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["pr_status"] == "rejected"
    assert client.delete(url, headers=hdr(admin)).status_code == 200


def test_sr_and_machine_delete_blocked_while_material_on_live_pr(client, db):
    from datetime import date
    from app.modules.p2p.models.p2p_request import P2PRequest
    admin = make_user(db, "h_admin12c@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-012C")
    sr = make_sr(client, admin, project)
    pr = P2PRequest(p2p_number="P2P-T-2", category_code="OTH", request_date=date.today(), status="approved")
    db.add(pr)
    db.commit()
    db.add(ServiceMaterial(service_request_id=sr["id"], material_name="Seal", quantity=1, unit="pcs", pr_id=pr.id, pr_number="P2P-T-2"))
    db.commit()
    r = client.delete(f"{SR_URL}/{sr['id']}", headers=hdr(admin))
    assert r.status_code == 409 and "P2P-T-2" in r.json()["detail"]
    r = client.delete(f"{PROJ_URL}/{project.id}", headers=hdr(admin))
    assert r.status_code == 409 and "P2P-T-2" in r.json()["detail"]
    # Once Purchase cancels the PR, both can go.
    pr.status = "cancelled"
    db.commit()
    assert client.delete(f"{SR_URL}/{sr['id']}", headers=hdr(admin)).status_code == 200
    assert client.delete(f"{PROJ_URL}/{project.id}", headers=hdr(admin)).status_code == 204


def test_receive_blocked_on_closed_sr(client, db):
    admin = make_user(db, "h_admin12d@premnathrail.com", role="admin")
    sr = make_sr(client, admin, make_project(db, "SN-H-012D"))
    mat = ServiceMaterial(service_request_id=sr["id"], material_name="Seal", quantity=2, unit="pcs")
    db.add(mat)
    db.commit()
    client.patch(f"{SR_URL}/{sr['id']}", json={"status": "closed", "resolution_description": "done"}, headers=hdr(admin))
    r = client.post(f"{SR_URL}/{sr['id']}/materials/{mat.id}/receive", json={"received_quantity": 1}, headers=hdr(admin))
    assert r.status_code == 409 and "reopen" in r.json()["detail"]


def test_machine_with_store_issue_history_points_to_decommission(client, db, monkeypatch):
    # A posted Store issue needs a whole Store fixture chain; stub the lookup.
    from app.modules.erp.routes import projects as proj_routes
    admin = make_user(db, "h_admin12b@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-012B")
    monkeypatch.setattr(proj_routes, "_machine_store_issues", lambda _db, _pid: ["MI-T-1"])
    r = client.delete(f"{PROJ_URL}/{project.id}", headers=hdr(admin))
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert "MI-T-1" in detail and "Decommissioned" in detail and "Cancel" not in detail


# ── Material + billing validation ───────────────────────────────────────────

def test_material_validation(client, db):
    admin = make_user(db, "h_admin13@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-013")
    sr = make_sr(client, admin, project)
    url = f"{SR_URL}/{sr['id']}/materials"
    assert client.post(url, json={"material_name": "  ", "quantity": 1}, headers=hdr(admin)).status_code == 422
    assert client.post(url, json={"material_name": "Seal", "quantity": 0}, headers=hdr(admin)).status_code == 422
    assert client.post(url, json={"material_name": "Seal", "quantity": 1, "estimated_budget": -5}, headers=hdr(admin)).status_code == 422
    assert client.post(url, json={"material_name": "Seal", "quantity": 1, "status": "lost"}, headers=hdr(admin)).status_code == 422
    mat = client.post(url, json={"material_name": "Seal", "quantity": 5}, headers=hdr(admin)).json()
    r = client.post(f"{url}/{mat['id']}/receive", json={"received_quantity": 6}, headers=hdr(admin))
    assert r.status_code == 400 and "at most 5" in r.json()["detail"]
    assert client.post(f"{url}/{mat['id']}/receive", json={"received_quantity": 3}, headers=hdr(admin)).status_code == 200
    r = client.patch(f"{url}/{mat['id']}", json={"quantity": 2}, headers=hdr(admin))
    assert r.status_code == 400 and "already received" in r.json()["detail"]
    r = client.patch(f"{url}/{mat['id']}", json={"quantity": 3}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["receiving_status"] == "received"


def test_billing_fields_validated_and_rolled_up(client, db):
    admin = make_user(db, "h_admin14@premnathrail.com", role="admin")
    project = make_project(db, "SN-H-014")
    sr = make_sr(client, admin, project)
    url = f"{SR_URL}/{sr['id']}"
    assert client.patch(url, json={"service_cost": -1}, headers=hdr(admin)).status_code == 422
    assert client.patch(url, json={"tax_percentage": 101}, headers=hdr(admin)).status_code == 422
    assert client.patch(url, json={"payment_status": "maybe"}, headers=hdr(admin)).status_code == 422
    # Invoice no. / payment status mirror the Finance invoice (erp/billing.py) — not typed here.
    r = client.patch(url, json={"payment_status": "invoiced", "invoice_number": " INV-1 "}, headers=hdr(admin))
    assert r.status_code == 422 and "Finance" in r.json()["detail"]
    r = client.patch(url, json={
        "service_cost": 1000, "transport_cost": 0, "tax_percentage": 10,
        "actual_date_attended": "2026-10-01", "actual_completion_date": None,
    }, headers=hdr(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_bill"] == 1100 and body["tax_amount"] == 100
    # Clearing a cost box sends null → stored as 0, not a 500.
    r = client.patch(url, json={"service_cost": None}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["total_bill"] == 0
