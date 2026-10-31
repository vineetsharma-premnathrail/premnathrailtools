"""Multi-buyer split (2026-10-31), the line side: the requester's tracker, the buyers' My Lines worklist,
the Purchase head's per-line buyer reassignment, a buyer's per-line short-close, and approving / rejecting
one PO of a requisition that has several waiting.

Users are built WITHOUT assigned_apps, so they get the real roles + deny-by-default behaviour. RFQs, POs and
GRNs are written straight to the test database (what Upload PO and Goods Receipt would have made), so these tests
do not depend on those routes."""
from datetime import date
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.main import app
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.notification import Notification
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p import approvals as p2p_approvals
from app.modules.p2p import po_split
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_item import RFQItem
from app.modules.p2p.models.vendor_quotation import VendorQuotation, VendorQuotationItem
from app.modules.p2p.routes import my_lines as my_lines_routes
from app.modules.p2p.routes import pr_lines as pr_lines_routes
from app.tests.p2p_workflow_helpers import master_item, set_po_workflow, set_pr_workflow
from app.tests.test_p2p_requests import _sqlite_number_series  # noqa: F401 — autouse fixture

BASE = "/api/v1/p2p/requests"
MY_LINES = "/api/v1/p2p/my-lines"
_seq = count(1)

REQUESTER = ["p2p:purchase_requisitions:view", "p2p:purchase_requisitions:create", "p2p:purchase_requisitions:edit",
             "p2p:purchase_requisitions:submit", "p2p:purchase_requisitions:cancel"]
VIEW_BOTH = ["p2p:purchase_requisitions:view", "p2p:purchase_orders:view"]
# A line buyer: the Purchase desk, My Lines and short-close — but not Assign buyer, not All buyers' lines.
BUYER = ["p2p:purchase_desk:view", "p2p:purchase_requisitions:view", "p2p:purchase_orders:view",
         "p2p:purchase_requisitions.my_lines:view", "p2p:purchase_requisitions.close:edit",
         "p2p:purchase_requisitions.purchase_order:view"]
# The Purchase head: Assign buyer, All buyers' lines (explicit grants).
HEAD = BUYER + ["p2p:purchase_requisitions:edit", "p2p:purchase_requisitions.buyer:edit",
                "p2p:purchase_requisitions.all_lines:edit", "p2p:purchase_requisitions.all_lines:view"]


@pytest.fixture(autouse=True)
def _line_routers():
    """The new routers are registered in main.py by the Manager; make sure they exist on the test app."""
    paths = {getattr(r, "path", None) for r in app.routes}
    if "/api/v1/p2p/my-lines" not in paths:
        app.include_router(my_lines_routes.router, prefix="/api/v1")
    if "/api/v1/p2p/requests/{pr_id}/tracker" not in paths:
        app.include_router(pr_lines_routes.router, prefix="/api/v1")


def _user(db, grants=(), role="user", name=None):
    n = next(_seq)
    u = User(email=f"prl{n}@premnathrail.com", name=name or f"prl{n}", role=role, is_active=True,
             assigned_apps=[], granular_permissions=list(grants), department="R&D")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


class World:
    """One approved requisition with two lines: steel plate (10, buyer A) and cutting oil (6, buyer B)."""


def _world(client, db, *, approve=True):
    w = World()
    w.admin = _user(db, role="admin")
    w.req = _user(db, REQUESTER, name="Rita Requester")
    w.a = _user(db, BUYER, name="Anil Buyer")
    w.b = _user(db, BUYER, name="Bhavna Buyer")
    w.c = _user(db, BUYER, name="Chetan Buyer")
    w.head = _user(db, HEAD, name="Hari Head")
    w.appr = _user(db, VIEW_BOTH, name="Asha Approver")
    w.po_appr = _user(db, VIEW_BOTH, name="Pooja PO Approver")
    set_pr_workflow(db, [w.appr.id], w.admin)
    set_po_workflow(db, [w.po_appr.id], w.admin)
    db.add(ModuleSetting(module_key="p2p", key="buyer_type_material", value=w.a.id))
    db.add(ModuleSetting(module_key="p2p", key="buyer_type_consumable", value=w.b.id))
    db.commit()
    w.mat = master_item(db, f"PRL steel plate {next(_seq)}", item_type="material")
    w.svc = master_item(db, f"PRL cutting oil {next(_seq)}", item_type="consumable")
    body = {"purpose": "stock", "priority": "standard", "approvers": {}, "items": [
        {"store_item_id": w.mat.id, "quantity": 10, "project_inhouse": "Inhouse"},
        {"store_item_id": w.svc.id, "quantity": 6, "project_inhouse": "Inhouse"}]}
    r = client.post(BASE, json=body, headers=_h(w.req))
    assert r.status_code == 200, r.text
    w.pr_id = r.json()["id"]
    if approve:
        r = client.post(f"{BASE}/{w.pr_id}/approve", json={"comment": "ok"}, headers=_h(w.appr))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "approved"
    return w


