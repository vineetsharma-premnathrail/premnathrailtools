"""Fix wave 1 of the PR multi-buyer split (2026-10-31): RFQ / quotation / invite / PO-draft findings.

    H1   re-recording a quote after its PO was rejected / discarded (quote lines updated in place)
    H2   discard a draft PO (returned / withdrawn): quantity back to open, roll-up, bell, audit
    M2   another buyer's RFQ is not readable (scope drops the header buyer; owner gate on every detail read)
    M3   invite mutations and quote-file uploads belong to the RFQ's buyer
    M4   an RFQ raised before the split may be uploaded by its owner for all its lines; the refusal is worded right
    L3   a PO with no RFQ is not reachable through another buyer's RFQ
    L4   a PO sent twice / changed under the lock is a clear 409
    L7   the draft quantity floor names its real reason
"""
from datetime import datetime, timezone

from app.core.config import settings
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.notification import Notification
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p import po_split
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_invite import RFQVendorInvite
from app.modules.p2p.models.vendor_quotation import VendorQuotationItem
from app.tests.p2p_po_helpers import make_ship_to, post_upload_po
from app.tests.test_p2p_multi_buyer_rfq import (  # noqa: F401 - w / quoted are fixtures
    RFQS, _create, _h, _open, _qi, _split_award, _upload, _vendor, quoted, w,
)
from app.tests.test_p2p_requests import _sqlite_number_series, make_user  # noqa: F401 - autouse fixture

PR = "/api/v1/p2p/requests"
POS = "/api/v1/p2p/purchase-orders"


def _po_of(db, po_json):
    db.expire_all()
    return db.get(P2PPurchaseOrder, po_json["id"])


def _return_po(db, w, po_json):
    """The PO approver returns the PO for changes: it goes back to draft."""
    req = engine.latest_request(db, "p2p_purchase_order", po_json["id"])
    engine.decide(db, req.id, w["approver"], "return", "Please check the rate again")
    db.commit()
    assert _po_of(db, po_json).status == "draft"


def _reject_po(client, w, po_json):
    r = client.post(f"{PR}/{w['pr_id']}/reject", json={"reason": "Rate is above budget", "po_id": po_json["id"]}, headers=_h(w["approver"]))
    assert r.status_code == 200, r.text


def _upload_l1(client, db, q, tally, quote="q1", lines=None):
    r = _upload(client, db, q["a"], q, q[quote], lines or [{"pr_item_id": q["l1"], "quantity": 40}], tally)
    assert r.status_code == 200, r.text
    return r.json()


def _discard(client, who, q, po, reason="Vendor withdrew the offer"):
    return client.post(f"{RFQS}/{q['rfq']['id']}/po-draft/{po['id']}/discard", json={"reason": reason}, headers=_h(who))


# ── H1: re-quote after a rejected PO ──────────────────────────────────────────

