"""One requisition, several POs from several buyers (2026-10-31): receiving, invoice matching, PO tracking
and the Store reorder 'on order' number all work per PO — a sibling PO still in approval changes nothing
for a PO that is already released, and a buyer is the person who ran the PO's own RFQ."""
from datetime import date, datetime, timezone

import pytest

from app.modules.accounts.service import check_three_way_match
from app.modules.main.models.notification import Notification
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.p2p.approvals import PO_ENTITY, PO_KEY
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.store.services.reorder import on_order
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _approve_pr, _create_pr, _purchaser, _receiving_store, _requester, _sqlite_number_series, auth_header,
)

GRNS = "/api/v1/p2p/goods-receipts"
TRACKING = "/api/v1/p2p/po-reports/tracking"


def _engine_request(db, po, status, requester_id=None):
    """The PO's own approval request in the central engine, in the given state."""
    db.add(ApprovalRequest(
        workflow_key=PO_KEY, module_key="p2p", entity_type=PO_ENTITY, entity_id=po.id, title=f"PO {po.po_number}",
        reference=po.po_number, status=status, submitted_at=datetime.now(timezone.utc), requester_id=requester_id,
        completed_at=datetime.now(timezone.utc) if status != "pending" else None,
    ))
    db.commit()


def _po(db, pr_row, line, qty, number, *, buyer, rfq=None, approval="approved", price=100.0):
    po = P2PPurchaseOrder(
        po_number=number, p2p_request_id=pr_row.id, vendor_name=f"Vendor {number}", status="issued", po_date=date.today(),
        created_by_id=buyer.id, rfq_id=rfq.id if rfq else None, total_value=qty * price,
    )
    po.items.append(P2PPurchaseOrderItem(
        pr_item_id=line.id, store_item_id=line.store_item_id, item_name=line.item_name, unit=line.unit, quantity=qty,
        unit_price=price, line_total=qty * price,
    ))
    db.add(po)
    db.commit()
    _engine_request(db, po, approval)
    return po


@pytest.fixture
def split(client, db):
    """PR with two lines (A x10, B x4), each on its own PO from its own buyer's RFQ. PO-1 (buyer 1) is
    released, PO-2 (buyer 2) is still in approval."""
    a = master_item(db, "Split pump", code="SPL-A", uom="Nos")
    b = master_item(db, "Split plate", code="SPL-B", uom="Nos")
    requester = _requester(db, "split.req@premnathrail.com")
    pr = _create_pr(client, requester, items=[
        {"store_item_id": a.id, "quantity": 10, "project_inhouse": "Project"},
        {"store_item_id": b.id, "quantity": 4, "project_inhouse": "Project"}])
    _approve_pr(client, pr)
    row = db.get(P2PRequest, pr["id"])
    for it in row.items:
        it.fulfillment_status = "sent_to_procurement"
    row.status = "po_raised"
    b0 = _purchaser(db, "split.desk@premnathrail.com")  # the requisition's old single assigned buyer
    row.assigned_buyer_id = b0.id
    b1, b2 = _purchaser(db, "split.buyer1@premnathrail.com"), _purchaser(db, "split.buyer2@premnathrail.com")
    rfq1 = RFQ(rfq_number=f"RFQ-SPL-1-{row.id}", p2p_request_id=row.id, status="locked", buyer_id=b1.id, created_by_id=b0.id)
    rfq2 = RFQ(rfq_number=f"RFQ-SPL-2-{row.id}", p2p_request_id=row.id, status="locked", buyer_id=b2.id, created_by_id=b0.id)
    db.add_all([rfq1, rfq2])
    db.commit()
    lines = {i.store_item_id: i for i in row.items}
    po1 = _po(db, row, lines[a.id], 10, f"PO-SPL-1-{row.id}", buyer=b0, rfq=rfq1, approval="approved")
    po2 = _po(db, row, lines[b.id], 4, f"PO-SPL-2-{row.id}", buyer=b0, rfq=rfq2, approval="pending")
    return {"pr": row, "requester": requester, "b0": b0, "b1": b1, "b2": b2, "po1": po1, "po2": po2, "a": a, "b": b,
            "line_a": lines[a.id], "line_b": lines[b.id], "rfq1": rfq1, "rfq2": rfq2}