def _pr(db, w) -> P2PRequest:
    db.expire_all()
    return db.get(P2PRequest, w.pr_id)


def _line(db, w, item) -> P2PRequestItem:
    return next(i for i in _pr(db, w).items if i.store_item_id == item.id)


def _rfq(db, w, buyer, lines, number, *, status="locked"):
    """An RFQ of `buyer` asking quotes for `lines` ({pr_item_id: qty})."""
    rfq = RFQ(rfq_number=number, p2p_request_id=w.pr_id, status=status, buyer_id=buyer.id, created_by_id=buyer.id)
    db.add(rfq)
    db.flush()
    pr = _pr(db, w)
    for pid, qty in lines.items():
        it = next(i for i in pr.items if i.id == pid)
        db.add(RFQItem(rfq_id=rfq.id, pr_item_id=pid, store_item_id=it.store_item_id, quantity=qty))
    db.commit()
    return rfq


def _award(db, rfq, pr_item_id, qty, vendor="Vendor One"):
    vq = VendorQuotation(rfq_id=rfq.id, p2p_request_id=rfq.p2p_request_id, vendor_name=vendor)
    db.add(vq)
    db.flush()
    vqi = VendorQuotationItem(vendor_quotation_id=vq.id, pr_item_id=pr_item_id, quantity=qty, unit_price=50.0,
                              is_awarded=True, awarded_qty=qty)
    db.add(vqi)
    db.commit()
    return vqi


def _po(db, w, buyer, lines, number, *, vendor="Vendor One", submit=True, rfq=None):
    """A PO of `buyer` for `lines` ({pr_item_id: qty}); with `submit` it goes into PO approval."""
    pr = _pr(db, w)
    po = P2PPurchaseOrder(po_number=number, p2p_request_id=pr.id, vendor_name=vendor, status="draft",
                          po_date=date.today(), created_by_id=buyer.id)
    if rfq is not None:
        po.rfq_id = rfq.id
    db.add(po)
    db.flush()
    for pid, qty in lines.items():
        it = next(i for i in pr.items if i.id == pid)
        db.add(P2PPurchaseOrderItem(purchase_order_id=po.id, store_item_id=it.store_item_id, item_name=it.item_name,
                                    unit=it.unit, quantity=qty, unit_price=100.0, pr_item_id=pid))
    db.commit()
    if submit:
        p2p_approvals.submit_po(db, pr, po, buyer)
        db.commit()
    return po


def _release(db, w, po):
    """The PO approver signs: the PO is released."""
    req = engine.latest_request(db, p2p_approvals.PO_ENTITY, po.id)
    engine.decide(db, req.id, w.po_appr, "approve", "Rates are fine")
    db.commit()


def _grn(db, po, received, accepted, number):
    g = P2PGoodsReceipt(grn_number=number, purchase_order_id=po.id, status="completed", received_date=date.today())
    db.add(g)
    db.flush()
    pi = po.items[0]
    db.add(P2PGoodsReceiptItem(goods_receipt_id=g.id, po_item_id=pi.id, store_item_id=pi.store_item_id, item_name=pi.item_name,
                               unit=pi.unit, ordered_quantity=pi.quantity, received_quantity=received, accepted_quantity=accepted,
                               rejected_quantity=received - accepted, quality_status="passed"))
    db.commit()
    return g


def _tracker(client, w, user):
    return client.get(f"{BASE}/{w.pr_id}/tracker", headers=_h(user))


# ═══ Tracker ═════════════════════════════════════════════════════════════════