def test_a_quote_can_be_re_recorded_after_its_po_was_rejected_and_nothing_is_orphaned(client, db, quoted):
    q = quoted
    _split_award(client, q)
    po = _upload_l1(client, db, q, "TALLY-FX-H1", lines=[{"pr_item_id": q["l1"], "quantity": 40}, {"pr_item_id": q["l3"]}])
    l1_quote_line, l3_quote_line = _qi(q["q1"], q["l1"]), _qi(q["q1"], q["l3"])
    # While the PO is live the quote is locked (as before).
    body = {"vendor_id": q["v1"].id, "items": [{"pr_item_id": q["l1"], "unit_price": 95, "gst_rate": 18}]}
    live = client.put(f"{RFQS}/{q['rfq']['id']}/line-quotations/{q['q1']['id']}", json=body, headers=_h(q["a"]))
    assert live.status_code == 409 and "already on a PO" in live.json()["detail"]

    _reject_po(client, q, po)
    db.expire_all()
    assert db.get(P2PPurchaseOrder, po["id"]).status == "cancelled"
    # Re-record: L3 is no longer quoted, L1 gets a new price.
    r = client.put(f"{RFQS}/{q['rfq']['id']}/line-quotations/{q['q1']['id']}", json=body, headers=_h(q["a"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    rows = {i.pr_item_id: i for i in db.query(VendorQuotationItem).filter_by(vendor_quotation_id=q["q1"]["id"]).all()}
    assert set(rows) == {q["l1"]}
    assert rows[q["l1"]].id == l1_quote_line and rows[q["l1"]].unit_price == 95   # updated in place, same row
    assert rows[q["l1"]].awarded_qty == 40 and rows[q["l1"]].is_awarded            # the award stays on a line still quoted
    # No PO line points at a quote line that is gone; the dead PO's L1 line still names its quote line.
    existing_ids = {i.id for i in db.query(VendorQuotationItem).all()}
    po_lines = db.query(P2PPurchaseOrderItem).filter_by(purchase_order_id=po["id"]).all()
    assert all(pl.vendor_quotation_item_id is None or pl.vendor_quotation_item_id in existing_ids for pl in po_lines)
    by_line = {pl.pr_item_id: pl.vendor_quotation_item_id for pl in po_lines}
    assert by_line[q["l1"]] == l1_quote_line and by_line[q["l3"]] is None and l3_quote_line not in existing_ids
    # The buyer can upload again on the re-recorded quote.
    again = _upload(client, db, q["a"], q, q["q1"], [{"pr_item_id": q["l1"], "quantity": 40}], "TALLY-FX-H1")
    assert again.status_code == 200, again.text


def test_a_quote_line_is_added_again_in_place_when_the_vendor_quotes_it_back(client, db, quoted):
    q = quoted
    body = {"vendor_id": q["v1"].id, "items": [
        {"pr_item_id": q["l1"], "unit_price": 99, "gst_rate": 18}, {"pr_item_id": q["l3"], "unit_price": 49, "gst_rate": 18}]}
    r = client.put(f"{RFQS}/{q['rfq']['id']}/line-quotations/{q['q1']['id']}", json=body, headers=_h(q["a"]))
    assert r.status_code == 200, r.text
    assert sorted(i["id"] for i in r.json()["items"]) == sorted([_qi(q["q1"], q["l1"]), _qi(q["q1"], q["l3"])])
    assert {i["pr_item_id"]: i["unit_price"] for i in r.json()["items"]} == {q["l1"]: 99, q["l3"]: 49}


# ── H2: discard a draft PO ────────────────────────────────────────────────────

def test_a_returned_draft_po_can_be_discarded_its_quantity_is_open_again(client, db, quoted):
    q = quoted
    _split_award(client, q)
    po = _upload_l1(client, db, q, "TALLY-FX-D1", lines=[{"pr_item_id": q["l1"], "quantity": 40}, {"pr_item_id": q["l3"]}])
    assert _open(db, q["pr_id"])[q["l1"]] == 60 and _open(db, q["pr_id"]).get(q["l3"], 0) == 0
    # In approval it can't be discarded (409 with the way forward).
    busy = _discard(client, q["a"], q, po)
    assert busy.status_code == 409 and "only a draft PO can" in busy.json()["detail"] and po["po_number"] in busy.json()["detail"]
    _return_po(db, q, po)

    # Permission and ownership first: another buyer, a short reason.
    other = _discard(client, q["b"], q, po)
    assert other.status_code == 403 and q["a"].name in other.json()["detail"]
    assert _discard(client, q["a"], q, po, reason="no").status_code == 422
    viewer = make_user(db, "mb.fx.viewer@premnathrail.com", assigned_apps=("purchase",))
    viewer.granular_permissions = ["p2p:purchase_orders:view", "p2p:rfq:view"]
    db.commit()
    assert _discard(client, viewer, q, po).status_code == 403
    assert _po_of(db, po).status == "draft"

    before = db.query(Notification).count()
    r = _discard(client, q["a"], q, po, reason="Alpha cannot supply in time")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled" and r.json()["id"] == po["id"]
    db.expire_all()
    assert db.get(P2PPurchaseOrder, po["id"]).status == "cancelled"
    assert _open(db, q["pr_id"])[q["l1"]] == 100 and _open(db, q["pr_id"])[q["l3"]] == 10   # computed: back to open
    assert db.get(P2PRequest, q["pr_id"]).status == "vendor_quotations"                      # rolled up: RFQ out for quotes, no live PO
    log = db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=q["pr_id"], action="po_discarded").one()
    assert po["po_number"] in log.summary and "Alpha cannot supply in time" in log.summary and q["a"].name in log.summary
    assert db.query(AuditLog).filter_by(entity_type="rfq", entity_id=q["rfq"]["id"], action="po_discarded").count() == 1
    # Bell (not Teams): the requester and the line buyers are told; the actor is not.
    bells = db.query(Notification).filter_by(notification_type="p2p_po_discarded").all()
    assert db.query(Notification).count() > before
    pr = db.get(P2PRequest, q["pr_id"])
    assert pr.requested_by_id in {n.user_id for n in bells} and q["a"].id not in {n.user_id for n in bells}
    assert all(n.entity_type == "p2p_request" and n.entity_id == q["pr_id"] and po["po_number"] in n.message for n in bells)
    # Discarding it again says it is gone; its Tally number is free for the re-upload.
    twice = _discard(client, q["a"], q, po)
    assert twice.status_code == 409 and "cancelled" in twice.json()["detail"]
    again = _upload(client, db, q["a"], q, q["q1"], [{"pr_item_id": q["l1"], "quantity": 40}], "TALLY-FX-D1")
    assert again.status_code == 200, again.text


def test_the_purchase_head_can_discard_another_buyers_draft_po_and_a_missing_po_is_a_404(client, db, quoted):
    q = quoted
    _split_award(client, q)
    po = _upload_l1(client, db, q, "TALLY-FX-D2")
    _return_po(db, q, po)
    assert _discard(client, q["head"], q, po, reason="Head cleans up a stale draft").status_code == 200
    gone = client.post(f"{RFQS}/{q['rfq']['id']}/po-draft/999999/discard", json={"reason": "does not matter"}, headers=_h(q["a"]))
    assert gone.status_code == 404 and "Draft PO not found" in gone.json()["detail"]


def test_a_draft_po_made_for_a_before_po_receipt_reopens_the_receipt_when_discarded(client, db, quoted):
    from app.modules.store.models.pre_po_receipt import StorePrePoReceipt
    from app.tests.test_pre_po_receipts import PROC, STORE, _body, _store_user, _vendor as _bpo_vendor
    from app.tests.p2p_workflow_helpers import master_item, set_po_workflow

    keeper = _store_user(db, "mb.fx.keeper@premnathrail.com")
    v, item = _bpo_vendor(db, "V-FX-BPO"), master_item(db, "Washer FX", code="FX-W1", uom="Nos")
    rec = client.post(STORE, json=_body(v, item, 4), headers=_h(keeper)).json()
    buyer = make_user(db, "mb.fx.bpo.buyer@premnathrail.com", assigned_apps=("purchase",))
    approver = make_user(db, "mb.fx.bpo.approver@premnathrail.com")
    set_po_workflow(db, [approver.id], buyer)
    rfq = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=_h(buyer)).json()["rfq"]
    pr = db.get(P2PRequest, db.get(StorePrePoReceipt, rec["id"]).p2p_request_id)
    details = {"ship_to_location_id": make_ship_to(db).id, "lines": [{"pr_item_id": pr.items[0].id, "unit_price": 30}]}
    po = post_upload_po(client, buyer, rfq["id"], details, "TALLY-FX-BPO")
    assert po.status_code == 200, po.text
    req = engine.latest_request(db, "p2p_purchase_order", po.json()["id"])
    engine.decide(db, req.id, approver, "return", "recheck")
    db.commit()
    r = client.post(f"{RFQS}/{rfq['id']}/po-draft/{po.json()['id']}/discard", json={"reason": "Wrong vendor on the Tally PO"}, headers=_h(buyer))
    assert r.status_code == 200, r.text
    db.expire_all()
    receipt = db.get(StorePrePoReceipt, rec["id"])
    assert receipt.status == "pending_po" and receipt.purchase_order_id is None


# ── M2: other buyers' RFQs are not readable ───────────────────────────────────

def _reads(rfq_id, vq_id):
    return [f"{RFQS}/{rfq_id}", f"{RFQS}/{rfq_id}/vendor-quotations", f"{RFQS}/{rfq_id}/line-quotations", f"{RFQS}/{rfq_id}/comparison",
            f"{RFQS}/{rfq_id}/comparison/export", f"{RFQS}/{rfq_id}/split-proposal", f"{RFQS}/{rfq_id}/invites",
            f"{RFQS}/{rfq_id}/line-quotations/{vq_id}/files", f"{RFQS}/{rfq_id}/attachments/1/content"]


def test_another_buyer_with_a_wide_scope_cannot_open_the_rfq_but_the_owner_and_head_can(client, db, quoted):
    q = quoted
    for url in _reads(q["rfq"]["id"], q["q1"]["id"]):
        denied = client.get(url, headers=_h(q["b"]))
        assert denied.status_code == 403, (url, denied.text)
        if not url.endswith("/export"):  # the export first asks for the price permission
            d = denied.json()["detail"]
            assert f"belongs to {q['a'].name}" in d and f"only {q['a'].name} or the Purchase head can open its quotes" in d, (url, d)
    for who in (q["a"], q["head"]):
        for url in _reads(q["rfq"]["id"], q["q1"]["id"])[:-1]:
            r = client.get(url, headers=_h(who))
            assert r.status_code == 200, (who.email, url, r.text)
    # Not found stays not found for the owner; the attachment lookup comes after the owner gate.
    assert client.get(f"{RFQS}/{q['rfq']['id']}/attachments/1/content", headers=_h(q["a"])).status_code == 404


def test_the_header_buyer_no_longer_reaches_other_buyers_rfqs_or_pos_through_scope(client, db, quoted, monkeypatch):
    q = quoted
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")
    header = make_user(db, "mb.fx.header@premnathrail.com", assigned_apps=("purchase",))
    db.get(P2PRequest, q["pr_id"]).assigned_buyer_id = header.id
    db.commit()
    _split_award(client, q)
    po = _upload_l1(client, db, q, "TALLY-FX-M2")
    denied = client.get(f"{RFQS}/{q['rfq']['id']}", headers=_h(header))
    assert denied.status_code == 403
    assert client.get(RFQS, params={"p2p_request_id": q["pr_id"]}, headers=_h(header)).json() == []
    assert client.get(f"{POS}/{po['id']}", headers=_h(header)).status_code == 403
    assert po["id"] not in {p["id"] for p in client.get(POS, headers=_h(header)).json()}
    # The RFQ's buyer and the PO's drafter still see both.
    assert client.get(f"{RFQS}/{q['rfq']['id']}", headers=_h(q["a"])).status_code == 200
    assert client.get(f"{POS}/{po['id']}", headers=_h(q["a"])).status_code == 200
    assert q["rfq"]["id"] in {r["id"] for r in client.get(RFQS, headers=_h(q["a"])).json()}


def test_a_po_approver_opens_the_tally_po_document_through_the_requisition_but_other_buyers_do_not(client, db, quoted):
    from app.tests.p2p_po_helpers import sharepoint_stub

    q = quoted
    _split_award(client, q)
    with sharepoint_stub():
        po = _upload_l1(client, db, q, "TALLY-FX-DOC")
        url = f"{RFQS}/{q['rfq']['id']}/po-draft/{po['id']}/document/content"
        assert client.get(url, headers=_h(q["a"])).status_code == 200
        other = client.get(url, headers=_h(q["b"]))
        assert other.status_code == 403 and "belongs to" in other.json()["detail"]
        # A PO approver who also has the purchase desk reads what they sign off on, whoever bought it.
        approver = q["approver"]
        approver.assigned_apps = list(approver.assigned_apps or []) + ["purchase"]
        approver.granular_permissions = list(approver.granular_permissions or []) + ["p2p:purchase_orders:view", "p2p:rfq:view"]
        db.commit()
        ok = client.get(url, headers=_h(approver))
        assert ok.status_code == 200, ok.text


# ── M3: invites belong to the RFQ's buyer ─────────────────────────────────────

def test_only_the_rfqs_buyer_or_head_may_invite_send_resend_remind_or_attach_quote_files(client, db, quoted):
    q = quoted
    rid = q["rfq"]["id"]
    calls = [
        ("post", f"{RFQS}/{rid}/invites/add", {"json": {"vendor_ids": [q["v1"].id]}}),
        ("post", f"{RFQS}/{rid}/invites/send", {}),
        ("post", f"{RFQS}/{rid}/invites/1/resend", {}),
        ("post", f"{RFQS}/{rid}/invites/remind", {}),
        ("post", f"{RFQS}/{rid}/line-quotations/{q['q1']['id']}/files", {"files": [("files", ("q.pdf", b"%PDF-1.4", "application/pdf"))]}),
    ]
    for method, url, kw in calls:
        r = getattr(client, method)(url, headers=_h(q["b"]), **kw)
        assert r.status_code == 403, (url, r.text)
        assert f"belongs to {q['a'].name}" in r.json()["detail"] and q["a"].name in r.json()["detail"], (url, r.json())
    assert db.query(RFQVendorInvite).filter_by(rfq_id=rid).count() == 0
    # The owner passes the gate (and meets the next real rule instead).
    r = client.post(f"{RFQS}/{rid}/invites/send", headers=_h(q["a"]))
    assert r.status_code == 400 and "belongs to" not in r.text


# ── M4: RFQs raised before the split / the refusal wording ────────────────────

def test_an_rfq_raised_before_the_split_is_uploaded_by_its_owner_for_all_its_lines(client, db, quoted):
    q = quoted
    _split_award(client, q)
    row = next(i for i in db.get(P2PRequest, q["pr_id"]).items if i.id == q["l3"])
    row.buyer_id = q["b"].id            # L3 is another buyer's line, but it sits on A's RFQ
    db.commit()
    line = [{"pr_item_id": q["l3"]}]
    recent = _upload(client, db, q["a"], q, q["q1"], line, "TALLY-FX-M4")
    assert recent.status_code == 403
    d = recent.json()["detail"]
    assert f"'MB bolt 3' is bought by {q['b'].name}, not by the owner of RFQ {q['rfq']['rfq_number']}" in d
    assert f"{q['b'].name} raises their own RFQ for it" in d and "reassigned to" not in d   # nobody moved it: not said
    db.add(AuditLog(entity_type="p2p_request", entity_id=q["pr_id"], action="line_buyer_reassigned", performed_by_id=q["head"].id,
                    summary="head moved 'MB bolt 3' (10 Nos not yet ordered) from mb.a to mb.b: workload"))
    db.commit()
    moved = _upload(client, db, q["a"], q, q["q1"], line, "TALLY-FX-M4")
    assert moved.status_code == 403 and f"(The line was reassigned to {q['b'].name}.)" in moved.json()["detail"]
    # Raised before the split (created before 2026-10-31): its owner may upload every line of it.
    rfq = db.get(RFQ, q["rfq"]["id"])
    rfq.created_at = datetime(2026, 10, 30, 9, 0, tzinfo=timezone.utc)
    db.commit()
    legacy = _upload(client, db, q["a"], q, q["q1"], line, "TALLY-FX-M4")
    assert legacy.status_code == 200, legacy.text
    assert [(i["pr_item_id"], i["quantity"]) for i in legacy.json()["items"]] == [(q["l3"], 10)]
    # Another buyer still can't upload on A's RFQ, legacy or not.
    assert _upload(client, db, q["b"], q, q["q1"], [{"pr_item_id": q["l1"], "quantity": 10}], "TALLY-FX-M4B").status_code == 403


# ── L3: a PO with no RFQ ──────────────────────────────────────────────────────

def test_a_po_with_no_rfq_is_not_reachable_through_another_buyers_rfq(client, db, quoted):
    q = quoted
    _split_award(client, q)
    po = _upload_l1(client, db, q, "TALLY-FX-L3")
    db.get(P2PPurchaseOrder, po["id"]).rfq_id = None            # an older PO: made before RFQs owned their POs
    db.commit()
    rb = _create(client, q["b"], q).json()                       # B's own RFQ on the same requisition
    mine = client.patch(f"{RFQS}/{rb['id']}/po-draft/{po['id']}/details", json={}, headers=_h(q["b"]))
    assert mine.status_code == 403 and "made without an RFQ" in mine.json()["detail"] and q["a"].name in mine.json()["detail"]
    for tail in ("discard", "submit"):
        r = client.post(f"{RFQS}/{rb['id']}/po-draft/{po['id']}/{tail}", json={"reason": "not mine to touch"}, headers=_h(q["b"]))
        assert r.status_code == 403 and "made without an RFQ" in r.json()["detail"], (tail, r.text)
    # Its drafter and the head get past the guard (the PO is in approval, so the next rule answers).
    for who in (q["a"], q["head"]):
        r = client.patch(f"{RFQS}/{q['rfq']['id']}/po-draft/{po['id']}/details", json={}, headers=_h(who))
        assert r.status_code == 409 and "sent for approval" in r.json()["detail"], (who.email, r.text)


# ── L4: sending a draft twice / under the lock ────────────────────────────────

def test_a_draft_po_sent_twice_is_a_409_not_a_second_approval(client, db, quoted):
    q = quoted
    _split_award(client, q)
    po = _upload_l1(client, db, q, "TALLY-FX-L4")
    _return_po(db, q, po)
    url = f"{RFQS}/{q['rfq']['id']}/po-draft/{po['id']}/submit"
    first = client.post(url, headers=_h(q["a"]))
    assert first.status_code == 200, first.text
    second = client.post(url, headers=_h(q["a"]))
    assert second.status_code == 409 and "can't be sent for approval" in second.json()["detail"] and "issued" in second.json()["detail"]
    db.expire_all()
    pending = [r for r in db.query(ApprovalRequest).filter_by(entity_type="p2p_purchase_order", entity_id=po["id"]).all()
               if r.status == "pending"]
    assert len(pending) == 1


def test_a_po_changed_while_waiting_for_the_requisition_lock_is_rechecked(client, db, quoted, monkeypatch):
    q = quoted
    _split_award(client, q)
    po = _upload_l1(client, db, q, "TALLY-FX-L4B")
    _return_po(db, q, po)
    real_lock = po_split.lock_pr

    def lock_then_somebody_else_sent_it(db_, pr_id):
        pr = real_lock(db_, pr_id)
        db_.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == po["id"]).update({"status": "issued"})
        db_.flush()
        return pr

    monkeypatch.setattr(po_split, "lock_pr", lock_then_somebody_else_sent_it)
    r = client.post(f"{RFQS}/{q['rfq']['id']}/po-draft/{po['id']}/submit", headers=_h(q["a"]))
    assert r.status_code == 409 and "it is issued" in r.json()["detail"]
    monkeypatch.undo()
    # The same for a discard: nothing is cancelled when the draft was sent meanwhile.
    monkeypatch.setattr(po_split, "lock_pr", lock_then_somebody_else_sent_it)
    d = _discard(client, q["a"], q, po)
    assert d.status_code == 409 and "only a draft PO can" in d.json()["detail"]