def _receive(client, po, user, qty):
    grn = client.post(GRNS, json={
        "purchase_order_id": po.id, "store_location_id": _receiving_store(client),
        "items": [{"po_item_id": po.items[0].id, "received_quantity": qty}]}, headers=auth_header(user))
    if grn.status_code != 200:
        return grn
    grn = grn.json()
    return client.post(f"{GRNS}/{grn['id']}/inspect", json={"items": [
        {"item_id": grn["items"][0]["id"], "accepted_quantity": qty, "quality_status": "passed"}]}, headers=auth_header(user))


# ── receiving ───────────────────────────────────────────────────────────────

def test_released_po_is_received_while_sibling_po_is_in_approval(client, db, split):
    s = split
    r = _receive(client, s["po1"], s["b1"], 10)
    assert r.status_code == 200, r.text
    db.expire_all()
    pr = db.get(P2PRequest, s["pr"].id)
    assert db.get(P2PPurchaseOrder, s["po1"].id).status == "fulfilled"
    # The sibling is still in approval, so the requisition stays 'PO raised' - but its received quantity moved.
    assert pr.status == "po_raised" and pr.received_quantity == pytest.approx(10)


def test_sibling_po_in_approval_is_refused_with_its_own_reason(client, db, split):
    s = split
    r = _receive(client, s["po2"], s["b2"], 4)
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert s["po2"].po_number in detail and "waiting for its approvers" in detail and "other POs" in detail


def test_rejected_po_is_refused_as_rejected(client, db, split):
    s = split
    req = db.query(ApprovalRequest).filter_by(entity_type=PO_ENTITY, entity_id=s["po2"].id).one()
    req.status = "rejected"
    db.commit()
    r = _receive(client, s["po2"], s["b2"], 4)
    assert r.status_code == 409 and "was rejected" in r.json()["detail"]


def test_requisition_is_received_only_when_every_po_is(client, db, split):
    s = split
    assert _receive(client, s["po1"], s["b1"], 10).status_code == 200
    req = db.query(ApprovalRequest).filter_by(entity_type=PO_ENTITY, entity_id=s["po2"].id).one()
    req.status = "approved"
    db.commit()
    assert _receive(client, s["po2"], s["b2"], 2).status_code == 200
    db.expire_all()
    assert db.get(P2PRequest, s["pr"].id).status == "partially_received"
    assert _receive(client, s["po2"], s["b2"], 2).status_code == 200
    db.expire_all()
    pr = db.get(P2PRequest, s["pr"].id)
    assert pr.status == "received" and pr.received_quantity == pytest.approx(14)


def test_requester_gets_a_bell_per_completed_grn_not_teams(client, db, split, monkeypatch):
    s = split
    teams = []
    monkeypatch.setattr("app.utils.notifications._notify_teams", lambda *a, **k: teams.append(a))
    assert _receive(client, s["po1"], s["b1"], 6).status_code == 200
    # A recorded-but-not-yet-inspected GRN tells the requester nothing yet.
    recorded = client.post(GRNS, json={"purchase_order_id": s["po1"].id, "store_location_id": _receiving_store(client),
                                       "items": [{"po_item_id": s["po1"].items[0].id, "received_quantity": 4}]}, headers=auth_header(s["b1"]))
    assert recorded.status_code == 200, recorded.text
    assert db.query(Notification).filter_by(notification_type="p2p_grn_completed").count() == 1
    grn = recorded.json()
    done = client.post(f"{GRNS}/{grn['id']}/inspect", json={"items": [
        {"item_id": grn["items"][0]["id"], "accepted_quantity": 4, "quality_status": "passed"}]}, headers=auth_header(s["b1"]))
    assert done.status_code == 200, done.text
    rows = db.query(Notification).filter_by(user_id=s["requester"].id, notification_type="p2p_grn_completed").order_by(Notification.id).all()
    assert len(rows) == 2 and teams == []
    pr_no = s["pr"].p2p_number
    assert all(r.message.startswith(f"Goods received on {pr_no}: GRN") and f"on PO {s['po1'].po_number}" in r.message for r in rows)


