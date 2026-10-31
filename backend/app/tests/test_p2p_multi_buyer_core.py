"""Multi-buyer split, core engine (2026-10-31): the requisition header status is a
roll-up (po_split.rollup_pr_status), per-line progress is derived (line_progress),
each PO is approved on its own (approvals), and RFQ / PO data scope follows the
RFQ's buyer (access). Everything is set up straight in the database so these
tests do not depend on the RFQ / Upload PO routes."""
from datetime import date
from itertools import count

import pytest

from app.core.data_scope import scope_filter
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p import approvals as p2p_approvals
from app.modules.p2p import po_split
from app.modules.p2p.access import ensure_pr_in_scope
from app.modules.p2p.line_progress import STATE_LABELS, LineProgress, line_progress
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_item import RFQItem
from app.modules.p2p.models.vendor_quotation import VendorQuotation, VendorQuotationItem
from app.modules.p2p.pre_po import po_line_min_quantity, qty_raised_lines
from app.tests.p2p_workflow_helpers import master_item, set_po_workflow

_seq = count(1)


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


def _user(db, grants=(), role="user", **kw):
    n = next(_seq)
    u = User(email=f"mb.core{n}@premnathrail.com", name=f"mbcore{n}", role=role, is_active=True,
             granular_permissions=list(grants), department="Purchase", **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _pr(db, requester, lines, status="approved", assigned_buyer=None):
    """An approved requisition; `lines` = [(item name, qty)] each routed to procurement."""
    n = next(_seq)
    pr = P2PRequest(p2p_number=f"P2P-RAW-2026-{8000 + n}", category_code="RAW", project_type="existing", approval_scheme="engine",
                    request_date=date.today(), requested_by_id=requester.id, status=status, project_label="MB",
                    assigned_buyer_id=assigned_buyer.id if assigned_buyer else None)
    db.add(pr)
    db.flush()
    for name, qty in lines:
        db.add(P2PRequestItem(p2p_request_id=pr.id, store_item_id=master_item(db, name).id, item_name=name, unit="Nos",
                              quantity=qty, project_inhouse="Project", fulfillment_status="sent_to_procurement"))
    db.commit()
    db.refresh(pr)
    return pr


def _po(db, pr, buyer, lines, status="draft", source=None, rfq=None):
    """A PO for `lines` = [(PR line, qty)]. status draft | issued | fulfilled ... ."""
    n = next(_seq)
    po = P2PPurchaseOrder(po_number=f"PO-MB-{n:04d}", p2p_request_id=pr.id, vendor_name=f"Vendor {n}", status=status,
                          po_date=date.today(), created_by_id=buyer.id, source=source, rfq_id=rfq.id if rfq else None)
    db.add(po)
    db.flush()
    for line, qty in lines:
        db.add(P2PPurchaseOrderItem(purchase_order_id=po.id, item_name=line.item_name, store_item_id=line.store_item_id,
                                    unit=line.unit, quantity=qty, unit_price=10.0, pr_item_id=line.id))
    db.commit()
    db.refresh(po)
    return po


def _rfq(db, pr, buyer, lines, status="locked", source=None):
    n = next(_seq)
    rfq = RFQ(rfq_number=f"RFQ-MB-{n:04d}", p2p_request_id=pr.id, status=status, buyer_id=buyer.id, created_by_id=buyer.id,
              source=source)
    db.add(rfq)
    db.flush()
    for line in lines:
        db.add(RFQItem(rfq_id=rfq.id, pr_item_id=line.id, store_item_id=line.store_item_id, quantity=line.quantity))
    db.commit()
    db.refresh(rfq)
    return rfq


def _grn(db, po, line_qty, *, status="completed", accepted=None, rejected=0.0, quality="passed"):
    """One GRN on `po` for its first line: received `line_qty`, accepted `accepted` (default all)."""
    item = po.items[0]
    n = next(_seq)
    g = P2PGoodsReceipt(grn_number=f"GRN-MB-{n:04d}", purchase_order_id=po.id, status=status, received_date=date.today())
    db.add(g)
    db.flush()
    db.add(P2PGoodsReceiptItem(
        goods_receipt_id=g.id, po_item_id=item.id, store_item_id=item.store_item_id, item_name=item.item_name, unit=item.unit,
        ordered_quantity=item.quantity, received_quantity=line_qty,
        accepted_quantity=line_qty if accepted is None else accepted, rejected_quantity=rejected, quality_status=quality))
    db.commit()
    return g


@pytest.fixture
def team(db):
    t = {"requester": _user(db), "b1": _user(db), "b2": _user(db), "head": _user(db), "admin": _user(db, role="admin"),
         "po1": _user(db), "partner": _user(db, is_partner=True)}
    set_po_workflow(db, [t["po1"].id], t["admin"], partner=True)
    return t


def _status(db, pr, **kw):
    status = po_split.rollup_pr_status(db, pr, None, force=True, **kw)
    db.commit()
    return status


# ── helpers on po_split ─────────────────────────────────────────────────────

def test_is_procurement_open_and_effective_buyer(db, team):
    assert po_split.PROCUREMENT_OPEN_STATUSES[0] == "approved" and "closed" not in po_split.PROCUREMENT_OPEN_STATUSES
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)], assigned_buyer=team["b1"])
    assert po_split.is_procurement_open(pr)
    for s in ("draft", "submitted", "returned", "rejected", "cancelled", "closed"):
        pr.status = s
        assert not po_split.is_procurement_open(pr)
    bolt, nut = sorted(pr.items, key=lambda i: i.id)
    assert po_split.effective_buyer_id(bolt, pr) == team["b1"].id  # falls back to the header buyer
    nut.buyer_id = team["b2"].id
    assert po_split.effective_buyer_id(nut, pr) == team["b2"].id   # the line's own buyer wins


