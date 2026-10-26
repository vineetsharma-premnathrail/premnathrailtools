"""Purpose of a purchase requisition (p2p/purpose.py, 2026-10-23): the purpose
decides what the requisition must be charged to, overhead purposes make every
line Inhouse, the old existing/new project type stays filled, and a department
running cost's cost centre is set on the PO (not the PR)."""
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.organization.models.cost_center import CostCenter
from app.modules.organization.models.department import Department
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.tests.p2p_workflow_helpers import master_item, set_po_workflow, set_pr_workflow
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _approve_pr, _create_payload, _create_pr, _pr_approvers, _purchaser, _raise_po, _requester, _sqlite_number_series,
    auth_header,
)


def _post(client, db, requester, item, **over):
    set_pr_workflow(db, [u.id for u in _pr_approvers(db).values()], requester)
    body = _create_payload(project_label=None, project_type=None, category_code="ADM",
                           items=[{"store_item_id": item.id, "quantity": 3, "project_inhouse": "Project"}])
    body.update(over)
    return client.post(BASE, json=body, headers=auth_header(requester))


def test_department_running_cost_takes_no_cost_centre_and_is_inhouse(client, db):
    item = master_item(db, "Floor cleaner 5L", code="HK-FC-01")
    req = _requester(db, "purpose.req1@premnathrail.com")

    # The cost centre is Purchase's job on the PO — the requisition needs none.
    r = _post(client, db, req, item, purpose="department")
    assert r.status_code == 200, r.text
    pr = r.json()
    assert pr["purpose"] == "department" and pr["project_type"] == "existing"
    assert pr["cost_center_id"] is None and pr["project_label"] == "Department running cost"
    # Sent as 'Project', stored Inhouse: overhead isn't bought for a customer project.
    assert pr["items"][0]["project_inhouse"] == "Inhouse"
    assert pr["p2p_number"].startswith("P2P-ADM-")

    r = _post(client, db, req, item, purpose="department", account_assignment="internal_order", internal_order_id=1)
    assert r.status_code == 400 and "can't be charged to a internal order" in r.json()["detail"], r.text


def test_department_po_gets_the_department_cost_centre_and_needs_one(client, db):
    dept = Department(name="Administration", code="ADMIN")
    db.add(dept)
    db.flush()
    cc = CostCenter(code="CC-ADM", name="Administration", status="active", department_id=dept.id)
    db.add(cc)
    db.commit()
    buyer = _purchaser(db, "purpose.buyer1@premnathrail.com")

    # Requester's department has a cost centre -> the PO starts with it.
    req = _requester(db, "purpose.req4@premnathrail.com")
    req.department = "Administration"
    db.commit()
    pr = _create_pr(client, req, purpose="department", category_code="ADM", project_label=None, project_type=None,
                    items=[{"item_name": "Floor cleaner", "quantity": 2, "unit": "pcs", "project_inhouse": "Inhouse"}])
    _raise_po(client, db, pr, buyer, po_number="PO-ADM-1")
    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.po_number == "PO-ADM-1").one()
    assert po.cost_center_id == cc.id

    # No cost centre for the department -> the PO can't go for approval, and says why.
    req2 = _requester(db, "purpose.req5@premnathrail.com")
    req2.department = "Canteen"
    db.commit()
    pr2 = _create_pr(client, req2, purpose="department", category_code="ADM", project_label=None, project_type=None,
                     items=[{"item_name": "Tea cups", "quantity": 20, "unit": "pcs", "project_inhouse": "Inhouse"}])
    _approve_pr(client, pr2)
    set_po_workflow(db, [u.id for u in pr2["_po_approvers"].values()], buyer)
    r = client.post(f"{BASE}/{pr2['id']}/create-po", json={
        "po_number": "PO-ADM-2", "item_pricing": [{"pr_item_id": i["id"], "unit_price": 10, "tax_rate": 18} for i in pr2["items"]],
    }, headers=auth_header(buyer))
    assert r.status_code == 400 and "has no cost centre" in r.json()["detail"] and "Canteen" in r.json()["detail"], r.text


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

    # Development is charged to an R&D project now; an internal order is no longer the default answer.
    r = _post(client, db, req, item, purpose="development", category_code="RAW", account_assignment="internal_order", internal_order_id=io.id)
    assert r.status_code == 400 and "R&D project" in r.json()["detail"], r.text


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
    assert meta["customer_order"]["label"] == "Project"
    assert meta["capital"]["default_category"] == "CAP" and meta["capital"]["default_requirement_type"] == "Capital Equipment"
    assert meta["department"]["default_category"] == "ADM" and meta["customer_order"]["default_category"] is None
    assert all("OTH" not in p["categories"] for p in meta.values())