def test_recording_and_replacing_a_quote_take_the_requisition_lock(client, db, quoted, monkeypatch):
    q = quoted
    from fastapi import HTTPException

    def busy(_db, _pr_id):
        raise HTTPException(status_code=409, detail="Another buyer is changing this requisition right now - wait, reload, try again.")

    monkeypatch.setattr(po_split, "lock_pr", busy)
    body = {"vendor_id": q["v1"].id, "items": [{"pr_item_id": q["l1"], "unit_price": 90}]}
    put = client.put(f"{RFQS}/{q['rfq']['id']}/line-quotations/{q['q1']['id']}", json=body, headers=_h(q["a"]))
    assert put.status_code == 409 and "Another buyer is changing" in put.json()["detail"]
    v3 = _vendor(db, "V-FX-3", "Gamma FX")
    post = client.post(f"{RFQS}/{q['rfq']['id']}/line-quotations", json={"vendor_id": v3.id, "items": [{"pr_item_id": q["l1"], "unit_price": 90}]},
                       headers=_h(q["a"]))
    assert post.status_code == 409 and "Another buyer is changing" in post.json()["detail"]
    # A non-owner is refused before the lock is even asked for.
    other = client.post(f"{RFQS}/{q['rfq']['id']}/line-quotations", json={"vendor_id": v3.id, "items": [{"pr_item_id": q["l1"], "unit_price": 90}]},
                        headers=_h(q["b"]))
    assert other.status_code == 403 and "belongs to" in other.json()["detail"]


