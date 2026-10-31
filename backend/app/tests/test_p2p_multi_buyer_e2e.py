"""One requisition, several buyers: the whole story through the real routes (2026-10-31).

Requisition of three lines: L1 (100, buyer A), L2 (5, buyer B), L3 (10, buyer A).
A and B each raise and submit their own RFQ, vendors quote, A splits L1 across two vendors, A uploads two POs
and B one, a PO approver rejects one PO, the buyer re-uploads it, every PO is approved on its own, Store receives
goods PO by PO (partly), and the balance is short-closed. After every step the requester's tracker is read and
its numbers checked (no vendor, no prices).

Also here: two buyers stay independent, a reassigned line is closed to the old buyer, My Lines own / head view,
the tracker is closed to an unrelated user, the uploading buyer cannot approve their own PO.

Spec criteria exercised end to end: 1, 8, 10-11, 17-18, 20, 29-30, 32, 37-39, 40, 43, 45, 47-48, 50-53, 59, 61-62.
Every step goes through the HTTP routes; only the RFQ terms and quote files that submit needs are written straight
into the test database (the same as the submit test in test_p2p_multi_buyer_rfq.py)."""
from datetime import date, timedelta

import pytest

from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_attachment import RFQAttachment
from app.modules.p2p.models.rfq_item import RFQItem
from app.modules.p2p.models.vendor_quotation import VendorQuotationItem
from app.tests.p2p_po_helpers import make_ship_to, post_upload_po
from app.tests.p2p_workflow_helpers import set_po_workflow
from app.tests.test_p2p_multi_buyer_rfq import (  # noqa: F401 - `w` is a fixture; helpers are shared on purpose
    RFQS, _award, _create, _h, _lock, _open, _qi, _quote, _split_award, _upload, w,
)
from app.tests.test_p2p_pr_lines import BUYER, HEAD, MY_LINES, _user
from app.tests.test_p2p_requests import (  # noqa: F401 - _sqlite_number_series is an autouse fixture
    _receiving_store, _sqlite_number_series, make_user,
)

PR = "/api/v1/p2p/requests"
GRNS = "/api/v1/p2p/goods-receipts"
VENDOR_WORDS = ("Alpha MB", "Beta MB")
MONEY_KEYS = ("unit_price", "line_total", "total_value", "po_value")


# ── set-up helpers ──────────────────────────────────────────────────────────

@pytest.fixture
def s(client, db, w):
    """`w` (PR with L1/L2/L3, buyers A/B, vendors V1/V2, admin head) plus the requester, a Partner, a store user,
    and a PO workflow of: PO approver, then any one Partner."""
    pr = db.get(P2PRequest, w["pr_id"])
    partner = make_user(db, "mb.e2e.partner@premnathrail.com", assigned_apps=("p2p",), is_partner=True)
    set_po_workflow(db, [w["approver"].id], w["head"], partner=True)
    return {**w, "requester": db.get(User, pr.requested_by_id), "partner": partner,
            "store": make_user(db, "mb.e2e.store@premnathrail.com", assigned_apps=("purchase",))}


def _submit(client, db, who, rfq_id, vendor):
    """Submit the way the buyer does: a quote file, the commercial terms, then Submit."""
    db.add(RFQAttachment(rfq_id=rfq_id, vendor_tier="L1", vendor_name=vendor.name, vendor_id=vendor.id, filename="L1.pdf",
                         sharepoint_path="x/L1.pdf", created_by_id=who.id))
    db.commit()
    r = client.patch(f"{RFQS}/{rfq_id}", json={
        "payment_terms": "30 days", "delivery_lead_time": "2 weeks", "late_delivery_clause": "0.5% per week",
        "single_quotation_reason": "Sole source", "comments": "Quote on the lines listed"}, headers=_h(who))
    assert r.status_code == 200, r.text
    r = client.post(f"{RFQS}/{rfq_id}/submit", headers=_h(who))
    assert r.status_code == 200, r.text


def _status(db, s):
    db.expire_all()
    return db.get(P2PRequest, s["pr_id"]).status


def _raise_and_submit_rfqs(client, db, s):
    """A and B each raise their own RFQ and submit it. Adds `rfq` (A's), `rfq_b` to `s`."""
    ra, rb = _create(client, s["a"], s), _create(client, s["b"], s)
    assert ra.status_code == 200 and rb.status_code == 200, (ra.text, rb.text)
    s["rfq"], s["rfq_b"] = ra.json(), rb.json()
    assert _status(db, s) == "approved"  # two drafts: nothing is out for quotes yet
    _submit(client, db, s["a"], s["rfq"]["id"], s["v1"])
    assert _status(db, s) == "vendor_quotations"
    _submit(client, db, s["b"], s["rfq_b"]["id"], s["v1"])
    return s


def _quote_all(client, s):
    """V1 quotes L1 (100 @100) and L3 (10 @50), V2 quotes L1 (60 @110) on A's RFQ; V1 quotes L2 (5 @7) on B's."""
    s["q1"] = _quote(client, s["a"], s["rfq"]["id"], s["v1"], [{"pr_item_id": s["l1"], "unit_price": 100, "gst_rate": 18},
                                                                {"pr_item_id": s["l3"], "unit_price": 50, "gst_rate": 18}])
    s["q2"] = _quote(client, s["a"], s["rfq"]["id"], s["v2"], [{"pr_item_id": s["l1"], "quantity": 60, "unit_price": 110, "gst_rate": 18}])
    s["qb"] = _quote(client, s["b"], s["rfq_b"]["id"], s["v1"], [{"pr_item_id": s["l2"], "unit_price": 7, "gst_rate": 18}])
    return s


def _award_all(client, s):
    """A: L1 40 to V1 and 60 to V2, L3 to V1. B: L2 to V1."""
    _split_award(client, s)
    r = _award(client, s["b"], s["rfq_b"]["id"], [{"pr_item_id": s["l2"], "vendor_quotation_item_id": _qi(s["qb"], s["l2"])}])
    assert r.status_code == 200, r.text
    return s


def _upload_b(client, db, s, tally="TALLY-E2E-3"):
    return _upload(client, db, s["b"], {"rfq": s["rfq_b"]}, s["qb"], [{"pr_item_id": s["l2"], "unit_price": 7}], tally)


