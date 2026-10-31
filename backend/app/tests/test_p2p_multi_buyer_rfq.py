"""One requisition, several buyers (2026-10-31): an RFQ belongs to ONE requisition, ONE buyer and an
explicit set of lines; quotes are only on those lines; awards carry a quantity (a line can be split
across vendors); Upload PO makes a PO for ONE vendor from chosen lines and quantities, so one
requisition gets many POs, each with its own approval.

Spec criteria covered: 1-2, 5, 8-14, 17-20, 24-27 (+ permission-denied and data-scope cases)."""
from datetime import date

import pytest

from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.audit_log import AuditLog
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p import line_progress, po_split
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_attachment import RFQAttachment
from app.modules.p2p.models.rfq_item import RFQItem
from app.tests.p2p_po_helpers import make_ship_to, post_upload_po
from app.tests.p2p_workflow_helpers import master_item, set_po_workflow
from app.tests.test_p2p_requests import (  # noqa: F401 - _sqlite_number_series is an autouse fixture
    _approve_pr, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header, make_user,
)

RFQS = "/api/v1/p2p/rfqs"
EPS = 1e-6


def _h(user):
    return auth_header(user)


def _vendor(db, code, name):
    v = Vendor(code=code, name=name, status="active", gst_registration_type="unregistered")
    db.add(v)
    db.commit()
    return v


@pytest.fixture
def w(client, db):
    """An approved requisition with three bought lines: L1 (100, buyer A), L2 (5, buyer B), L3 (10, buyer A)."""
    items = [master_item(db, f"MB bolt {n}", code=f"MB-{n}", uom="Nos") for n in (1, 2, 3)]
    requester = _requester(db, "mb.req@premnathrail.com")
    pr = _create_pr(client, requester, items=[
        {"store_item_id": items[0].id, "quantity": 100, "project_inhouse": "Project"},
        {"store_item_id": items[1].id, "quantity": 5, "project_inhouse": "Project"},
        {"store_item_id": items[2].id, "quantity": 10, "project_inhouse": "Project"}])
    _approve_pr(client, pr)
    a, b = _purchaser(db, "mb.a@premnathrail.com"), _purchaser(db, "mb.b@premnathrail.com")
    head = make_user(db, "mb.head@premnathrail.com", role="admin")
    approver = make_user(db, "mb.poapprover@premnathrail.com", assigned_apps=("p2p",))
    set_po_workflow(db, [approver.id], head)
    row = db.get(P2PRequest, pr["id"])
    lines = sorted(row.items, key=lambda i: i.id)
    for it, who in zip(lines, (a, b, a)):
        it.fulfillment_status = "sent_to_procurement"
        it.buyer_id = who.id
    db.commit()
    return {"pr": pr, "pr_id": pr["id"], "a": a, "b": b, "head": head, "approver": approver,
            "l1": lines[0].id, "l2": lines[1].id, "l3": lines[2].id,
            "v1": _vendor(db, "V-MB1", "Alpha MB"), "v2": _vendor(db, "V-MB2", "Beta MB")}


def _create(client, who, w, **body):
    return client.post(RFQS, json={"p2p_request_id": w["pr_id"], **body}, headers=_h(who))


def _lock(db, rfq_id):
    """Submitted RFQ without the commercial-terms ceremony (that is covered by the submit tests)."""
    rfq = db.get(RFQ, rfq_id)
    rfq.status = "locked"
    db.commit()


def _line_ids(rfq_json):
    return sorted(i["pr_item_id"] for i in rfq_json["items"])


def _quote(client, who, rfq_id, vendor, items, **kw):
    r = client.post(f"{RFQS}/{rfq_id}/line-quotations", json={"vendor_id": vendor.id, "items": items, **kw}, headers=_h(who))
    assert r.status_code == 200, r.text
    return r.json()


def _qi(quote, line):
    return next(i["id"] for i in quote["items"] if i["pr_item_id"] == line)


@pytest.fixture
def quoted(client, db, w):
    """Buyer A's locked RFQ on L1 + L3 with two quotes: V1 (L1 100 @100, L3 10 @50), V2 (L1 60 @110)."""
    rfq = _create(client, w["a"], w).json()
    _lock(db, rfq["id"])
    q1 = _quote(client, w["a"], rfq["id"], w["v1"], [{"pr_item_id": w["l1"], "unit_price": 100, "gst_rate": 18},
                                                    {"pr_item_id": w["l3"], "unit_price": 50, "gst_rate": 18}])
    q2 = _quote(client, w["a"], rfq["id"], w["v2"], [{"pr_item_id": w["l1"], "quantity": 60, "unit_price": 110, "gst_rate": 18}])
    return {**w, "rfq": rfq, "q1": q1, "q2": q2}


def _award(client, who, rfq_id, awards):
    return client.post(f"{RFQS}/{rfq_id}/awards", json={"awards": awards}, headers=_h(who))