# ── L7: the quantity floor names its real reason ──────────────────────────────

def test_the_draft_quantity_floor_says_why_and_how_to_order_less(client, db, quoted):
    q = quoted
    _split_award(client, q)
    po = _upload_l1(client, db, q, "TALLY-FX-L7")           # 40 of Alpha MB's 40 awarded
    _return_po(db, q, po)
    item = po["items"][0]
    r = client.patch(f"{RFQS}/{q['rfq']['id']}/po-draft/{po['id']}", json={"items": [{"id": item["id"], "quantity": 30, "unit_price": 10}]},
                     headers=_h(q["a"]))
    assert r.status_code == 422, r.text
    d = r.json()["detail"]
    assert "can't be below 40" in d and "Alpha MB" in d and "uploaded on this PO" in d and "discard this draft" in d
    assert "what the requisition asks for" not in d
    # Raising it is still allowed.
    up = client.patch(f"{RFQS}/{q['rfq']['id']}/po-draft/{po['id']}", json={"items": [{"id": item["id"], "quantity": 41, "unit_price": 10}]},
                      headers=_h(q["a"]))
    assert up.status_code == 200, up.text


# ── list: another buyer's RFQ is only "RFQ of {buyer}" ────────────────────────

def test_the_rfq_list_blanks_quotes_and_vendors_of_other_buyers_but_keeps_number_buyer_and_lines(client, db, quoted):
    q = quoted
    _split_award(client, q)
    rfq = db.get(RFQ, q["rfq"]["id"])
    rfq.payment_terms = "30 days"
    db.commit()
    rb = _create(client, q["b"], q).json()

    def rows(who):
        return {r["id"]: r for r in client.get(RFQS, params={"p2p_request_id": q["pr_id"]}, headers=_h(who)).json()}

    mine = rows(q["a"])[q["rfq"]["id"]]
    assert len(mine["vendor_quotations"]) == 2 and mine["awarded_vendors"] and mine["payment_terms"] == "30 days"
    seen = rows(q["b"])
    other = seen[q["rfq"]["id"]]
    assert other["rfq_number"] == q["rfq"]["rfq_number"] and other["buyer_id"] == q["a"].id and other["buyer_name"] == q["a"].name
    assert other["status"] == "locked" and sorted(i["pr_item_id"] for i in other["items"]) == sorted([q["l1"], q["l3"]])
    assert other["vendor_quotations"] == [] and other["attachments"] == [] and other["awarded_vendors"] == []
    assert other["other_quoted_vendors"] == [] and other["awarded_line_count"] == 0 and other["payment_terms"] is None
    assert seen[rb["id"]]["items"] and seen[rb["id"]]["buyer_id"] == q["b"].id          # B's own row is untouched
    head = rows(q["head"])[q["rfq"]["id"]]
    assert len(head["vendor_quotations"]) == 2 and head["awarded_vendors"]               # the Purchase head sees everything
    # A PO approver of the requisition keeps the full row.
    approver = q["approver"]
    approver.assigned_apps = list(approver.assigned_apps or []) + ["purchase"]
    approver.granular_permissions = list(approver.granular_permissions or []) + ["p2p:rfq:view"]
    db.commit()
    _upload_l1(client, db, q, "TALLY-FX-LIST")
    seen_by_approver = rows(approver).get(q["rfq"]["id"])
    assert seen_by_approver is not None and len(seen_by_approver["vendor_quotations"]) == 2