def test_requester_sees_the_tracker_with_approval_buyer_rfq_po_grn_and_quantities(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-PRL-1")
    po = _po(db, w, w.a, {l1.id: 10}, "PO-PRL-1", rfq=rfq)
    _release(db, w, po)
    _grn(db, po, received=10, accepted=7, number="GRN-PRL-1")

    r = _tracker(client, w, w.req)
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["p2p_request_id"] == w.pr_id and t["status"] in ("po_approved", "partially_received")
    # Who approved the PR, and when.
    step = t["pr_approval"]["steps"][0]
    assert t["pr_approval"]["status"] == "approved"
    assert step["status"] == "approved" and step["decided_by_name"] == w.appr.name and step["decided_at"]
    # Per line: buyer, RFQ, PO with its approval and GRN, quantities.
    by_id = {ln["pr_item_id"]: ln for ln in t["lines"]}
    one, two = by_id[l1.id], by_id[l2.id]
    assert one["buyer_name"] == w.a.name and two["buyer_name"] == w.b.name
    assert [x["rfq_number"] for x in one["rfqs"]] == ["RFQ-PRL-1"] and one["rfqs"][0]["buyer_name"] == w.a.name
    po_row = one["pos"][0]
    assert po_row["po_number"] == "PO-PRL-1" and po_row["quantity"] == 10 and po_row["stage"] in ("partly_received", "with_vendor")
    assert po_row["approval"]["status"] == "approved"
    assert po_row["approval"]["steps"][0]["decided_by_name"] == w.po_appr.name
    assert po_row["grns"] == [{"grn_id": po_row["grns"][0]["grn_id"], "grn_number": "GRN-PRL-1",
                               "received_date": date.today().isoformat(), "status": "completed",
                               "received_qty": 10, "accepted_qty": 7, "rejected_qty": 3}]
    assert (one["ordered_qty"], one["accepted_qty"], one["rejected_qty"]) == (10, 7, 3)
    # The other buyer's line is still untouched.
    assert two["pos"] == [] and two["rfqs"] == [] and two["ordered_qty"] == 0
    assert two["state"] == "to_quote"
    assert t["progress"]["lines"] == 2 and t["progress"]["ordered_pct"] == pytest.approx(62.5)


def test_tracker_has_no_money_and_hides_the_vendor_from_the_requester(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    _po(db, w, w.a, {l1.id: 10}, "PO-PRL-2", vendor="Secret Steels Pvt Ltd")

    text = _tracker(client, w, w.req).text
    assert "Secret Steels" not in text and "unit_price" not in text and "total_value" not in text and "line_total" not in text
    assert _tracker(client, w, w.req).json()["lines"][0]["pos"][0]["vendor_name"] is None
    # People who buy / approve it see the vendor (still no prices).
    for who in (w.a, w.head):
        t = _tracker(client, w, who).json()
        assert t["lines"][0]["pos"][0]["vendor_name"] == "Secret Steels Pvt Ltd"
        assert "unit_price" not in str(t)


def test_a_line_buyer_sees_the_whole_tracker(client, db):
    w = _world(client, db)
    r = _tracker(client, w, w.b)  # B buys only line 2
    assert r.status_code == 200, r.text
    assert len(r.json()["lines"]) == 2


def test_an_unrelated_user_gets_403_on_the_tracker(client, db):
    w = _world(client, db)
    outsider = _user(db, VIEW_BOTH)
    r = _tracker(client, w, outsider)
    assert r.status_code == 403, r.text
    # And one with no Procurement access at all.
    nobody = _user(db, ["store:items:view"])
    assert _tracker(client, w, nobody).status_code == 403


def test_a_requisition_outside_the_data_scope_is_403_on_the_tracker(client, db):
    w = _world(client, db)
    role = Role(name="Own only PRL", permissions=["p2p:purchase_desk:view", "p2p:purchase_requisitions:view"], data_scopes={"p2p": "own"})
    db.add(role)
    db.commit()
    narrow = _user(db, [])
    narrow.roles = [role]
    db.commit()
    assert _tracker(client, w, narrow).status_code == 403


def test_draft_tracker_is_private_and_empty(client, db):
    w = _world(client, db, approve=False)
    # Make it a draft again: a draft is its requester's private copy.
    pr = _pr(db, w)
    pr.status = "draft"
    db.commit()
    own = _tracker(client, w, w.req)
    assert own.status_code == 200 and own.json()["lines"] == []
    assert _tracker(client, w, w.a).status_code == 403


def test_tracker_of_a_missing_requisition_is_404(client, db):
    w = _world(client, db)
    assert client.get(f"{BASE}/999999/tracker", headers=_h(w.req)).status_code == 404


def test_a_rejected_po_stays_on_the_tracker_as_cancelled(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    po = _po(db, w, w.a, {l1.id: 10}, "PO-PRL-3")
    req = engine.latest_request(db, p2p_approvals.PO_ENTITY, po.id)
    engine.decide(db, req.id, w.po_appr, "reject", "Price too high")
    db.commit()
    line = next(x for x in _tracker(client, w, w.req).json()["lines"] if x["pr_item_id"] == l1.id)
    assert line["ordered_qty"] == 0  # a cancelled PO is no longer ordered
    assert [(p["po_number"], p["stage"]) for p in line["pos"]] == [("PO-PRL-3", "cancelled")]
    assert line["pos"][0]["approval"]["status"] == "rejected"


# ═══ Reassign a line's buyer ═════════════════════════════════════════════════

def _reassign(client, w, who, line, buyer, reason="Anil is on leave this week"):
    body = {} if buyer is None else {"buyer_id": buyer.id}
    if reason is not None:
        body["reason"] = reason
    return client.post(f"{BASE}/{w.pr_id}/lines/{line.id}/reassign-buyer", json=body, headers=_h(who))


def test_head_reassigns_the_unordered_quantity_and_the_old_buyer_is_blocked(client, db, monkeypatch):
    teams = []
    monkeypatch.setattr("app.utils.notifications._notify_teams", lambda *a, **k: teams.append(a))
    w = _world(client, db)
    teams.clear()  # the PR approval request above is a legitimate Teams message
    l1 = _line(db, w, w.mat)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-PRL-4")
    _award(db, rfq, l1.id, 6)

    r = _reassign(client, w, w.head, l1, w.c)
    assert r.status_code == 200, r.text
    assert next(i for i in r.json()["items"] if i["id"] == l1.id)["buyer_id"] == w.c.id

    db.expire_all()
    ri = db.query(RFQItem).filter(RFQItem.rfq_id == rfq.id).one()
    assert ri.withdrawn_at is not None and "Moved to Chetan Buyer by Hari Head" in ri.withdrawn_reason
    assert "Anil is on leave" in ri.withdrawn_reason
    vqi = db.query(VendorQuotationItem).one()
    assert vqi.awarded_qty == 0 and not vqi.is_awarded  # the award with no PO is cleared
    actions = [a.action for a in db.query(AuditLog).filter(AuditLog.entity_id == w.pr_id, AuditLog.entity_type == "p2p_request").all()]
    assert "line_buyer_reassigned" in actions and "award_cleared" in actions
    # Bell notices to the old buyer, the new buyer and the requester; the head who acted gets none; never Teams.
    for who in (w.a, w.c, w.req):
        assert db.query(Notification).filter(Notification.user_id == who.id, Notification.notification_type == "p2p_line_buyer_reassigned").count() == 1
    assert db.query(Notification).filter(Notification.user_id == w.head.id, Notification.notification_type == "p2p_line_buyer_reassigned").count() == 0
    assert teams == []

    # The old buyer can no longer work the line.
    r = client.post(f"{BASE}/{w.pr_id}/lines/{l1.id}/short-close", json={"reason": "Not needed any more"}, headers=_h(w.a))
    assert r.status_code == 403 and "Chetan Buyer" in r.json()["detail"] and "reassign" in r.json()["detail"].lower()
    mine = client.get(MY_LINES, headers=_h(w.a)).json()
    assert [row["pr_item_id"] for row in mine["rows"]] == []
    theirs = client.get(MY_LINES, headers=_h(w.c)).json()
    assert [row["pr_item_id"] for row in theirs["rows"]] == [l1.id]
    # The tracker follows the buyer.
    line = next(x for x in _tracker(client, w, w.req).json()["lines"] if x["pr_item_id"] == l1.id)
    assert line["buyer_name"] == "Chetan Buyer"


def test_reassign_keeps_quantity_already_on_a_po_with_its_buyer(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-PRL-5")
    vqi = _award(db, rfq, l1.id, 10)
    po = _po(db, w, w.a, {l1.id: 4}, "PO-PRL-5", rfq=rfq)
    po.items[0].vendor_quotation_item_id = vqi.id
    db.commit()

    assert _reassign(client, w, w.head, l1, w.c).status_code == 200
    db.expire_all()
    assert db.query(VendorQuotationItem).one().awarded_qty == 4  # what is on the PO stays awarded
    assert db.get(P2PPurchaseOrder, po.id).created_by_id == w.a.id and db.get(P2PPurchaseOrder, po.id).status != "cancelled"


def test_reassign_errors_say_what_to_do(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    # No reason / no buyer.
    r = _reassign(client, w, w.head, l1, w.c, reason="  ")
    assert r.status_code == 422 and "reason" in r.json()["detail"].lower() and "5 characters" in r.json()["detail"]
    r = _reassign(client, w, w.head, l1, None)
    assert r.status_code == 422 and "Pick the buyer" in r.json()["detail"]
    # Already the buyer.
    r = _reassign(client, w, w.head, l1, w.a)
    assert r.status_code == 409 and "already the buyer" in r.json()["detail"]
    # A user with no Procurement access cannot be made the buyer.
    nobody = _user(db, ["store:items:view"], name="Nina Nobody")
    r = _reassign(client, w, w.head, l1, nobody)
    assert r.status_code == 409 and "Nina Nobody" in r.json()["detail"] and "Procurement" in r.json()["detail"]
    # An unknown user.
    r = client.post(f"{BASE}/{w.pr_id}/lines/{l1.id}/reassign-buyer", json={"buyer_id": 999999, "reason": "Someone else buys it"}, headers=_h(w.head))
    assert r.status_code == 404
    # A line that is not on this requisition (never trust the id alone).
    r = client.post(f"{BASE}/{w.pr_id}/lines/999999/reassign-buyer", json={"buyer_id": w.c.id, "reason": "Someone else buys it"}, headers=_h(w.head))
    assert r.status_code == 404 and "not on" in r.json()["detail"]
    # Nothing left to move: the whole line is on a PO.
    _po(db, w, w.a, {l1.id: 10}, "PO-PRL-6")
    r = _reassign(client, w, w.head, l1, w.c)
    assert r.status_code == 409 and "PO-PRL-6" in r.json()["detail"] and "nothing left to reassign" in r.json()["detail"].lower()


def test_reassign_needs_the_assign_buyer_permission(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    # A line buyer (no Assign buyer), the requester, and a user outside the Purchase desk.
    for who in (w.a, w.req, w.appr):
        r = _reassign(client, w, who, l1, w.c)
        assert r.status_code == 403, (who.id, r.text)
    # Nothing moved.
    assert _line(db, w, w.mat).buyer_id == w.a.id


def test_reassign_is_refused_on_a_requisition_outside_the_data_scope(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    role = Role(name="Head own only PRL", permissions=[g for g in HEAD if ".all_lines" not in g], data_scopes={"p2p": "own"})
    db.add(role)
    db.commit()
    narrow = _user(db, [])
    narrow.roles = [role]
    db.commit()
    assert _reassign(client, w, narrow, l1, w.c).status_code == 403


def test_reassign_is_refused_when_the_requisition_is_not_with_procurement(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    pr = _pr(db, w)
    pr.status = "closed"
    db.commit()
    r = _reassign(client, w, w.head, l1, w.c)
    assert r.status_code == 409 and "with procurement" in r.json()["detail"]


def test_reassign_follows_the_assign_to_rule_of_the_heads_role(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    role = Role(name="Head with a rule PRL", permissions=HEAD, data_scopes={"p2p": "organization"},
                assignee_rules={"p2p:purchase_requisitions.buyer": {"mode": "self"}})
    db.add(role)
    db.commit()
    ruled = _user(db, [], name="Ruled Head")
    ruled.roles = [role]
    db.commit()
    r = _reassign(client, w, ruled, l1, w.c)
    assert r.status_code == 403 and "Chetan Buyer" in r.json()["detail"]


# ═══ Short-close one line ════════════════════════════════════════════════════

def _short(client, w, who, line, qty=None, reason="Customer cancelled this item"):
    body = {"reason": reason}
    if qty is not None:
        body["quantity"] = qty
    return client.post(f"{BASE}/{w.pr_id}/lines/{line.id}/short-close", json=body, headers=_h(who))


def test_buyer_short_closes_part_of_a_line_and_awards_are_trimmed(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-PRL-7")
    _award(db, rfq, l1.id, 10)

    r = _short(client, w, w.a, l1, qty=4)
    assert r.status_code == 200, r.text
    item = next(i for i in r.json()["items"] if i["id"] == l1.id)
    assert item["short_closed_qty"] == 4 and "Customer cancelled" in item["short_closed_reason"]
    assert item["short_closed_by_name"] == w.a.name and item["short_closed_at"]
    db.expire_all()
    assert db.query(VendorQuotationItem).one().awarded_qty == 6  # trimmed to what is still to buy
    assert "line_short_closed" in [a.action for a in db.query(AuditLog).filter(AuditLog.entity_id == w.pr_id).all()]
    # The requester gets a bell notice.
    assert db.query(Notification).filter(Notification.user_id == w.req.id, Notification.notification_type == "p2p_line_short_closed").count() == 1
    line = next(x for x in _tracker(client, w, w.req).json()["lines"] if x["pr_item_id"] == l1.id)
    assert line["short_closed_qty"] == 4 and line["short_closed_reason"].startswith("Customer cancelled")
    # The default is everything not yet ordered.
    r = _short(client, w, w.a, l1)
    assert r.status_code == 200
    assert next(i for i in r.json()["items"] if i["id"] == l1.id)["short_closed_qty"] == 10


def test_short_close_errors(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    r = _short(client, w, w.a, l1, qty=11)
    assert r.status_code == 422 and "Only 10" in r.json()["detail"]
    r = _short(client, w, w.a, l1, reason="no")
    assert r.status_code == 422 and "reason" in r.json()["detail"].lower()
    r = _short(client, w, w.a, l1, qty=-1)
    assert r.status_code == 422
    # Another buyer's line.
    r = _short(client, w, w.b, l1)
    assert r.status_code == 403 and "Anil Buyer" in r.json()["detail"] and "Purchase head" in r.json()["detail"]
    # A line that is not on this requisition.
    assert client.post(f"{BASE}/{w.pr_id}/lines/999999/short-close", json={"reason": "Not needed at all"}, headers=_h(w.a)).status_code == 404
    # The requester (no line, no close grant of a buyer).
    assert _short(client, w, w.req, l1).status_code == 403
    # Nothing left when the line is fully on a PO.
    _po(db, w, w.b, {l2.id: 6}, "PO-PRL-8")
    r = _short(client, w, w.b, l2)
    assert r.status_code == 409 and "PO-PRL-8" in r.json()["detail"]
    # Closed requisition.
    pr = _pr(db, w)
    pr.status = "closed"
    db.commit()
    assert _short(client, w, w.a, l1).status_code == 409


def test_head_may_short_close_another_buyers_line_and_the_buyer_is_told(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    assert _short(client, w, w.head, l1, qty=3).status_code == 200
    db.expire_all()
    assert db.query(Notification).filter(Notification.user_id == w.a.id, Notification.notification_type == "p2p_line_short_closed").count() == 1


def test_short_closing_every_line_closes_the_requisition(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    assert _short(client, w, w.a, l1).json()["status"] == "approved"  # one line left to buy
    r = _short(client, w, w.b, l2)
    assert r.status_code == 200 and r.json()["status"] == "closed"
    db.expire_all()
    assert "closed" in [a.action for a in db.query(AuditLog).filter(AuditLog.entity_id == w.pr_id).all()]
    mail = db.query(Notification).filter(Notification.user_id == w.req.id, Notification.notification_type == "p2p_line_short_closed").all()
    assert any("now closed" in n.message for n in mail)


# ═══ My Lines ════════════════════════════════════════════════════════════════

def test_my_lines_shows_only_my_lines_sorted_with_progress_and_no_prices(client, db):
    w = _world(client, db)
    # A second requisition so the sort across requisitions is visible.
    body = {"purpose": "stock", "priority": "urgent", "approvers": {},
            "items": [{"store_item_id": w.mat.id, "quantity": 3, "project_inhouse": "Inhouse"}]}
    second = client.post(BASE, json=body, headers=_h(w.req)).json()
    assert client.post(f"{BASE}/{second['id']}/approve", json={"comment": "ok"}, headers=_h(w.appr)).status_code == 200
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-PRL-9")
    _po(db, w, w.a, {l1.id: 4}, "PO-PRL-9", rfq=rfq)

    r = client.get(MY_LINES, headers=_h(w.a))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["total"] == 2 and d["skip"] == 0 and d["limit"] == 100
    numbers = [row["p2p_number"] for row in d["rows"]]
    assert numbers == sorted(numbers) and numbers[0] != numbers[1]  # requisition number ascending
    first = d["rows"][0]
    assert first["pr_item_id"] == l1.id and first["buyer_name"] == w.a.name
    assert (first["buy_qty"], first["ordered_qty"], first["open_to_order"]) == (10, 4, 6)
    assert [x["rfq_number"] for x in first["rfqs"]] == ["RFQ-PRL-9"] and [x["po_number"] for x in first["pos"]] == ["PO-PRL-9"]
    assert first["pos"][0]["stage"] == "in_approval" and first["requester_name"] == w.req.name
    assert "unit_price" not in r.text and "po_value" not in r.text
    assert sum(d["counts"].values()) == 2
    # B sees only their line.
    other = client.get(MY_LINES, headers=_h(w.b)).json()
    assert [row["pr_item_id"] for row in other["rows"]] == [l2.id]


def test_my_lines_other_buyer_and_all_need_the_head_grant(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    r = client.get(MY_LINES, params={"buyer_id": w.b.id}, headers=_h(w.a))
    assert r.status_code == 403 and "All buyers" in r.json()["detail"]
    assert client.get(MY_LINES, params={"all": "true"}, headers=_h(w.a)).status_code == 403
    assert client.get(MY_LINES, params={"buyer_id": 0}, headers=_h(w.a)).status_code == 403
    # Asking for yourself by id is fine.
    assert client.get(MY_LINES, params={"buyer_id": w.a.id}, headers=_h(w.a)).status_code == 200
    # The head sees everyone, or one buyer.
    everyone = client.get(MY_LINES, params={"all": "true"}, headers=_h(w.head)).json()
    assert {row["pr_item_id"] for row in everyone["rows"]} == {l1.id, l2.id}
    only_b = client.get(MY_LINES, params={"buyer_id": w.b.id}, headers=_h(w.head)).json()
    assert [row["pr_item_id"] for row in only_b["rows"]] == [l2.id]
    # Admin too.
    assert client.get(MY_LINES, params={"all": "true"}, headers=_h(w.admin)).json()["total"] == 2


def test_my_lines_unassigned_lines_for_the_head(client, db):
    w = _world(client, db)
    l1 = _line(db, w, w.mat)
    pr = _pr(db, w)
    pr.assigned_buyer_id = None
    for it in pr.items:
        if it.id == l1.id:
            it.buyer_id = None
    db.commit()
    r = client.get(MY_LINES, params={"buyer_id": 0}, headers=_h(w.head)).json()
    assert [row["pr_item_id"] for row in r["rows"]] == [l1.id] and r["rows"][0]["buyer_id"] is None


def test_my_lines_without_the_my_lines_permission_is_403(client, db):
    _world(client, db)
    # Customised role: the tab is open but the My Lines sub-tab is not ticked.
    no_sub = _user(db, ["p2p:purchase_desk:view", "p2p:purchase_requisitions:view", "p2p:purchase_requisitions.all_requisitions:view"])
    r = client.get(MY_LINES, headers=_h(no_sub))
    assert r.status_code == 403 and "My Lines" in r.json()["detail"]
    # No Procurement at all.
    assert client.get(MY_LINES, headers=_h(_user(db, ["store:items:view"]))).status_code == 403


def test_my_lines_filters_state_search_and_requisition(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    rfq = _rfq(db, w, w.a, {l1.id: 10}, "RFQ-PRL-10")
    everyone = client.get(MY_LINES, params={"all": "true"}, headers=_h(w.head)).json()
    assert everyone["counts"] == {"quoting": 1, "to_quote": 1}
    quoting = client.get(MY_LINES, params={"all": "true", "state": "quoting"}, headers=_h(w.head)).json()
    assert [row["pr_item_id"] for row in quoting["rows"]] == [l1.id] and quoting["rows"][0]["rfqs"][0]["id"] == rfq.id
    by_text = client.get(MY_LINES, params={"all": "true", "search": "cutting oil"}, headers=_h(w.head)).json()
    assert [row["pr_item_id"] for row in by_text["rows"]] == [l2.id]
    by_pr = client.get(MY_LINES, params={"all": "true", "p2p_request_id": w.pr_id + 1000}, headers=_h(w.head)).json()
    assert by_pr["rows"] == [] and by_pr["total"] == 0
    # Paging.
    page = client.get(MY_LINES, params={"all": "true", "limit": 1, "skip": 1}, headers=_h(w.head)).json()
    assert page["total"] == 2 and len(page["rows"]) == 1 and page["rows"][0]["pr_item_id"] == l2.id


def test_my_lines_hides_requisitions_that_are_not_with_procurement_and_finished_lines(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    # Line 2 fully received: nothing to order and nothing pending -> off the default list.
    po = _po(db, w, w.b, {l2.id: 6}, "PO-PRL-11")
    _release(db, w, po)
    _grn(db, po, received=6, accepted=6, number="GRN-PRL-11")
    rows = client.get(MY_LINES, params={"all": "true"}, headers=_h(w.head)).json()["rows"]
    assert [row["pr_item_id"] for row in rows] == [l1.id]
    done = client.get(MY_LINES, params={"all": "true", "state": "received"}, headers=_h(w.head)).json()["rows"]
    assert [row["pr_item_id"] for row in done] == [l2.id]
    pr = _pr(db, w)
    pr.status = "cancelled"
    db.commit()
    assert client.get(MY_LINES, params={"all": "true"}, headers=_h(w.head)).json()["rows"] == []


def test_my_lines_respects_the_data_scope(client, db):
    _world(client, db)
    role = Role(name="Buyer own-scope PRL", permissions=BUYER, data_scopes={"p2p": "own"})
    db.add(role)
    db.commit()
    narrow = _user(db, [])
    narrow.roles = [role]
    db.commit()
    assert client.get(MY_LINES, headers=_h(narrow)).json()["rows"] == []


# ═══ Several POs waiting for approval ════════════════════════════════════════

def _two_pos(db, w):
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    po1 = _po(db, w, w.a, {l1.id: 10}, "PO-PRL-A")
    po2 = _po(db, w, w.b, {l2.id: 6}, "PO-PRL-B")
    return po1, po2


def test_approve_po_names_the_po_when_two_are_waiting(client, db):
    w = _world(client, db)
    po1, po2 = _two_pos(db, w)
    assert _pr(db, w).status == "po_raised"
    url = f"{BASE}/{w.pr_id}/approve-po"

    r = client.post(url, json={"comment": "ok"}, headers=_h(w.po_appr))
    assert r.status_code == 409 and "PO-PRL-A" in r.json()["detail"] and "PO-PRL-B" in r.json()["detail"] and "po_id" in r.json()["detail"]
    # A PO that is not on this requisition.
    r = client.post(url, json={"comment": "ok", "po_id": 999999}, headers=_h(w.po_appr))
    assert r.status_code == 404 and "not a PO of" in r.json()["detail"]
    # Approve only the first one.
    r = client.post(url, json={"comment": "ok", "po_id": po1.id}, headers=_h(w.po_appr))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert po_split.po_is_released(db, db.get(P2PPurchaseOrder, po1.id)) is True
    assert po_split.po_is_released(db, db.get(P2PPurchaseOrder, po2.id)) is False
    assert db.get(P2PRequest, w.pr_id).status == "po_raised"  # the other PO still waits
    # Deciding the same PO again is refused with the reason.
    r = client.post(url, json={"comment": "again", "po_id": po1.id}, headers=_h(w.po_appr))
    assert r.status_code == 409 and "not waiting for approval" in r.json()["detail"]
    # With one left waiting, no po_id is needed.
    r = client.post(url, json={"comment": "ok"}, headers=_h(w.po_appr))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert po_split.po_is_released(db, db.get(P2PPurchaseOrder, po2.id)) is True


def test_reject_one_po_with_po_id_cancels_only_that_po(client, db):
    w = _world(client, db)
    po1, po2 = _two_pos(db, w)
    url = f"{BASE}/{w.pr_id}/reject"
    r = client.post(url, json={"reason": "Wrong vendor"}, headers=_h(w.po_appr))
    assert r.status_code == 409 and "PO-PRL-A" in r.json()["detail"]
    r = client.post(url, json={"reason": "Wrong vendor", "po_id": po2.id}, headers=_h(w.po_appr))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(P2PPurchaseOrder, po2.id).status == "cancelled"
    assert db.get(P2PPurchaseOrder, po1.id).status == "issued"
    assert db.get(P2PRequest, w.pr_id).status == "po_raised"  # the requisition is not rejected


def test_cancelling_the_requisition_is_blocked_while_a_po_is_in_approval(client, db):
    w = _world(client, db)
    po1, _po2 = _two_pos(db, w)
    r = client.post(f"{BASE}/{w.pr_id}/cancel", json={"reason": "not needed"}, headers=_h(w.req))
    assert r.status_code == 409 and "awaiting approval" in r.json()["detail"]
    assert _pr(db, w).status == "po_raised"


# ═══ Close writes the un-ordered balance off per line ════════════════════════

def test_close_writes_the_never_ordered_quantity_into_the_line(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    po = _po(db, w, w.a, {l1.id: 10}, "PO-PRL-12")
    _release(db, w, po)
    _grn(db, po, received=4, accepted=4, number="GRN-PRL-12")
    db.get(P2PPurchaseOrder, po.id).status = "partially_fulfilled"  # what Goods Receipt does after a partial delivery
    db.commit()
    po_split.rollup_pr_status(db, _pr(db, w), None, force=True)
    db.commit()
    assert _pr(db, w).status == "partially_received"

    r = client.post(f"{BASE}/{w.pr_id}/close", json={"reason": "Vendor stops at 4; service not needed"}, headers=_h(w.head))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "closed"
    item2 = next(i for i in r.json()["items"] if i["id"] == l2.id)
    assert item2["short_closed_qty"] == 6 and "Vendor stops" in item2["short_closed_reason"]
    item1 = next(i for i in r.json()["items"] if i["id"] == l1.id)
    assert item1["short_closed_qty"] == 0  # ordered quantity is not written into the line (the PO shows short-closed)
    summaries = [a.summary for a in db.query(AuditLog).filter(AuditLog.entity_id == w.pr_id, AuditLog.action == "short_closed").all()]
    assert summaries and "written off" in summaries[0]


def test_close_is_blocked_while_a_po_is_waiting_for_approval(client, db):
    w = _world(client, db)
    l1, l2 = _line(db, w, w.mat), _line(db, w, w.svc)
    po1 = _po(db, w, w.a, {l1.id: 10}, "PO-PRL-13")
    _release(db, w, po1)
    _grn(db, po1, received=10, accepted=10, number="GRN-PRL-13")
    _po(db, w, w.b, {l2.id: 6}, "PO-PRL-14")  # still in approval
    pr = _pr(db, w)
    pr.status = "partially_received"  # the roll-up would say po_raised; force the status the close gate reads
    db.commit()
    r = client.post(f"{BASE}/{w.pr_id}/close", json={"reason": "stop here please"}, headers=_h(w.head))
    assert r.status_code == 409 and "PO-PRL-14" in r.json()["detail"]
