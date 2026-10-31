"""Test helpers: make a PO the supported way.

Since 2026-10-30 a PO is not created in the portal: the buyer uploads the Tally PO
(number + PDF) on the requisition (POST /api/v1/p2p/rfqs/{rfq_id}/upload-po), which builds
the PO from the PR lines, prices it and sends it into PO approval. Tests that only need a
PO as set-up call `upload_po_for_pr`, which goes through that same route with SharePoint
stubbed."""
import contextlib
import json
import types
from contextlib import contextmanager
from unittest import mock

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.modules.accounts.models.vendor import Vendor
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_item import RFQItem
from app.modules.p2p.routes import p2p_requests as pr_routes
from app.modules.p2p.routes import rfq as rfq_routes
from app.modules.store.models.location import StoreLocation

PDF = b"%PDF-1.4\n%test\n"
RFQS = "/api/v1/p2p/rfqs"
PR_BASE = "/api/v1/p2p/requests"


def _bearer(user) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@contextmanager
def sharepoint_stub():
    """SharePoint upload, download and delete answered in memory (a download returns the PDF
    test bytes). Yields an object whose `.uploaded` / `.deleted` list the paths touched."""
    calls = types.SimpleNamespace(uploaded=[], deleted=[])

    async def _up(_site, folder, file):
        path = f"{folder}/{file.filename}"
        calls.uploaded.append(path)
        return {"name": file.filename, "size": 10, "path": path, "webUrl": None}

    async def _del(_site, path):
        calls.deleted.append(path)

    async def _down(_site, _path):
        return PDF, "application/pdf"

    patches = [
        mock.patch.object(rfq_routes, "upload_file_to_sharepoint", _up),
        mock.patch.object(rfq_routes, "delete_file_from_sharepoint", _del),
        mock.patch.object(pr_routes, "download_file_content", _down),
        mock.patch.object(rfq_routes, "download_file_content", _down),
        mock.patch.object(settings, "SHAREPOINT_SITE_ID", "site"),
    ]
    with contextlib.ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        yield calls


def make_vendor(db, code="TST-VEND"):
    """An active vendor-master row for the PO (get-or-create)."""
    v = db.query(Vendor).filter(Vendor.code == code).first()
    if v is None:
        v = Vendor(code=code, name=f"Test vendor {code}", status="active", gst_registration_type="unregistered")
        db.add(v)
        db.commit()
    return v


def make_ship_to(db, code="TEST-SHIP"):
    """An active receiving store for the PO's ship-to (get-or-create)."""
    loc = db.query(StoreLocation).filter(StoreLocation.code == code).first()
    if loc is None:
        loc = StoreLocation(name="Test receiving store", code=code, address="Test plant gate")
        db.add(loc)
        db.commit()
    return loc


def rfq_for_pr(db, pr_id, buyer_id=None):
    """The (locked) RFQ the PO is uploaded on: the PR's own RFQ, or a fresh locked one. The
    PR moves to 'vendor_quotations', the stage Upload PO needs."""
    pr = db.get(P2PRequest, pr_id)
    if pr.status == "approved":
        for it in pr.items:
            if it.fulfillment_status in (None, "pending"):
                it.fulfillment_status = "sent_to_procurement"
        pr.status = "vendor_quotations"
    rfq = db.query(RFQ).filter(RFQ.p2p_request_id == pr_id).order_by(RFQ.id).first()
    if rfq is None:
        rfq = RFQ(rfq_number=f"RFQ-UPO-{pr_id}", p2p_request_id=pr_id, status="locked", created_by_id=buyer_id, buyer_id=buyer_id)
        db.add(rfq)
        db.flush()
    # An RFQ carries its lines (multi-buyer split): every open buy line of the PR at its open quantity,
    # bought by the RFQ's buyer.
    have = {i.pr_item_id for i in db.query(RFQItem).filter(RFQItem.rfq_id == rfq.id).all()}
    for it in pr.items:
        if it.fulfillment_status == "stock_issued" or (it.quantity or 0) - (it.issued_qty or 0) <= 0:
            continue
        if it.buyer_id is None and not pr.assigned_buyer_id:
            it.buyer_id = rfq.buyer_id or buyer_id
        if it.id not in have:
            db.add(RFQItem(rfq_id=rfq.id, pr_item_id=it.id, store_item_id=it.store_item_id,
                           quantity=(it.quantity or 0) - (it.issued_qty or 0)))
    db.commit()
    db.refresh(rfq)
    return rfq


def open_pr_lines(db, pr_id):
    """The PR lines still to be ordered (not issued from stock)."""
    pr = db.get(P2PRequest, pr_id)
    return [i for i in pr.items if i.fulfillment_status != "stock_issued" and (i.quantity or 0) - (i.issued_qty or 0) > 0]


def upload_po_details(db, pr_id, *, prices=None, unit_price=100, tax_rate=18, ship_to=None, vendor=None, **extra):
    """The `details` payload of Upload PO: every open PR line priced (`prices` maps pr_item_id
    to a unit price; the rest get `unit_price`)."""
    prices = prices or {}
    ship_to = ship_to or make_ship_to(db)
    vendor = vendor or make_vendor(db)
    body = {
        "vendor_id": vendor.id, "ship_to_location_id": ship_to.id,
        "lines": [{"pr_item_id": i.id, "unit_price": prices.get(i.id, unit_price), "tax_rate": tax_rate}
                  for i in open_pr_lines(db, pr_id)],
    }
    body.update(extra)
    return body


def post_upload_po(client, buyer, rfq_id, details, tally_po_no, *, body=PDF, name="tally.pdf", ctype="application/pdf"):
    """POST Upload PO as the UI does (multipart: Tally number, details JSON, PDF). SharePoint is
    stubbed for the call; the files it saw are on `post_upload_po.calls` (.uploaded / .deleted)."""
    with sharepoint_stub() as calls:
        post_upload_po.calls = calls
        return client.post(
            f"{RFQS}/{rfq_id}/upload-po", data={"tally_po_no": tally_po_no, "details": json.dumps(details)},
            files={"file": (name, body, ctype)}, headers=_bearer(buyer))


def upload_po_for_pr(client, db, pr_id, buyer, tally_po_no="TALLY-PO-1", **detail_kw):
    """Upload the Tally PO on an approved requisition and return the new PO (response JSON).
    The PO goes into approval: PO -> issued, PR -> po_raised."""
    rfq = rfq_for_pr(db, pr_id, buyer.id)
    r = post_upload_po(client, buyer, rfq.id, upload_po_details(db, pr_id, **detail_kw), tally_po_no)
    assert r.status_code == 200, r.text
    return r.json()
