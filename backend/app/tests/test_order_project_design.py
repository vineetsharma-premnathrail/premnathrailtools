"""Design / Electrical / Hydraulic ↔ PM projects and Units (design/order_project_links.py):
the project hook opens one Design request per new RRV model (repeat models
with a released BOM get none), idempotently; the 'design' 360 cell; links on
requests / BOMs / electrical jobs / hydraulic systems validated against the
project; the customer's approval of every project drawing makes the order's
drawing-approval billing milestone due."""
from datetime import date, timedelta

import pytest

from app.modules.design.models.bom import DesignBom, DesignBomRevision
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.models.event import DesignEvent
from app.modules.design.models.request import DesignRequest
from app.modules.design.models.setting import DesignTeamMember
from app.modules.design.models.submission import DesignCustomerSubmission, DesignSubmissionLine
from app.modules.projects import so_projects as ops
from app.modules.sales.models.order import SalesOrder
from app.modules.projects.models.project import PmProject
from app.modules.store.models.item import StoreItem
from app.tests.test_sales import (
    BASE, TODAY, confirm, hdr, make_user, payload_from_prefill, setup_customer, setup_people,
)

DESIGN = "/api/v1/design"


def _item(db, code="FG-RRV-10T", name="RRV 10T"):
    it = StoreItem(item_code=code, item_name=name, uom="NOS", category="Finished Goods")
    db.add(it)
    db.commit()
    return it


def _released_bom(db, item, number="BOM-2026-0001"):
    bom = DesignBom(bom_number=number, product_item_id=item.id, title=f"{item.item_name} BOM", status="active")
    db.add(bom)
    db.flush()
    db.add(DesignBomRevision(bom_id=bom.id, revision_index=1, revision_label="B1", status="released"))
    db.commit()
    return bom


def _head(db):
    head = make_user(db, "dhead@premnathrail.com", apps=("design", "electrical", "hydraulic"))
    db.add(DesignTeamMember(user_id=head.id, role="head"))
    db.commit()
    return head


def _order(client, db, item=None, billing=None):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    body = payload_from_prefill(client, hdr(maker), inq)
    if item is not None:
        body["lines"][0]["product_item_id"] = item.id
    if billing:
        body["billing_plan"] = billing
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 200, r.text
    so = confirm(client, db, r.json(), maker, head, director)
    db.expire_all()
    project = db.query(PmProject).filter(PmProject.sales_order_id == so["id"]).first()
    return so, project, head


def _requests(db, project):
    db.expire_all()
    return db.query(DesignRequest).filter(DesignRequest.order_project_id == project.id).all()


def test_new_model_opens_one_design_request_idempotently(client, db):
    dhead = _head(db)
    so, project, sales_head = _order(client, db, item=_item(db))
    reqs = _requests(db, project)
    assert len(reqs) == 1
    req = reqs[0]
    assert req.title == f"RRV 10T for Central Railway — {project.project_code}"
    assert req.status == "open" and req.source == "project" and req.order_project_element_id is None
    assert req.customer_id == project.customer_id
    assert "CR/PO/2026/771" in req.requirement and project.project_code in req.requirement
    first_date = min(e.contractual_date for e in project.elements)
    assert req.due_date == first_date
    assert req.requested_by_id == sales_head.id
    # The Design head is told, like a request raised by hand.
    from app.modules.main.models.notification import Notification
    assert db.query(Notification).filter(Notification.user_id == dhead.id,
                                         Notification.notification_type == "design_request_new").count() == 1

    # Idempotent: running the hook again (even with "new" elements) adds nothing.
    order = db.get(SalesOrder, so["id"])
    from app.modules.design.order_project_links import on_order_project
    on_order_project(db, project, order, None, list(project.elements))
    ops.ensure_project_for_order(db, order, None)
    db.commit()
    assert len(_requests(db, project)) == 1

    # The 360 cell shows the request for every vehicle.
    r = client.get(f"/api/v1/projects/{project.id}/units", headers=hdr(_admin(db)))
    assert r.status_code == 200, r.text
    cells = [e["departments"]["design"] for e in r.json()["elements"]]
    assert all(c and c["label"] == "Request open" and req.request_number in c["detail"] for c in cells)

    # Request API carries the chip labels and filters by project.
    r = client.get(f"{DESIGN}/requests", params={"order_project_id": project.id}, headers=hdr(dhead))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert [x["id"] for x in rows] == [req.id]
    assert rows[0]["order_project_number"] == project.project_code


def _admin(db):
    from app.tests.test_sales import make_user
    return make_user(db, "units.admin@premnathrail.com", role="admin")


def test_repeat_model_with_released_bom_gets_no_request(client, db):
    _head(db)
    item = _item(db)
    bom = _released_bom(db, item)
    _so, project, sales_head = _order(client, db, item=item)
    assert _requests(db, project) == []
    assert db.query(DesignEvent).filter(DesignEvent.bom_id == bom.id, DesignEvent.action == "order_project_repeat").count() == 1
    r = client.get(f"/api/v1/projects/{project.id}/units", headers=hdr(_admin(db)))
    cell = r.json()["elements"][0]["departments"]["design"]
    assert cell["tone"] == "success" and cell["label"] == "Repeat model"
    assert f"BOM {bom.bom_number} rev B1" in cell["detail"]


