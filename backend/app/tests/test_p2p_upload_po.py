"""Upload PO on the requisition (owner, 2026-10-30): POs are no longer created in the portal.
The buyer uploads the Tally PO (number + PDF + vendor, ship-to store and each line's price) on the
requisition's RFQ; the PO is built from the PR's own lines, priced, its PDF stored in SharePoint,
and it goes straight into PO approval (PR -> po_raised, PO -> issued)."""
import json
from datetime import date

import pytest

from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.audit_log import AuditLog
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_attachment import RFQAttachment
from app.tests.p2p_po_helpers import (
    PDF, RFQS, make_ship_to, make_vendor, post_upload_po, rfq_for_pr, sharepoint_stub, upload_po_details,
)
from app.tests.p2p_workflow_helpers import master_item, set_po_workflow
from app.tests.test_p2p_requests import (  # noqa: F401 - _sqlite_number_series is an autouse fixture
    BASE, _approve_pr, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header, make_user,
)

TWO_LINES = [{"item_name": "Bolt UPO", "quantity": 5, "unit": "pcs", "project_inhouse": "Project"},
             {"item_name": "Nut UPO", "quantity": 3, "unit": "pcs", "project_inhouse": "Project"}]


def _ready(client, db, tag, items=None, approve=True):
    """An approved requisition at RFQ stage with its locked RFQ, a buyer and the PO workflow pointed at
    the PR's PO approvers. Returns (pr, rfq, buyer)."""
    pr = _create_pr(client, _requester(db, f"upo.req.{tag}@premnathrail.com"), **({"items": [dict(i) for i in items]} if items else {}))
    if approve:
        _approve_pr(client, pr)
    buyer = _purchaser(db, f"upo.buyer.{tag}@premnathrail.com")
    set_po_workflow(db, [u.id for u in pr["_po_approvers"].values()], buyer)
    rfq = rfq_for_pr(db, pr["id"], buyer.id) if approve else None
    return pr, rfq, buyer


def _upload(client, db, buyer, rfq, pr, tally="TALLY-UPO-1", **kw):
    return post_upload_po(client, buyer, rfq.id, upload_po_details(db, pr["id"], **kw), tally)


# ── happy path ────────────────────────────────────────────────────────────────

def test_upload_po_makes_the_po_prices_it_and_sends_it_into_approval(client, db):
    pr, rfq, buyer = _ready(client, db, "A1", items=TWO_LINES)
    bolt, nut = pr["items"]
    ship = make_ship_to(db)
    r = _upload(client, db, buyer, rfq, pr, tally="PO/0042/26-27", prices={bolt["id"]: 12.5, nut["id"]: 40},
                tax_rate=18, ship_to=ship, expected_delivery=date.today().isoformat(), delivery_terms="30 days credit")
    assert r.status_code == 200, r.text
    po = r.json()
    assert po["status"] == "issued" and po["external_ref"] == "PO/0042/26-27"
    assert po["ship_to_location_id"] == ship.id and po["delivery_terms"] == "30 days credit"
    assert po["vendor_id"] == make_vendor(db).id and po["document_filename"].endswith("tally.pdf")
    by_line = {i["pr_item_id"]: i for i in po["items"]}
    assert by_line[bolt["id"]]["unit_price"] == 12.5 and by_line[bolt["id"]]["quantity"] == 5
    assert by_line[nut["id"]]["unit_price"] == 40 and by_line[nut["id"]]["tax_rate"] == 18
    assert all(i["store_item_id"] for i in po["items"])  # lines carry the Item Master id, never a name
    assert po["total_value"] == pytest.approx((5 * 12.5 + 3 * 40) * 1.18)
    db.expire_all()
    row = db.get(P2PRequest, pr["id"])
    assert row.status == "po_raised" and row.po_number == po["po_number"] and row.po_value == pytest.approx(po["total_value"])
    # The history keeps this copy of the PDF, opened from the timeline.
    log = db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr["id"], action="po_document_uploaded").one()
    assert log.attachment_url and log.attachment_url.endswith("tally.pdf") and "PO/0042/26-27" in log.summary
    assert db.get(P2PPurchaseOrder, po["id"]).document_sharepoint_path == log.attachment_url
    trail = client.get(f"{BASE}/{pr['id']}/audit", headers=auth_header(buyer)).json()
    entry = next(e for e in trail if e["action"] == "po_document_uploaded")
    assert entry["id"] == log.id and entry["document_name"].endswith("tally.pdf")
    assert all(e["document_name"] is None for e in trail if e["action"] != "po_document_uploaded")
    with sharepoint_stub():
        doc = client.get(f"{BASE}/{pr['id']}/audit/{log.id}/document", headers=auth_header(buyer))
    assert doc.status_code == 200, doc.text
    assert doc.content == PDF and doc.headers["content-type"] == "application/pdf"