def _split_award(client, q):
    """V1 gets L1 40 and L3 (whole 10); V2 gets L1 60."""
    r = _award(client, q["a"], q["rfq"]["id"], [
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q1"], q["l1"]), "quantity": 40},
        {"pr_item_id": q["l3"], "vendor_quotation_item_id": _qi(q["q1"], q["l3"])},
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q2"], q["l1"]), "quantity": 60,
         "reason": "Alpha can only deliver 40 now"}])
    assert r.status_code == 200, r.text
    return r.json()


def _upload(client, db, who, q, vendor_quote, lines, tally, **extra):
    details = {"vendor_quotation_id": vendor_quote["id"], "ship_to_location_id": make_ship_to(db).id,
               "lines": [{"unit_price": 10, "tax_rate": 18, **ln} for ln in lines], **extra}
    return post_upload_po(client, who, q["rfq"]["id"], details, tally)


def _open(db, pr_id):
    db.expire_all()
    return {pid: lp.open_to_order for pid, lp in line_progress.line_progress(db, db.get(P2PRequest, pr_id)).items()}


# ── RFQ per buyer (criteria 1, 2, 5) ──────────────────────────────────────────

def test_two_buyers_raise_their_own_rfqs_on_their_own_lines(client, db, w):
    ra, rb = _create(client, w["a"], w), _create(client, w["b"], w)
    assert ra.status_code == 200 and rb.status_code == 200, (ra.text, rb.text)
    a, b = ra.json(), rb.json()
    assert a["id"] != b["id"] and a["rfq_number"] != b["rfq_number"]
    assert a["buyer_id"] == w["a"].id and a["buyer_name"] == w["a"].name and b["buyer_id"] == w["b"].id
    assert _line_ids(a) == sorted([w["l1"], w["l3"]]) and _line_ids(b) == [w["l2"]]
    first = next(i for i in a["items"] if i["pr_item_id"] == w["l1"])
    assert first["quantity"] == 100 and first["open_qty"] == 100 and first["store_item_id"] and first["item_name"]
    assert db.get(P2PRequest, w["pr_id"]).status == "approved"  # nothing is out for quotes yet


def test_a_buyers_draft_is_reused_and_its_lines_replaced(client, db, w):
    first = _create(client, w["a"], w).json()
    again = _create(client, w["a"], w).json()
    assert again["id"] == first["id"] and db.query(RFQ).filter_by(p2p_request_id=w["pr_id"], buyer_id=w["a"].id).count() == 1
    narrowed = _create(client, w["a"], w, pr_item_ids=[w["l1"]]).json()
    assert narrowed["id"] == first["id"] and _line_ids(narrowed) == [w["l1"]]
    assert db.query(RFQItem).filter_by(rfq_id=first["id"]).count() == 1
    # PATCH lines swaps the set on the draft; an empty set is allowed on a draft (submit then refuses).
    both = client.patch(f"{RFQS}/{first['id']}/lines", json={"pr_item_ids": [w["l1"], w["l3"]]}, headers=_h(w["a"]))
    assert both.status_code == 200 and _line_ids(both.json()) == sorted([w["l1"], w["l3"]])
    empty = client.patch(f"{RFQS}/{first['id']}/lines", json={"pr_item_ids": []}, headers=_h(w["a"]))
    assert empty.status_code == 200 and empty.json()["items"] == []
    r = client.post(f"{RFQS}/{first['id']}/submit", headers=_h(w["a"]))
    assert r.status_code == 409 and "has no lines" in r.json()["detail"]


def test_a_line_waiting_for_the_stock_check_never_blocks_the_others(client, db, w):
    db.get(P2PRequest, w["pr_id"]).items[2].fulfillment_status = "pending"
    db.commit()
    waiting = next(i for i in db.get(P2PRequest, w["pr_id"]).items if i.fulfillment_status == "pending").id
    r = _create(client, w["a"], w)
    assert r.status_code == 200, r.text
    assert _line_ids(r.json()) == [w["l1"]] if waiting == w["l3"] else True
    assert waiting not in _line_ids(r.json())
    # Naming the waiting line explicitly is refused with the reason.
    explicit = client.patch(f"{RFQS}/{r.json()['id']}/lines", json={"pr_item_ids": [waiting]}, headers=_h(w["a"]))
    assert explicit.status_code == 409 and "stock check" in explicit.json()["detail"]
    # When nothing of the buyer is ready the error says which lines wait and why.
    for it in db.get(P2PRequest, w["pr_id"]).items:
        it.fulfillment_status = "pending"
    db.commit()
    db.query(RFQItem).delete()
    db.query(RFQ).delete()
    db.commit()
    none = _create(client, w["b"], w)
    assert none.status_code == 409 and "waiting for the stock check" in none.json()["detail"]