def test_can_work_all_lines_is_admin_or_explicit_grant(db, team):
    plain = _user(db, ["p2p:purchase_requisitions:edit", "p2p:purchase_requisitions.my_lines:view"])
    head = _user(db, ["p2p:purchase_requisitions.all_lines:edit"])
    viewer_only = _user(db, ["p2p:purchase_requisitions.all_lines:view"])
    assert po_split.can_work_all_lines(team["admin"]) is True
    assert po_split.can_work_all_lines(head) is True
    assert po_split.can_work_all_lines(plain) is False       # the normal Edit grant does not inherit it
    assert po_split.can_work_all_lines(viewer_only) is False  # view is not edit
    assert po_split.can_work_all_lines(None) is False


def test_buy_qty_is_net_of_stock_issue_and_short_close(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10), ("Nut", 5), ("Washer", 3)])
    bolt, nut, washer = sorted(pr.items, key=lambda i: i.id)
    bolt.issued_qty = 2
    bolt.short_closed_qty = 3
    nut.short_closed_qty = 5          # whole line written off
    washer.fulfillment_status = "stock_issued"
    washer.issued_qty = 3
    db.commit()
    assert po_split.buy_qty_by_pr_item(pr) == {bolt.id: 5}


def test_lock_pr_returns_the_fresh_requisition_with_its_lines(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    line = pr.items[0]
    # Another request changed the line after this session loaded it.
    db.query(P2PRequestItem).filter(P2PRequestItem.id == line.id).update({"short_closed_qty": 4}, synchronize_session=False)
    locked = po_split.lock_pr(db, pr.id)
    assert locked.id == pr.id and locked.items[0].short_closed_qty == 4
    assert po_split.buy_qty_by_pr_item(locked) == {line.id: 6}


def test_lock_pr_unknown_requisition_is_404_with_a_way_forward(db):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        po_split.lock_pr(db, 999999)
    assert e.value.status_code == 404 and "Procurement" in e.value.detail


# ── header roll-up ──────────────────────────────────────────────────────────

def test_rollup_no_po_is_approved_then_vendor_quotations_with_a_locked_rfq(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)])
    bolt, nut = sorted(pr.items, key=lambda i: i.id)
    assert _status(db, pr) == "approved"
    _rfq(db, pr, team["b1"], [bolt], status="draft")
    assert _status(db, pr) == "approved"                      # a draft RFQ is not out for quotes
    _rfq(db, pr, team["b1"], [bolt], status="locked")
    assert _status(db, pr) == "vendor_quotations"


