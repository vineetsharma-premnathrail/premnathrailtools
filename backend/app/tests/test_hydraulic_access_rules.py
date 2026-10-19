"""Hydraulic & Pneumatic: subtab gating on detail / export / document
endpoints, circuit-approved gate on BOM release, review-request notice on
circuit submit, pneumatic number series, and lookup unit costs for the BOM
form."""
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.hydraulic.models.document import HydDocument
from app.utils import notifications
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User

API = "/api/v1/hydraulic"
YEAR = date.today().year


def make_user(db, email, role="user", grants=None):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True,
                assigned_apps=["hydraulic"], granular_permissions=list(grants or []))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def attach_diagram(db, circuit_id):
    db.add(HydDocument(entity_type="circuit", entity_id=circuit_id, doc_type="circuit_diagram", title="Diagram", file_name="d.pdf"))
    db.commit()


@pytest.fixture
def eng(db):
    return make_user(db, "acc.hyd.eng@premnathrail.com")


@pytest.fixture
def h(eng):
    return auth(eng)


# ---------------------------------------------------------------------------
# Number series
# ---------------------------------------------------------------------------

def test_pneumatic_bom_and_test_use_p_series(client, h):
    pns = client.post(f"{API}/systems", json={"name": "Brake air", "system_type": "pneumatic"}, headers=h).json()
    hyd = client.post(f"{API}/systems", json={"name": "Power pack", "system_type": "hydraulic"}, headers=h).json()
    # The linked system decides the medium, whatever the payload says.
    pbom = client.post(f"{API}/boms", json={"title": "Air", "system_id": pns["id"], "system_type": "hydraulic"}, headers=h).json()
    hbom = client.post(f"{API}/boms", json={"title": "Oil", "system_id": hyd["id"]}, headers=h).json()
    assert pbom["bom_number"] == f"PBOM-{YEAR}-0001" and hbom["bom_number"] == f"HBOM-{YEAR}-0001"

    ptst = client.post(f"{API}/tests", json={"title": "Leak", "test_type": "leak_test", "system_id": pns["id"], "readings": [
        {"parameter": "Drop", "max_value": 1, "measured_value": 0.5},
    ]}, headers=h).json()
    htst = client.post(f"{API}/tests", json={"title": "Proof", "test_type": "proof_test", "system_id": hyd["id"]}, headers=h).json()
    assert ptst["test_number"] == f"PTST-{YEAR}-0001" and htst["test_number"] == f"HTST-{YEAR}-0001"
    client.post(f"{API}/tests/{ptst['id']}/complete", json={"result": "pass"}, headers=h)
    retest = client.post(f"{API}/tests/{ptst['id']}/retest", headers=h).json()
    assert retest["test_number"] == f"PTST-{YEAR}-0002"


# ---------------------------------------------------------------------------
# BOM release needs an approved circuit
# ---------------------------------------------------------------------------

def test_bom_release_waits_for_circuit_approval(client, db, h):
    reviewer = auth(make_user(db, "acc.hyd.rev@premnathrail.com"))
    pump = client.post(f"{API}/components", json={"name": "Pump", "category": "pump", "unit_cost": 100}, headers=h).json()
    ckt = client.post(f"{API}/circuits", json={"title": "Main"}, headers=h).json()
    bom = client.post(f"{API}/boms", json={"title": "Pack", "circuit_id": ckt["id"], "items": [{"component_id": pump["id"], "quantity": 1}]}, headers=h).json()

    r = client.post(f"{API}/boms/{bom['id']}/release", headers=h)
    assert r.status_code == 409 and f"{ckt['circuit_number']} Rev A is draft" in r.json()["detail"]
    attach_diagram(db, ckt["id"])
    client.post(f"{API}/circuits/{ckt['id']}/submit", headers=h)
    r = client.post(f"{API}/boms/{bom['id']}/release", headers=h)
    assert r.status_code == 409 and "is under review" in r.json()["detail"]
    client.post(f"{API}/circuits/{ckt['id']}/approve", json={}, headers=reviewer)
    assert client.post(f"{API}/boms/{bom['id']}/release", headers=h).json()["status"] == "released"


# ---------------------------------------------------------------------------
# Circuit submit notifies approvers
# ---------------------------------------------------------------------------

def test_submit_notifies_approve_grant_holders_on_teams(client, db, h, eng, monkeypatch):
    # The review request now goes through the central approval engine, which
    # notifies the stage approvers (bell + Teams) with notification_type "approval".
    approver = make_user(db, "acc.hyd.approver@premnathrail.com", grants=["hydraulic:circuits:view", "hydraulic:circuits:approve"])
    make_user(db, "acc.hyd.admin@premnathrail.com", role="admin")  # not a fallback while a grant holder exists
    calls = []
    real = notifications.notify_user

    def spy(db_, user_id, *args, **kw):
        calls.append((user_id, args[2] if len(args) > 2 else kw.get("notification_type"), kw.get("teams", False)))
        return real(db_, user_id, *args, **kw)

    monkeypatch.setattr(notifications, "notify_user", spy)
    ckt = client.post(f"{API}/circuits", json={"title": "Main"}, headers=h).json()
    attach_diagram(db, ckt["id"])
    assert client.post(f"{API}/circuits/{ckt['id']}/submit", headers=h).json()["status"] == "under_review"

    assert calls == [(approver.id, "approval", True)]
    note = db.query(Notification).filter_by(user_id=approver.id).one()
    assert note.entity_type == "hyd_circuit" and note.entity_id == ckt["id"] and "Approval needed" in note.title
    assert db.query(Notification).filter_by(user_id=eng.id).count() == 0