def test_delivery_terms_default_to_the_rfq_payment_terms(client, db):
    pr, rfq, buyer = _ready(client, db, "A2")
    rfq.payment_terms = "Net 45 days"
    db.commit()
    r = _upload(client, db, buyer, rfq, pr)
    assert r.status_code == 200, r.text
    assert r.json()["delivery_terms"] == "Net 45 days"


def test_upload_po_reads_its_lines_back(client, db):
    """Regression: the route reads the new PO's lines right after building it; the app session has
    autoflush off, so build_po_draft must flush them or every upload answers 'not open lines'."""
    pr, rfq, buyer = _ready(client, db, "A3")
    r = _upload(client, db, buyer, rfq, pr)
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == 1


# ── validation ────────────────────────────────────────────────────────────────

def test_a_line_without_a_price_is_refused_with_the_item_name_and_the_stored_pdf_is_removed(client, db):
    pr, rfq, buyer = _ready(client, db, "B1", items=TWO_LINES)
    details = upload_po_details(db, pr["id"])
    details["lines"] = details["lines"][:1]  # Nut has no price
    r = post_upload_po(client, buyer, rfq.id, details, "TALLY-B1")
    assert r.status_code == 422, r.text
    assert "Nut UPO" in r.json()["detail"] and "unit price" in r.json()["detail"]
    calls = post_upload_po.calls
    # The PDF went to SharePoint before the lock, so the failure removes it again (nothing points at it).
    assert len(calls.uploaded) == 1 and calls.deleted == calls.uploaded
    db.expire_all()
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).count() == 0
    assert db.get(P2PRequest, pr["id"]).status == "vendor_quotations"
    assert db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr["id"], action="po_document_uploaded").count() == 0


def test_zero_price_unknown_line_and_bad_details_are_422(client, db):
    pr, rfq, buyer = _ready(client, db, "B2")
    line = pr["items"][0]
    zero = post_upload_po(client, buyer, rfq.id, upload_po_details(db, pr["id"], prices={line["id"]: 0}), "TALLY-B2")
    assert zero.status_code == 422 and "unit_price" in zero.json()["detail"] and "incomplete" in zero.json()["detail"]
    stray = upload_po_details(db, pr["id"])
    stray["lines"] = [{"pr_item_id": line["id"] + 999, "unit_price": 5}]
    r = post_upload_po(client, buyer, rfq.id, stray, "TALLY-B2")
    assert r.status_code == 422 and "not open lines" in r.json()["detail"]
    with sharepoint_stub():
        r = client.post(f"{RFQS}/{rfq.id}/upload-po", data={"tally_po_no": "TALLY-B2", "details": "{not json"},
                        files={"file": ("t.pdf", PDF, "application/pdf")}, headers=auth_header(buyer))
    assert r.status_code == 422 and "details are incomplete" in r.json()["detail"]
    noship = upload_po_details(db, pr["id"])
    noship["ship_to_location_id"] = 999999
    r = post_upload_po(client, buyer, rfq.id, noship, "TALLY-B2")
    assert r.status_code == 422 and "store" in r.json()["detail"]
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).count() == 0


