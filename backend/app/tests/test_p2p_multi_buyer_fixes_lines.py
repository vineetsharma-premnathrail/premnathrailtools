"""Multi-buyer split, fix wave 2 (2026-10-31): requisition-line, tracker, My Lines, requisition routes and the HR
leaver handover.

    Sec M1   moving a line to another buyer needs the Purchase head grant; nobody else can make themselves its buyer
    Sec L1   the new buyer must be in the Purchase team and is never the requester; short-close needs the Purchase desk
    Sec L2   tracker: vendor name and PO-approval comments only for the PO's buyer / head / approvers / management
    Sec L4   close checks run under the requisition lock
    Rev M2   HR leaver handover moves the RFQs the leaver owns
    Rev M3   My Lines pre-filters in SQL (urgent / overdue server filters), progress for the needed requisitions only
    Rev L1   requisition detail carries the PO the viewer is asked to decide
    Rev L2   'PO rejected' flag on a kept award
    Rev L3   the old request-quotations / select-vendor routes are gone
"""
from datetime import date, timedelta

import pytest

from app.modules.main.models.audit_log import AuditLog
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p import approvals as p2p_approvals
from app.modules.p2p import po_split
from app.modules.p2p.line_progress import PO_REJECTED_LABEL, line_progress, line_progress_many
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.routes import my_lines as my_lines_routes
from app.modules.p2p.routes import p2p_requests as p2p_requests_routes
from app.tests.test_cov_hr_lifecycle import LC, complete, leaver_world, masters, raise_exit  # noqa: F401 (fixtures)
from app.tests.test_cov_hr_support import NOW, TODAY
from app.tests.test_p2p_pr_lines import (  # noqa: F401 (autouse fixtures + helpers)
    BASE, BUYER, HEAD, MY_LINES, REQUESTER, _award, _grn, _h, _line, _line_routers, _po, _pr, _release, _reassign,
    _rfq, _short, _tracker, _user, _world)
from app.tests.test_p2p_requests import _sqlite_number_series  # noqa: F401 — autouse fixture

# A buyer who holds Assign buyer and PR Edit but NOT the Purchase head's 'All buyers' lines'.
ASSIGNER_NO_ALL_LINES = BUYER + ["p2p:purchase_requisitions:edit", "p2p:purchase_requisitions.buyer:edit"]


@pytest.fixture
def hr_clock(monkeypatch):
    """The HR 'today' the leaver_world fixture was built for (test_cov_hr_support.frozen_hr_clock, not autouse here)."""
    for target in (
        "app.modules.hr.routes.leave.today_ist", "app.modules.hr.routes.attendance.today_ist",
        "app.modules.hr.routes.holidays.today_ist", "app.modules.hr.services.attendance.today_ist",
    ):
        monkeypatch.setattr(target, lambda: TODAY)
    monkeypatch.setattr("app.modules.hr.routes.attendance.now_ist", lambda: NOW)


# ═══ Sec M1 / L1: reassign ═══════════════════════════════════════════════════