def _upload_all(client, db, s):
    """PO-1 (V1: L1 40 + L3 10) and PO-2 (V2: L1 60) by A, PO-3 (V1: L2 5) by B. Adds po1, po2, po3 (response JSON)."""
    p1 = _upload(client, db, s["a"], s, s["q1"], [{"pr_item_id": s["l1"]}, {"pr_item_id": s["l3"]}], "TALLY-E2E-1")
    assert p1.status_code == 200, p1.text
    p2 = _upload(client, db, s["a"], s, s["q2"], [{"pr_item_id": s["l1"]}], "TALLY-E2E-2")
    assert p2.status_code == 200, p2.text
    p3 = _upload_b(client, db, s)
    assert p3.status_code == 200, p3.text
    s["po1"], s["po2"], s["po3"] = p1.json(), p2.json(), p3.json()
    return s


def _to_three_pos(client, db, s):
    _raise_and_submit_rfqs(client, db, s)
    _quote_all(client, s)
    _award_all(client, s)
    return _upload_all(client, db, s)


def _approve_po(client, s, po, by=("approver", "partner")):
    for who in by:
        r = client.post(f"{PR}/{s['pr_id']}/approve-po", json={"comment": "Checked and fine", "po_id": po["id"]}, headers=_h(s[who]))
        assert r.status_code == 200, (who, r.text)


def _grn(client, s, po, qty_by_line):
    """Store books a goods receipt on `po` for {pr_item_id: qty} and passes everything at inspection."""
    items = [{"po_item_id": it["id"], "received_quantity": qty_by_line[it["pr_item_id"]]}
             for it in po["items"] if it["pr_item_id"] in qty_by_line]
    r = client.post(GRNS, json={"purchase_order_id": po["id"], "store_location_id": _receiving_store(client), "items": items},
                    headers=_h(s["store"]))
    if r.status_code != 200:
        return r
    grn = r.json()
    by_po_item = {it["id"]: qty_by_line[it["pr_item_id"]] for it in po["items"] if it["pr_item_id"] in qty_by_line}
    done = client.post(f"{GRNS}/{grn['id']}/inspect", json={"items": [
        {"item_id": gi["id"], "accepted_quantity": by_po_item[gi["po_item_id"]], "quality_status": "passed"} for gi in grn["items"]]},
        headers=_h(s["store"]))
    return done


def _tracker(client, s, user=None):
    r = client.get(f"{PR}/{s['pr_id']}/tracker", headers=_h(user or s["requester"]))
    assert r.status_code == 200, r.text
    t = r.json()
    t["by"] = {ln["pr_item_id"]: ln for ln in t["lines"]}
    t["text"] = r.text
    return t


def _requester_sees_no_commercials(t):
    for word in (*VENDOR_WORDS, *MONEY_KEYS):
        assert word not in t["text"], f"the requester's tracker leaks '{word}'"
    assert all(p["vendor_name"] is None for ln in t["lines"] for p in ln["pos"])


def _po_row(line, po):
    return next(p for p in line["pos"] if p["po_id"] == po["id"])


# ═══ The full story ══════════════════════════════════════════════════════════