def test_a_file_that_is_not_a_pdf_is_415(client, db):
    pr, rfq, buyer = _ready(client, db, "C1")
    details = upload_po_details(db, pr["id"])
    r = post_upload_po(client, buyer, rfq.id, details, "TALLY-C1", name="po.docx", ctype="application/msword")
    assert r.status_code == 415 and "PDF" in r.json()["detail"]
    r = post_upload_po(client, buyer, rfq.id, details, "TALLY-C1", body=b"not a pdf")
    assert r.status_code == 415 and "isn't a real PDF" in r.json()["detail"]
    r = post_upload_po(client, buyer, rfq.id, details, "   ")
    assert r.status_code == 422 and "Tally PO number" in r.json()["detail"]
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).count() == 0


def test_a_tally_number_already_on_a_live_po_is_409(client, db):
    pr1, rfq1, buyer = _ready(client, db, "D1")
    assert _upload(client, db, buyer, rfq1, pr1, tally="PO/DUP/1").status_code == 200
    pr2, rfq2, _b = _ready(client, db, "D2")
    r = _upload(client, db, buyer, rfq2, pr2, tally="po/dup/1")
    assert r.status_code == 409 and "already on" in r.json()["detail"]
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr2["id"]).count() == 0


def test_the_requisition_must_be_at_rfq_stage_and_have_no_po_yet(client, db):
    # Not approved yet: still 'submitted'.
    pr, _rfq, buyer = _ready(client, db, "E1", approve=False)
    rfq = RFQ(rfq_number="RFQ-UPO-E1", p2p_request_id=pr["id"], status="locked")
    db.add(rfq)
    db.commit()
    r = _upload(client, db, buyer, rfq, pr)
    assert r.status_code == 409 and "RFQ stage" in r.json()["detail"] and "submitted" in r.json()["detail"]
    # One PO per requisition: a second upload says where the PO is.
    pr2, rfq2, buyer2 = _ready(client, db, "E2")
    assert _upload(client, db, buyer2, rfq2, pr2, tally="TALLY-E2-A").status_code == 200
    again = _upload(client, db, buyer2, rfq2, pr2, tally="TALLY-E2-B")
    assert again.status_code == 409 and "already has PO" in again.json()["detail"] and "amendment" in again.json()["detail"]


def test_with_nobody_to_approve_the_po_nothing_is_stored(client, db):
    pr, rfq, buyer = _ready(client, db, "E3")
    gone = make_user(db, "upo.gone.approver@premnathrail.com")
    set_po_workflow(db, [gone.id], buyer)
    gone.is_active = False  # the only named approver has left
    db.commit()
    r = _upload(client, db, buyer, rfq, pr)
    assert r.status_code == 422 and "PO approvers" in r.json()["detail"], r.text
    db.expire_all()
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).count() == 0
    assert db.get(P2PRequest, pr["id"]).status == "vendor_quotations"
    assert len(post_upload_po.calls.deleted) == 1


# ── vendor ────────────────────────────────────────────────────────────────────

def test_vendor_id_names_the_vendor_when_the_rfq_has_no_quotes(client, db):
    pr, rfq, buyer = _ready(client, db, "F1")
    vendor = Vendor(code="V-UPO-1", name="Emailed Seals", status="active", gst_registration_type="unregistered")
    db.add(vendor)
    db.commit()
    r = _upload(client, db, buyer, rfq, pr, vendor=vendor)
    assert r.status_code == 200, r.text
    assert r.json()["vendor_id"] == vendor.id and r.json()["vendor_name"] == "Emailed Seals"


def test_no_vendor_or_an_inactive_vendor_is_refused(client, db):
    pr, rfq, buyer = _ready(client, db, "F2")
    details = upload_po_details(db, pr["id"])
    details.pop("vendor_id")
    r = post_upload_po(client, buyer, rfq.id, details, "TALLY-F2")
    assert r.status_code == 400 and "vendor name is required" in r.json()["detail"]
    blocked = Vendor(code="V-UPO-2", name="Blocked Seals", status="blocked", gst_registration_type="unregistered")
    db.add(blocked)
    db.commit()
    r = post_upload_po(client, buyer, rfq.id, upload_po_details(db, pr["id"], vendor=blocked), "TALLY-F2")
    assert r.status_code == 400 and "blocked" in r.json()["detail"]
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).count() == 0