def test_rollup_goes_back_to_approved_when_the_locked_rfq_is_gone(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4)], status="vendor_quotations")
    assert _status(db, pr) == "approved"
    audit = db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr.id, action="po_rollup").one()
    assert audit.old_value == "vendor_quotations" and audit.new_value == "approved"


def test_rollup_only_before_po_rfqs_is_vendor_selected(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4)])
    _rfq(db, pr, team["b1"], pr.items, status="locked", source="before_po")
    assert _status(db, pr) == "vendor_selected"


def test_rollup_auto_closes_when_nothing_is_left_to_buy_and_nothing_was_bought(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)])
    bolt, nut = sorted(pr.items, key=lambda i: i.id)
    bolt.short_closed_qty = 4
    nut.fulfillment_status, nut.issued_qty = "stock_issued", 2
    db.commit()
    assert _status(db, pr) == "closed"
    assert pr.closed_at is not None
    note = db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr.id, action="closed").one()
    assert "short-closed" in note.summary and "nothing left to buy" in note.summary
    assert _status(db, pr) == "closed"                        # terminal: never derived back


def test_rollup_does_not_close_while_a_line_is_still_to_buy(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)])
    pr.items[0].short_closed_qty = 4
    db.commit()
    assert _status(db, pr) == "approved"


def test_rollup_ignores_requisitions_outside_procurement(db, team):
    for s in ("draft", "submitted", "rejected", "cancelled", "closed"):
        pr = _pr(db, team["requester"], [("Bolt", 4)], status=s)
        assert po_split.rollup_pr_status(db, pr, None, force=True) == s


def test_rollup_with_pos_follows_the_po_order(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)])
    bolt, nut = sorted(pr.items, key=lambda i: i.id)
    po_a = _po(db, pr, team["b1"], [(bolt, 4)], status="draft")
    assert _status(db, pr) == "po_drafted"
    po_b = _po(db, pr, team["b2"], [(nut, 2)], status="issued")   # no approval request: legacy "released" rule decides
    # PO B goes through the engine: waiting for its approvers.
    p2p_approvals.submit_po(db, pr, po_b, team["b2"])
    db.commit()
    assert pr.status == "po_raised"                               # approval pending dominates a draft
    po_a.status = "issued"
    p2p_approvals.submit_po(db, pr, po_a, team["b1"])
    db.commit()
    assert pr.status == "po_raised"


def test_rollup_released_po_alone_is_po_approved_and_accepted_goods_partially_received(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)])
    bolt, nut = sorted(pr.items, key=lambda i: i.id)
    po = _po(db, pr, team["b1"], [(bolt, 4)], status="issued", source="tally")  # released from import
    assert _status(db, pr) == "po_approved"          # the Nut line is still un-ordered
    po.status = "partially_fulfilled"
    db.commit()
    assert _status(db, pr) == "partially_received"
    po.status = "fulfilled"
    db.commit()
    assert _status(db, pr) == "partially_received"   # fulfilled, but the Nut line is not ordered yet
    _po(db, pr, team["b2"], [(nut, 2)], status="fulfilled", source="tally")
    assert _status(db, pr) == "received"


def test_rollup_received_counts_short_closed_lines_as_done(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)])
    bolt, nut = sorted(pr.items, key=lambda i: i.id)
    nut.short_closed_qty = 2
    _po(db, pr, team["b1"], [(bolt, 4)], status="fulfilled", source="tally")
    assert _status(db, pr) == "received"


def test_rollup_zero_po_after_the_only_po_is_cancelled_returns_to_approved(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4)], status="po_raised")
    po = _po(db, pr, team["b1"], [(pr.items[0], 4)], status="cancelled")
    pr.po_number = po.po_number
    db.commit()
    assert _status(db, pr) == "approved"
    assert pr.po_number is None


