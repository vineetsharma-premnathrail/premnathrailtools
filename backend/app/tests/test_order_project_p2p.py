"""Purchase ↔ Order Project (p2p/order_project_links.py): PR lines carry the
vehicle / lot of the order's project (mandatory for project lines of a PR
charged to an order that has one, auto-filled when derivable), PO and GRN
lines inherit it, list filters, and the 'purchase' column of the 360 page."""
from datetime import date, timedelta

from app.modules.p2p import order_project_links as links
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.sales import order_projects as ops
from app.modules.sales.models.order_project import OrderProject
from app.tests.p2p_workflow_helpers import master_item, set_pr_workflow
from app.tests.test_p2p_item_master_link import GRN, _inspect_all, _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _approve_and_raise_po, _create_payload, _pr_approvers, _purchaser, _requester, _sqlite_number_series, auth_header,
)
from app.tests.test_sales import confirm, create_order, setup_customer, setup_people


def _order_project(client, db, qty=2):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=qty, price=1000000)
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    db.expire_all()
    project = db.query(OrderProject).filter(OrderProject.sales_order_id == so["id"]).one()
    els = sorted(project.elements, key=lambda e: e.element_no)
    return so, project, els


def _post_pr(client, db, requester, **over):
    set_pr_workflow(db, [u.id for u in _pr_approvers(db).values()], requester)
    return client.post(BASE, json=_create_payload(**over), headers=auth_header(requester))


def test_provider_and_hooks_registered_at_startup():
    import app.main  # noqa: F401
    assert ops._department_providers.get("purchase") is links.purchase_cells


def test_so_charged_pr_needs_element_per_project_line(client, db):
    so, project, els = _order_project(client, db, qty=2)
    item = master_item(db, "Axle bearing", code="RM-AXB-01")
    tool = master_item(db, "Torque wrench", code="TL-TW-01")
    requester = _requester(db, "op.req1@premnathrail.com")

    # Project line without a vehicle -> 422 naming the line.
    r = _post_pr(client, db, requester, account_assignment="sales_order", sales_order_id=so["id"],
                 items=[{"store_item_id": item.id, "quantity": 4, "project_inhouse": "Project"}])
    assert r.status_code == 422, r.text
    assert "Line 1 (RM-AXB-01 Axle bearing)" in r.json()["detail"] and project.op_number in r.json()["detail"]

    # A draft may leave it blank; submitting it then refuses.
    r = _post_pr(client, db, requester, account_assignment="sales_order", sales_order_id=so["id"], save_as_draft=True,
                 items=[{"store_item_id": item.id, "quantity": 4, "project_inhouse": "Project"}])
    assert r.status_code == 200, r.text
    draft = r.json()
    assert draft["order_project_id"] == project.id and draft["items"][0]["order_project_element_id"] is None
    r = client.post(f"{BASE}/{draft['id']}/submit", headers=auth_header(requester))
    assert r.status_code == 422 and "pick the vehicle / lot" in r.json()["detail"]

    # Each line its own vehicle; an Inhouse line needs none.
    r = _post_pr(client, db, requester, account_assignment="sales_order", sales_order_id=so["id"], items=[
        {"store_item_id": item.id, "quantity": 2, "project_inhouse": "Project", "order_project_element_id": els[0].id},
        {"store_item_id": item.id, "quantity": 2, "project_inhouse": "Project", "order_project_element_id": els[1].id},
        {"store_item_id": tool.id, "quantity": 1, "project_inhouse": "Inhouse"},
    ])
    assert r.status_code == 200, r.text
    pr = r.json()
    assert pr["order_project_id"] == project.id and pr["order_project_number"] == project.op_number
    lines = pr["items"]
    assert [ln["order_project_element_id"] for ln in lines] == [els[0].id, els[1].id, None]
    assert lines[0]["order_project_number"] == project.op_number
    assert lines[0]["order_project_element_no"] == els[0].element_no and lines[0]["order_project_element_label"] == "Vehicle 1"
    assert lines[1]["order_project_display"] == ops.element_display(project, els[1])

    # Filters.
    buyer = _purchaser(db, "op.buyer1@premnathrail.com")
    got = client.get(BASE, params={"order_project_element_id": els[1].id}, headers=auth_header(buyer)).json()
    assert [p["id"] for p in got] == [pr["id"]]
    got = client.get(BASE, params={"order_project_id": project.id}, headers=auth_header(buyer)).json()
    assert {p["id"] for p in got} == {pr["id"]}  # drafts stay private to the requester
    got = client.get(BASE, params={"order_project_id": project.id}, headers=auth_header(requester)).json()
    assert {p["id"] for p in got} == {pr["id"], draft["id"]}


def test_bad_element_picks_are_refused_with_the_reason(client, db):
    so, project, els = _order_project(client, db, qty=2)
    item = master_item(db, "Brake pad", code="RM-BP-01")
    requester = _requester(db, "op.req2@premnathrail.com")

    r = _post_pr(client, db, requester, account_assignment="sales_order", sales_order_id=so["id"],
                 items=[{"store_item_id": item.id, "quantity": 1, "project_inhouse": "Project", "order_project_element_id": 99999}])
    assert r.status_code == 404 and r.json()["detail"].startswith("Line 1 (RM-BP-01 Brake pad):")

    r = _post_pr(client, db, requester, items=[
        {"store_item_id": item.id, "quantity": 1, "project_inhouse": "Inhouse", "order_project_element_id": els[0].id}])
    assert r.status_code == 422 and "marked Inhouse" in r.json()["detail"]

    from app.modules.organization.models.cost_center import CostCenter
    cc = CostCenter(code="CC-MNT", name="Maintenance", status="active")
    db.add(cc)
    db.commit()
    r = _post_pr(client, db, requester, account_assignment="cost_center", cost_center_id=cc.id, items=[
        {"store_item_id": item.id, "quantity": 1, "project_inhouse": "Project", "order_project_element_id": els[0].id}])
    assert r.status_code == 422 and "cost centre" in r.json()["detail"]

    # Plain stock PR with no order link stays as before.
    r = _post_pr(client, db, requester, items=[{"store_item_id": item.id, "quantity": 1, "project_inhouse": "Project"}])
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["order_project_element_id"] is None