def test_one_requisition_three_buyers_story_from_rfq_to_short_close(client, db, s):
    pr_id, a, b = s["pr_id"], s["a"], s["b"]
    l1, l2, l3 = s["l1"], s["l2"], s["l3"]

    # 0. Approved, nothing started: the requester sees who approved it and each line with its own buyer.
    t = _tracker(client, s)
    assert t["status"] == "approved" and t["pr_approval"]["status"] == "approved"
    steps = t["pr_approval"]["steps"]
    assert steps and all(st["status"] == "approved" and st["decided_by_name"] and st["decided_at"] for st in steps)
    assert {i: (ln["buyer_name"], ln["state"], ln["ordered_qty"]) for i, ln in t["by"].items()} == {
        l1: (a.name, "to_quote", 0), l2: (b.name, "to_quote", 0), l3: (a.name, "to_quote", 0)}

    # 1. A and B raise their own RFQ (A: L1 + L3, B: L2) and submit; B's RFQ is not touched by A's.
    _raise_and_submit_rfqs(client, db, s)
    db.expire_all()
    assert sorted(i.pr_item_id for i in db.query(RFQItem).filter_by(rfq_id=s["rfq"]["id"]).all()) == sorted([l1, l3])
    assert [i.pr_item_id for i in db.query(RFQItem).filter_by(rfq_id=s["rfq_b"]["id"]).all()] == [l2]
    assert db.get(RFQ, s["rfq"]["id"]).buyer_id == a.id and db.get(RFQ, s["rfq_b"]["id"]).buyer_id == b.id
    t = _tracker(client, s)
    assert t["status"] == "vendor_quotations"
    assert {i: ln["state"] for i, ln in t["by"].items()} == {l1: "quoting", l2: "quoting", l3: "quoting"}
    assert [r["rfq_number"] for r in t["by"][l1]["rfqs"]] == [s["rfq"]["rfq_number"]]
    assert [r["rfq_number"] for r in t["by"][l2]["rfqs"]] == [s["rfq_b"]["rfq_number"]]
    assert t["by"][l1]["rfqs"][0]["buyer_name"] == a.name and t["by"][l2]["rfqs"][0]["buyer_name"] == b.name

    # 2. Vendors quote: the requester sees how many quotes came, never who or what price.
    _quote_all(client, s)
    t = _tracker(client, s)
    assert t["by"][l1]["rfqs"][0]["quote_count"] == 2 and t["by"][l3]["rfqs"][0]["quote_count"] == 1
    assert t["by"][l2]["rfqs"][0]["quote_count"] == 1
    _requester_sees_no_commercials(t)

    # 3. A splits L1: 40 to V1, 60 to V2 (reason for the dearer one); L3 to V1. B awards L2.
    _award_all(client, s)
    t = _tracker(client, s)
    assert {i: ln["state"] for i, ln in t["by"].items()} == {l1: "awarded", l2: "awarded", l3: "awarded"}
    assert all(ln["ordered_qty"] == 0 for ln in t["lines"])
    db.expire_all()
    awarded = {(qi.pr_item_id, qi.awarded_qty) for vq in db.get(RFQ, s["rfq"]["id"]).vendor_quotations for qi in vq.items if qi.is_awarded}
    assert awarded == {(l1, 40), (l1, 60), (l3, 10)}

    # 4. Upload the Tally POs: PO-1 and PO-2 by A, PO-3 by B. Each gets its own approval.
    p1 = _upload(client, db, a, s, s["q1"], [{"pr_item_id": l1}, {"pr_item_id": l3}], "TALLY-E2E-1")
    assert p1.status_code == 200, p1.text
    assert _status(db, s) == "po_raised"                     # after the first PO the header is "PO in approval"
    p2 = _upload(client, db, a, s, s["q2"], [{"pr_item_id": l1}], "TALLY-E2E-2")
    p3 = _upload_b(client, db, s)
    assert p2.status_code == 200 and p3.status_code == 200, (p2.text, p3.text)
    po1, po2, po3 = p1.json(), p2.json(), p3.json()
    assert [(i["pr_item_id"], i["quantity"]) for i in po1["items"]] == [(l1, 40), (l3, 10)]
    assert [(i["pr_item_id"], i["quantity"]) for i in po2["items"]] == [(l1, 60)]
    assert [(i["pr_item_id"], i["quantity"]) for i in po3["items"]] == [(l2, 5)]
    assert len({po1["po_number"], po2["po_number"], po3["po_number"]}) == 3
    t = _tracker(client, s)
    assert t["status"] == "po_raised"
    one = t["by"][l1]
    assert (one["ordered_qty"], one["accepted_qty"], one["pending_qty"], one["state"]) == (100, 0, 100, "po_in_approval")
    assert {p["po_number"] for p in one["pos"]} == {po1["po_number"], po2["po_number"]}
    assert all(p["approval"]["status"] == "pending" and p["stage"] == "in_approval" for p in one["pos"])
    assert [p["po_number"] for p in t["by"][l3]["pos"]] == [po1["po_number"]]
    assert [p["po_number"] for p in t["by"][l2]["pos"]] == [po3["po_number"]]
    assert t["progress"]["ordered_pct"] == 100 and t["progress"]["received_pct"] == 0
    _requester_sees_no_commercials(t)
    # Each PO has its own approval request, and the head (who may see PO commercials) sees the vendor.
    assert len({po1["id"], po2["id"], po3["id"]}) == 3
    assert {p["vendor_name"] for p in _tracker(client, s, s["head"])["by"][l1]["pos"]} == {"Alpha MB", "Beta MB"}

    # 5. A PO approver rejects PO-2: only PO-2 is cancelled, the requisition is NOT rejected, 60 are free again.
    r = client.post(f"{PR}/{pr_id}/reject", json={"reason": "Beta rate is above budget", "po_id": po2["id"]}, headers=_h(s["approver"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    pr = db.get(P2PRequest, pr_id)
    assert db.get(P2PPurchaseOrder, po2["id"]).status == "cancelled"
    assert db.get(P2PPurchaseOrder, po1["id"]).status == "issued" and db.get(P2PPurchaseOrder, po3["id"]).status == "issued"
    assert pr.status == "po_raised" and not pr.rejected_reason  # PO-1 and PO-3 still wait; the PR is untouched
    t = _tracker(client, s)
    one = t["by"][l1]
    assert (one["ordered_qty"], one["pending_qty"], one["state"]) == (40, 40, "awarded")   # 60 back to "vendor chosen, PO to upload"
    assert "part already ordered" in one["state_label"]
    assert (_po_row(one, po2)["stage"], _po_row(one, po2)["approval"]["status"]) == ("cancelled", "rejected")
    assert _po_row(one, po1)["stage"] == "in_approval"
    assert _open(db, pr_id)[l1] == 60                         # the quantity is open for the buyer again
    kept = db.query(VendorQuotationItem).filter_by(vendor_quotation_id=s["q2"]["id"], pr_item_id=l1).one()
    assert kept.awarded_qty == 60                             # the award stays so the buyer can re-upload

    # 6. A re-uploads PO-2 (same Tally number: the rejected PO no longer holds it). Quantity is 60 again.
    again = _upload(client, db, a, s, s["q2"], [{"pr_item_id": l1}], "TALLY-E2E-2")
    assert again.status_code == 200, again.text
    po2b = again.json()
    assert po2b["id"] != po2["id"] and [(i["pr_item_id"], i["quantity"]) for i in po2b["items"]] == [(l1, 60)]
    t = _tracker(client, s)
    assert (t["by"][l1]["ordered_qty"], t["by"][l1]["state"]) == (100, "po_in_approval")

    # 7. Approvals, one PO at a time. The uploader cannot approve; the stages run PO approver -> Partner.
    for outsider in (a, b, s["requester"]):
        r = client.post(f"{PR}/{pr_id}/approve-po", json={"comment": "mine", "po_id": po1["id"]}, headers=_h(outsider))
        assert r.status_code == 403, (outsider.id, r.text)
    _approve_po(client, s, po1)
    db.expire_all()
    assert _status(db, s) == "po_raised"                      # PO-2b and PO-3 are still in approval
    t = _tracker(client, s)
    row = _po_row(t["by"][l1], po1)
    assert row["approval"]["status"] == "approved" and row["stage"] == "with_vendor"
    assert {st["decided_by_name"] for st in row["approval"]["steps"] if st["status"] == "approved"} == {s["approver"].name, s["partner"].name}
    assert all(st["decided_at"] for st in row["approval"]["steps"] if st["status"] == "approved")
    assert _po_row(t["by"][l1], po2b)["approval"]["status"] == "pending"

    # 8. Store receives on the released PO-1 only (25 of L1's 40). A PO still in approval is refused with its reason.
    r = _grn(client, s, po1, {l1: 25})
    assert r.status_code == 200, r.text
    refused = _grn(client, s, po3, {l2: 5})
    assert refused.status_code == 409 and po3["po_number"] in refused.json()["detail"] and "approval" in refused.json()["detail"]
    t = _tracker(client, s)
    one = t["by"][l1]
    assert (one["accepted_qty"], one["pending_qty"], one["ordered_qty"]) == (25, 75, 100)
    grns = _po_row(one, po1)["grns"]
    assert len(grns) == 1 and (grns[0]["received_qty"], grns[0]["accepted_qty"], grns[0]["rejected_qty"]) == (25, 25, 0)
    assert grns[0]["grn_number"] and grns[0]["status"] == "completed"
    assert _po_row(one, po2b)["grns"] == [] and t["by"][l2]["pos"][0]["grns"] == []
    assert t["status"] == "po_raised"                         # still waiting for two approvals

    # 9. The other two POs are approved. Goods were accepted, so the header is "partly received".
    _approve_po(client, s, po2b)
    _approve_po(client, s, po3)
    assert _status(db, s) == "partially_received"
    # Header-level approval gate follows each PO's own approval.
    assert db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.p2p_request_id == pr_id, P2PPurchaseOrder.status == "cancelled").count() == 1

    # 10. GRN on PO-2b (all 60), on PO-3 (all 5), and a second GRN on PO-1 (L3 all 10 and 8 more of L1).
    assert _grn(client, s, po2b, {l1: 60}).status_code == 200
    assert _grn(client, s, po3, {l2: 5}).status_code == 200
    assert _grn(client, s, po1, {l1: 8, l3: 10}).status_code == 200
    assert _status(db, s) == "partially_received"             # 7 of L1 are still to come
    t = _tracker(client, s)
    one, two, three = t["by"][l1], t["by"][l2], t["by"][l3]
    assert (one["ordered_qty"], one["accepted_qty"], one["pending_qty"], one["state"]) == (100, 93, 7, "partly_received")
    assert [(g["received_qty"], g["accepted_qty"]) for g in _po_row(one, po1)["grns"]] == [(25, 25), (8, 8)]
    assert [(g["received_qty"], g["accepted_qty"]) for g in _po_row(one, po2b)["grns"]] == [(60, 60)]
    assert (two["accepted_qty"], two["pending_qty"], two["state"]) == (5, 0, "received")
    assert (three["accepted_qty"], three["pending_qty"], three["state"]) == (10, 0, "received")
    assert t["progress"]["lines_done"] == 2 and t["progress"]["received_pct"] == pytest.approx(93.9, abs=0.05)
    assert _po_row(one, po1)["stage"] == "partly_received" and _po_row(one, po2b)["stage"] == "received"
    # GRN numbers are shown per PO; the same GRN never appears under two POs.
    numbers = [g["grn_number"] for ln in t["lines"] for p in ln["pos"] for g in p["grns"]]
    assert len(numbers) == 5 and len(set(numbers)) == 4  # four GRNs; the second GRN of PO-1 carries both L1 and L3
    _requester_sees_no_commercials(t)
    # Requester got one bell per completed GRN (not Teams).
    assert db.query(Notification).filter_by(user_id=s["requester"].id, notification_type="p2p_grn_completed").count() == 4

    # 11. Short-close the 7 that will not come: a reason is needed; then the requisition is closed.
    no_reason = client.post(f"{PR}/{pr_id}/close", json={}, headers=_h(s["head"]))
    assert no_reason.status_code == 400 and "reason" in no_reason.json()["detail"].lower()
    closed = client.post(f"{PR}/{pr_id}/close", json={"reason": "Alpha cannot deliver the last 7 pieces"}, headers=_h(s["head"]))
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "closed"
    t = _tracker(client, s)
    assert t["status"] == "closed"
    one = t["by"][l1]
    assert one["state"] == "short_closed" and one["accepted_qty"] == 93
    assert _po_row(one, po1)["stage"] == "short_closed" and _po_row(one, po2b)["stage"] == "closed"
    assert t["by"][l2]["state"] == "received" and t["by"][l3]["state"] == "received"
    # No more goods on a closed requisition; the requester is told.
    late = _grn(client, s, po1, {l1: 7})
    assert late.status_code == 409 and "was closed on" in late.json()["detail"]
    mail = db.query(Notification).filter_by(user_id=s["requester"].id, notification_type="p2p_request_closed").all()
    assert len(mail) == 1 and "short-closed" in mail[0].message and "Alpha cannot deliver" in mail[0].message
    note = db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr_id, action="short_closed").one()
    assert "93" in note.summary or "written off" in note.summary


def test_when_every_po_is_received_the_requisition_is_received_and_closes_plainly(client, db, s):
    _to_three_pos(client, db, s)
    po1, po2, po3 = s["po1"], s["po2"], s["po3"]
    for po in (po1, po2, po3):
        _approve_po(client, s, po)
    assert _status(db, s) == "po_approved"                    # all released, nothing received yet
    t = _tracker(client, s)
    assert {ln["state"] for ln in t["lines"]} == {"with_vendor"}
    assert _grn(client, s, po1, {s["l1"]: 40, s["l3"]: 10}).status_code == 200
    assert _grn(client, s, po2, {s["l1"]: 60}).status_code == 200
    assert _status(db, s) == "partially_received"             # PO-3 has not arrived
    assert _grn(client, s, po3, {s["l2"]: 5}).status_code == 200
    assert _status(db, s) == "received"
    t = _tracker(client, s)
    assert {ln["state"] for ln in t["lines"]} == {"received"} and t["progress"]["lines_done"] == 3
    assert (t["progress"]["ordered_pct"], t["progress"]["received_pct"]) == (100, 100)
    r = client.post(f"{PR}/{s['pr_id']}/close", json={}, headers=_h(s["head"]))   # nothing is left: no reason needed
    assert r.status_code == 200 and r.json()["status"] == "closed"
    assert all(i["short_closed_qty"] == 0 for i in r.json()["items"])
    assert db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=s["pr_id"], action="closed").count() == 1