def test_links_are_validated_on_request_bom_job_and_system(client, db):
    dhead = _head(db)
    item = _item(db)
    _so, project, _ = _order(client, db, item=item)
    el = sorted(project.elements, key=lambda e: e.element_no)[0]

    # Design request — element alone fills its project.
    r = client.post(f"{DESIGN}/requests", headers=hdr(dhead), json={
        "title": "Cab variant", "requirement": "Vehicle 1 needs an AC cab variant.", "order_project_element_id": el.id})
    assert r.status_code == 201, r.text
    assert r.json()["order_project_id"] == project.id and r.json()["order_project_element_no"] == el.element_no
    # Unknown element → real reason.
    r = client.post(f"{DESIGN}/requests", headers=hdr(dhead), json={
        "title": "Bad", "requirement": "Something to design.", "order_project_element_id": 999999})
    assert r.status_code == 404 and "All Projects" in r.json()["detail"]

    # BOM header with a vehicle-specific variant; list filters by project.
    r = client.post(f"{DESIGN}/boms", headers=hdr(dhead), json={
        "product_item_id": item.id, "title": "RRV 10T — vehicle 1 variant", "order_project_id": project.id,
        "order_project_element_id": el.id})
    assert r.status_code == 201, r.text
    bom_id = r.json()["id"]
    assert r.json()["order_project_number"] == project.project_code
    r = client.get(f"{DESIGN}/boms", params={"order_project_id": project.id}, headers=hdr(dhead))
    assert [b["id"] for b in r.json()] == [bom_id]

    # Electrical job — customer prefilled from the project.
    r = client.post("/api/v1/electrical/jobs", headers=hdr(dhead), json={
        "title": "RRV electrical", "order_project_id": project.id, "order_project_element_id": el.id})
    assert r.status_code == 200, r.text
    assert r.json()["order_project_id"] == project.id and r.json()["customer_name"] == "Central Railway"

    # Hydraulic system — linked to the vehicle.
    r = client.post("/api/v1/hydraulic/systems", headers=hdr(dhead), json={
        "name": "Brake circuit", "system_type": "hydraulic", "order_project_id": project.id, "order_project_element_id": el.id})
    assert r.status_code == 200, r.text
    assert r.json()["order_project_element_no"] == el.element_no
    sys_id = r.json()["id"]

    # A closed project can't take new links, but an existing link survives edits.
    project.status = "closed"
    db.commit()
    r = client.patch(f"/api/v1/hydraulic/systems/{sys_id}", headers=hdr(dhead), json={
        "name": "Brake circuit v2", "order_project_id": project.id, "order_project_element_id": el.id})
    assert r.status_code == 200, r.text
    r = client.post(f"{DESIGN}/requests", headers=hdr(dhead), json={
        "title": "Late", "requirement": "Something to design.", "order_project_id": project.id})
    assert r.status_code == 422 and "closed" in r.json()["detail"].lower()

    # The 360 cell mentions the electrical job and the hydraulic system.
    project.status = "active"
    db.commit()
    cells = ops.department_cells(db, project, db.get(SalesOrder, project.sales_order_id), list(project.elements))
    detail = cells[el.id]["design"]["detail"]
    assert "Electrical" in detail and "Hydraulic" in detail


def test_customer_approval_of_project_drawings_makes_milestone_due(client, db):
    dhead = _head(db)
    billing = [{"milestone_type": "advance", "percent": 20}, {"milestone_type": "drawing_approval", "percent": 30},
               {"milestone_type": "delivery", "percent": 50}]
    so, project, _ = _order(client, db, item=_item(db), billing=billing)
    req = _requests(db, project)[0]

    docs, lines = [], []
    sub = DesignCustomerSubmission(submission_number="SUB-2026-0001", customer_name="Central Railway", status="sent",
                                   sent_date=TODAY, created_by_id=dhead.id)
    db.add(sub)
    db.flush()
    for n in (1, 2):
        d = DesignDocument(doc_number=f"DRG-{n}", title=f"GA {n}", document_type="ga_drawing", design_request_id=req.id,
                           customer_approval_required=True, status="active")
        db.add(d)
        db.flush()
        rv = DesignDocumentRevision(document_id=d.id, revision_index=0, revision_label="R0", status="approved")
        db.add(rv)
        db.flush()
        ln = DesignSubmissionLine(submission_id=sub.id, document_id=d.id, revision_id=rv.id, response="pending")
        db.add(ln)
        docs.append(d)
        lines.append(ln)
    db.commit()

    def milestone():
        db.expire_all()
        order = db.get(SalesOrder, so["id"])
        return next(b for b in order.billing_lines if b.milestone_type == "drawing_approval")

    # First drawing approved — the second is still with the customer: not due yet.
    r = client.post(f"{DESIGN}/submissions/{sub.id}/response", headers=hdr(dhead), json={
        "response_date": str(TODAY), "lines": [{"line_id": lines[0].id, "response": "approved"}]})
    assert r.status_code == 200, r.text
    assert milestone().triggered_at is None
    db.expire_all()
    cells = ops.department_cells(db, project, db.get(SalesOrder, so["id"]), list(project.elements))
    cell = cells[project.elements[0].id]["design"]
    assert "customer-approved 1/2" in cell["detail"] and cell["label"] == "Awaiting customer approval"

    # Second approved (with comments) — every project drawing approved → due.
    r = client.post(f"{DESIGN}/submissions/{sub.id}/response", headers=hdr(dhead), json={
        "response_date": str(TODAY), "lines": [{"line_id": lines[1].id, "response": "approved_with_comments",
                                                "comment": "Add earthing note"}]})
    assert r.status_code == 200, r.text
    m = milestone()
    assert m.triggered_at is not None and m.triggered_at.date() == TODAY
    assert db.query(DesignEvent).filter(DesignEvent.request_id == req.id, DesignEvent.action == "drawing_milestone_due").count() == 1


def test_project_hook_registered_at_startup():
    import app.main  # noqa: F401
    from app.modules.design.order_project_links import design_cells, on_order_project
    assert on_order_project in ops._project_hooks
    assert ops._department_providers.get("design") is design_cells