def test_old_po_without_engine_request_keeps_the_requisition_rule(client, db, split):
    s = split
    for po in (s["po1"], s["po2"]):
        db.query(ApprovalRequest).filter_by(entity_type=PO_ENTITY, entity_id=po.id).delete()
    db.commit()
    from app.modules.p2p.routes.goods_receipts import _po_approval_block_reason
    db.expire_all()
    # PR is 'po_raised' with two live POs and no approval request: not released.
    assert "has not completed its approval" in _po_approval_block_reason(db, db.get(P2PPurchaseOrder, s["po1"].id))
    pr = db.get(P2PRequest, s["pr"].id)
    pr.status = "po_approved"
    db.commit()
    assert _po_approval_block_reason(db, db.get(P2PPurchaseOrder, s["po1"].id)) is None


# ── invoice matching ────────────────────────────────────────────────────────

def test_invoice_match_per_po_while_sibling_is_pending(client, db, split):
    s = split
    assert _receive(client, s["po1"], s["b1"], 10).status_code == 200
    ok = check_three_way_match(db, purchase_order_id=s["po1"].id, invoice_qty=10, invoice_amount=1000)
    assert ok["matching_status"] == "matched"
    with pytest.raises(ValueError) as e:
        check_three_way_match(db, purchase_order_id=s["po2"].id, invoice_qty=4, invoice_amount=400)
    assert s["po2"].po_number in str(e.value) and "own approval" in str(e.value)


# ── PO tracking: the buyer is the RFQ's buyer ───────────────────────────────

def _tracking(client, user, **params):
    r = client.get(TRACKING, params=params, headers=auth_header(user))
    assert r.status_code == 200, r.text
    return r.json()


def test_tracking_buyer_is_the_rfq_buyer_not_the_requisitions(client, db, split):
    s = split
    rows = {r["po_number"]: r for r in _tracking(client, s["b0"])["rows"]}
    assert rows[s["po1"].po_number]["buyer_id"] == s["b1"].id and rows[s["po1"].po_number]["buyer_name"] == s["b1"].name
    assert rows[s["po2"].po_number]["buyer_id"] == s["b2"].id
    only1 = _tracking(client, s["b0"], buyer_id=s["b1"].id)
    assert [r["po_number"] for r in only1["rows"]] == [s["po1"].po_number]
    only2 = _tracking(client, s["b0"], buyer_id=s["b2"].id)
    assert [r["po_number"] for r in only2["rows"]] == [s["po2"].po_number]
    # The requisition's old assigned buyer owns neither PO (both POs have an RFQ buyer).
    assert _tracking(client, s["b0"], buyer_id=s["b0"].id)["rows"] == []


def test_tracking_buyer_falls_back_to_po_creator_then_requisition_buyer(client, db, split):
    s = split
    db.query(P2PPurchaseOrder).filter_by(id=s["po2"].id).update({"rfq_id": None})
    db.commit()
    rows = {r["po_number"]: r for r in _tracking(client, s["b1"])["rows"]}
    assert rows[s["po2"].po_number]["buyer_id"] == s["b0"].id  # no RFQ: who raised the PO
    db.query(P2PPurchaseOrder).filter_by(id=s["po2"].id).update({"created_by_id": None})
    db.commit()
    rows = {r["po_number"]: r for r in _tracking(client, s["b1"])["rows"]}
    assert rows[s["po2"].po_number]["buyer_id"] == s["b0"].id  # then the requisition's assigned buyer


def test_tracking_filter_options_list_rfq_buyers(client, db, split):
    s = split
    from app.modules.p2p.po_tracking import filter_options
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder as PO
    opts = filter_options(db, db.query(PO))
    assert {b["id"] for b in opts["buyers"]} == {s["b1"].id, s["b2"].id}


# ── Store reorder: on order with split lines ────────────────────────────────