def test_a_buyer_cannot_take_another_buyers_line_and_the_head_can_raise_for_a_buyer(client, db, w):
    wrong = _create(client, w["b"], w, pr_item_ids=[w["l1"]])
    assert wrong.status_code == 403 and "assigned to" in wrong.json()["detail"] and w["a"].name in wrong.json()["detail"]
    assert "Purchase head" in wrong.json()["detail"]
    # A buyer cannot raise it for somebody else either.
    other = _create(client, w["b"], w, buyer_id=w["a"].id)
    assert other.status_code == 403 and "Only the Purchase head" in other.json()["detail"]
    # The head raises it for buyer B: B is the buyer, the audit names the head.
    r = _create(client, w["head"], w, buyer_id=w["b"].id)
    assert r.status_code == 200, r.text
    assert r.json()["buyer_id"] == w["b"].id and r.json()["created_by_id"] == w["head"].id and _line_ids(r.json()) == [w["l2"]]
    log = db.query(AuditLog).filter_by(entity_type="rfq", entity_id=r.json()["id"], action="created").one()
    assert w["head"].name in log.summary and "on behalf of" in log.summary
    # A line nobody buys is refused for a buyer, claimable by the head.
    row = db.get(P2PRequest, w["pr_id"]).items
    next(i for i in row if i.id == w["l2"]).buyer_id = None
    db.commit()
    no_buyer = _create(client, w["b"], w, pr_item_ids=[w["l2"]])
    assert no_buyer.status_code == 409 and "has no buyer" in no_buyer.json()["detail"]


# ── submit (criterion 8) ──────────────────────────────────────────────────────

def test_submit_locks_only_this_rfq_and_the_vendor_mail_lists_only_its_lines(client, db, w):
    ra, rb = _create(client, w["a"], w).json(), _create(client, w["b"], w).json()
    rfq = db.get(RFQ, ra["id"])
    db.add(RFQAttachment(rfq_id=rfq.id, vendor_tier="L1", vendor_name=w["v1"].name, vendor_id=w["v1"].id, filename="L1.pdf",
                         sharepoint_path="x/L1.pdf", created_by_id=w["a"].id))
    db.commit()
    r = client.patch(f"{RFQS}/{rfq.id}", json={
        "payment_terms": "30 days", "delivery_lead_time": "2 weeks", "late_delivery_clause": "0.5% per week",
        "single_quotation_reason": "Sole source", "comments": "Only L1 quote available"}, headers=_h(w["a"]))
    assert r.status_code == 200, r.text
    # Another buyer can neither edit nor submit A's RFQ.
    assert client.post(f"{RFQS}/{rfq.id}/submit", headers=_h(w["b"])).status_code == 403
    sub = client.post(f"{RFQS}/{rfq.id}/submit", headers=_h(w["a"]))
    assert sub.status_code == 200, sub.text
    db.expire_all()
    assert db.get(RFQ, ra["id"]).status == "locked" and db.get(RFQ, rb["id"]).status == "draft"
    assert db.get(P2PRequest, w["pr_id"]).status == "vendor_quotations"
    assert ra["rfq_number"] in (db.get(P2PRequest, w["pr_id"]).rfq_number or "")
    from app.modules.p2p.rfq_mail import build_rfq_email
    pr = db.get(P2PRequest, w["pr_id"])
    _subject, html = build_rfq_email(db.get(RFQ, ra["id"]), pr, w["a"], None, False)
    assert "MB bolt 1" in html and "MB bolt 3" in html and "MB bolt 2" not in html  # B's line is not mailed to A's vendors
    # B's RFQ is untouched and can still be raised / changed.
    assert client.get(f"{RFQS}/{rb['id']}", headers=_h(w["b"])).json()["status"] == "draft"


# ── quotes only on the RFQ's lines (criterion 10) ─────────────────────────────

def test_quotes_are_only_for_the_rfqs_lines_and_never_above_its_quantity(client, db, quoted):
    q = quoted
    r = client.post(f"{RFQS}/{q['rfq']['id']}/line-quotations", json={"vendor_id": q["v1"].id + 0, "items": [
        {"pr_item_id": q["l2"], "unit_price": 5}]}, headers=_h(q["a"]))
    assert r.status_code == 409  # V1 already quoted - edit that one (checked before the line)
    v3 = _vendor(db, "V-MB3", "Gamma MB")
    r = client.post(f"{RFQS}/{q['rfq']['id']}/line-quotations", json={"vendor_id": v3.id, "items": [
        {"pr_item_id": q["l2"], "unit_price": 5}]}, headers=_h(q["a"]))
    assert r.status_code == 422 and "is not on RFQ" in r.json()["detail"] and "MB bolt 2" in r.json()["detail"]
    r = client.post(f"{RFQS}/{q['rfq']['id']}/line-quotations", json={"vendor_id": v3.id, "items": [
        {"pr_item_id": q["l1"], "quantity": 150, "unit_price": 5}]}, headers=_h(q["a"]))
    assert r.status_code == 422 and "asks for 100" in r.json()["detail"]
    # The quote lines carry the Item Master id and the quantity the vendor can supply.
    qty = {i["pr_item_id"]: (i["quantity"], i["store_item_id"]) for i in q["q2"]["items"]}
    assert qty[q["l1"]][0] == 60 and qty[q["l1"]][1]
    assert {i["pr_item_id"]: i["quantity"] for i in q["q1"]["items"]} == {q["l1"]: 100, q["l3"]: 10}
    # Another buyer cannot quote on A's RFQ (403), nor can a draft RFQ take quotes (409).
    r = client.post(f"{RFQS}/{q['rfq']['id']}/line-quotations", json={"vendor_id": v3.id, "items": [
        {"pr_item_id": q["l1"], "unit_price": 5}]}, headers=_h(q["b"]))
    assert r.status_code == 403 and q["a"].name in r.json()["detail"]
    draft = _create(client, q["b"], q).json()
    r = client.post(f"{RFQS}/{draft['id']}/line-quotations", json={"vendor_id": v3.id, "items": [
        {"pr_item_id": q["l2"], "unit_price": 5}]}, headers=_h(q["b"]))
    assert r.status_code == 409 and "still a draft" in r.json()["detail"]
    # The comparison covers only the RFQ's lines.
    cmp = client.get(f"{RFQS}/{q['rfq']['id']}/comparison", headers=_h(q["a"])).json()
    assert sorted(r["pr_item_id"] for r in cmp["lines"]) == sorted([q["l1"], q["l3"]])