def test_vendor_id_is_refused_when_the_rfq_has_quotes_and_the_quoted_vendor_gets_the_po(client, db):
    pr, rfq, buyer = _ready(client, db, "F3")
    quoted = Vendor(code="V-UPO-3", name="Quoted Seals", status="active", gst_registration_type="unregistered")
    db.add(quoted)
    db.flush()
    db.add(RFQAttachment(rfq_id=rfq.id, vendor_tier="L1", vendor_name=quoted.name, vendor_id=quoted.id, filename="L1.pdf",
                         sharepoint_path="x/L1.pdf", created_by_id=buyer.id))
    db.commit()
    r = _upload(client, db, buyer, rfq, pr)  # the payload names the master vendor
    assert r.status_code == 422 and "has vendor quotes" in r.json()["detail"]
    details = upload_po_details(db, pr["id"])
    details.pop("vendor_id")
    ok = post_upload_po(client, buyer, rfq.id, details, "TALLY-F3")
    assert ok.status_code == 200, ok.text
    assert ok.json()["vendor_id"] == quoted.id and ok.json()["vendor_name"] == "Quoted Seals"


# ── permissions and scope ─────────────────────────────────────────────────────

def _custom_buyer(db, email, grants):
    u = make_user(db, email, assigned_apps=("purchase",))
    u.granular_permissions = list(grants)
    db.commit()
    return u


def test_upload_needs_purchase_orders_create_submit_and_the_po_document_feature(client, db):
    pr, rfq, _buyer = _ready(client, db, "G1")
    details = upload_po_details(db, pr["id"])
    view_only = _custom_buyer(db, "upo.viewonly@premnathrail.com", ["p2p:rfq:view", "p2p:purchase_orders:view"])
    r = post_upload_po(client, view_only, rfq.id, details, "TALLY-G1")
    assert r.status_code == 403
    no_submit = _custom_buyer(db, "upo.nosubmit@premnathrail.com",
                              ["p2p:rfq:view", "p2p:purchase_orders:view", "p2p:purchase_orders:create"])
    assert post_upload_po(client, no_submit, rfq.id, details, "TALLY-G1").status_code == 403
    no_doc = _custom_buyer(db, "upo.nodoc@premnathrail.com", [
        "p2p:rfq:view", "p2p:purchase_orders:view", "p2p:purchase_orders:create", "p2p:purchase_orders:submit",
        "p2p:purchase_orders.po_document:view"])
    assert post_upload_po(client, no_doc, rfq.id, details, "TALLY-G1").status_code == 403
    outsider = make_user(db, "upo.outsider@premnathrail.com", assigned_apps=("hr",))
    assert post_upload_po(client, outsider, rfq.id, details, "TALLY-G1").status_code == 403
    requester = _requester(db, "upo.req.other@premnathrail.com")
    assert post_upload_po(client, requester, rfq.id, details, "TALLY-G1").status_code == 403
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).count() == 0
    assert db.get(P2PRequest, pr["id"]).status == "vendor_quotations"


def test_unknown_rfq_is_404(client, db):
    pr, _rfq, buyer = _ready(client, db, "G2")
    r = post_upload_po(client, buyer, 987654, upload_po_details(db, pr["id"]), "TALLY-G2")
    assert r.status_code == 404


def test_the_po_document_on_the_history_is_for_those_who_may_see_the_prices(client, db):
    pr, rfq, buyer = _ready(client, db, "H1")
    assert _upload(client, db, buyer, rfq, pr).status_code == 200
    log = db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr["id"], action="po_document_uploaded").one()
    url = f"{BASE}/{pr['id']}/audit/{log.id}/document"
    requester = db.get(P2PRequest, pr["id"]).requested_by_id
    from app.modules.main.models.user import User
    with sharepoint_stub():
        # The requester sees the requisition, not the vendor's prices.
        r = client.get(url, headers=auth_header(db.get(User, requester)))
        assert r.status_code == 403 and "prices" in r.json()["detail"]
        # Another requester can't even open the requisition (data scope).
        other = _requester(db, "upo.req.nosy@premnathrail.com")
        assert client.get(url, headers=auth_header(other)).status_code == 403
        # A PO approver can.
        approver = next(iter(pr["_po_approvers"].values()))
        assert client.get(url, headers=auth_header(approver)).status_code == 200
        # A log entry of another requisition is not found.
        other_pr, other_rfq, other_buyer = _ready(client, db, "H2")
        assert client.get(f"{BASE}/{other_pr['id']}/audit/{log.id}/document", headers=auth_header(other_buyer)).status_code == 404