def test_on_order_counts_unordered_part_of_a_line_plus_its_po(client, db, split):
    s = split
    # Line A (10) is entirely on PO-1, line B (4) entirely on PO-2: on order = PO lines, nothing counted twice.
    qty, docs = on_order(db, {s["a"].id, s["b"].id})
    assert qty[s["a"].id] == pytest.approx(10) and qty[s["b"].id] == pytest.approx(4)
    assert docs[s["a"].id] == [s["po1"].po_number] and docs[s["b"].id] == [s["po2"].po_number]
    # PO-2 shrinks to 1: the other 3 of the line are still to order on the requisition.
    po2 = db.get(P2PPurchaseOrder, s["po2"].id)
    po2.items[0].quantity = 1
    db.commit()
    qty, docs = on_order(db, {s["b"].id})
    assert qty[s["b"].id] == pytest.approx(4)
    assert sorted(docs[s["b"].id]) == sorted([s["pr"].p2p_number, s["po2"].po_number])
    # 2 of the line are short-closed: only 1 is left to order besides PO-2's 1.
    s["line_b"].short_closed_qty = 2
    db.commit()
    qty, _ = on_order(db, {s["b"].id})
    assert qty[s["b"].id] == pytest.approx(2)


def test_on_order_drops_received_ended_and_draft_requisitions(client, db, split):
    s = split
    assert _receive(client, s["po1"], s["b1"], 10).status_code == 200
    qty, _ = on_order(db, {s["a"].id})
    assert qty.get(s["a"].id, 0) == 0  # fully received: nothing on order, nothing to order
    pr = db.get(P2PRequest, s["pr"].id)
    pr.status = "closed"
    db.commit()
    assert on_order(db, {s["b"].id})[0].get(s["b"].id, 0) == 0
    pr.status = "draft"  # not submitted yet: no demand (a cancelled PO leaves only the requisition line)
    db.get(P2PPurchaseOrder, s["po2"].id).status = "cancelled"
    db.commit()
    assert on_order(db, {s["b"].id})[0].get(s["b"].id, 0) == 0
    pr.status = "submitted"  # submitted: the line is demand again, the cancelled PO no longer covers it
    db.commit()
    assert on_order(db, {s["b"].id})[0].get(s["b"].id) == pytest.approx(4)


def test_on_order_partial_receipt_counts_the_balance_once(client, db, split):
    s = split
    assert _receive(client, s["po1"], s["b1"], 6).status_code == 200
    qty, docs = on_order(db, {s["a"].id})
    assert qty[s["a"].id] == pytest.approx(4) and docs[s["a"].id] == [s["po1"].po_number]


def test_on_order_with_no_items_is_empty(db):
    assert on_order(db, set()) == ({}, {})


# ── MIS: pending approvers count every PO in approval ───────────────────────

def test_mis_counts_every_pending_po_approval_of_a_requisition(client, db, split):
    from app.modules.organization.models.approval import ApprovalRequestStep
    from app.modules.p2p.models.p2p_request import ENGINE_SCHEME
    from app.tests.test_p2p_requests import make_user

    s = split
    approver = make_user(db, "split.approver@premnathrail.com")
    pr = db.get(P2PRequest, s["pr"].id)
    pr.approval_scheme = ENGINE_SCHEME
    for po in (s["po1"], s["po2"]):
        req = db.query(ApprovalRequest).filter_by(entity_type=PO_ENTITY, entity_id=po.id).one()
        req.status, req.current_sequence = "pending", 1
        db.add(ApprovalRequestStep(request_id=req.id, sequence=1, stage_name="PO approvers", approver_id=approver.id, status="pending"))
    db.commit()
    admin = make_user(db, "split.mis.admin@premnathrail.com", role="admin")
    r = client.get("/api/v1/p2p/mis/summary", params={"period": "monthly"}, headers=auth_header(admin))
    assert r.status_code == 200, r.text
    mine = [a for a in r.json()["approver_pending"] if a["approver_id"] == approver.id]
    assert len(mine) == 1 and mine[0]["pending_count"] == 2 and mine[0]["role"] == "PO approvers"


def test_closed_requisition_refuses_goods_on_even_a_released_po(client, db, split):
    s = split
    pr = db.get(P2PRequest, s["pr"].id)
    pr.status, pr.closed_at = "closed", datetime.now(timezone.utc)
    db.commit()
    r = _receive(client, s["po1"], s["b1"], 5)
    assert r.status_code == 409
    assert pr.p2p_number in r.json()["detail"] and "was closed on" in r.json()["detail"] and "new requisition" in r.json()["detail"]