# ── awards by quantity (criteria 11-14) ───────────────────────────────────────

def test_a_line_can_be_split_across_vendors_and_the_total_is_checked(client, db, quoted):
    q = quoted
    cmp = _split_award(client, q)
    row = next(r for r in cmp["lines"] if r["pr_item_id"] == q["l1"])
    assert row["awarded_total"] == 100 and row["open_qty"] == 100
    assert sorted(a["quantity"] for a in row["awards"]) == [40, 60]
    l3 = next(r for r in cmp["lines"] if r["pr_item_id"] == q["l3"])
    assert l3["awarded_total"] == 10  # quantity omitted = the whole remaining quantity
    stored = {(vq.vendor_name, qi.pr_item_id): (qi.awarded_qty, qi.is_awarded, qi.award_reason)
              for vq in db.get(RFQ, q["rfq"]["id"]).vendor_quotations for qi in vq.items}
    assert stored[("Beta MB", q["l1"])] == (60, True, "Alpha can only deliver 40 now")
    assert stored[("Alpha MB", q["l1"])][:2] == (40, True)
    # Over-award: 70 + 50 against 100 still to buy.
    r = _award(client, q["a"], q["rfq"]["id"], [
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q1"], q["l1"]), "quantity": 70},
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q2"], q["l1"]), "quantity": 50, "reason": "split for speed"}])
    assert r.status_code == 409 and "awarded 120" in r.json()["detail"] and "Reduce an award by 20" in r.json()["detail"]
    # A vendor can't get more than it quoted.
    r = _award(client, q["a"], q["rfq"]["id"], [
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q2"], q["l1"]), "quantity": 70, "reason": "speed"}])
    assert r.status_code == 409 and "quoted 60" in r.json()["detail"]


def test_an_award_to_a_vendor_that_is_not_l1_needs_a_reason_naming_the_rank(client, db, quoted):
    q = quoted
    r = _award(client, q["a"], q["rfq"]["id"], [
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q2"], q["l1"]), "quantity": 20}])
    assert r.status_code == 422, r.text
    d = r.json()["detail"]
    assert "MB bolt 1" in d and "Beta MB" in d and "L2" in d and "not L1" in d
    db.expire_all()
    assert all(not qi.is_awarded for vq in db.get(RFQ, q["rfq"]["id"]).vendor_quotations for qi in vq.items)  # nothing saved


def test_an_award_cannot_go_below_what_is_already_on_a_po_and_zero_withdraws_the_rest(client, db, quoted):
    q = quoted
    _split_award(client, q)
    up = _upload(client, db, q["a"], q, q["q1"], [{"pr_item_id": q["l1"], "quantity": 40}], "TALLY-FLOOR-1")
    assert up.status_code == 200, up.text
    po_no = up.json()["po_number"]
    low = _award(client, q["a"], q["rfq"]["id"], [
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q1"], q["l1"]), "quantity": 30}])
    assert low.status_code == 409 and "40 of" in low.json()["detail"] and po_no in low.json()["detail"]
    assert "Cancel or amend that PO first" in low.json()["detail"]
    zero = _award(client, q["a"], q["rfq"]["id"], [
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q1"], q["l1"]), "quantity": 0}])
    assert zero.status_code == 409 and po_no in zero.json()["detail"]
    # V2's award (not on a PO) can be taken back; the line keeps V1's 40.
    ok = _award(client, q["a"], q["rfq"]["id"], [
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q2"], q["l1"]), "quantity": 0}])
    assert ok.status_code == 200, ok.text
    row = next(r for r in ok.json()["lines"] if r["pr_item_id"] == q["l1"])
    assert row["awarded_total"] == 40
    # Awarding the whole line to V2 clears V1's award down to the 40 already on its PO.
    whole = _award(client, q["a"], q["rfq"]["id"], [
        {"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q2"], q["l1"]), "reason": "Beta is faster"}])
    assert whole.status_code == 200, whole.text
    row = next(r for r in whole.json()["lines"] if r["pr_item_id"] == q["l1"])
    assert sorted(a["quantity"] for a in row["awards"]) == [40, 60]


def test_awards_need_the_award_permission_and_the_rfqs_own_buyer(client, db, quoted):
    q = quoted
    body = [{"pr_item_id": q["l1"], "vendor_quotation_item_id": _qi(q["q1"], q["l1"]), "quantity": 10}]
    other = _award(client, q["b"], q["rfq"]["id"], body)
    assert other.status_code == 403 and q["a"].name in other.json()["detail"]
    view_only = make_user(db, "mb.viewonly@premnathrail.com", assigned_apps=("purchase",))
    view_only.granular_permissions = ["p2p:rfq:view", "p2p:rfq:edit"]
    db.commit()
    assert _award(client, view_only, q["rfq"]["id"], body).status_code == 403
    outsider = make_user(db, "mb.outsider@premnathrail.com", assigned_apps=("hr",))
    assert _award(client, outsider, q["rfq"]["id"], body).status_code == 403
    db.expire_all()
    assert all(not qi.is_awarded for vq in db.get(RFQ, q["rfq"]["id"]).vendor_quotations for qi in vq.items)


# ── Upload PO per vendor (criteria 17-20) ─────────────────────────────────────

def test_one_rfq_makes_two_pos_each_with_its_own_approval_and_other_buyers_keep_working(client, db, quoted):
    q = quoted
    _split_award(client, q)
    # Buyer B raises, submits and quotes their own RFQ while A's POs are being made.
    rb = _create(client, q["b"], q).json()
    p1 = _upload(client, db, q["a"], q, q["q1"], [{"pr_item_id": q["l1"]}, {"pr_item_id": q["l3"]}], "TALLY-2PO-1")
    assert p1.status_code == 200, p1.text
    po1 = p1.json()
    assert {(i["pr_item_id"], i["quantity"]) for i in po1["items"]} == {(q["l1"], 40), (q["l3"], 10)}  # the awarded quantities
    assert po1["rfq_id"] == q["rfq"]["id"] and po1["vendor_id"] == q["v1"].id and po1["vendor_quotation_id"] == q["q1"]["id"]
    assert all(i["vendor_quotation_item_id"] and i["store_item_id"] for i in po1["items"])
    # Header after the first PO: po_raised; B's RFQ still works.
    db.expire_all()
    assert db.get(P2PRequest, q["pr_id"]).status == "po_raised"
    _lock(db, rb["id"])
    qb = _quote(client, q["b"], rb["id"], q["v1"], [{"pr_item_id": q["l2"], "unit_price": 7}])
    aw = _award(client, q["b"], rb["id"], [{"pr_item_id": q["l2"], "vendor_quotation_item_id": _qi(qb, q["l2"])}])
    assert aw.status_code == 200, aw.text
    p2 = _upload(client, db, q["a"], q, q["q2"], [{"pr_item_id": q["l1"]}], "TALLY-2PO-2")
    assert p2.status_code == 200, p2.text
    po2 = p2.json()
    assert [(i["pr_item_id"], i["quantity"]) for i in po2["items"]] == [(q["l1"], 60)] and po2["vendor_id"] == q["v2"].id
    assert po1["id"] != po2["id"] and po1["external_ref"] != po2["external_ref"]
    db.expire_all()
    r1, r2 = engine.latest_request(db, "p2p_purchase_order", po1["id"]), engine.latest_request(db, "p2p_purchase_order", po2["id"])
    assert r1 is not None and r2 is not None and r1.id != r2.id  # each PO has its own approval request
    assert _open(db, q["pr_id"])[q["l1"]] == 0 and _open(db, q["pr_id"])[q["l2"]] == 5
    # B's line is still theirs to upload; A cannot upload it (not A's RFQ).
    by_a = post_upload_po(client, q["a"], rb["id"], {"vendor_quotation_id": qb["id"], "ship_to_location_id": make_ship_to(db).id,
                                                      "lines": [{"pr_item_id": q["l2"], "unit_price": 7}]}, "TALLY-2PO-3")
    assert by_a.status_code == 403 and q["b"].name in by_a.json()["detail"]
    ok = post_upload_po(client, q["b"], rb["id"], {"vendor_quotation_id": qb["id"], "ship_to_location_id": make_ship_to(db).id,
                                                    "lines": [{"pr_item_id": q["l2"], "unit_price": 7}]}, "TALLY-2PO-3")
    assert ok.status_code == 200, ok.text


def test_a_po_takes_only_what_is_awarded_to_the_vendor_and_a_lower_quantity_leaves_the_rest_open(client, db, quoted):
    q = quoted
    _split_award(client, q)
    over = _upload(client, db, q["a"], q, q["q1"], [{"pr_item_id": q["l1"], "quantity": 45}], "TALLY-QTY-1")
    assert over.status_code == 409 and "45 is more than the 40 awarded to Alpha MB" in over.json()["detail"]
    assert "MB bolt 1" in over.json()["detail"]
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=q["pr_id"]).count() == 0
    assert len(post_upload_po.calls.deleted) == 1  # the stored PDF is removed again
    low = _upload(client, db, q["a"], q, q["q1"], [{"pr_item_id": q["l1"], "quantity": 30}], "TALLY-QTY-1")
    assert low.status_code == 200, low.text
    assert low.json()["items"][0]["quantity"] == 30
    assert _open(db, q["pr_id"])[q["l1"]] == 70  # 100 - 30 on the PO; 10 of V1's award and 60 of V2's still to order
    assert db.get(P2PRequest, q["pr_id"]).status == "po_raised"  # not closed
    rest = _upload(client, db, q["a"], q, q["q1"], [{"pr_item_id": q["l1"]}], "TALLY-QTY-2")
    assert rest.status_code == 200 and rest.json()["items"][0]["quantity"] == 10  # default = the remaining award
    # A line the vendor was not awarded is refused with the way forward.
    not_awarded = _upload(client, db, q["a"], q, q["q2"], [{"pr_item_id": q["l3"]}], "TALLY-QTY-3")
    assert not_awarded.status_code == 422 and "is not awarded to Beta MB" in not_awarded.json()["detail"]


def test_without_a_vendor_quotation_an_rfq_with_awards_names_the_awarded_vendors(client, db, quoted):
    q = quoted
    _split_award(client, q)
    details = {"vendor_id": q["v1"].id, "ship_to_location_id": make_ship_to(db).id, "lines": [{"pr_item_id": q["l1"], "unit_price": 9}]}
    r = post_upload_po(client, q["a"], q["rfq"]["id"], details, "TALLY-NOV-1")
    assert r.status_code == 422 and "Alpha MB" in r.json()["detail"] and "Beta MB" in r.json()["detail"]
    both = post_upload_po(client, q["a"], q["rfq"]["id"], {**details, "vendor_quotation_id": q["q1"]["id"]}, "TALLY-NOV-1")
    assert both.status_code == 422 and "not both" in both.json()["detail"]


def test_only_the_rfqs_buyer_or_the_head_uploads_and_only_for_lines_still_on_the_rfq(client, db, quoted):
    q = quoted
    _split_award(client, q)
    line = [{"pr_item_id": q["l3"]}]
    assert _upload(client, db, q["b"], q, q["q1"], line, "TALLY-OWN-1").status_code == 403
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=q["pr_id"]).count() == 0
    # The line was reassigned to B (the RFQ line still active): A is told who buys it now.
    row = next(i for i in db.get(P2PRequest, q["pr_id"]).items if i.id == q["l3"])
    row.buyer_id = q["b"].id
    db.commit()
    moved = _upload(client, db, q["a"], q, q["q1"], line, "TALLY-OWN-1")
    assert moved.status_code == 403 and f"bought by {q['b'].name}" in moved.json()["detail"] and "not by the owner of RFQ" in moved.json()["detail"]
    # ...and once the move has withdrawn it from the RFQ nobody can upload it on this RFQ.
    from datetime import datetime, timezone
    item = db.query(RFQItem).filter_by(rfq_id=q["rfq"]["id"], pr_item_id=q["l3"]).one()
    item.withdrawn_at, item.withdrawn_reason = datetime.now(timezone.utc), f"Moved to {q['b'].name} by head: workload"
    db.commit()
    gone = _upload(client, db, q["head"], q, q["q1"], line, "TALLY-OWN-1")
    assert gone.status_code == 409 and "was taken off RFQ" in gone.json()["detail"] and "workload" in gone.json()["detail"]
    # The head may upload a line of A's RFQ that is still A's.
    head = _upload(client, db, q["head"], q, q["q2"], [{"pr_item_id": q["l1"]}], "TALLY-OWN-2")
    assert head.status_code == 200, head.text


def test_concurrent_changes_are_refused_with_the_reason_when_the_requisition_is_locked(client, db, quoted, monkeypatch):
    q = quoted
    _split_award(client, q)
    from fastapi import HTTPException

    def busy(_db, _pr_id):
        raise HTTPException(status_code=409, detail="Another buyer is changing this requisition right now - wait, reload, try again.")

    monkeypatch.setattr(po_split, "lock_pr", busy)
    r = _upload(client, db, q["a"], q, q["q1"], [{"pr_item_id": q["l3"]}], "TALLY-LOCK-1")
    assert r.status_code == 409 and "Another buyer is changing" in r.json()["detail"]
    assert len(post_upload_po.calls.deleted) == 1 and db.query(P2PPurchaseOrder).filter_by(p2p_request_id=q["pr_id"]).count() == 0
    aw = _award(client, q["a"], q["rfq"]["id"], [{"pr_item_id": q["l3"], "vendor_quotation_item_id": _qi(q["q1"], q["l3"]), "quantity": 5}])
    assert aw.status_code == 409 and "Another buyer is changing" in aw.json()["detail"]


def test_the_same_tally_number_saved_twice_is_a_409_naming_the_po(client, db, quoted, monkeypatch):
    """The unique index on live Tally numbers turns a lost race into a clear 409."""
    q = quoted
    _split_award(client, q)
    assert _upload(client, db, q["a"], q, q["q1"], [{"pr_item_id": q["l3"]}], "TALLY-RACE-1").status_code == 200
    from app.modules.p2p.routes import rfq as rfq_routes
    # Another upload passed the pre-check at the same moment: the check is blind, the database says no.
    monkeypatch.setattr(rfq_routes, "_clean_tally_ref", lambda _db, ref, _po: ref.strip())
    real_commit = db.commit

    from sqlalchemy.exc import IntegrityError
    def clash():
        raise IntegrityError("insert", {}, Exception("uq_p2p_po_live_external_ref"))

    from sqlalchemy.orm import Session
    monkeypatch.setattr(Session, "commit", lambda self: clash())
    r = _upload(client, db, q["a"], q, q["q2"], [{"pr_item_id": q["l1"]}], "tally-race-1")
    monkeypatch.undo()
    assert r.status_code == 409 and "Tally PO tally-race-1 is already on" in r.json()["detail"]
    assert len(post_upload_po.calls.deleted) == 1
    del real_commit


# ── single-vendor shortcut (criterion 26) ─────────────────────────────────────

def test_shortcut_for_an_rfq_with_only_quote_files_needs_a_reason_and_takes_the_ticked_lines(client, db, w):
    rfq = _create(client, w["a"], w).json()
    _lock(db, rfq["id"])
    for tier, v in (("L1", w["v1"]), ("L2", w["v2"])):
        db.add(RFQAttachment(rfq_id=rfq["id"], vendor_tier=tier, vendor_name=v.name, vendor_id=v.id, filename=f"{tier}.pdf",
                             sharepoint_path=f"x/{tier}.pdf", created_by_id=w["a"].id))
    db.commit()
    ship = make_ship_to(db).id

    def go(tally, lines, **extra):
        return post_upload_po(client, w["a"], rfq["id"], {"vendor_tier": "L2", "ship_to_location_id": ship, "lines": lines, **extra}, tally)

    no_reason = go("TALLY-SC-1", [{"pr_item_id": w["l1"], "unit_price": 9}])
    assert no_reason.status_code == 400 and "instead of L1" in no_reason.json()["detail"]
    too_many = go("TALLY-SC-1", [{"pr_item_id": w["l1"], "quantity": 150, "unit_price": 9}], selection_reason="L1 cannot deliver in time")
    assert too_many.status_code == 409 and "more than is left to order" in too_many.json()["detail"]
    ok = go("TALLY-SC-1", [{"pr_item_id": w["l1"], "quantity": 60, "unit_price": 9}], selection_reason="L1 cannot deliver in time")
    assert ok.status_code == 200, ok.text
    po = ok.json()
    assert po["vendor_id"] == w["v2"].id and [(i["pr_item_id"], i["quantity"], i["price_source"], i["vendor_quotation_item_id"]) for i in po["items"]] == [
        (w["l1"], 60, "manual", None)]
    assert _open(db, w["pr_id"])[w["l1"]] == 40 and _open(db, w["pr_id"])[w["l3"]] == 10
    # A line of another buyer's RFQ cannot be smuggled onto this PO.
    other = go("TALLY-SC-2", [{"pr_item_id": w["l2"], "unit_price": 9}], selection_reason="L1 cannot deliver in time")
    assert other.status_code == 422 and "is not on RFQ" in other.json()["detail"]


# ── Before-PO (criterion 27) and the header status ────────────────────────────

def test_before_po_requisition_belongs_to_its_creator_and_uploads_at_the_receipt_quantity(client, db):
    from app.modules.store.models.pre_po_receipt import StorePrePoReceipt
    from app.tests.test_pre_po_receipts import PROC, STORE, _body, _store_user, _vendor as _bpo_vendor

    keeper = _store_user(db, "mb.keeper@premnathrail.com")
    v, item = _bpo_vendor(db, "V-MB-BPO"), master_item(db, "Washer MB", code="MB-W1", uom="Nos")
    rec = client.post(STORE, json=_body(v, item, 4), headers=_h(keeper)).json()
    buyer = _purchaser(db, "mb.bpo.buyer@premnathrail.com")
    set_po_workflow(db, [make_user(db, "mb.bpo.approver@premnathrail.com").id], buyer)
    rfq = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=_h(buyer)).json()["rfq"]
    assert rfq["buyer_id"] == buyer.id and [(i["store_item_id"], i["quantity"]) for i in rfq["items"]] == [(item.id, 4)]
    pr = db.get(P2PRequest, db.get(StorePrePoReceipt, rec["id"]).p2p_request_id)
    assert pr.status == "vendor_selected" and all(i.buyer_id == buyer.id for i in pr.items)  # the creator buys every line
    details = {"ship_to_location_id": make_ship_to(db).id, "lines": [{"pr_item_id": pr.items[0].id, "unit_price": 30}]}
    r = post_upload_po(client, buyer, rfq["id"], details, "TALLY-MB-BPO")
    assert r.status_code == 200, r.text
    assert [(i["quantity"], i["unit_price"]) for i in r.json()["items"]] == [(4, 30)] and r.json()["rfq_id"] == rfq["id"]
    db.expire_all()
    assert db.get(StorePrePoReceipt, rec["id"]).status == "po_created"


def test_cancelling_a_before_po_receipt_with_no_po_cancels_its_requisition(client, db):
    from app.modules.p2p.routes.pre_po_receipts import cancel_requisition_for_receipt
    from app.modules.store.models.pre_po_receipt import StorePrePoReceipt
    from app.tests.test_pre_po_receipts import PROC, STORE, _body, _store_user, _vendor as _bpo_vendor

    keeper = _store_user(db, "mb.keeper2@premnathrail.com")
    v, item = _bpo_vendor(db, "V-MB-BPO2"), master_item(db, "Washer MB2", code="MB-W2", uom="Nos")
    rec = client.post(STORE, json=_body(v, item, 2), headers=_h(keeper)).json()
    buyer = _purchaser(db, "mb.bpo.buyer2@premnathrail.com")
    client.post(f"{PROC}/{rec['id']}/create-requisition", headers=_h(buyer))
    receipt = db.get(StorePrePoReceipt, rec["id"])
    pr_id = receipt.p2p_request_id
    done = cancel_requisition_for_receipt(db, receipt, keeper, "vendor cancelled the supply")
    db.commit()
    assert done is not None
    pr = db.get(P2PRequest, pr_id)
    assert pr.status == "cancelled" and "vendor cancelled the supply" in pr.cancelled_reason and receipt.receipt_number in pr.cancelled_reason
    assert db.query(RFQItem).join(RFQ, RFQ.id == RFQItem.rfq_id).filter(RFQ.p2p_request_id == pr_id, RFQItem.withdrawn_at.is_(None)).count() == 0
    assert db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr_id, action="cancelled").count() == 1


def test_the_old_header_level_evaluation_routes_answer_410_with_the_way_forward(client, db, quoted):
    q = quoted
    h = _h(q["a"])
    calls = [("post", f"{RFQS}/{q['rfq']['id']}/vendor-quotations"), ("patch", f"{RFQS}/{q['rfq']['id']}/vendor-quotations/1"),
             ("post", f"{RFQS}/{q['rfq']['id']}/start-technical-evaluation"), ("post", f"{RFQS}/{q['rfq']['id']}/start-commercial-evaluation"),
             ("post", f"{RFQS}/{q['rfq']['id']}/vendor-quotations/1/technical-evaluation"),
             ("post", f"{RFQS}/{q['rfq']['id']}/vendor-quotations/1/commercial-evaluation"),
             ("post", f"{RFQS}/{q['rfq']['id']}/select-vendor-quotation")]
    for method, url in calls:
        r = getattr(client, method)(url, headers=h)
        assert r.status_code == 410, (url, r.status_code)
        assert "replaced by line quotations" in r.json()["detail"] and "Quotations tab" in r.json()["detail"]
    nobody = make_user(db, "mb.nobody@premnathrail.com", assigned_apps=("hr",))
    assert client.post(f"{RFQS}/{q['rfq']['id']}/select-vendor-quotation", headers=_h(nobody)).status_code == 403


def test_creating_an_rfq_needs_the_permission_scope_and_an_open_requisition(client, db, w):
    outsider = make_user(db, "mb.out2@premnathrail.com", assigned_apps=("hr",))
    assert _create(client, outsider, w).status_code == 403
    no_create = make_user(db, "mb.nocreate@premnathrail.com", assigned_apps=("purchase",))
    no_create.granular_permissions = ["p2p:rfq:view"]
    db.commit()
    assert _create(client, no_create, w).status_code == 403
    assert client.post(RFQS, json={"p2p_request_id": 987654}, headers=_h(w["a"])).status_code == 404
    db.get(P2PRequest, w["pr_id"]).status = "cancelled"
    db.commit()
    r = _create(client, w["a"], w)
    assert r.status_code == 409 and "still being bought" in r.json()["detail"] and "cancelled" in r.json()["detail"]


def test_an_rfq_of_another_buyer_is_not_readable_without_scope(client, db, w):
    rfq = _create(client, w["a"], w).json()
    # B's data scope for Procurement is "assigned" (their own RFQs): A's RFQ is not readable by link.
    w["b"].data_access_scopes = {"p2p": "assigned"}
    db.commit()
    assert client.get(f"{RFQS}/{rfq['id']}", headers=_h(w["b"])).status_code == 403
    assert client.get(f"{RFQS}/{rfq['id']}", headers=_h(w["a"])).status_code == 200
    assert client.get(f"{RFQS}/{rfq['id']}", headers=_h(w["head"])).status_code == 200
    ids = [x["id"] for x in client.get(RFQS, params={"p2p_request_id": w["pr_id"]}, headers=_h(w["b"])).json()]
    assert rfq["id"] not in ids