def test_rollup_without_force_keeps_the_single_po_flow(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4)], status="po_raised")
    _po(db, pr, team["b1"], [(pr.items[0], 4)], status="issued", source="tally")
    assert po_split.rollup_pr_status(db, pr, None) == "po_raised"           # one PO covering all: untouched
    assert po_split.rollup_pr_status(db, pr, None, force=True) == "po_approved"


# ── line progress maths ─────────────────────────────────────────────────────

def test_line_progress_states_without_any_po(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10), ("Nut", 4), ("Washer", 3), ("Pin", 6), ("Cap", 2)])
    bolt, nut, washer, pin, cap = sorted(pr.items, key=lambda i: i.id)
    bolt.fulfillment_status = "pending"
    nut.fulfillment_status, nut.issued_qty = "stock_issued", 4
    washer.short_closed_qty = 3
    cap.issued_qty = 1     # partly from stock: 1 left to buy
    db.commit()
    _rfq(db, pr, team["b1"], [pin], status="locked")
    prog = line_progress(db, pr)
    assert prog[bolt.id].state == "awaiting_stock_decision" and prog[bolt.id].buy_qty == 10
    assert prog[nut.id].state == "issued_from_stock" and prog[nut.id].buy_qty == 0
    assert prog[washer.id].state == "short_closed" and prog[washer.id].short_closed_qty == 3 and prog[washer.id].open_to_order == 0
    assert prog[pin.id].state == "quoting" and prog[pin.id].open_to_order == 6
    assert prog[cap.id].state == "to_quote" and prog[cap.id].buy_qty == 1
    for p in prog.values():
        assert isinstance(p, LineProgress) and p.state in STATE_LABELS and p.state_label