def test_project_manager_stage_only_for_production_and_names_the_projects_manager(client, db):
    """PR workflow: department head stand-in -> the order project's own manager
    (only when Purpose = Production) -> Purchase Head stand-in."""
    from app.modules.organization.models.approval import ApprovalRequestStep
    from app.modules.organization.services import approval_engine as engine
    from app.modules.p2p import approvals as p2p_approvals
    from app.tests.test_p2p_requests import make_user
    from app.tests.test_order_project_p2p import _order_project

    _so, project, els = _order_project(client, db, qty=1)
    head = make_user(db, "purpose.head@premnathrail.com", assigned_apps=("p2p",))
    pm = make_user(db, "purpose.pm@premnathrail.com", assigned_apps=("p2p",))
    purchase_head = make_user(db, "purpose.ph@premnathrail.com", assigned_apps=("p2p",))
    req = _requester(db, "purpose.req6@premnathrail.com")
    engine.save_workflow(db, p2p_approvals.PR_KEY, {"stages": [
        {"name": "Department head", "approver_rule": "specific_users", "rule_config": {"user_ids": [head.id]}},
        {"name": "Project manager", "approver_rule": "record_field", "rule_config": {"field": "project_manager_id"},
         "conditions": [{"field": "purpose", "op": "eq", "value": "customer_order"}]},
        {"name": "Purchase Head", "approver_rule": "specific_users", "rule_config": {"user_ids": [purchase_head.id]}},
    ]}, head)
    db.commit()
    item = master_item(db, "Axle box", code="RM-AXL-09")
    body = _create_payload(project_label="PEW-9-1 — Test machine", project_type=None, category_code="RAW", purpose="customer_order",
                           account_assignment="order_project", order_project_id=project.id,
                           items=[{"store_item_id": item.id, "quantity": 1, "project_inhouse": "Project",
                                   "order_project_element_id": els[0].id}])

    def stages(pr_id):
        r = p2p_approvals.pr_request(db, pr_id)
        rows = db.query(ApprovalRequestStep).filter(ApprovalRequestStep.request_id == r.id).order_by(ApprovalRequestStep.sequence).all()
        return [(s.stage_name, s.approver_id) for s in rows]

    # No manager on the project -> refused, naming the project and where to fix it.
    r = client.post(BASE, json=body, headers=auth_header(req))
    assert r.status_code == 422 and project.op_number in r.json()["detail"] and "Order Projects" in r.json()["detail"], r.text

    project.project_manager_id = pm.id
    db.commit()
    r = client.post(BASE, json=body, headers=auth_header(req))
    assert r.status_code == 200, r.text
    assert stages(r.json()["id"]) == [("Department head", head.id), ("Project manager", pm.id), ("Purchase Head", purchase_head.id)]

    # Office buying: the project manager stage doesn't apply.
    r = client.post(BASE, json=_create_payload(project_label=None, project_type=None, category_code="ADM", purpose="department",
                                               items=[{"store_item_id": item.id, "quantity": 1, "project_inhouse": "Inhouse"}]),
                    headers=auth_header(req))
    assert r.status_code == 200, r.text
    assert stages(r.json()["id"]) == [("Department head", head.id), ("Purchase Head", purchase_head.id)]


def test_category_buyer_comes_from_procurement_settings(client, db):
    """Procurement › Settings › Buyer for each requisition category: the picked
    buyer gets new requisitions; blank keeps the standard (email) buyer."""
    from app.modules.main.models.module_setting import ModuleSetting
    from app.modules.p2p.models.p2p_request import resolve_auto_buyer_id
    from app.tests.test_p2p_requests import make_user

    standard = make_user(db, "manish.kumar@premnathrail.com", assigned_apps=("p2p",))
    assert resolve_auto_buyer_id(db, "ELE") == standard.id
    assert resolve_auto_buyer_id(db, "SRV") is None  # no standard buyer for Services

    picked = make_user(db, "purpose.buyer.srv@premnathrail.com", assigned_apps=("p2p",))
    db.add(ModuleSetting(module_key="p2p", key="buyer_srv", value=picked.id))
    db.add(ModuleSetting(module_key="p2p", key="buyer_ele", value=picked.id))
    db.commit()
    assert resolve_auto_buyer_id(db, "SRV") == picked.id
    assert resolve_auto_buyer_id(db, "ELE") == picked.id

    # A picked buyer who has left falls back to the standard one.
    picked.is_active = False
    db.commit()
    assert resolve_auto_buyer_id(db, "ELE") == standard.id

    # The settings screen offers one buyer per category.
    admin = make_user(db, "purpose.admin@premnathrail.com", role="admin")
    keys = set(client.get("/api/v1/p2p/settings", headers=auth_header(admin)).json()["values"])
    assert {"buyer_ele", "buyer_srv", "buyer_cap", "buyer_adm"} <= keys
