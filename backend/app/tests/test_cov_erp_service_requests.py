"""Extra coverage for ERP Service & Commissioning service requests:
priority / service-type validation and filters, status lifecycle, billing
roll-up, material receiving, and material-photo scoping (ERP review C-08).
Complements test_erp_service_requests.py — no scenario there is repeated."""
from datetime import datetime, timedelta, timezone

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_material_attachment import ServiceMaterialAttachment
from app.modules.erp.models.service_request import SR_SERVICE_TYPES, ServiceRequest
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User

# Closing / sending for closure needs both actual execution dates.
CLOSE_READY = {"actual_date_attended": "2026-10-01", "actual_completion_date": "2026-10-02"}

API = "/api/v1/erp/service-requests"
ALL = ["sr_create", "sr_edit", "sr_delete"]


def make_user(db, email, role="user", apps=("erp",), perms=None):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True,
             assigned_apps=list(apps), erp_permissions=list(perms or []))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def make_project(db, serial, **kw):
    p = Project(serial_number=serial, model_name="RRV", **kw)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def new_sr(client, user, project, **extra):
    body = {"project_id": project.id, "issue_title": "Hydraulic leak", "service_type": "repair_breakdown", **extra}
    r = client.post(API, json=body, headers=auth(user))
    assert r.status_code == 201, r.text
    return r.json()


def add_photo(db, sr_id, name="Seal kit"):
    mat = ServiceMaterial(service_request_id=sr_id, material_name=name, quantity=1, unit="pcs")
    db.add(mat)
    db.flush()
    photo = ServiceMaterialAttachment(service_material_id=mat.id, filename=f"{name}.jpg", content_type="image/jpeg",
                                      sharepoint_path=f"x/{name}.jpg")
    db.add(photo)
    db.commit()
    return mat.id, photo.id


# --- Auth ------------------------------------------------------------------

def test_unauthenticated_requests_are_rejected(client, db):
    assert client.get(API).status_code in (401, 403)
    assert client.post(API, json={}).status_code in (401, 403, 422)


# --- Priority & service type -------------------------------------------------

def test_priority_defaults_to_standard_and_is_normalised(client, db):
    u = make_user(db, "prio1@premnathrail.com", perms=["sr_create"])
    p = make_project(db, "COV-PRIO-1")
    assert new_sr(client, u, p)["priority"] == "standard"
    assert new_sr(client, u, p, priority="  URGENT ")["priority"] == "urgent"


def test_invalid_priority_rejected_on_create_and_update(client, db):
    u = make_user(db, "prio2@premnathrail.com", perms=["sr_create", "sr_edit"])
    p = make_project(db, "COV-PRIO-2")
    r = client.post(API, json={"project_id": p.id, "issue_title": "x", "service_type": "amc", "priority": "high"}, headers=auth(u))
    assert r.status_code == 422
    assert "Standard or Urgent" in r.text
    sr = new_sr(client, u, p)
    r = client.patch(f"{API}/{sr['id']}", json={"priority": "low"}, headers=auth(u))
    assert r.status_code == 422
    r = client.patch(f"{API}/{sr['id']}", json={"priority": "urgent"}, headers=auth(u))
    assert r.status_code == 200 and r.json()["priority"] == "urgent"


@pytest.mark.parametrize("service_type", SR_SERVICE_TYPES)
def test_every_service_type_is_accepted(client, db, service_type):
    u = make_user(db, f"st_{service_type}@premnathrail.com", perms=["sr_create"])
    p = make_project(db, f"COV-ST-{service_type}")
    assert new_sr(client, u, p, service_type=service_type.upper())["service_type"] == service_type


def test_service_type_can_be_changed_but_not_to_an_unknown_value(client, db):
    u = make_user(db, "st_patch@premnathrail.com", perms=["sr_create", "sr_edit"])
    sr = new_sr(client, u, make_project(db, "COV-ST-PATCH"))
    assert client.patch(f"{API}/{sr['id']}", json={"service_type": "free_visit"}, headers=auth(u)).status_code == 422
    r = client.patch(f"{API}/{sr['id']}", json={"service_type": "warranty"}, headers=auth(u))
    assert r.status_code == 200 and r.json()["service_type"] == "warranty"