def test_line_progress_awarded_before_the_po_is_uploaded(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    rfq = _rfq(db, pr, team["b1"], [bolt])
    vq = VendorQuotation(rfq_id=rfq.id, p2p_request_id=pr.id, vendor_name="Alpha")
    db.add(vq)
    db.flush()
    vqi = VendorQuotationItem(vendor_quotation_id=vq.id, pr_item_id=bolt.id, store_item_id=bolt.store_item_id, quantity=10,
                              unit_price=5, is_awarded=True, awarded_qty=10)
    db.add(vqi)
    db.commit()
    p = line_progress(db, pr)[bolt.id]
    assert p.state == "awarded" and p.awarded_no_po == 10 and p.open_to_order == 10 and p.ordered_qty == 0
    # 6 of the award goes on a PO: 4 are still awarded, no PO.
    po = _po(db, pr, team["b1"], [(bolt, 6)], status="draft", rfq=rfq)
    po.items[0].vendor_quotation_item_id = vqi.id
    db.commit()
    p = line_progress(db, pr)[bolt.id]
    assert p.awarded_no_po == 4 and p.open_to_order == 4 and p.state == "awarded" and "part already ordered" in p.state_label


def test_line_progress_line_split_across_two_pos(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    po_a = _po(db, pr, team["b1"], [(bolt, 6)], status="issued", source="tally")        # released
    po_b = _po(db, pr, team["b2"], [(bolt, 4)], status="issued")                         # in approval
    p2p_approvals.submit_po(db, pr, po_b, team["b2"])
    db.commit()
    p = line_progress(db, pr)[bolt.id]
    assert (p.buy_qty, p.ordered_qty, p.released_qty, p.open_to_order) == (10, 10, 6, 0)
    assert p.pending_receipt == 10 and p.state == "po_in_approval" and not p.over_ordered
    # PO B is approved: both released, nothing delivered.
    req = engine.latest_request(db, "p2p_purchase_order", po_b.id)
    for approver in (team["po1"], team["partner"]):
        engine.decide(db, req.id, approver, "approve", "ok")
    db.commit()
    p = line_progress(db, pr)[bolt.id]
    assert p.released_qty == 10 and p.state == "with_vendor"


def test_line_progress_partial_grn_then_complete(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    po = _po(db, pr, team["b1"], [(bolt, 10)], status="issued", source="tally")
    _grn(db, po, 4, accepted=3, rejected=1)
    p = line_progress(db, pr)[bolt.id]
    assert (p.accepted_qty, p.rejected_qty, p.pending_receipt) == (3, 1, 7)   # the vendor still owes the rejected one
    assert p.state == "partly_received" and p.open_to_order == 0
    _grn(db, po, 7)
    p = line_progress(db, pr)[bolt.id]
    assert p.accepted_qty == 10 and p.pending_receipt == 0 and p.state == "received"


def test_line_progress_a_grn_still_in_inspection_counts_as_received_not_accepted(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    po = _po(db, pr, team["b1"], [(bolt, 10)], status="issued", source="tally")
    _grn(db, po, 4, status="draft", accepted=0, quality="pending")
    p = line_progress(db, pr)[bolt.id]
    assert p.accepted_qty == 0 and p.pending_receipt == 6 and p.state == "partly_received"


def test_line_progress_reversed_grn_is_ignored(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    po = _po(db, pr, team["b1"], [(bolt, 10)], status="issued", source="tally")
    _grn(db, po, 10, status="reversed")
    p = line_progress(db, pr)[bolt.id]
    assert p.accepted_qty == 0 and p.pending_receipt == 10 and p.state == "with_vendor"


def test_line_progress_short_close_reduces_the_need(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    po = _po(db, pr, team["b1"], [(bolt, 6)], status="issued", source="tally")
    bolt.short_closed_qty = 4
    db.commit()
    p = line_progress(db, pr)[bolt.id]
    assert (p.buy_qty, p.short_closed_qty, p.ordered_qty, p.open_to_order) == (6, 4, 6, 0)
    assert p.state == "with_vendor"
    _grn(db, po, 6)
    p = line_progress(db, pr)[bolt.id]
    assert p.state == "short_closed" and p.pending_receipt == 0   # all bought arrived, 4 written off


def test_line_progress_over_ordered_never_shows_a_negative_open_quantity(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    _po(db, pr, team["b1"], [(bolt, 12)], status="issued", source="tally")
    p = line_progress(db, pr)[bolt.id]
    assert p.open_to_order == 0 and p.over_ordered is True and "above need" in p.state_label


def test_line_progress_cancelled_po_returns_the_quantity(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    _po(db, pr, team["b1"], [(bolt, 10)], status="cancelled")
    p = line_progress(db, pr)[bolt.id]
    assert p.ordered_qty == 0 and p.open_to_order == 10 and p.state == "to_quote"


def test_line_progress_closed_requisition_shows_open_lines_as_closed_short(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)], status="closed")
    p = line_progress(db, pr)[pr.items[0].id]
    assert p.state == "short_closed"


def test_line_progress_query_count_does_not_grow_with_the_lines(db, team):
    from sqlalchemy import event

    def _count(n_lines):
        pr = _pr(db, team["requester"], [(f"Item{next(_seq)}", 3) for _ in range(n_lines)])
        po = _po(db, pr, team["b1"], [(l, 3) for l in pr.items], status="issued", source="tally")
        _grn(db, po, 3)
        db.expire_all()
        seen = []
        eng = db.get_bind()
        cb = lambda *a, **k: seen.append(1)  # noqa: E731
        event.listen(eng, "before_cursor_execute", cb)
        try:
            line_progress(db, db.get(P2PRequest, pr.id))
        finally:
            event.remove(eng, "before_cursor_execute", cb)
        return len(seen)

    assert _count(2) == _count(12)


# ── pre_po helpers ──────────────────────────────────────────────────────────

def test_po_line_min_quantity_never_exceeds_the_po_line_and_respects_short_close(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    po_a = _po(db, pr, team["b1"], [(bolt, 3)])
    # Only this PO exists: the line still asks for 10, but the floor stays at this PO line's own 3.
    assert po_line_min_quantity(po_a.items[0], db) == 3
    po_b = _po(db, pr, team["b2"], [(bolt, 4)])
    assert po_line_min_quantity(po_a.items[0], db) == 3     # 10 - 4 = 6, capped by the line's own quantity
    bolt.short_closed_qty = 5
    db.commit()
    assert po_line_min_quantity(po_a.items[0], db) == 1     # 10 - 5 short-closed - 4 on the other PO
    bolt.short_closed_qty = 9
    db.commit()
    assert po_line_min_quantity(po_a.items[0], db) == 0     # never negative
    assert po_b.items[0].quantity == 4


def test_qty_raised_lines_respects_short_close(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 10)])
    bolt = pr.items[0]
    po = _po(db, pr, team["b1"], [(bolt, 10)])
    assert qty_raised_lines(db, po) == 0
    bolt.short_closed_qty = 2
    db.commit()
    assert qty_raised_lines(db, po) == 1   # 10 ordered but only 8 still wanted


# ── approval per PO ─────────────────────────────────────────────────────────

def _two_pos_in_approval(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)], status="vendor_quotations")
    bolt, nut = sorted(pr.items, key=lambda i: i.id)
    po_a = _po(db, pr, team["b1"], [(bolt, 4)], status="draft")
    po_b = _po(db, pr, team["b2"], [(nut, 2)], status="draft")
    for po, buyer in ((po_a, team["b1"]), (po_b, team["b2"])):
        p2p_approvals.submit_po(db, pr, po, buyer)
    db.commit()
    return pr, po_a, po_b


def test_each_po_has_its_own_request_and_the_header_waits_for_approval(db, team):
    pr, po_a, po_b = _two_pos_in_approval(db, team)
    ra = engine.latest_request(db, "p2p_purchase_order", po_a.id)
    rb = engine.latest_request(db, "p2p_purchase_order", po_b.id)
    assert ra.id != rb.id and ra.status == rb.status == "pending"
    assert pr.status == "po_raised"
    assert {p.id for p, _ in p2p_approvals.pending_po_requests(db, pr.id)} == {po_a.id, po_b.id}
    # A cancelled PO is not pending any more.
    po_b.status = "cancelled"
    db.commit()
    assert [p.id for p, _ in p2p_approvals.pending_po_requests(db, pr.id)] == [po_a.id]


def test_rejecting_one_po_cancels_only_that_po_and_never_rejects_the_requisition(db, team):
    pr, po_a, po_b = _two_pos_in_approval(db, team)
    ra = engine.latest_request(db, "p2p_purchase_order", po_a.id)
    engine.decide(db, ra.id, team["po1"], "reject", "Wrong vendor")
    db.commit()
    db.expire_all()
    pr = db.get(P2PRequest, pr.id)
    assert db.get(P2PPurchaseOrder, po_a.id).status == "cancelled"
    assert db.get(P2PPurchaseOrder, po_b.id).status == "issued"            # untouched, still waiting
    assert pr.status == "po_raised" and pr.rejected_reason is None          # PO B still pending
    assert engine.latest_request(db, "p2p_purchase_order", po_b.id).status == "pending"
    # The rejected PO's quantity is free again for another PO.
    assert po_split.open_qty_by_pr_item(db, pr) == {sorted(pr.items, key=lambda i: i.id)[0].id: 4}
    # Reject the second one too: nothing is live, the requisition goes back to procurement (not rejected).
    rb = engine.latest_request(db, "p2p_purchase_order", po_b.id)
    engine.decide(db, rb.id, team["po1"], "reject", "Too dear")
    db.commit()
    db.expire_all()
    pr = db.get(P2PRequest, pr.id)
    assert pr.status == "approved" and pr.rejected_reason is None and pr.po_number is None


def test_returning_one_po_sends_only_that_po_back_to_draft(db, team):
    pr, po_a, po_b = _two_pos_in_approval(db, team)
    ra = engine.latest_request(db, "p2p_purchase_order", po_a.id)
    engine.decide(db, ra.id, team["po1"], "return", "Fix the rate")
    db.commit()
    db.expire_all()
    assert db.get(P2PPurchaseOrder, po_a.id).status == "draft"
    assert db.get(P2PPurchaseOrder, po_b.id).status == "issued"
    assert db.get(P2PRequest, pr.id).status == "po_raised"                 # B still waits and dominates the draft
    rb = engine.latest_request(db, "p2p_purchase_order", po_b.id)
    for approver in (team["po1"], team["partner"]):
        engine.decide(db, rb.id, approver, "approve", "ok")
    db.commit()
    db.expire_all()
    assert db.get(P2PRequest, pr.id).status == "po_drafted"                # B released, A is a draft again


def test_approving_one_po_leaves_the_other_pending_and_releases_only_it(db, team):
    pr, po_a, po_b = _two_pos_in_approval(db, team)
    ra = engine.latest_request(db, "p2p_purchase_order", po_a.id)
    for approver in (team["po1"], team["partner"]):
        engine.decide(db, ra.id, approver, "approve", "ok")
    db.commit()
    db.expire_all()
    assert p2p_approvals_released(db, po_a) and not p2p_approvals_released(db, po_b)
    assert db.get(P2PRequest, pr.id).status == "po_raised"
    rb = engine.latest_request(db, "p2p_purchase_order", po_b.id)
    for approver in (team["po1"], team["partner"]):
        engine.decide(db, rb.id, approver, "approve", "ok")
    db.commit()
    db.expire_all()
    assert p2p_approvals_released(db, po_b) and db.get(P2PRequest, pr.id).status == "po_approved"


def p2p_approvals_released(db, po):
    return po_split.po_is_released(db, db.get(P2PPurchaseOrder, po.id))


def test_approval_info_prefers_the_po_the_viewer_can_decide(db, team):
    pr, po_a, po_b = _two_pos_in_approval(db, team)
    # A third approver who only sits on PO B's request.
    ra = engine.latest_request(db, "p2p_purchase_order", po_a.id)
    rb = engine.latest_request(db, "p2p_purchase_order", po_b.id)
    other = _user(db)
    engine.decide(db, ra.id, team["po1"], "approve", "ok")      # A moves on to the Partner stage
    db.commit()
    info = p2p_approvals.approval_info(db, pr, team["po1"])
    assert info["po_id"] == po_b.id and info["can_decide"] is True      # po1 is done with A, still decides B
    info = p2p_approvals.approval_info(db, pr, team["partner"])
    assert info["po_id"] == po_a.id and info["can_decide"] is True      # the partner decides A now
    info = p2p_approvals.approval_info(db, pr, other)
    assert info["can_decide"] is False and info["po_id"] in (po_a.id, po_b.id)
    assert set(info["pending_po_ids"]) == {po_a.id, po_b.id}
    assert rb.id != ra.id


def test_can_act_now_loops_every_live_po(db, team):
    pr, po_a, po_b = _two_pos_in_approval(db, team)
    outsider = _user(db)
    assert p2p_approvals.can_act_now(db, team["po1"], pr) is True
    assert p2p_approvals.can_act_now(db, outsider, pr) is False
    # po1 approves A and B; only the Partner is left on both.
    for po in (po_a, po_b):
        engine.decide(db, engine.latest_request(db, "p2p_purchase_order", po.id).id, team["po1"], "approve", "ok")
    db.commit()
    assert p2p_approvals.can_act_now(db, team["po1"], pr) is False
    assert p2p_approvals.can_act_now(db, team["partner"], pr) is True
    # Cancelling A leaves B: the partner can still act on B.
    po_a.status = "cancelled"
    db.commit()
    assert p2p_approvals.can_act_now(db, team["partner"], pr) is True
    po_b.status = "cancelled"
    db.commit()
    assert p2p_approvals.can_act_now(db, team["partner"], pr) is False


def test_the_buyer_who_uploaded_a_po_cannot_approve_it(db, team):
    pr, po_a, po_b = _two_pos_in_approval(db, team)
    from fastapi import HTTPException
    ra = engine.latest_request(db, "p2p_purchase_order", po_a.id)
    with pytest.raises(HTTPException) as e:
        engine.decide(db, ra.id, team["b1"], "approve", "mine")
    assert e.value.status_code in (403, 409)


def test_po_decision_is_ignored_when_the_po_is_no_longer_waiting(db, team):
    pr, po_a, po_b = _two_pos_in_approval(db, team)
    po_a.status = "cancelled"            # a route cancelled it; the engine request is closed afterwards
    db.commit()
    ra = engine.latest_request(db, "p2p_purchase_order", po_a.id)
    p2p_approvals._po_decided(db, ra, "rejected", team["po1"])
    db.commit()
    assert db.get(P2PPurchaseOrder, po_a.id).status == "cancelled"
    assert db.get(P2PPurchaseOrder, po_b.id).status == "issued"


def test_approval_email_lines_resolve_by_the_request_entity_not_the_latest_po(db, team):
    from app.modules.p2p.approval_mail_lines import _po_lines
    pr, po_a, po_b = _two_pos_in_approval(db, team)
    ra = engine.latest_request(db, "p2p_purchase_order", po_a.id)
    lines = _po_lines(db, ra, team["admin"])
    assert lines is not None and any("Bolt" in str(r[1]) for r in lines["rows"])
    assert not any("Nut" in str(r[1]) for r in lines["rows"])        # PO B's line is not in PO A's mail


# ── data scope ──────────────────────────────────────────────────────────────

def _assigned_user(db):
    role = Role(name=f"Buyer assigned {next(_seq)}", permissions=["p2p:rfq:view", "p2p:purchase_orders:view",
                                                                 "p2p:purchase_requisitions:view"],
                data_scopes={"p2p": "assigned"})
    db.add(role)
    db.commit()
    u = _user(db)
    u.roles = [role]
    db.commit()
    db.refresh(u)
    return u


def test_rfq_assigned_scope_is_the_rfqs_own_buyer(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)], assigned_buyer=team["head"])
    bolt, nut = sorted(pr.items, key=lambda i: i.id)
    rfq1 = _rfq(db, pr, team["b1"], [bolt])
    rfq2 = _rfq(db, pr, team["b2"], [nut])
    b1 = team["b1"]
    b1.roles = _assigned_user(db).roles
    db.commit()
    expr = scope_filter(db, b1, RFQ)
    seen = {r.id for r in db.query(RFQ).filter(expr).all()}
    assert rfq1.id in seen and rfq2.id not in seen
    # Another buyer's RFQ on the same requisition stays outside this buyer's scope.
    assert not (expr is None)


def test_po_assigned_scope_includes_pos_ordered_on_the_users_rfq(db, team):
    pr = _pr(db, team["requester"], [("Bolt", 4), ("Nut", 2)], assigned_buyer=team["head"])
    bolt, nut = sorted(pr.items, key=lambda i: i.id)
    rfq1 = _rfq(db, pr, team["b1"], [bolt])
    rfq2 = _rfq(db, pr, team["b2"], [nut])
    po1 = _po(db, pr, team["admin"], [(bolt, 4)], rfq=rfq1)     # drafted by someone else, on b1's RFQ
    po2 = _po(db, pr, team["admin"], [(nut, 2)], rfq=rfq2)
    b1 = team["b1"]
    b1.roles = _assigned_user(db).roles
    db.commit()
    seen = {p.id for p in db.query(P2PPurchaseOrder).filter(scope_filter(db, b1, P2PPurchaseOrder)).all()}
    assert po1.id in seen and po2.id not in seen


def test_line_buyer_requisition_scope_still_lets_the_buyer_open_it_but_not_a_stranger(db, team):
    from fastapi import HTTPException
    pr = _pr(db, team["requester"], [("Bolt", 4)])
    pr.items[0].buyer_id = team["b1"].id
    db.commit()
    b1, stranger = team["b1"], _assigned_user(db)
    b1.roles = _assigned_user(db).roles
    db.commit()
    ensure_pr_in_scope(db, b1, pr)                      # no error: bought line
    with pytest.raises(HTTPException) as e:
        ensure_pr_in_scope(db, stranger, pr)
    assert e.value.status_code == 403