def test_buyer_with_edit_and_assign_but_no_all_lines_cannot_reassign(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    mid = _user(db, ASSIGNER_NO_ALL_LINES, name="Mid Buyer")
    r = _reassign(client, w, mid, l1, w.c)
    assert r.status_code == 403, r.text
    assert "Purchase head" in r.json()["detail"] and "All buyers' lines" in r.json()["detail"]
    assert _line(db, w, w.mat).buyer_id == w.a.id  # nothing moved


def test_a_buyer_cannot_pull_another_buyers_line_to_themselves_but_the_head_may(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    # Bhavna (line 2's buyer, with PR Edit + Assign buyer) tries to take Anil's line.
    sneaky = _user(db, ASSIGNER_NO_ALL_LINES, name="Sneaky Buyer")
    r = _reassign(client, w, sneaky, l1, sneaky)
    assert r.status_code == 403, r.text
    assert _line(db, w, w.mat).buyer_id == w.a.id
    # The head (All buyers' lines) may make themselves the buyer.
    r = _reassign(client, w, w.head, l1, w.head)
    assert r.status_code == 200, r.text
    assert _line(db, w, w.mat).buyer_id == w.head.id


def test_reassign_target_can_not_be_the_requester(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    r = _reassign(client, w, w.head, l1, w.req)
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == ("The requester can't be the buyer of their own requisition — "
                                  "pick someone from the Purchase team.")
    assert _line(db, w, w.mat).buyer_id == w.a.id


def test_reassign_target_must_be_in_the_purchase_team(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    outsider = _user(db, ["p2p:purchase_requisitions:view"], name="Outside Viewer")  # PR view, no buyer desk
    r = _reassign(client, w, w.head, l1, outsider)
    assert r.status_code == 409, r.text
    assert "not in the Purchase team" in r.json()["detail"] and "Outside Viewer" in r.json()["detail"]
    nobody = _user(db, ["store:items:view"], name="Store Only")  # purchase desk but no PR view is not enough either
    assert _reassign(client, w, w.head, l1, nobody).status_code == 409
    assert _line(db, w, w.mat).buyer_id == w.a.id


def test_short_close_needs_the_purchase_desk(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    # The requester can view the PR and holds Close-like rights on nothing: refused before anything is read.
    viewer = _user(db, ["p2p:purchase_requisitions:view", "p2p:purchase_requisitions.close:edit"], name="Desk-less Closer")
    r = _short(client, w, viewer, l1)
    assert r.status_code == 403, r.text
    assert "Procurement" in r.json()["detail"] or "module" in r.json()["detail"]
    db.expire_all()
    assert db.get(P2PRequestItem, l1.id).short_closed_qty == 0
    # The line's own buyer, on the desk, still can.
    assert _short(client, w, w.a, l1, qty=2).status_code == 200


# ═══ Sec L2: tracker visibility ══════════════════════════════════════════════

def test_tracker_hides_vendor_and_po_comments_from_other_buyers_and_the_requester(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-FIX-1")
    po = _po(db, w, w.a, {l1.id: 10}, "PO-FIX-1", vendor="Hidden Steels Pvt Ltd", rfq=rfq)
    _release(db, w, po)  # the approver's comment is "Rates are fine"

    def po_row(who):
        t = _tracker(client, w, who)
        assert t.status_code == 200, t.text
        line = next(x for x in t.json()["lines"] if x["pr_item_id"] == l1.id)
        return line["pos"][0], t.text

    # The PO's own buyer, the Purchase head, and the PO approver see the vendor and the comments.
    for who in (w.a, w.head, w.po_appr, w.admin):
        row, _ = po_row(who)
        assert row["vendor_name"] == "Hidden Steels Pvt Ltd", who.id
        assert row["approval"]["steps"][0]["comment"] == "Rates are fine", who.id
    # Another buyer on the same requisition and the requester see the PO's number and stage only.
    for who in (w.b, w.c, w.req):
        row, text = po_row(who)
        assert row["po_number"] == "PO-FIX-1" and row["vendor_name"] is None, who.id
        assert row["approval"]["steps"][0]["comment"] is None, who.id
        assert row["approval"]["steps"][0]["decided_by_name"] == w.po_appr.name  # who/when stays visible
        assert "Hidden Steels" not in text and "Rates are fine" not in text, who.id


def test_the_rfq_buyer_sees_the_vendor_even_if_another_user_uploaded_the_po(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-FIX-2")
    _po(db, w, w.head, {l1.id: 10}, "PO-FIX-2", vendor="Shared Vendor", rfq=rfq)  # the head uploaded it
    line = next(x for x in _tracker(client, w, w.a).json()["lines"] if x["pr_item_id"] == l1.id)
    assert line["pos"][0]["vendor_name"] == "Shared Vendor"
    line = next(x for x in _tracker(client, w, w.b).json()["lines"] if x["pr_item_id"] == l1.id)
    assert line["pos"][0]["vendor_name"] is None


# ═══ Sec L4: close checks run under the lock ═════════════════════════════════

def test_close_checks_run_after_the_requisition_is_locked(client, db, monkeypatch):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    po = _po(db, w, w.a, {l1.id: 10}, "PO-FIX-3")
    _release(db, w, po)
    _grn(db, po, received=4, accepted=4, number="GRN-FIX-3")
    pr = _pr(db, w)
    pr.status = "partially_received"
    db.commit()

    calls: list[str] = []
    real_lock = po_split.lock_pr
    monkeypatch.setattr(po_split, "lock_pr", lambda d, pid: (calls.append("lock"), real_lock(d, pid))[1])
    real_wait = p2p_requests_routes._pos_in_approval
    monkeypatch.setattr(p2p_requests_routes, "_pos_in_approval", lambda d, p: (calls.append("po_waiting"), real_wait(d, p))[1])
    real_grn = p2p_requests_routes._grn_awaiting_inspection
    monkeypatch.setattr(p2p_requests_routes, "_grn_awaiting_inspection", lambda d, p: (calls.append("grn_open"), real_grn(d, p))[1])

    r = client.post(f"{BASE}/{w.pr_id}/close", json={"reason": "Vendor stops at 4"}, headers=_h(w.head))
    assert r.status_code == 200, r.text
    assert calls[0] == "lock" and calls.index("po_waiting") > calls.index("lock") and calls.index("grn_open") > calls.index("lock"), calls


def test_close_without_a_reason_still_asks_for_it_before_locking(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    po = _po(db, w, w.a, {l1.id: 10}, "PO-FIX-4")
    _release(db, w, po)
    pr = _pr(db, w)
    pr.status = "partially_received"
    db.commit()
    r = client.post(f"{BASE}/{w.pr_id}/close", json={}, headers=_h(w.head))
    assert r.status_code == 400 and "Give a reason" in r.json()["detail"]


# ═══ Rev M2: HR leaver handover moves RFQs ═══════════════════════════════════

def test_exit_handover_moves_the_leavers_rfqs_on_open_requisitions(client, db, leaver_world, hr_clock):
    w = leaver_world
    leaver, successor = w["leaver"], w["successor"]
    n = 9100

    def pr_with_rfq(status, rfq_status="locked"):
        nonlocal n
        n += 1
        pr = P2PRequest(p2p_number=f"P2P-FIX-{n}", category_code="MAT", project_label="x", request_date=date.today(),
                        status=status, requested_by_id=w["reportee"].id, priority="standard")
        db.add(pr)
        db.flush()
        rfq = RFQ(rfq_number=f"RFQ-FIX-{n}", p2p_request_id=pr.id, status=rfq_status, buyer_id=leaver.id, created_by_id=leaver.id)
        db.add(rfq)
        db.commit()
        return pr, rfq

    open_pr, open_rfq = pr_with_rfq("approved")
    closed_pr, closed_rfq = pr_with_rfq("closed")
    cancelled_pr, cancelled_rfq = pr_with_rfq("cancelled")
    ev = raise_exit(client, w)
    r = complete(client, w["hr"], ev["id"], handover_to_id=successor.id)
    assert r.status_code == 200, r.text

    db.expire_all()
    assert db.get(RFQ, open_rfq.id).buyer_id == successor.id
    assert db.get(RFQ, closed_rfq.id).buyer_id == leaver.id       # closed / cancelled requisitions keep their history
    assert db.get(RFQ, cancelled_rfq.id).buyer_id == leaver.id
    audit = db.query(AuditLog).filter(AuditLog.entity_type == "p2p_request", AuditLog.entity_id == open_pr.id).all()
    assert any(open_rfq.rfq_number in (a.summary or "") and "reassigned from leaver" in (a.summary or "") for a in audit), \
        [a.summary for a in audit]
    assert any(open_rfq.rfq_number in line for line in r.json()["completion_summary"]["p2p"])


# ═══ Rev M3: My Lines ════════════════════════════════════════════════════════

def _second_pr(client, db, w, *, priority="standard"):
    """Another approved requisition of the same people: material 5 (buyer A) and consumable 3 (buyer B)."""
    body = {"purpose": "stock", "priority": priority, "approvers": {}, "items": [
        {"store_item_id": w.mat.id, "quantity": 5, "project_inhouse": "Inhouse"},
        {"store_item_id": w.svc.id, "quantity": 3, "project_inhouse": "Inhouse"}]}
    r = client.post(BASE, json=body, headers=_h(w.req))
    assert r.status_code == 200, r.text
    pr_id = r.json()["id"]
    r = client.post(f"{BASE}/{pr_id}/approve", json={"comment": "ok"}, headers=_h(w.appr))
    assert r.status_code == 200, r.text
    return pr_id


def _fully_receive_line_one(db, w):
    l1 = _line(db, w, w.mat)
    po = _po(db, w, w.a, {l1.id: 10}, "PO-FIX-ML1")
    _release(db, w, po)
    _grn(db, po, received=10, accepted=10, number="GRN-FIX-ML1")
    return l1


def test_my_lines_skips_requisitions_with_nothing_left_to_do_before_computing_progress(client, db, monkeypatch):
    w = _world(client, db)
    done = _fully_receive_line_one(db, w)  # Anil has nothing left on the first requisition
    second_id = _second_pr(client, db, w)

    seen: list[set[int]] = []
    real = my_lines_routes.line_progress_many
    monkeypatch.setattr(my_lines_routes, "line_progress_many", lambda d, prs: (seen.append({p.id for p in prs}), real(d, prs))[1])

    body = client.get(MY_LINES, headers=_h(w.a)).json()
    assert {row["p2p_request_id"] for row in body["rows"]} == {second_id}
    assert seen == [{second_id}]  # the finished requisition was never handed to the progress pass
    assert body["total"] == 1 and body["counts"] == {"to_quote": 1}

    # Finished lines still show when their state is asked for by name.
    rows = client.get(MY_LINES, params={"state": "received"}, headers=_h(w.a)).json()["rows"]
    assert [r["pr_item_id"] for r in rows] == [done.id]


def test_my_lines_urgent_and_overdue_filters_run_on_the_server(client, db):
    w = _world(client, db)  # standard, no required date
    urgent_id = _second_pr(client, db, w, priority="urgent")
    late_id = _second_pr(client, db, w)
    db.expire_all()
    late = db.get(P2PRequest, late_id)
    late.required_date = date.today() - timedelta(days=3)
    future = db.get(P2PRequest, urgent_id)
    future.required_date = date.today() + timedelta(days=30)
    db.commit()

    def ids(**params):
        r = client.get(MY_LINES, params=params, headers=_h(w.a))
        assert r.status_code == 200, r.text
        return {row["p2p_request_id"] for row in r.json()["rows"]}

    assert ids() == {w.pr_id, urgent_id, late_id}
    assert ids(urgent=True) == {urgent_id}
    assert ids(overdue=True) == {late_id}
    assert ids(urgent=True, overdue=True) == set()
    assert ids(urgent=False, overdue=False) == {w.pr_id, urgent_id, late_id}


def test_my_lines_overdue_ignores_finished_lines(client, db):
    w = _world(client, db)
    _fully_receive_line_one(db, w)
    pr = _pr(db, w)
    pr.required_date = date.today() - timedelta(days=1)
    db.commit()
    assert client.get(MY_LINES, params={"overdue": True}, headers=_h(w.a)).json()["rows"] == []
    assert client.get(MY_LINES, params={"overdue": True, "state": "received"}, headers=_h(w.a)).json()["rows"] == []
    # Bhavna's line on the same requisition is still open and overdue.
    assert len(client.get(MY_LINES, params={"overdue": True}, headers=_h(w.b)).json()["rows"]) == 1


def test_my_lines_data_scope_and_permissions_still_hold_with_the_filters(client, db):
    w = _world(client, db)
    # Another buyer's lines still need the head grant, with or without the new params.
    r = client.get(MY_LINES, params={"buyer_id": w.b.id, "urgent": True}, headers=_h(w.a))
    assert r.status_code == 403
    nobody = _user(db, ["store:items:view"])
    assert client.get(MY_LINES, params={"urgent": True}, headers=_h(nobody)).status_code == 403


def test_line_progress_many_matches_line_progress_for_each_requisition(client, db):
    w = _world(client, db)
    _fully_receive_line_one(db, w)
    second_id = _second_pr(client, db, w)
    db.expire_all()
    prs = [db.get(P2PRequest, w.pr_id), db.get(P2PRequest, second_id)]
    many = line_progress_many(db, prs)
    assert set(many) == {p.id for p in prs}
    for pr in prs:
        assert many[pr.id] == line_progress(db, pr)
    assert line_progress_many(db, []) == {}


# ═══ Rev L1: requisition detail carries the PO the viewer decides ════════════

def test_detail_shows_the_pending_po_the_viewer_can_decide(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    po1 = _po(db, w, w.a, {l1.id: 10}, "PO-FIX-D1")
    po2 = _po(db, w, w.b, {l2.id: 6}, "PO-FIX-D2")  # the newest PO
    # The approver is asked to decide the oldest pending PO first.
    r = client.get(f"{BASE}/{w.pr_id}", headers=_h(w.po_appr))
    assert r.status_code == 200, r.text
    body = r.json()
    info = body["engine_approval"]
    assert info["can_decide"] is True and info["po_id"] is not None
    assert body["purchase_order"]["id"] == info["po_id"]
    # Once that one is decided the page moves to the next waiting PO.
    other = po2.id if info["po_id"] == po1.id else po1.id
    req = engine.latest_request(db, p2p_approvals.PO_ENTITY, info["po_id"])
    engine.decide(db, req.id, w.po_appr, "approve", "ok")
    db.commit()
    body = client.get(f"{BASE}/{w.pr_id}", headers=_h(w.po_appr)).json()
    assert body["engine_approval"]["po_id"] == other
    assert body["purchase_order"]["id"] == other


def test_detail_without_a_pending_po_keeps_the_latest_po(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    po1 = _po(db, w, w.a, {l1.id: 10}, "PO-FIX-D3", submit=False)
    po2 = _po(db, w, w.b, {l2.id: 6}, "PO-FIX-D4", submit=False)
    body = client.get(f"{BASE}/{w.pr_id}", headers=_h(w.head)).json()
    assert body["purchase_order"]["id"] == max(po1.id, po2.id)


# ═══ Rev L2: 'PO rejected' flag ══════════════════════════════════════════════

def _award_with_po_and_reject(client, db, w):
    l1 = _line(db, w, w.mat)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-FIX-R")
    vqi = _award(db, rfq, l1.id, 10)
    po = _po(db, w, w.a, {l1.id: 10}, "PO-FIX-R", rfq=rfq)
    for it in db.query(P2PPurchaseOrderItem).filter(P2PPurchaseOrderItem.purchase_order_id == po.id).all():
        it.vendor_quotation_item_id = vqi.id
    db.commit()
    return l1, vqi, po


def test_a_rejected_po_flags_the_kept_award(client, db):
    w = _world(client, db)
    l1, vqi, po = _award_with_po_and_reject(client, db, w)
    # While the PO is in approval the line is not awarded-waiting.
    db.expire_all()
    p = line_progress(db, _pr(db, w))[l1.id]
    assert p.state == "po_in_approval" and p.po_rejected is False

    req = engine.latest_request(db, p2p_approvals.PO_ENTITY, po.id)
    engine.decide(db, req.id, w.po_appr, "reject", "Price too high")
    db.commit()

    db.expire_all()
    p = line_progress(db, _pr(db, w))[l1.id]
    assert p.state == "awarded" and p.po_rejected is True
    assert p.state_label == PO_REJECTED_LABEL == "Vendor chosen - PO rejected, upload again"
    line = next(x for x in _tracker(client, w, w.req).json()["lines"] if x["pr_item_id"] == l1.id)
    assert line["po_rejected"] is True and line["state_label"] == PO_REJECTED_LABEL
    row = next(x for x in client.get(MY_LINES, headers=_h(w.a)).json()["rows"] if x["pr_item_id"] == l1.id)
    assert row["po_rejected"] is True and row["state"] == "awarded" and row["state_label"] == PO_REJECTED_LABEL

    # A new PO for the award clears the flag.
    new_po = _po(db, w, w.a, {l1.id: 10}, "PO-FIX-R2")
    for it in db.query(P2PPurchaseOrderItem).filter(P2PPurchaseOrderItem.purchase_order_id == new_po.id).all():
        it.vendor_quotation_item_id = vqi.id
    db.commit()
    db.expire_all()
    p = line_progress(db, _pr(db, w))[l1.id]
    assert p.po_rejected is False and p.state == "po_in_approval"


def test_an_award_that_never_had_a_po_is_not_flagged(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-FIX-N")
    _award(db, rfq, l1.id, 10)
    db.expire_all()
    p = line_progress(db, _pr(db, w))[l1.id]
    assert p.state == "awarded" and p.po_rejected is False and p.state_label == "Vendor chosen - PO to upload"
    row = next(x for x in client.get(MY_LINES, headers=_h(w.a)).json()["rows"] if x["pr_item_id"] == l1.id)
    assert row["po_rejected"] is False


def test_a_cancelled_po_that_was_not_rejected_is_not_flagged(client, db):
    w = _world(client, db)
    l1, vqi, po = _award_with_po_and_reject(client, db, w)
    db.expire_all()
    db.get(P2PPurchaseOrder, po.id).status = "cancelled"  # cancelled by the buyer, not by the approvers
    db.commit()
    db.expire_all()
    p = line_progress(db, _pr(db, w))[l1.id]
    assert p.state == "awarded" and p.po_rejected is False


# ═══ Rev L3: dead routes are gone ════════════════════════════════════════════

def test_header_level_quotation_and_vendor_routes_are_removed(client, db):
    w = _world(client, db)
    for path, body in (("request-quotations", {"vendor": "Acme"}), ("select-vendor", {"selected_vendor": "Acme"})):
        r = client.post(f"{BASE}/{w.pr_id}/{path}", json=body, headers=_h(w.head))
        assert r.status_code in (404, 405), (path, r.status_code)