def test_list_filters_by_priority_service_type_and_project(client, db):
    u = make_user(db, "filt@premnathrail.com", perms=["sr_create"])
    p1, p2 = make_project(db, "COV-F-1"), make_project(db, "COV-F-2")
    a = new_sr(client, u, p1, priority="urgent", service_type="warranty")
    b = new_sr(client, u, p1, service_type="amc")
    c = new_sr(client, u, p2, service_type="warranty")
    ids = lambda q: {s["id"] for s in client.get(f"{API}?{q}", headers=auth(u)).json()}  # noqa: E731
    assert ids("priority=urgent") == {a["id"]}
    assert ids("service_type=warranty") == {a["id"], c["id"]}
    assert ids(f"project_id={p1.id}") == {a["id"], b["id"]}
    assert ids(f"project_id={p2.id}&service_type=amc") == set()


def test_search_matches_machine_serial_number(client, db):
    u = make_user(db, "srch@premnathrail.com", perms=["sr_create"])
    target = new_sr(client, u, make_project(db, "UNIQ-SERIAL-77"))
    new_sr(client, u, make_project(db, "OTHER-1"))
    res = client.get(f"{API}?search=UNIQ-SERIAL", headers=auth(u)).json()
    assert [s["id"] for s in res] == [target["id"]]


def test_request_numbers_run_in_sequence(client, db):
    u = make_user(db, "seq@premnathrail.com", perms=["sr_create"])
    p = make_project(db, "COV-SEQ")
    first, second = new_sr(client, u, p), new_sr(client, u, p)
    n1, n2 = int(first["request_number"].rsplit("-", 1)[1]), int(second["request_number"].rsplit("-", 1)[1])
    assert n2 == n1 + 1
    assert first["request_number"].rsplit("-", 1)[0] == second["request_number"].rsplit("-", 1)[0]


def test_cannot_raise_sr_against_machine_in_recycle_bin(client, db):
    u = make_user(db, "binproj@premnathrail.com", perms=["sr_create"])
    p = make_project(db, "COV-BINNED")
    p.is_deleted = True
    db.commit()
    r = client.post(API, json={"project_id": p.id, "issue_title": "x", "service_type": "amc"}, headers=auth(u))
    assert r.status_code == 404


# --- Lifecycle ---------------------------------------------------------------

def test_full_status_lifecycle_and_reopen_clears_closed_date(client, db):
    u = make_user(db, "life@premnathrail.com", perms=["sr_create", "sr_edit"])
    sr = new_sr(client, u, make_project(db, "COV-LIFE"))
    url = f"{API}/{sr['id']}"
    for status in ("acknowledged", "assigned", "scheduled", "in_progress", "pending_parts", "work_completed", "review"):
        r = client.patch(url, json={"status": status}, headers=auth(u))
        assert r.status_code == 200 and r.json()["status"] == status
        assert r.json()["closed_at"] is None
    r = client.patch(url, json={**CLOSE_READY, "status": "closed", "resolution_description": "Replaced seal"}, headers=auth(u))
    assert r.status_code == 200 and r.json()["closed_at"] is not None
    # Reopening a closed SR needs a reason (kept in the audit trail).
    assert client.patch(url, json={"status": "in_progress"}, headers=auth(u)).status_code == 422
    r = client.patch(url, json={"status": "in_progress", "status_reason": "Leak came back"}, headers=auth(u))
    assert r.status_code == 200 and r.json()["closed_at"] is None

    audit = client.get(f"{url}/audit", headers=auth(u)).json()
    status_rows = [a for a in audit if a["action"] == "field_updated" and a["field_name"] == "Status"]
    assert status_rows[0]["old_value"] == "open" and status_rows[0]["new_value"] == "acknowledged"
    assert status_rows[-1]["old_value"] == "closed" and status_rows[-1]["new_value"] == "in_progress"
    assert all(a["performed_by"] == "life" for a in audit)


def test_unchanged_fields_write_no_audit_row(client, db):
    u = make_user(db, "noop@premnathrail.com", perms=["sr_create", "sr_edit"])
    sr = new_sr(client, u, make_project(db, "COV-NOOP"))
    before = db.query(AuditLog).filter(AuditLog.entity_type == "service_request", AuditLog.entity_id == sr["id"]).count()
    assert client.patch(f"{API}/{sr['id']}", json={"issue_title": sr["issue_title"]}, headers=auth(u)).status_code == 200
    after = db.query(AuditLog).filter(AuditLog.entity_type == "service_request", AuditLog.entity_id == sr["id"]).count()
    assert after == before


def test_already_closed_sr_can_be_re_saved_without_corrective_action_check(client, db):
    admin = make_user(db, "closed_resave@premnathrail.com", role="admin")
    sr = new_sr(client, admin, make_project(db, "COV-RESAVE"))
    client.patch(f"{API}/{sr['id']}", json={**CLOSE_READY, "status": "closed", "resolution_description": "done"}, headers=auth(admin))
    r = client.patch(f"{API}/{sr['id']}", json={**CLOSE_READY, "status": "closed", "resolution_description": "done"}, headers=auth(admin))
    assert r.status_code == 200