def test_submit_falls_back_to_admins_and_skips_the_submitter(client, db):
    admin = make_user(db, "acc.hyd.admin2@premnathrail.com", role="admin")
    other_admin = make_user(db, "acc.hyd.admin3@premnathrail.com", role="admin")
    ha = auth(admin)
    ckt = client.post(f"{API}/circuits", json={"title": "Main"}, headers=ha).json()
    attach_diagram(db, ckt["id"])
    client.post(f"{API}/circuits/{ckt['id']}/submit", headers=ha)
    notes = db.query(Notification).filter_by(notification_type="hyd_circuit_review").all()
    assert [n.user_id for n in notes] == [other_admin.id]


# ---------------------------------------------------------------------------
# Subtab gating on detail / export endpoints
# ---------------------------------------------------------------------------

def test_detail_and_export_endpoints_need_their_tab(client, db, h):
    system = client.post(f"{API}/systems", json={"name": "Pack"}, headers=h).json()
    ckt = client.post(f"{API}/circuits", json={"title": "Main"}, headers=h).json()
    bom = client.post(f"{API}/boms", json={"title": "Pack"}, headers=h).json()
    test = client.post(f"{API}/tests", json={"title": "Proof", "test_type": "proof_test", "system_id": system["id"]}, headers=h).json()
    calc = client.post(f"{API}/calculations", json={"title": "Motor", "calc_type": "pump_power", "inputs": {
        "flow_lpm": 40, "pressure_bar": 180, "overall_efficiency_pct": 85,
    }}, headers=h)
    assert calc.status_code == 200, calc.text
    urls = {
        "systems": f"{API}/systems/{system['id']}",
        "circuits": f"{API}/circuits/{ckt['id']}",
        "bom": f"{API}/boms/{bom['id']}",
        "testing": f"{API}/tests/{test['id']}",
        "calculations": f"{API}/calculations/{calc.json()['id']}",
    }
    # Restricted to Component Master only → every other detail is refused.
    comp_only = auth(make_user(db, "acc.hyd.comp@premnathrail.com", grants=["hydraulic:components:view"]))
    for url in [*urls.values(), f"{API}/boms/{bom['id']}/export"]:
        assert client.get(url, headers=comp_only).status_code == 403, url
    # Granted the tab → that detail opens.
    for tab, url in urls.items():
        viewer = auth(make_user(db, f"acc.hyd.{tab}@premnathrail.com", grants=[f"hydraulic:{tab}:view"]))
        assert client.get(url, headers=viewer).status_code == 200, url
    bom_viewer = auth(make_user(db, "acc.hyd.bomx@premnathrail.com", grants=["hydraulic:bom:view"]))
    assert client.get(f"{API}/boms/{bom['id']}/export", headers=bom_viewer).status_code == 200


def test_component_lookup_carries_unit_cost_for_bom_only_users(client, db, h):
    client.post(f"{API}/components", json={"name": "Pump", "category": "pump", "unit_cost": 2500}, headers=h)
    bom_only = auth(make_user(db, "acc.hyd.bomonly@premnathrail.com", grants=["hydraulic:bom:view", "hydraulic:bom:create"]))
    assert client.get(f"{API}/components", headers=bom_only).status_code == 403
    opts = client.get(f"{API}/lookups/components", headers=bom_only).json()
    assert [o["unit_cost"] for o in opts] == [2500]


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

def _upload(client, headers, entity_type, entity_id):
    return client.post(
        f"{API}/documents",
        data={"entity_type": entity_type, "entity_id": str(entity_id), "doc_type": "other", "title": "Cert"},
        files=[("files", ("cert.pdf", b"%PDF-1.4", "application/pdf"))],
        headers=headers,
    )


def test_document_upload_needs_edit_on_the_parent_tab(client, db, h):
    ckt = client.post(f"{API}/circuits", json={"title": "Main"}, headers=h).json()
    viewer = auth(make_user(db, "acc.hyd.viewer@premnathrail.com", grants=["hydraulic:circuits:view"]))
    r = _upload(client, viewer, "circuit", ckt["id"])
    assert r.status_code == 403 and "Circuits & Diagrams" in r.json()["detail"] and "Permission Matrix" in r.json()["detail"]

    # Deleting needs it too, even for the uploader.
    doc = HydDocument(entity_type="circuit", entity_id=ckt["id"], doc_type="other", title="Old", file_name="o.pdf",
                      uploaded_by_id=db.query(User).filter_by(email="acc.hyd.viewer@premnathrail.com").one().id)
    db.add(doc)
    db.commit()
    assert client.delete(f"{API}/documents/{doc.id}", headers=viewer).status_code == 403


def test_completed_test_and_retired_service_records_refuse_uploads(client, db, h, eng):
    system = client.post(f"{API}/systems", json={"name": "Pack"}, headers=h).json()
    t = client.post(f"{API}/tests", json={"title": "Proof", "test_type": "proof_test", "system_id": system["id"], "readings": [
        {"parameter": "Drop", "max_value": 2, "measured_value": 1},
    ]}, headers=h).json()
    client.post(f"{API}/tests/{t['id']}/complete", json={"result": "pass"}, headers=h)
    r = _upload(client, h, "test", t["id"])
    assert r.status_code == 409 and "re-test" in r.json()["detail"]

    doc = HydDocument(entity_type="test", entity_id=t["id"], doc_type="other", title="Cert", file_name="c.pdf", uploaded_by_id=eng.id)
    db.add(doc)
    db.commit()
    r = client.delete(f"{API}/documents/{doc.id}", headers=h)
    assert r.status_code == 409 and "locked" in r.json()["detail"]

    r = _upload(client, h, "service_record", 1)
    assert r.status_code == 410 and "plan rule R5" in r.json()["detail"]
