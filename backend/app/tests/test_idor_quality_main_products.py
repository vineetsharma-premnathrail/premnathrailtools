"""IDOR / object-level authorization regressions for Quality, Main (users)
and Products: by-id mutations need the tab's action (not just module
access), records outside the data scope 403, documents of record check the
tab, and child rows are bound to the parent id in the URL."""
from datetime import date

import pytest

from app.modules.main.models.role import Role
from app.modules.main.models.user_document import UserDocument
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.models.quality_standard import QualityStandard
from app.tests.test_quality_phase1 import Q, hdr, make_user, setup_item


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


def _inspection(db, owner_id, number="FIN-IDOR-1"):
    insp = QualityInspection(inspection_number=number, inspection_type="final", item_name="RRV",
                             inspection_date=date.today(), status="pending", inspected_by_id=owner_id)
    db.add(insp)
    db.commit()
    return insp


# ── Quality: legacy inspections ─────────────────────────────────────────

def test_inspection_patch_needs_edit_on_its_tab(client, db):
    viewer = make_user(db, "idor.q.viewer@x.com", granular_permissions=["quality:final_inspection:view"])
    editor = make_user(db, "idor.q.editor@x.com", granular_permissions=["quality:final_inspection:view",
                                                                         "quality:final_inspection:edit"])
    insp = _inspection(db, viewer.id)
    r = client.patch(f"{Q}/inspections/{insp.id}", json={"remarks": "x"}, headers=hdr(viewer))
    assert r.status_code == 403 and "'Edit' permission on Quality › RRV Final Inspections" in r.json()["detail"]
    r = client.patch(f"{Q}/inspections/{insp.id}", json={"remarks": "ok"}, headers=hdr(editor))
    assert r.status_code == 200, r.text


def test_decided_inspection_is_frozen_except_remarks(client, db):
    editor = make_user(db, "frozen.q.editor@x.com", granular_permissions=[
        "quality:final_inspection:view", "quality:final_inspection:edit", "quality:final_inspection:delete"])
    insp = _inspection(db, editor.id, number="FIN-FROZEN-1")
    r = client.patch(f"{Q}/inspections/{insp.id}", json={"status": "passed", "item_name": "RRV"}, headers=hdr(editor))
    assert r.status_code == 200, r.text
    # The edit form re-sends unchanged fields: still fine, remarks change.
    r = client.patch(f"{Q}/inspections/{insp.id}", json={"status": "passed", "item_name": "RRV", "remarks": "noted"}, headers=hdr(editor))
    assert r.status_code == 200 and r.json()["remarks"] == "noted"
    r = client.patch(f"{Q}/inspections/{insp.id}", json={"status": "failed"}, headers=hdr(editor))
    assert r.status_code == 409 and "status" in r.json()["detail"] and "quality record" in r.json()["detail"]
    r = client.patch(f"{Q}/inspections/{insp.id}", json={"results": [{"parameter": "Brake test", "result": "fail"}]}, headers=hdr(editor))
    assert r.status_code == 409 and "results" in r.json()["detail"]
    r = client.delete(f"{Q}/inspections/{insp.id}", headers=hdr(editor))
    assert r.status_code == 409 and "can't be deleted" in r.json()["detail"]


def test_inspection_create_needs_create_on_its_tab(client, db):
    viewer = make_user(db, "idor.q.viewer2@x.com", granular_permissions=["quality:final_inspection:view"])
    r = client.post(f"{Q}/inspections", json={"inspection_type": "final", "item_name": "RRV",
                                             "inspection_date": str(date.today())}, headers=hdr(viewer))
    assert r.status_code == 403 and "'Create' permission on Quality › RRV Final Inspections" in r.json()["detail"]


def test_inspection_patch_outside_scope_403(client, db):
    other = make_user(db, "idor.q.other@x.com")
    role = Role(name="Quality own (idor)", permissions=["quality:*:*"], data_scopes={"quality": "own"})
    db.add(role)
    db.commit()
    me = make_user(db, "idor.q.own@x.com")
    me.roles = [role]
    db.commit()
    insp = _inspection(db, other.id, number="FIN-IDOR-2")
    r = client.patch(f"{Q}/inspections/{insp.id}", json={"remarks": "x"}, headers=hdr(me))
    assert r.status_code == 403 and "Own records" in r.json()["detail"]


# ── Quality: standards ──────────────────────────────────────────────────

def test_standard_patch_and_create_need_tab_actions(client, db):
    viewer = make_user(db, "idor.q.std@x.com", granular_permissions=["quality:standards:view"])
    std = QualityStandard(standard_code="IDOR-STD-1", title="Weld spec", status="active")
    db.add(std)
    db.commit()
    r = client.patch(f"{Q}/standards/{std.id}", json={"title": "Changed"}, headers=hdr(viewer))
    assert r.status_code == 403 and "'Edit' permission on Quality › Standards" in r.json()["detail"]
    r = client.post(f"{Q}/standards", json={"standard_code": "IDOR-STD-2", "title": "New", "status": "active"},
                    headers=hdr(viewer))
    assert r.status_code == 403 and "'Create' permission on Quality › Standards" in r.json()["detail"]
    editor = make_user(db, "idor.q.std2@x.com", granular_permissions=["quality:standards:view", "quality:standards:edit"])
    r = client.patch(f"{Q}/standards/{std.id}", json={"title": "Changed"}, headers=hdr(editor))
    assert r.status_code == 200, r.text


# ── Quality: documents of record (PDF) ──────────────────────────────────

def test_record_pdf_needs_view_on_the_records_tab(client, db):
    eng = make_user(db, "idor.q.eng@x.com", quality_role="engineer")
    item, _loc = setup_item(db, name="IDOR part")
    r = client.post(f"{Q}/ncr", json={"source": "internal", "severity": "minor", "item_id": item.id, "quantity": 1,
                                      "description": "Burr"}, headers=hdr(eng))
    assert r.status_code == 200, r.text
    ncr_id = r.json()["id"]
    dash_only = make_user(db, "idor.q.dash@x.com", granular_permissions=["quality:dashboard:view"])
    r = client.get(f"{Q}/records/ncr/{ncr_id}/deviation-approval.pdf", headers=hdr(dash_only))
    assert r.status_code == 403 and "'View' permission on Quality › Non-Conformance (NCR)" in r.json()["detail"]


# ── Main: user documents bound to the user in the URL ───────────────────

def test_user_document_bound_to_user_in_url(client, db):
    admin = make_user(db, "idor.main.admin@x.com", role="admin")
    a = make_user(db, "idor.main.a@x.com")
    b = make_user(db, "idor.main.b@x.com")
    doc_b = UserDocument(user_id=b.id, document_type="id", document_name="Passport", filename="p.pdf",
                         sharepoint_path="x/p.pdf")
    db.add(doc_b)
    db.commit()
    r = client.get(f"/api/v1/users/{a.id}/documents/{doc_b.id}/content", headers=hdr(admin))
    assert r.status_code == 404 and f"not found on user #{a.id}" in r.json()["detail"]
    r = client.delete(f"/api/v1/users/{a.id}/documents/{doc_b.id}", headers=hdr(admin))
    assert r.status_code == 404
    db.expire_all()
    assert db.get(UserDocument, doc_b.id) is not None