def test_closed_sr_freezes_technical_record_but_allows_billing(client, db):
    admin = make_user(db, "closed_frozen@premnathrail.com", role="admin")
    sr = new_sr(client, admin, make_project(db, "COV-FROZEN"))
    url = f"{API}/{sr['id']}"
    client.patch(url, json={**CLOSE_READY, "status": "closed", "resolution_description": "done"}, headers=auth(admin))
    r = client.patch(url, json={**CLOSE_READY, "status": "closed", "service_report_notes": "x"}, headers=auth(admin))
    assert r.status_code == 409 and "Reopen it first" in r.json()["detail"]
    r = client.patch(url, json={"resolution_description": "something else"}, headers=auth(admin))
    assert r.status_code == 409
    # Invoicing happens after closure.
    # Invoicing happens after closure: costs stay editable; the invoice no. comes from the Finance invoice.
    r = client.patch(url, json={"service_cost": 500}, headers=auth(admin))
    assert r.status_code == 200 and r.json()["total_bill"] > 0
    r = client.patch(url, json={"invoice_number": "INV-1"}, headers=auth(admin))
    assert r.status_code == 422


def test_sr_cannot_be_created_past_the_opening_steps(client, db):
    u = make_user(db, "createstat@premnathrail.com", perms=["sr_create"])
    p = make_project(db, "COV-CREATESTAT")
    for status in ("review", "work_completed", "cancelled", "closed"):
        r = client.post(API, json={"project_id": p.id, "issue_title": "x", "service_type": "amc", "status": status}, headers=auth(u))
        assert r.status_code == 422, status
    r = client.post(API, json={"project_id": p.id, "issue_title": "x", "service_type": "amc", "status": "assigned"}, headers=auth(u))
    assert r.status_code == 201 and r.json()["status"] == "assigned"


def test_billing_rolls_up_costs_tax_and_materials(client, db):
    u = make_user(db, "bill@premnathrail.com", perms=ALL)
    sr = new_sr(client, u, make_project(db, "COV-BILL"))
    url = f"{API}/{sr['id']}"
    r = client.patch(url, json={"service_cost": 1000, "transport_cost": 200, "accommodation_cost": 300,
                                "miscellaneous_cost": 100, "tax_percentage": 10}, headers=auth(u)).json()
    assert r["tax_amount"] == pytest.approx(160) and r["total_bill"] == pytest.approx(1760)

    mat = client.post(f"{url}/materials", json={"material_name": "Pump", "estimated_budget": 400}, headers=auth(u)).json()
    body = client.get(url, headers=auth(u)).json()
    assert body["total_material_cost"] == pytest.approx(400)
    assert body["total_bill"] == pytest.approx(2000 * 1.1)

    client.patch(f"{url}/materials/{mat['id']}", json={"estimated_budget": 900}, headers=auth(u))
    assert client.get(url, headers=auth(u)).json()["total_material_cost"] == pytest.approx(900)

    client.delete(f"{url}/materials/{mat['id']}", headers=auth(u))
    body = client.get(url, headers=auth(u)).json()
    assert body["total_material_cost"] == 0 and body["total_bill"] == pytest.approx(1760)


# --- Delete / restore ------------------------------------------------------

def test_other_user_with_delete_permission_cannot_delete_or_restore(client, db):
    owner = make_user(db, "del_owner@premnathrail.com", perms=ALL)
    other = make_user(db, "del_other@premnathrail.com", perms=ALL)
    sr = new_sr(client, owner, make_project(db, "COV-DEL"))
    assert client.delete(f"{API}/{sr['id']}", headers=auth(other)).status_code == 403
    assert client.delete(f"{API}/{sr['id']}", headers=auth(owner)).status_code == 200
    assert client.post(f"{API}/{sr['id']}/restore", headers=auth(other)).status_code == 403
    assert client.post(f"{API}/{sr['id']}/restore", headers=auth(owner)).status_code == 200
    # Restoring a live SR is a 404, not a silent success.
    assert client.post(f"{API}/{sr['id']}/restore", headers=auth(owner)).status_code == 404


def test_deleting_an_sr_already_in_recycle_bin_is_404(client, db):
    u = make_user(db, "redel@premnathrail.com", perms=ALL)
    sr = new_sr(client, u, make_project(db, "COV-REDEL"))
    assert client.delete(f"{API}/{sr['id']}", headers=auth(u)).status_code == 200
    assert client.delete(f"{API}/{sr['id']}", headers=auth(u)).status_code == 404