# ── RFQ list for the requisition ──────────────────────────────────────────────

def test_the_rfq_list_for_a_requisition_includes_its_before_po_rfq_but_the_plain_list_hides_it(client, db):
    pr, rfq, buyer = _ready(client, db, "I1")
    rfq.source = "before_po"
    db.commit()
    plain = client.get(RFQS, headers=auth_header(buyer))
    assert plain.status_code == 200 and rfq.id not in [x["id"] for x in plain.json()]
    mine = client.get(RFQS, params={"p2p_request_id": pr["id"]}, headers=auth_header(buyer))
    assert mine.status_code == 200 and [x["id"] for x in mine.json()] == [rfq.id]
    outsider = make_user(db, "upo.rfq.outsider@premnathrail.com", assigned_apps=("hr",))
    assert client.get(RFQS, params={"p2p_request_id": pr["id"]}, headers=auth_header(outsider)).status_code == 403


# ── Before-PO receipt ─────────────────────────────────────────────────────────

def test_upload_on_a_before_po_requisition_links_the_receipt(client, db):
    from app.modules.store.models.pre_po_receipt import StorePrePoReceipt
    from app.tests.test_pre_po_receipts import PROC, STORE, _body, _store_user, _vendor

    keeper = _store_user(db, "upo.keeper@premnathrail.com")
    v, item = _vendor(db, "V-UPO-BPO"), master_item(db, "Washer UPO", code="UPO-W1", uom="Nos")
    rec = client.post(STORE, json=_body(v, item, 4), headers=auth_header(keeper)).json()
    buyer = _purchaser(db, "upo.bpo.buyer@premnathrail.com")
    set_po_workflow(db, [make_user(db, "upo.bpo.approver@premnathrail.com").id], buyer)
    rfq = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=auth_header(buyer)).json()["rfq"]
    row = db.get(StorePrePoReceipt, rec["id"])
    assert row.status == "pending_po" and row.p2p_request_id and row.purchase_order_id is None
    # The requisition's own page finds its hidden RFQ and uploads the Tally PO on it.
    assert [x["id"] for x in client.get(RFQS, params={"p2p_request_id": row.p2p_request_id}, headers=auth_header(buyer)).json()] == [rfq["id"]]
    details = upload_po_details(db, row.p2p_request_id, unit_price=30, tax_rate=None)
    details.pop("vendor_id")  # the receipt's vendor is the RFQ's one quote
    r = post_upload_po(client, buyer, rfq["id"], details, "TALLY-UPO-BPO")
    assert r.status_code == 200, r.text
    po = r.json()
    assert po["vendor_id"] == v.id and [(i["store_item_id"], i["quantity"], i["unit_price"]) for i in po["items"]] == [(item.id, 4, 30)]
    db.expire_all()
    row = db.get(StorePrePoReceipt, rec["id"])
    assert row.status == "po_created" and row.purchase_order_id == po["id"]
    assert json.loads(json.dumps(client.get(f"{PROC}/by-po/{po['id']}", headers=auth_header(buyer)).json()))["id"] == rec["id"]


# ── the old ways of making a PO are gone ──────────────────────────────────────

def test_the_portal_no_longer_creates_pos_the_old_routes_are_gone(client, db):
    pr, rfq, buyer = _ready(client, db, "J1")
    h = auth_header(buyer)
    assert client.post(f"{RFQS}/{rfq.id}/po-draft", json={"vendor_name": "Any"}, headers=h).status_code in (404, 405)
    assert client.post(f"{RFQS}/{rfq.id}/split-pos", json={"pos": []}, headers=h).status_code in (404, 405)
    assert client.post(f"{BASE}/{pr['id']}/create-po", json={"po_number": "PO-X"}, headers=h).status_code in (404, 405)
    assert client.post("/api/v1/p2p/pre-po-receipts/1/create-po", headers=h).status_code in (404, 405)
    assert db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).count() == 0
