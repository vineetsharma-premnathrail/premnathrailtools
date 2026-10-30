"""PM 'New Project' create rules (2026-10-30): no Finance budget at create, an optional
CRM source (inquiry / tender) that must exist, priority is Standard or Urgent."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.main.models.user import User
from app.modules.projects.models.project import PmProject

API = "/api/v1"
TODAY = date.today()


@pytest.fixture
def partner(db):
    user = User(email="cr.partner@x.com", name="cr.partner", role="user", assigned_apps=["projects"], is_active=True, is_partner=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def _body(**extra):
    data = {"name": "Tamping", "client_name": "RVNL", "customer_po_ref": "PO/1", "sales_order_ref": "SO-1",
            "start_date": str(TODAY), "target_handover_date": str(TODAY + timedelta(days=30))}
    data.update(extra)
    return data


def _with_machine(**extra):
    data = {"name": "Tamping", "sales_order_ref": "SO-1", "start_date": str(TODAY),
            "target_handover_date": str(TODAY + timedelta(days=30)),
            "machine": {"client_company": "RVNL", "po_number": "PO-77", "model_name": "TM-1"}}
    data.update(extra)
    return data


def _inquiry(db, uid="INQ-CR-1"):
    org = Organization(name=f"Org {uid}", org_type="Customer")
    db.add(org)
    db.flush()
    inq = Inquiry(universal_id=uid, org_id=org.id, lead_source="Direct")
    db.add(inq)
    db.commit()
    db.refresh(inq)
    return inq


def test_budget_is_refused_on_create_with_the_fix(client, db, partner):
    for url, body in ((f"{API}/projects", _body(internal_order_id=1)), (f"{API}/projects/with-machine", _with_machine(internal_order_id=1))):
        r = client.post(url, headers=_h(partner), json=body)
        assert r.status_code == 422 and "link a budget later from the project's Overview" in r.json()["detail"], r.text
    assert db.query(PmProject).count() == 0


def test_crm_source_is_saved_and_returned(client, db, partner):
    inq = _inquiry(db)
    r = client.post(f"{API}/projects/with-machine", headers=_h(partner), json=_with_machine(source_kind="inquiry", source_id=inq.id))
    assert r.status_code == 200, r.text
    assert r.json()["source_kind"] == "inquiry" and r.json()["source_id"] == inq.id
    db.expire_all()
    assert db.get(PmProject, r.json()["id"]).source_id == inq.id


def test_crm_source_must_exist_and_be_complete(client, db, partner):
    r = client.post(f"{API}/projects", headers=_h(partner), json=_body(source_kind="inquiry", source_id=9999))
    assert r.status_code == 422 and "doesn't exist" in r.json()["detail"], r.text
    r = client.post(f"{API}/projects", headers=_h(partner), json=_body(source_kind="order", source_id=1))
    assert r.status_code == 422 and "inquiry or a tender" in r.json()["detail"], r.text
    r = client.post(f"{API}/projects", headers=_h(partner), json=_body(source_kind="tender"))
    assert r.status_code == 422 and "Pick which tender" in r.json()["detail"], r.text
    assert db.query(PmProject).count() == 0


def test_project_without_source_still_works_and_priority_defaults_standard(client, db, partner):
    r = client.post(f"{API}/projects", headers=_h(partner), json=_body())
    assert r.status_code == 200, r.text
    assert r.json()["source_kind"] is None and r.json()["priority"] == "standard"


def test_priority_is_standard_or_urgent(client, db, partner):
    r = client.post(f"{API}/projects", headers=_h(partner), json=_body(priority="critical"))
    assert r.status_code == 422 and "Standard or Urgent" in r.json()["detail"], r.text
    r = client.post(f"{API}/projects", headers=_h(partner), json=_body(priority="Urgent"))
    assert r.status_code == 200 and r.json()["priority"] == "urgent", r.text
    r = client.patch(f"{API}/projects/{r.json()['id']}", headers=_h(partner), json={"priority": "standard"})
    assert r.status_code == 200 and r.json()["priority"] == "standard", r.text