def test_recycle_bin_reports_days_remaining(client, db):
    u = make_user(db, "binlist@premnathrail.com", perms=ALL)
    sr = new_sr(client, u, make_project(db, "COV-BINLIST"))
    client.delete(f"{API}/{sr['id']}", headers=auth(u))
    row = db.get(ServiceRequest, sr["id"])
    row.deleted_at = datetime.now(timezone.utc) - timedelta(days=4)
    db.commit()
    item = next(i for i in client.get(f"{API}/recycle-bin", headers=auth(u)).json() if i["id"] == sr["id"])
    assert item["days_remaining"] in (5, 6)
    assert item["request_number"] == sr["request_number"]


# --- Material receiving -------------------------------------------------------

def test_receive_material_partial_full_and_clamped(client, db):
    u = make_user(db, "recv@premnathrail.com", perms=["sr_create", "sr_edit"])
    sr = new_sr(client, u, make_project(db, "COV-RECV"))
    base = f"{API}/{sr['id']}/materials"
    mat = client.post(base, json={"material_name": "Hose", "quantity": 4}, headers=auth(u)).json()
    recv = f"{base}/{mat['id']}/receive"

    assert client.post(recv, json={"received_quantity": -1}, headers=auth(u)).status_code == 400
    r = client.post(recv, json={"received_quantity": 2}, headers=auth(u)).json()
    assert r["receiving_status"] == "partial" and r["received_quantity"] == 2 and r["status"] == "pending"
    # Over-receipt is refused with the maximum, not silently clamped.
    over = client.post(recv, json={"received_quantity": 99}, headers=auth(u))
    assert over.status_code == 400 and "at most 4" in over.json()["detail"]
    r = client.post(recv, json={"received_quantity": 4}, headers=auth(u)).json()
    assert r["receiving_status"] == "received" and r["received_quantity"] == 4 and r["status"] == "issued"
    r = client.post(recv, json={"received_quantity": 0}, headers=auth(u)).json()
    assert r["receiving_status"] == "pending"
    assert any(a["action"] == "material_received" for a in client.get(f"{API}/{sr['id']}/audit", headers=auth(u)).json())


def test_receive_material_from_another_sr_is_404(client, db):
    u = make_user(db, "recv2@premnathrail.com", perms=["sr_create", "sr_edit"])
    p = make_project(db, "COV-RECV2")
    sr_a, sr_b = new_sr(client, u, p), new_sr(client, u, p)
    mat = client.post(f"{API}/{sr_a['id']}/materials", json={"material_name": "Hose"}, headers=auth(u)).json()
    r = client.post(f"{API}/{sr_b['id']}/materials/{mat['id']}/receive", json={"received_quantity": 1}, headers=auth(u))
    assert r.status_code == 404
    r = client.patch(f"{API}/{sr_b['id']}/materials/{mat['id']}", json={"quantity": 9}, headers=auth(u))
    assert r.status_code == 404


# --- Material photos: ERP review C-08 (IDOR) ------------------------------------

def test_photo_cannot_be_deleted_through_another_material_on_same_sr(client, db):
    u = make_user(db, "photo_mat@premnathrail.com", perms=ALL)
    sr = new_sr(client, u, make_project(db, "COV-PH-1"))
    mat_a, photo_a = add_photo(db, sr["id"], "A")
    mat_b, _ = add_photo(db, sr["id"], "B")
    r = client.delete(f"{API}/{sr['id']}/materials/{mat_b}/attachments/{photo_a}", headers=auth(u))
    assert r.status_code == 404
    assert db.get(ServiceMaterialAttachment, photo_a) is not None


