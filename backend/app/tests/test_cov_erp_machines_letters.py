"""Extra coverage for the ERP machine registry (machines registered from a
Production RRV build at completion/handover) and machine letters.
Complements test_erp_projects.py and test_rrv_builds.py (which runs the full
build → handover flow end to end) — here the registry hand-off is exercised
directly through production.service so its rules can be pinned one by one."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import create_access_token
from app.modules.erp.models.project import Project
from app.modules.erp.models.project_letter import ProjectLetter
from app.modules.main.models.user import User
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.production.service import apply_rrv_handover, register_rrv_machine

ERP = "/api/v1/erp"


def make_user(db, email, role="user", apps=("erp",), perms=None, **flags):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True,
             assigned_apps=list(apps), erp_permissions=list(perms or []), **flags)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def make_build(db, n=1, **kw):
    fields = dict(build_number=f"RRV-COV-{n:03d}", rrv_model="PR-RRV 4x4", customer_name="Northern Railway",
                  customer_po_number="NR/PO/1", vehicle_serial_number=f"PR-RRV-COV-{n}", chassis_number="CHS-1",
                  engine_number="ENG-1", warranty_months=12, required_tests=[])
    fields.update(kw)
    b = ProductionRrvBuild(**fields)
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


# --- Machine registry from RRV completion / handover --------------------------

def test_completion_registers_a_new_rrv_machine_and_links_the_build(db):
    build = make_build(db, 1, year_of_manufacture="2026")
    machine = register_rrv_machine(db, build)
    db.commit()
    assert build.erp_project_id == machine.id
    assert machine.serial_number == "PR-RRV-COV-1" and machine.machine_type == "RRV"
    assert machine.status == "manufacturing_under_progress"
    assert machine.model_name == "PR-RRV 4x4" and machine.client_company == "Northern Railway"
    assert machine.chassis_number == "CHS-1" and machine.engine_number == "ENG-1"
    assert machine.po_number == "NR/PO/1" and machine.handover_date is None


def test_handover_makes_machine_live_with_dates_and_warranty(db):
    build = make_build(db, 2, handover_date=date(2026, 1, 31), commissioning_date=date(2026, 1, 20),
                       handover_location="Ghaziabad depot", warranty_months=13)
    machine = apply_rrv_handover(db, build)
    db.commit()
    assert machine.status == "active"
    assert machine.delivery_date == machine.handover_date == machine.warranty_start_date == date(2026, 1, 31)
    assert machine.commissioning_date == date(2026, 1, 20)
    # 31 Jan + 13 months has no 31st → clamps to the end of February.
    assert machine.warranty_end_date == date(2027, 2, 28)
    assert machine.site_location == "Ghaziabad depot"


def test_handover_onto_pre_linked_machine_keeps_registry_values(db):
    machine = Project(serial_number="PRE-LINKED-1", client_company="Konkan Railway", site_location="Ratnagiri",
                      chassis_number="OLD-CHS", model_name="Legacy model", warranty_end_date=date(2030, 1, 1))
    db.add(machine)
    db.commit()
    build = make_build(db, 3, erp_project_id=machine.id, chassis_number="NEW-CHS", engine_number=None,
                       handover_date=date(2026, 6, 1), handover_location="Depot", warranty_months=0)
    out = apply_rrv_handover(db, build)
    db.commit()
    assert out.id == machine.id
    assert db.query(Project).count() == 1
    # Identity from the build wins; commercial/site data already on the machine is kept.
    assert out.chassis_number == "NEW-CHS"
    assert out.client_company == "Konkan Railway" and out.model_name == "Legacy model"
    assert out.site_location == "Ratnagiri"
    # warranty_months = 0 leaves the existing warranty end alone.
    assert out.warranty_end_date == date(2030, 1, 1)


def test_registration_refuses_a_serial_already_in_the_registry(db):
    db.add(Project(serial_number="PR-RRV-COV-4"))
    db.commit()
    build = make_build(db, 4)
    with pytest.raises(HTTPException) as exc:
        register_rrv_machine(db, build)
    assert exc.value.status_code == 409
    assert "PR-RRV-COV-4" in exc.value.detail and "Link that machine" in exc.value.detail


def test_handed_over_machine_is_visible_to_service_and_takes_warranty_srs(client, db):
    build = make_build(db, 5, handover_date=date.today(), warranty_months=18)
    machine = apply_rrv_handover(db, build)
    db.commit()
    user = make_user(db, "svc_after_handover@premnathrail.com", perms=["sr_create"])
    listed = client.get(f"{ERP}/projects?search=PR-RRV-COV-5", headers=auth(user)).json()
    assert [m["id"] for m in listed] == [machine.id]
    assert listed[0]["status"] == "active"
    r = client.post(f"{ERP}/service-requests", json={
        "project_id": machine.id, "issue_title": "Brake drag after handover", "service_type": "warranty",
    }, headers=auth(user))
    assert r.status_code == 201 and r.json()["service_type"] == "warranty"


# --- Letters ---------------------------------------------------------------

def _letter(invoice_no="INV/P1/26-27/005", **over):
    # General letters can no longer be created — the fixed delivery documents
    # are; a Delivery Cover Letter is the simplest of them.
    body = {"letter_type": "delivery_cover", "letter_date": "2026-10-06", "signatory_name": "Vineet", "signatory_designation": "Manager",
            "data": {"client": "DMRC", "loa_ref": "DMRC/LOA/12", "invoice_no": invoice_no, "documents": ["Packing List"]}}
    body.update(over)
    return body


def _machine(client, admin, serial):
    r = client.post(f"{ERP}/projects", json={"serial_number": serial}, headers=auth(admin))
    assert r.status_code == 201, r.text
    return r.json()


def test_letter_from_one_machine_is_unreachable_through_another(client, db):
    admin = make_user(db, "ltr_scope@premnathrail.com", role="admin")
    a, b = _machine(client, admin, "LTR-A"), _machine(client, admin, "LTR-B")
    letter = client.post(f"{ERP}/projects/{a['id']}/letters", json=_letter(), headers=auth(admin)).json()
    wrong = f"{ERP}/projects/{b['id']}/letters/{letter['id']}"
    assert client.get(f"{wrong}/file", headers=auth(admin)).status_code == 404
    assert client.patch(wrong, json=_letter(invoice_no="HIJACK"), headers=auth(admin)).status_code == 404
    assert client.delete(wrong, headers=auth(admin)).status_code == 404
    db.expire_all()
    row = db.get(ProjectLetter, letter["id"])
    assert row.subject == "Delivery Cover Letter" and row.data["invoice_no"] == "INV/P1/26-27/005" and not row.is_deleted


def test_letter_delete_is_soft_and_needs_delete_permission(client, db):
    admin = make_user(db, "ltr_del_admin@premnathrail.com", role="admin")
    editor = make_user(db, "ltr_editor@premnathrail.com", perms=["project_edit"])
    m = _machine(client, admin, "LTR-DEL")
    base = f"{ERP}/projects/{m['id']}/letters"
    letter = client.post(base, json=_letter(), headers=auth(editor))
    assert letter.status_code == 201
    lid = letter.json()["id"]
    r = client.delete(f"{base}/{lid}", headers=auth(editor))
    assert r.status_code == 403 and "erp:projects:delete" in r.json()["detail"]
    assert client.delete(f"{base}/{lid}", headers=auth(admin)).status_code == 200
    assert client.get(base, headers=auth(admin)).json() == []
    assert client.get(f"{base}/{lid}/file", headers=auth(admin)).status_code == 404
    db.expire_all()
    row = db.get(ProjectLetter, lid)
    assert row is not None and row.is_deleted and row.deleted_at is not None


def test_letter_revision_only_bumps_on_real_change(client, db):
    admin = make_user(db, "ltr_rev@premnathrail.com", role="admin")
    m = _machine(client, admin, "LTR-REV")
    base = f"{ERP}/projects/{m['id']}/letters"
    lid = client.post(base, json=_letter(), headers=auth(admin)).json()["id"]
    client.patch(f"{base}/{lid}", json=_letter(), headers=auth(admin))
    db.expire_all()
    assert db.get(ProjectLetter, lid).revision == 0
    client.patch(f"{base}/{lid}", json=_letter(invoice_no="INV/P1/26-27/006"), headers=auth(admin))
    db.expire_all()
    assert db.get(ProjectLetter, lid).revision == 1


def test_letters_on_machine_in_recycle_bin_are_404(client, db):
    admin = make_user(db, "ltr_bin@premnathrail.com", role="admin")
    m = _machine(client, admin, "LTR-BIN")
    assert client.delete(f"{ERP}/projects/{m['id']}", headers=auth(admin)).status_code == 204
    base = f"{ERP}/projects/{m['id']}/letters"
    assert client.get(base, headers=auth(admin)).status_code == 404
    assert client.post(base, json=_letter(), headers=auth(admin)).status_code == 404
    assert client.get(f"{ERP}/projects/{m['id']}/letter-defaults", headers=auth(admin)).status_code == 404


def test_letter_unknown_format_and_audit_trail(client, db):
    admin = make_user(db, "ltr_fmt@premnathrail.com", role="admin")
    m = _machine(client, admin, "LTR-FMT")
    base = f"{ERP}/projects/{m['id']}/letters"
    lid = client.post(base, json=_letter(), headers=auth(admin)).json()["id"]
    r = client.get(f"{base}/{lid}/file?format=xlsx", headers=auth(admin))
    assert r.status_code == 422 and "pdf" in r.json()["detail"]
    client.patch(f"{base}/{lid}", json=_letter(invoice_no="INV/P1/26-27/007"), headers=auth(admin))
    client.delete(f"{base}/{lid}", headers=auth(admin))
    actions = [a["action"] for a in client.get(f"{ERP}/projects/{m['id']}/audit", headers=auth(admin)).json()]
    for expected in ("letter_created", "letter_updated", "letter_deleted"):
        assert expected in actions


def test_letter_needs_erp_app_access(client, db):
    admin = make_user(db, "ltr_app_admin@premnathrail.com", role="admin")
    outsider = make_user(db, "ltr_outsider@premnathrail.com", apps=("crm",), perms=["project_edit"])
    m = _machine(client, admin, "LTR-APP")
    assert client.get(f"{ERP}/projects/{m['id']}/letters", headers=auth(outsider)).status_code == 403
    assert client.post(f"{ERP}/projects/{m['id']}/letters", json=_letter(), headers=auth(outsider)).status_code == 403


def test_letter_defaults_prefer_active_partner_then_last_letter(client, db):
    admin = make_user(db, "ltr_def_admin@premnathrail.com", role="admin")
    m = _machine(client, admin, "LTR-DEF")
    url = f"{ERP}/projects/{m['id']}/letter-defaults"

    empty = client.get(url, headers=auth(admin)).json()
    assert empty["source"] is None and empty["signatory_name"] is None

    client.post(f"{ERP}/projects/{m['id']}/letters", json=_letter(signatory_name="Last Signer"), headers=auth(admin))
    assert client.get(url, headers=auth(admin)).json()["source"] == "last_letter"

    # Inactive partners never become the default signatory.
    exited = User(email="aa_exited@premnathrail.com", name="Aa Exited", role="user", is_active=False, is_partner=True)
    partner = User(email="bb_partner@premnathrail.com", name="Bb Partner", role="user", is_active=True, is_partner=True,
                   assigned_apps=["erp"])
    db.add_all([exited, partner])
    db.commit()
    body = client.get(url, headers=auth(admin)).json()
    assert body["source"] == "partner" and body["signatory_name"] == "Bb Partner"
    assert body["signatory_designation"] == "Partner"
    assert [p["name"] for p in body["partners"]] == ["Bb Partner"]

    # A logged-in partner is picked over the alphabetically-first one.
    me = User(email="cc_partner@premnathrail.com", name="Cc Partner", role="user", is_active=True, is_partner=True,
              assigned_apps=["erp"])
    db.add(me)
    db.commit()
    assert client.get(url, headers=auth(me)).json()["signatory_name"] == "Cc Partner"