def test_single_element_project_auto_fills_and_flows_to_po_grn_and_360(client, db):
    so, project, els = _order_project(client, db, qty=1)
    assert len(els) == 1
    item = master_item(db, "Hydraulic hose", code="RM-HH-01")
    requester = _requester(db, "op.req3@premnathrail.com")
    db.expire_all()

    # Charged to the order project itself (account assignment 'order_project').
    r = _post_pr(client, db, requester, account_assignment="order_project", order_project_id=project.id,
                 items=[{"store_item_id": item.id, "quantity": 5, "project_inhouse": "Project"}])
    assert r.status_code == 200, r.text
    pr = r.json()
    assert pr["account_assignment"] == "order_project" and pr["order_project_id"] == project.id
    assert pr["account_assignment_label"].startswith(f"Order project: {project.op_number}")
    assert pr["items"][0]["order_project_element_id"] == els[0].id

    # 360: requested, not yet ordered.
    db.expire_all()
    p = db.get(OrderProject, project.id)
    cell = links.purchase_cells(db, p, list(p.elements))[els[0].id]
    assert cell["status"] == "requested" and cell["tone"] == "neutral"


def test_element_travels_pr_to_po_to_grn_and_provider_tones(client, db):
    so, project, els = _order_project(client, db, qty=2)
    item = master_item(db, "Wheel set", code="RM-WS-01")
    loc = _store(db, "OPS")
    requester = _requester(db, "op.req4@premnathrail.com")
    from app.tests.test_p2p_requests import _create_pr
    pr = _create_pr(client, requester, account_assignment="sales_order", sales_order_id=so["id"], items=[
        {"store_item_id": item.id, "quantity": 3, "project_inhouse": "Project", "order_project_element_id": els[1].id}])
    buyer = _purchaser(db, "op.buyer4@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)

    po = _po_for(client, buyer, pr["id"])
    line = po["items"][0]
    assert line["order_project_element_id"] == els[1].id and line["order_project_element_no"] == els[1].element_no
    got = client.get("/api/v1/p2p/purchase-orders", params={"order_project_element_id": els[1].id}, headers=auth_header(buyer)).json()
    assert [p["id"] for p in got] == [po["id"]]
    assert client.get("/api/v1/p2p/purchase-orders", params={"order_project_element_id": els[0].id},
                      headers=auth_header(buyer)).json() == []

    db.expire_all()
    p = db.get(OrderProject, project.id)
    cells = links.purchase_cells(db, p, list(p.elements))
    assert cells[els[0].id] is None
    assert cells[els[1].id]["status"] == "ordered" and cells[els[1].id]["tone"] == "info"

    # Overdue vs the PO delivery date -> warning.
    po_row = db.get(P2PPurchaseOrder, po["id"])
    po_row.expected_delivery = date.today() - timedelta(days=3)
    db.commit()
    cells = links.purchase_cells(db, db.get(OrderProject, project.id), list(p.elements))
    assert cells[els[1].id]["tone"] == "warning" and po_row.po_number in cells[els[1].id]["detail"]

    # GRN line inherits the element; fully received -> success.
    r = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id,
                               "items": [{"po_item_id": line["id"], "received_quantity": 3}]}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    grn = r.json()
    assert grn["items"][0]["order_project_element_id"] == els[1].id
    assert grn["items"][0]["order_project_number"] == project.op_number
    assert _inspect_all(client, buyer, grn).status_code == 200
    db.expire_all()
    cells = links.purchase_cells(db, db.get(OrderProject, project.id), list(db.get(OrderProject, project.id).elements))
    assert cells[els[1].id]["status"] == "received" and cells[els[1].id]["tone"] == "success"

    # 360 detail endpoint carries the purchase cell.
    from app.tests.test_sales import make_user
    viewer = make_user(db, "op.viewer@premnathrail.com", role="admin")
    from app.tests.test_sales import hdr
    r = client.get(f"/api/v1/sales/order-projects/{project.id}", headers=hdr(viewer))
    assert r.status_code == 200, r.text
    assert "Received" in r.text


def test_po_line_insert_copies_element_from_pr_line(client, db):
    """RFQ / quotation PO drafts name their PR line (pr_item_id) — the element
    is copied on insert without each flow having to know about it."""
    so, project, els = _order_project(client, db, qty=2)
    item = master_item(db, "Seat", code="RM-ST-01")
    requester = _requester(db, "op.req5@premnathrail.com")
    r = _post_pr(client, db, requester, account_assignment="sales_order", sales_order_id=so["id"], items=[
        {"store_item_id": item.id, "quantity": 1, "project_inhouse": "Project", "order_project_element_id": els[0].id}])
    assert r.status_code == 200, r.text
    pr_line = db.get(P2PRequestItem, r.json()["items"][0]["id"])
    po = P2PPurchaseOrder(po_number="PO-OP-T1", status="draft", po_date=date.today(), p2p_request_id=r.json()["id"])
    db.add(po)
    db.flush()
    li = P2PPurchaseOrderItem(purchase_order_id=po.id, item_name="Seat", quantity=1, pr_item_id=pr_line.id, store_item_id=item.id)
    db.add(li)
    db.commit()
    db.refresh(li)
    assert (li.order_project_id, li.order_project_element_id) == (project.id, els[0].id)