def test_a_po_still_in_approval_blocks_close_and_cancel_with_the_po_named(client, db, s):
    _to_three_pos(client, db, s)
    po1, po3 = s["po1"], s["po3"]
    _approve_po(client, s, po1)
    assert _grn(client, s, po1, {s["l1"]: 40, s["l3"]: 10}).status_code == 200
    # Header is "PO in approval" while PO-2 and PO-3 wait; it cannot be closed or cancelled yet.
    assert _status(db, s) == "po_raised"
    r = client.post(f"{PR}/{s['pr_id']}/close", json={"reason": "stop it here"}, headers=_h(s["head"]))
    assert r.status_code == 409 and "po raised" in r.json()["detail"]
    r = client.post(f"{PR}/{s['pr_id']}/cancel", json={"reason": "not needed any more"}, headers=_h(s["requester"]))
    assert r.status_code == 409 and r.json()["detail"], r.text
    assert _status(db, s) == "po_raised"
    # Neither refusal touched any PO: PO-1 is fulfilled, the two waiting ones are still waiting.
    db.expire_all()
    assert [db.get(P2PPurchaseOrder, p["id"]).status for p in (po1, s["po2"], po3)] == ["fulfilled", "issued", "issued"]


# ═══ Two buyers stay independent ═════════════════════════════════════════════

