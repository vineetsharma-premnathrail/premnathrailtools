"""Purpose of a purchase requisition (p2p/purpose.py, 2026-10-23): the purpose
decides what the requisition must be charged to, overhead purposes make every
line Inhouse, and the old existing/new project type stays filled."""
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.organization.models.cost_center import CostCenter
from app.tests.p2p_workflow_helpers import master_item, set_pr_workflow
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _create_payload, _pr_approvers, _requester, _sqlite_number_series, auth_header,
)


def _post(client, db, requester, item, **over):
    set_pr_workflow(db, [u.id for u in _pr_approvers(db).values()], requester)
    body = _create_payload(project_label=None, project_type=None, category_code="ADM",
                           items=[{"store_item_id": item.id, "quantity": 3, "project_inhouse": "Project"}])
    body.update(over)
    return client.post(BASE, json=body, headers=auth_header(requester))


def test_department_running_cost_needs_a_cost_centre_and_is_inhouse(client, db):
    cc = CostCenter(code="CC-ADM", name="Administration", status="active")
    db.add(cc)
    db.commit()
    item = master_item(db, "Floor cleaner 5L", code="HK-FC-01")
    req = _requester(db, "purpose.req1@premnathrail.com")

    r = _post(client, db, req, item, purpose="department")
    assert r.status_code == 400 and "cost centre" in r.json()["detail"], r.text

    r = _post(client, db, req, item, purpose="department", account_assignment="internal_order", internal_order_id=1)
    assert r.status_code == 400 and "can't be charged to a internal order" in r.json()["detail"], r.text

    r = _post(client, db, req, item, purpose="department", account_assignment="cost_center", cost_center_id=cc.id)
    assert r.status_code == 200, r.text
    pr = r.json()
    assert pr["purpose"] == "department" and pr["project_type"] == "existing"
    assert pr["cost_center_id"] == cc.id and pr["project_label"] == "CC-ADM — Administration"
    # Sent as 'Project', stored Inhouse: overhead isn't bought for a customer project.
    assert pr["items"][0]["project_inhouse"] == "Inhouse"
    assert pr["p2p_number"].startswith("P2P-ADM-")


def test_capital_needs_internal_order_and_stock_takes_no_charge(client, db):
    io = InternalOrder(code="CAP-07", name="New CNC lathe", order_type="capital", status="in_progress")
    db.add(io)
    db.commit()
    item = master_item(db, "CNC lathe", code="CAP-CNC-01")
    req = _requester(db, "purpose.req2@premnathrail.com")

    # Category must fit the purpose (Asset: Capital Equipment, Electrical, …).
    r = _post(client, db, req, item, purpose="capital", account_assignment="internal_order", internal_order_id=io.id)
    assert r.status_code == 400 and "Office & Admin doesn't fit" in r.json()["detail"], r.text
    r = _post(client, db, req, item, purpose="capital", category_code="CAP")
    assert r.status_code == 400 and "Finance › Masters › Internal orders" in r.json()["detail"], r.text
    r = _post(client, db, req, item, purpose="capital", category_code="CAP", account_assignment="internal_order", internal_order_id=io.id)
    assert r.status_code == 200, r.text
    assert r.json()["internal_order_id"] == io.id and r.json()["p2p_number"].startswith("P2P-CAP-")

    r = _post(client, db, req, item, purpose="stock", category_code="HWC", account_assignment="internal_order", internal_order_id=io.id)
    assert r.status_code == 400 and "isn't charged to anything" in r.json()["detail"], r.text
    r = _post(client, db, req, item, purpose="stock", category_code="HWC")
    assert r.status_code == 200, r.text
    assert r.json()["project_label"] == "Store stock refill" and r.json()["account_assignment"] is None

    r = _post(client, db, req, item, purpose="development", category_code="RAW", account_assignment="internal_order", internal_order_id=io.id)
    assert r.status_code == 200 and r.json()["project_type"] == "new", r.text


def test_machine_project_needs_the_project_and_bad_purpose_refused(client, db):
    item = master_item(db, "Brake pad", code="SP-BP-01")
    req = _requester(db, "purpose.req3@premnathrail.com")
    r = _post(client, db, req, item, purpose="machine_project", category_code="PNH")
    assert r.status_code == 400 and "machine project" in r.json()["detail"], r.text
    r = _post(client, db, req, item, purpose="machine_project", category_code="PNH", project_label="PEW-17A — 4F-4R-4M-DDS")
    assert r.status_code == 200 and r.json()["items"][0]["project_inhouse"] == "Project", r.text
    r = _post(client, db, req, item, purpose="party")
    assert r.status_code == 400 and "Purpose must be one of" in r.json()["detail"], r.text
    # Others is never offered for a purpose: it has no buyer.
    r = _post(client, db, req, item, purpose="machine_project", category_code="OTH", project_label="PEW-17A")
    assert r.status_code == 400 and "doesn't fit" in r.json()["detail"], r.text
    # A draft may hold any category; submitting it checks.
    r = _post(client, db, req, item, purpose="machine_project", category_code="OTH", save_as_draft=True)
    assert r.status_code == 200, r.text
    r = client.post(f"{BASE}/{r.json()['id']}/submit", headers=auth_header(req))
    assert r.status_code == 400 and "doesn't fit" in r.json()["detail"], r.text
    # The form gets each purpose's categories and pre-filled values.
    meta = {p["code"]: p for p in client.get(f"{BASE}/meta", headers=auth_header(req)).json()["purposes"]}
    assert list(meta)[:2] == ["customer_order", "machine_project"]
    assert meta["customer_order"]["label"] == "Production (customer order)"
    assert meta["capital"]["default_category"] == "CAP" and meta["capital"]["default_requirement_type"] == "Capital Equipment"
    assert meta["department"]["default_category"] == "ADM" and meta["customer_order"]["default_category"] is None
    assert all("OTH" not in p["categories"] for p in meta.values())
