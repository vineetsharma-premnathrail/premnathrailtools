"""Draft PO: quantity may be raised above the requisition (never below it) and
a draft may be saved with unpriced lines; Send for approval still needs prices."""
from app.modules.main.models.audit_log import AuditLog
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.rfq import RFQ
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_requests import (  # noqa: F401 - _sqlite_number_series is an autouse fixture
    _approve_pr, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header, make_user,
)

RFQS = "/api/v1/p2p/rfqs"


def _draft(client, db, tag, qty=10):
    item = master_item(db, f"Qty item {tag}", code=f"QD-{tag}", uom="Nos")
    pr = _create_pr(client, _requester(db, f"qd.req.{tag}@premnathrail.com"),
                    items=[{"store_item_id": item.id, "quantity": qty, "project_inhouse": "Project"}])
    _approve_pr(client, pr)
    buyer = _purchaser(db, f"qd.buyer.{tag}@premnathrail.com")
    row = db.get(P2PRequest, pr["id"])
    for it in row.items:
        it.fulfillment_status = "sent_to_procurement"
    row.status = "vendor_quotations"
    rfq = RFQ(rfq_number=f"RFQ-QD-{tag}", p2p_request_id=pr["id"], status="locked")
    db.add(rfq)
    db.commit()
    r = client.post(f"{RFQS}/{rfq.id}/po-draft", json={"vendor_name": "Ad hoc vendor"}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    return buyer, rfq, r.json(), pr


def _patch(client, buyer, rfq, po, items):
    return client.patch(f"{RFQS}/{rfq.id}/po-draft/{po['id']}", json={"items": items}, headers=auth_header(buyer))


def test_draft_response_carries_the_quantity_floor(client, db):
    _buyer, _rfq, po, _pr = _draft(client, db, "A1", qty=10)
    assert po["items"][0]["quantity"] == 10 and po["items"][0]["min_quantity"] == 10


def test_quantity_can_be_raised_and_totals_follow_and_it_is_audited(client, db):
    buyer, rfq, po, pr = _draft(client, db, "A2", qty=10)
    r = _patch(client, buyer, rfq, po, [{"id": po["items"][0]["id"], "unit_price": 5, "quantity": 12}])
    assert r.status_code == 200, r.text
    line = r.json()["items"][0]
    assert line["quantity"] == 12 and line["line_total"] == 60 and r.json()["total_value"] == 60
    assert line["min_quantity"] == 10
    note = db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr["id"], action="po_qty_raised").one()
    assert "10 to 12" in note.summary
    # Going back down to the requisition quantity is fine; below it is not.
    assert _patch(client, buyer, rfq, po, [{"id": line["id"], "unit_price": 5, "quantity": 10}]).status_code == 200


def test_quantity_below_requisition_is_refused_with_the_floor(client, db):
    buyer, rfq, po, _pr = _draft(client, db, "A3", qty=10)
    r = _patch(client, buyer, rfq, po, [{"id": po["items"][0]["id"], "unit_price": 5, "quantity": 9}])
    assert r.status_code == 422, r.text
    assert "can't be below 10" in r.json()["detail"] and "only increase" in r.json()["detail"]


def test_draft_saves_with_unpriced_lines_but_cannot_be_sent(client, db):
    buyer, rfq, po, _pr = _draft(client, db, "A4", qty=10)
    r = _patch(client, buyer, rfq, po, [{"id": po["items"][0]["id"], "quantity": 11}])
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["unit_price"] is None and r.json()["total_value"] is None
    s = client.post(f"{RFQS}/{rfq.id}/po-draft/{po['id']}/submit", headers=auth_header(buyer))
    assert s.status_code == 400 and "Qty item A4" in s.json()["detail"]


def test_edit_without_the_purchase_orders_permission_is_denied(client, db):
    _buyer, rfq, po, _pr = _draft(client, db, "A5", qty=10)
    outsider = make_user(db, "qd.outsider@premnathrail.com", assigned_apps=("hr",))
    r = _patch(client, outsider, rfq, po, [{"id": po["items"][0]["id"], "quantity": 20}])
    assert r.status_code == 403