def test_one_buyers_po_being_rejected_never_touches_the_other_buyers_rfq_or_award(client, db, s):
    _raise_and_submit_rfqs(client, db, s)
    _quote_all(client, s)
    _award_all(client, s)
    # A raises a single PO and a PO approver rejects it: the requisition is not rejected.
    p = _upload(client, db, s["a"], s, s["q1"], [{"pr_item_id": s["l1"]}, {"pr_item_id": s["l3"]}], "TALLY-IND-1")
    assert p.status_code == 200, p.text
    r = client.post(f"{PR}/{s['pr_id']}/reject", json={"reason": "Wrong vendor for this job"}, headers=_h(s["approver"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    pr = db.get(P2PRequest, s["pr_id"])
    assert pr.status == "vendor_quotations" and not pr.rejected_reason   # back to quoting, never "rejected"
    assert db.get(RFQ, s["rfq_b"]["id"]).status == "locked"
    b_award = db.query(VendorQuotationItem).filter_by(vendor_quotation_id=s["qb"]["id"], pr_item_id=s["l2"]).one()
    assert b_award.is_awarded and b_award.awarded_qty == 5
    # B carries on and uploads their own PO; A's lines are back to "vendor chosen" with their awards.
    assert _upload_b(client, db, s).status_code == 200
    t = _tracker(client, s)
    assert t["by"][s["l2"]]["state"] == "po_in_approval" and t["by"][s["l1"]]["state"] == "awarded"
    assert t["by"][s["l1"]]["ordered_qty"] == 0 and t["by"][s["l3"]]["state"] == "awarded"


def test_a_released_and_received_po_of_one_buyer_does_not_hold_up_the_other_buyer(client, db, s):
    # A's RFQ is processed to a received PO while B's RFQ is still only a draft.
    ra = _create(client, s["a"], s).json()
    rb = _create(client, s["b"], s).json()
    s["rfq"], s["rfq_b"] = ra, rb
    _submit(client, db, s["a"], ra["id"], s["v1"])
    s["q1"] = _quote(client, s["a"], ra["id"], s["v1"], [{"pr_item_id": s["l1"], "unit_price": 100, "gst_rate": 18},
                                                         {"pr_item_id": s["l3"], "unit_price": 50, "gst_rate": 18}])
    r = _award(client, s["a"], ra["id"], [{"pr_item_id": s["l1"], "vendor_quotation_item_id": _qi(s["q1"], s["l1"])},
                                         {"pr_item_id": s["l3"], "vendor_quotation_item_id": _qi(s["q1"], s["l3"])}])
    assert r.status_code == 200, r.text
    p1 = _upload(client, db, s["a"], s, s["q1"], [{"pr_item_id": s["l1"]}, {"pr_item_id": s["l3"]}], "TALLY-IND-2")
    assert p1.status_code == 200, p1.text
    _approve_po(client, s, p1.json())
    assert _grn(client, s, p1.json(), {s["l1"]: 100, s["l3"]: 10}).status_code == 200
    # The header says A's goods are in, but B's line is untouched: not "received".
    assert _status(db, s) == "partially_received"
    t = _tracker(client, s)
    assert t["by"][s["l2"]]["state"] == "to_quote" and t["by"][s["l1"]]["state"] == "received"
    # B's RFQ is still a draft with its line, and B submits, quotes, awards and uploads as normal.
    assert client.get(f"{RFQS}/{rb['id']}", headers=_h(s["b"])).json()["status"] == "draft"
    _submit(client, db, s["b"], rb["id"], s["v1"])
    s["qb"] = _quote(client, s["b"], rb["id"], s["v1"], [{"pr_item_id": s["l2"], "unit_price": 7, "gst_rate": 18}])
    assert _award(client, s["b"], rb["id"], [{"pr_item_id": s["l2"], "vendor_quotation_item_id": _qi(s["qb"], s["l2"])}]).status_code == 200
    p3 = _upload_b(client, db, s, "TALLY-IND-3")
    assert p3.status_code == 200, p3.text
    _approve_po(client, s, p3.json())
    assert _grn(client, s, p3.json(), {s["l2"]: 5}).status_code == 200
    assert _status(db, s) == "received"


# ═══ Reassign: the old buyer is closed out ═══════════════════════════════════

def test_reassigning_a_line_closes_it_to_the_old_buyer_on_upload_and_moves_my_lines(client, db, s):
    _raise_and_submit_rfqs(client, db, s)
    _quote_all(client, s)
    _award_all(client, s)
    c = make_user(db, "mb.e2e.c@premnathrail.com", assigned_apps=("purchase",))
    head = _user(db, HEAD, name="Hari Purchase Head")      # Assign buyer + All buyers' lines, not an admin
    r = client.post(f"{PR}/{s['pr_id']}/lines/{s['l3']}/reassign-buyer", json={"buyer_id": c.id, "reason": "A is overloaded this week"},
                    headers=_h(head))
    assert r.status_code == 200, r.text
    # A buyer with only the Buyer grants (no Assign buyer) cannot hand a line over.
    plain_buyer = _user(db, BUYER, name="Plain Buyer")
    nope = client.post(f"{PR}/{s['pr_id']}/lines/{s['l1']}/reassign-buyer", json={"buyer_id": c.id, "reason": "give it away"},
                       headers=_h(plain_buyer))
    assert nope.status_code == 403
    db.expire_all()
    withdrawn = db.query(RFQItem).filter_by(rfq_id=s["rfq"]["id"], pr_item_id=s["l3"]).one()
    assert withdrawn.withdrawn_at is not None and "Hari Purchase Head" in withdrawn.withdrawn_reason
    assert db.query(RFQItem).filter_by(rfq_id=s["rfq"]["id"], pr_item_id=s["l1"]).one().withdrawn_at is None
    l3_award = db.query(VendorQuotationItem).filter_by(vendor_quotation_id=s["q1"]["id"], pr_item_id=s["l3"]).one()
    assert not l3_award.is_awarded and l3_award.awarded_qty == 0     # an award with no PO is cleared
    assert db.get(P2PRequest, s["pr_id"]).status == "vendor_quotations"

    # A's Upload PO dialog was still open on L3: saving is refused, nothing is saved, the reason names the move.
    stale = _upload(client, db, s["a"], s, s["q1"], [{"pr_item_id": s["l1"]}, {"pr_item_id": s["l3"]}], "TALLY-RE-1")
    assert stale.status_code in (409, 422), stale.text
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=s["pr_id"]).count() == 0
    assert "Hari Purchase Head" in stale.json()["detail"] or "RFQ" in stale.json()["detail"]
    # ...but A's remaining line is fine.
    ok = _upload(client, db, s["a"], s, s["q1"], [{"pr_item_id": s["l1"]}], "TALLY-RE-1")
    assert ok.status_code == 200, ok.text
    assert [(i["pr_item_id"], i["quantity"]) for i in ok.json()["items"]] == [(s["l1"], 40)]
    # The old buyer cannot short-close the moved line either (403 names the new buyer).
    sc = client.post(f"{PR}/{s['pr_id']}/lines/{s['l3']}/short-close", json={"reason": "not needed any more"}, headers=_h(s["a"]))
    assert sc.status_code == 403 and c.name in sc.json()["detail"]
    # Tracker: the line now shows buyer C; A still opens the PR (owns an RFQ and a PO on it).
    t = _tracker(client, s, s["a"])
    assert t["by"][s["l3"]]["buyer_name"] == c.name and t["by"][s["l1"]]["buyer_name"] == s["a"].name
    assert _tracker(client, s)["by"][s["l3"]]["buyer_name"] == c.name
    # My Lines follows the buyer: A no longer lists L3 (still lists L1, whose 40 are on a PO to receive), C lists it.
    assert [r["pr_item_id"] for r in client.get(MY_LINES, headers=_h(s["a"])).json()["rows"]] == [s["l1"]]
    assert [r["pr_item_id"] for r in client.get(MY_LINES, headers=_h(c)).json()["rows"]] == [s["l3"]]


def test_reassigning_the_only_line_of_a_draft_rfq_leaves_it_empty_and_it_cannot_be_submitted(client, db, s):
    rb = _create(client, s["b"], s).json()                    # B's draft RFQ holds only L2
    assert [i["pr_item_id"] for i in rb["items"]] == [s["l2"]]
    c = make_user(db, "mb.e2e.c3@premnathrail.com", assigned_apps=("purchase",))
    r = client.post(f"{PR}/{s['pr_id']}/lines/{s['l2']}/reassign-buyer", json={"buyer_id": c.id, "reason": "B is on leave"}, headers=_h(s["head"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    item = db.query(RFQItem).filter_by(rfq_id=rb["id"]).one()
    assert item.withdrawn_at is not None and "B is on leave" in item.withdrawn_reason
    sub = client.post(f"{RFQS}/{rb['id']}/submit", headers=_h(s["b"]))
    assert sub.status_code == 409 and "no lines" in sub.json()["detail"]
    # C raises their own RFQ for the line they took over.
    mine = _create(client, c, s)
    assert mine.status_code == 200, mine.text
    assert [i["pr_item_id"] for i in mine.json()["items"]] == [s["l2"]] and mine.json()["buyer_id"] == c.id


# Regression: a buyer on the legacy Purchase role (Edit inherited) used to be able to take any buyer's line (found 2026-10-31).
def test_a_buyer_on_the_legacy_purchase_role_cannot_reassign_a_line(client, db, s):
    c = make_user(db, "mb.e2e.c2@premnathrail.com", assigned_apps=("purchase",))
    url = f"{PR}/{s['pr_id']}/lines/{s['l1']}/reassign-buyer"
    give_away = client.post(url, json={"buyer_id": c.id, "reason": "give it away"}, headers=_h(s["a"]))      # A hands over own line
    assert give_away.status_code == 403 and "Purchase head" in give_away.json()["detail"], give_away.text
    steal = client.post(url, json={"buyer_id": s["b"].id, "reason": "I want this one"}, headers=_h(s["b"]))  # B pulls A's line
    assert steal.status_code == 403, steal.text
    db.expire_all()
    assert {i.id: i.buyer_id for i in db.get(P2PRequest, s["pr_id"]).items}[s["l1"]] == s["a"].id


# ═══ My Lines ════════════════════════════════════════════════════════════════

def test_my_lines_own_lines_for_a_buyer_and_everything_for_the_head(client, db, s):
    own_a = client.get(MY_LINES, headers=_h(s["a"]))
    assert own_a.status_code == 200, own_a.text
    assert [r["pr_item_id"] for r in own_a.json()["rows"]] == sorted([s["l1"], s["l3"]])
    assert all(r["buyer_id"] == s["a"].id and r["state"] == "to_quote" and r["open_to_order"] > 0 for r in own_a.json()["rows"])
    assert "unit_price" not in own_a.text
    assert [r["pr_item_id"] for r in client.get(MY_LINES, headers=_h(s["b"])).json()["rows"]] == [s["l2"]]
    # A buyer cannot ask for another buyer's lines or for everything (403 says which grant is missing).
    other = client.get(MY_LINES, params={"buyer_id": s["b"].id}, headers=_h(s["a"]))
    assert other.status_code == 403 and "All buyers" in other.json()["detail"]
    assert client.get(MY_LINES, params={"all": "true"}, headers=_h(s["a"])).status_code == 403
    # The head (explicit All buyers' lines grant) sees every buyer, and can filter one.
    head = _user(db, HEAD, name="Hari Purchase Head")
    every = client.get(MY_LINES, params={"all": "true"}, headers=_h(head)).json()
    assert {r["pr_item_id"] for r in every["rows"]} == {s["l1"], s["l2"], s["l3"]}
    only_b = client.get(MY_LINES, params={"buyer_id": s["b"].id}, headers=_h(head)).json()
    assert [r["pr_item_id"] for r in only_b["rows"]] == [s["l2"]]
    # Someone with the Purchase desk but without the My Lines sub-tab ticked gets 403 with the reason.
    no_sub = _user(db, ["p2p:purchase_desk:view", "p2p:purchase_requisitions:view", "p2p:purchase_requisitions.all_requisitions:view"])
    r = client.get(MY_LINES, headers=_h(no_sub))
    assert r.status_code == 403 and "My Lines" in r.json()["detail"]
    # Once A's RFQ is out the two lines move to "waiting for quotes"; B's line is still with the buyer.
    ra = _create(client, s["a"], s).json()
    _submit(client, db, s["a"], ra["id"], s["v1"])
    by_state = client.get(MY_LINES, params={"all": "true", "state": "quoting"}, headers=_h(head)).json()["rows"]
    assert sorted(r["pr_item_id"] for r in by_state) == sorted([s["l1"], s["l3"]])
    assert all(r["rfqs"][0]["rfq_number"] == ra["rfq_number"] for r in by_state)


# ═══ Who may open the tracker ════════════════════════════════════════════════

def test_the_tracker_is_closed_to_an_unrelated_user_and_open_to_every_line_buyer(client, db, s):
    pr_id = s["pr_id"]
    outsider = make_user(db, "mb.e2e.outsider@premnathrail.com", assigned_apps=("hr",))
    r = client.get(f"{PR}/{pr_id}/tracker", headers=_h(outsider))
    assert r.status_code == 403 and r.json()["detail"]
    # A Procurement user whose data scope is "own" has no business with this requisition.
    stranger = make_user(db, "mb.e2e.stranger@premnathrail.com", assigned_apps=("p2p",))
    stranger.data_access_scopes = {"p2p": "own"}
    db.commit()
    assert client.get(f"{PR}/{pr_id}/tracker", headers=_h(stranger)).status_code == 403
    # A store user who has only Goods Receipt (no Purchase Requisitions tab) gets no tracker.
    keeper = make_user(db, "mb.e2e.keeper@premnathrail.com", assigned_apps=("store",))
    keeper.granular_permissions = ["store:grn:view", "store:grn:create"]
    db.commit()
    assert client.get(f"{PR}/{pr_id}/tracker", headers=_h(keeper)).status_code == 403
    assert client.get(f"{PR}/999999/tracker", headers=_h(s["requester"])).status_code == 404
    # Both line buyers and the requester see all three lines (the other buyer's lines read-only).
    for who in (s["a"], s["b"], s["requester"], s["head"]):
        assert len(_tracker(client, s, who)["lines"]) == 3


def test_a_buyer_cannot_open_the_other_buyers_rfq_when_data_scope_is_assigned(client, db, s):
    ra, rb = _create(client, s["a"], s).json(), _create(client, s["b"], s).json()
    s["a"].data_access_scopes = {"p2p": "assigned"}
    s["b"].data_access_scopes = {"p2p": "assigned"}
    db.commit()
    assert client.get(f"{RFQS}/{ra['id']}", headers=_h(s["a"])).status_code == 200
    assert client.get(f"{RFQS}/{rb['id']}", headers=_h(s["a"])).status_code == 403
    assert client.get(f"{RFQS}/{ra['id']}", headers=_h(s["b"])).status_code == 403
    # ...yet each buyer still opens the requisition and its tracker (each owns lines on it).
    assert _tracker(client, s, s["a"])["status"] == "approved" and _tracker(client, s, s["b"])["status"] == "approved"
    # B cannot award, quote or upload on A's RFQ even by guessing the id.
    assert client.patch(f"{RFQS}/{ra['id']}/lines", json={"pr_item_ids": [s["l2"]]}, headers=_h(s["b"])).status_code in (403, 409)


# ═══ Four-eyes ═══════════════════════════════════════════════════════════════

def test_the_buyer_who_uploaded_a_po_cannot_approve_it_even_when_listed_as_an_approver(client, db, s):
    _raise_and_submit_rfqs(client, db, s)
    _quote_all(client, s)
    _award_all(client, s)
    # A is (wrongly) one of the PO approvers: the engine still refuses A on A's own PO.
    set_po_workflow(db, [s["a"].id, s["approver"].id], s["head"], partner=True)
    p = _upload(client, db, s["a"], s, s["q1"], [{"pr_item_id": s["l1"]}, {"pr_item_id": s["l3"]}], "TALLY-4EYES-1")
    assert p.status_code == 200, p.text
    r = client.post(f"{PR}/{s['pr_id']}/approve-po", json={"comment": "mine", "po_id": p.json()["id"]}, headers=_h(s["a"]))
    assert r.status_code in (403, 409) and r.json()["detail"], r.text
    db.expire_all()
    assert db.get(P2PPurchaseOrder, p.json()["id"]).status == "issued"
    # B's PO is a different PO: A may approve it (A did not upload it).
    pb = _upload_b(client, db, s, "TALLY-4EYES-2")
    assert pb.status_code == 200, pb.text


# ═══ Rejection is told to the buyer and the requester ════════════════════════

def test_a_rejected_po_tells_its_buyer_and_the_requester_why_with_a_bell(client, db, s, monkeypatch):
    teams = []
    monkeypatch.setattr("app.utils.notifications._notify_teams", lambda *a, **k: teams.append(a))
    _to_three_pos(client, db, s)
    teams.clear()
    reason = "Beta rate is above budget"
    r = client.post(f"{PR}/{s['pr_id']}/reject", json={"reason": reason, "po_id": s["po2"]["id"]}, headers=_h(s["approver"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    missing = []
    for who, label in ((s["a"], "the buyer who uploaded it"), (s["requester"], "the requester")):
        rows = db.query(Notification).filter(Notification.user_id == who.id).all()
        if not any(s["po2"]["po_number"] in (n.message or "") and reason in (n.message or "") for n in rows):
            missing.append(f"{label} got no bell notice naming {s['po2']['po_number']} and the reason (got: {[n.message for n in rows]})")
    assert not missing, "; ".join(missing)


# ═══ Lines from stock, expired quote, close with a GRN waiting, history ══════

def test_lines_issued_from_stock_are_not_offered_for_rfq_quote_or_po(client, db, s):
    pr = db.get(P2PRequest, s["pr_id"])
    for it in pr.items:
        if it.id == s["l3"]:
            it.fulfillment_status, it.issued_qty = "stock_issued", 10      # fully from stock
        if it.id == s["l1"]:
            it.issued_qty = 30                                            # partly: 70 left to buy
    db.commit()
    r = _create(client, s["a"], s)
    assert r.status_code == 200, r.text
    rfq = r.json()
    assert [(i["pr_item_id"], i["quantity"], i["open_qty"]) for i in rfq["items"]] == [(s["l1"], 70, 70)]
    explicit = client.patch(f"{RFQS}/{rfq['id']}/lines", json={"pr_item_ids": [s["l1"], s["l3"]]}, headers=_h(s["a"]))
    assert explicit.status_code == 409, explicit.text
    _submit(client, db, s["a"], rfq["id"], s["v1"])
    q = _quote(client, s["a"], rfq["id"], s["v1"], [{"pr_item_id": s["l1"], "unit_price": 100, "gst_rate": 18}])
    assert q["items"][0]["quantity"] == 70                              # the shortfall, never the full 100
    over = client.post(f"{RFQS}/{rfq['id']}/line-quotations", json={"vendor_id": s["v2"].id, "items": [
        {"pr_item_id": s["l1"], "quantity": 100, "unit_price": 90}]}, headers=_h(s["a"]))
    assert over.status_code == 422 and "asks for 70" in over.json()["detail"]
    stock_line = client.post(f"{RFQS}/{rfq['id']}/line-quotations", json={"vendor_id": s["v2"].id, "items": [
        {"pr_item_id": s["l3"], "unit_price": 90}]}, headers=_h(s["a"]))
    assert stock_line.status_code == 422 and "is not on RFQ" in stock_line.json()["detail"]
    aw = _award(client, s["a"], rfq["id"], [{"pr_item_id": s["l1"], "vendor_quotation_item_id": _qi(q, s["l1"])}])
    assert aw.status_code == 200, aw.text
    po = _upload(client, db, s["a"], {"rfq": rfq}, q, [{"pr_item_id": s["l1"]}], "TALLY-STK-1")
    assert po.status_code == 200 and [(i["pr_item_id"], i["quantity"]) for i in po.json()["items"]] == [(s["l1"], 70)]
    t = _tracker(client, s)
    assert t["by"][s["l3"]]["state"] == "issued_from_stock" and t["by"][s["l1"]]["ordered_qty"] == 70


def test_an_expired_quote_cannot_be_awarded(client, db, s):
    _raise_and_submit_rfqs(client, db, s)
    expired = (date.today() - timedelta(days=3)).isoformat()
    q = _quote(client, s["a"], s["rfq"]["id"], s["v1"], [{"pr_item_id": s["l1"], "unit_price": 100, "gst_rate": 18}], valid_until=expired)
    r = _award(client, s["a"], s["rfq"]["id"], [{"pr_item_id": s["l1"], "vendor_quotation_item_id": _qi(q, s["l1"])}])
    assert r.status_code == 409 and "expired" in r.json()["detail"], r.text


def test_close_is_refused_while_a_goods_receipt_awaits_inspection_and_names_it(client, db, s):
    _to_three_pos(client, db, s)
    for po in (s["po1"], s["po2"], s["po3"]):
        _approve_po(client, s, po)
    assert _grn(client, s, s["po1"], {s["l1"]: 20}).status_code == 200
    assert _status(db, s) == "partially_received"
    # Store books 10 more on PO-2 but has not inspected them yet.
    po2 = s["po2"]
    waiting = client.post(GRNS, json={"purchase_order_id": po2["id"], "store_location_id": _receiving_store(client),
                                      "items": [{"po_item_id": po2["items"][0]["id"], "received_quantity": 10}]}, headers=_h(s["store"]))
    assert waiting.status_code == 200, waiting.text
    r = client.post(f"{PR}/{s['pr_id']}/close", json={"reason": "Vendors will not deliver the rest"}, headers=_h(s["head"]))
    assert r.status_code == 409 and waiting.json()["grn_number"] in r.json()["detail"] and "inspection" in r.json()["detail"]
    assert _status(db, s) == "partially_received"


def test_every_step_of_the_story_is_written_to_the_history(client, db, s):
    _to_three_pos(client, db, s)
    r = client.post(f"{PR}/{s['pr_id']}/reject", json={"reason": "Beta rate is above budget", "po_id": s["po2"]["id"]}, headers=_h(s["approver"]))
    assert r.status_code == 200, r.text
    c = make_user(db, "mb.e2e.c4@premnathrail.com", assigned_apps=("purchase",))
    # 60 of L1 are open again: write 20 off, hand the other 40 to buyer C.
    sc = client.post(f"{PR}/{s['pr_id']}/lines/{s['l1']}/short-close", json={"quantity": 20, "reason": "Site needs only 80 now"}, headers=_h(s["head"]))
    assert sc.status_code == 200, sc.text
    mv = client.post(f"{PR}/{s['pr_id']}/lines/{s['l1']}/reassign-buyer", json={"buyer_id": c.id, "reason": "A is overloaded"}, headers=_h(s["head"]))
    assert mv.status_code == 200, mv.text
    _approve_po(client, s, s["po1"])
    assert _grn(client, s, s["po1"], {s["l1"]: 20}).status_code == 200
    db.expire_all()
    actions = {a.action for a in db.query(AuditLog).filter(AuditLog.entity_id == s["pr_id"], AuditLog.entity_type == "p2p_request").all()}
    actions |= {a.action for a in db.query(AuditLog).filter(AuditLog.entity_type == "rfq").all()}
    actions |= {a.action for a in db.query(AuditLog).filter(AuditLog.entity_type == "p2p_purchase_order").all()}
    expected = {"created", "rfq_created", "submitted", "line_quotation_added", "lines_awarded", "po_draft_created",
                "po_document_uploaded", "po_raised", "approval_rejected", "po_cancelled", "line_short_closed", "award_trimmed",
                "line_buyer_reassigned", "approval_approved", "po_fully_approved", "grn_recorded", "grn_inspected", "po_rollup"}
    assert expected <= actions, f"missing from the history: {sorted(expected - actions)}"
    summary = db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=s["pr_id"], action="line_buyer_reassigned").one().summary
    assert "A is overloaded" in summary and c.name in summary and "40" in summary   # from, to, quantity, reason