def test_other_users_photo_delete_forbidden_even_with_all_permissions(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")
    owner = make_user(db, "ph_owner@premnathrail.com", perms=ALL)
    intruder = make_user(db, "ph_intruder@premnathrail.com", perms=ALL)
    viewer = make_user(db, "ph_viewer@premnathrail.com")
    sr = new_sr(client, owner, make_project(db, "COV-PH-2"))
    mat, photo = add_photo(db, sr["id"])
    url = f"{API}/{sr['id']}/materials/{mat}/attachments/{photo}"
    assert client.delete(url, headers=auth(intruder)).status_code == 403
    assert client.delete(url, headers=auth(viewer)).status_code == 403
    db.expire_all()
    assert db.get(ServiceMaterialAttachment, photo) is not None
    # Upload is gated the same way.
    r = client.post(f"{API}/{sr['id']}/materials/{mat}/attachments",
                    files={"files": ("p.jpg", b"\xff\xd8", "image/jpeg")}, headers=auth(intruder))
    assert r.status_code == 403


def test_admin_can_delete_any_photo(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")
    owner = make_user(db, "ph_owner3@premnathrail.com", perms=ALL)
    admin = make_user(db, "ph_admin3@premnathrail.com", role="admin")
    sr = new_sr(client, owner, make_project(db, "COV-PH-3"))
    mat, photo = add_photo(db, sr["id"])
    assert client.delete(f"{API}/{sr['id']}/materials/{mat}/attachments/{photo}", headers=auth(admin)).status_code == 200
    db.expire_all()
    assert db.get(ServiceMaterialAttachment, photo) is None


def test_photo_on_deleted_material_or_binned_sr_is_unreachable(client, db):
    u = make_user(db, "ph_gone@premnathrail.com", perms=ALL)
    p = make_project(db, "COV-PH-4")
    sr = new_sr(client, u, p)
    mat, photo = add_photo(db, sr["id"])
    assert client.delete(f"{API}/{sr['id']}/materials/{mat}", headers=auth(u)).status_code == 200
    assert client.delete(f"{API}/{sr['id']}/materials/{mat}/attachments/{photo}", headers=auth(u)).status_code == 404
    assert client.get(f"{API}/{sr['id']}/materials/{mat}/attachments/{photo}/content", headers=auth(u)).status_code == 404

    sr2 = new_sr(client, u, p)
    mat2, photo2 = add_photo(db, sr2["id"])
    client.delete(f"{API}/{sr2['id']}", headers=auth(u))
    assert client.delete(f"{API}/{sr2['id']}/materials/{mat2}/attachments/{photo2}", headers=auth(u)).status_code == 404
    assert client.get(f"{API}/{sr2['id']}/materials/{mat2}/attachments/{photo2}/preview", headers=auth(u)).status_code == 404


def test_photo_preview_is_scoped_to_its_own_sr(client, db):
    owner = make_user(db, "ph_prev_o@premnathrail.com", perms=ALL)
    other = make_user(db, "ph_prev_x@premnathrail.com", perms=ALL)
    p = make_project(db, "COV-PH-5")
    victim, own = new_sr(client, owner, p), new_sr(client, other, p)
    mat, photo = add_photo(db, victim["id"])
    r = client.get(f"{API}/{own['id']}/materials/{mat}/attachments/{photo}/preview", headers=auth(other))
    assert r.status_code == 404


def test_locked_sr_rejects_photo_delete(client, db):
    u = make_user(db, "ph_lock@premnathrail.com", perms=ALL)
    sr = new_sr(client, u, make_project(db, "COV-PH-6"))
    mat, photo = add_photo(db, sr["id"])
    db.get(ServiceRequest, sr["id"]).is_locked = True
    db.commit()
    assert client.delete(f"{API}/{sr['id']}/materials/{mat}/attachments/{photo}", headers=auth(u)).status_code == 423


def test_material_photo_upload_rejects_non_images(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site-123")
    u = make_user(db, "ph_type@premnathrail.com", perms=ALL)
    sr = new_sr(client, u, make_project(db, "COV-PH-7"))
    mat = client.post(f"{API}/{sr['id']}/materials", json={"material_name": "Gasket"}, headers=auth(u)).json()
    r = client.post(f"{API}/{sr['id']}/materials/{mat['id']}/attachments",
                    files={"files": ("spec.pdf", b"%PDF-1.4", "application/pdf")}, headers=auth(u))
    assert r.status_code == 400
    assert "not an image" in r.json()["detail"]


def test_sr_attachment_delete_is_scoped_to_its_own_sr(client, db):
    from app.modules.erp.models.service_request_attachment import ServiceRequestAttachment
    owner = make_user(db, "att_o@premnathrail.com", perms=ALL)
    other = make_user(db, "att_x@premnathrail.com", perms=ALL)
    p = make_project(db, "COV-ATT")
    victim, own = new_sr(client, owner, p), new_sr(client, other, p)
    att = ServiceRequestAttachment(service_request_id=victim["id"], filename="report.pdf")
    db.add(att)
    db.commit()
    assert client.delete(f"{API}/{own['id']}/attachments/{att.id}", headers=auth(other)).status_code == 404
    assert client.delete(f"{API}/{victim['id']}/attachments/{att.id}", headers=auth(other)).status_code == 403
    assert client.get(f"{API}/{own['id']}/attachments/{att.id}/content", headers=auth(other)).status_code == 404
    db.expire_all()
    assert db.get(ServiceRequestAttachment, att.id) is not None
