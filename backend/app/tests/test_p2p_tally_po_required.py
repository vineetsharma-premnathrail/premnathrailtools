"""Owner, 2026-10-27: a PO is created in the portal, its Tally PO (number +
PDF) is uploaded on the draft and is mandatory before Send for approval; the
separate bulk 'Upload Tally POs' option is gone. Also the PR form's per-plant
stock lookup."""
from datetime import date

from app.core.config import settings
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.routes import rfq as rfq_routes
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_requests import _requester, auth_header, make_user  # noqa: F401
from app.tests.test_po_draft_quantity import RFQS, _draft, _patch
from app.tests.test_p2p_requests import _sqlite_number_series  # noqa: F401 - autouse fixture

PDF = b"%PDF-1.4\n%test\n"


def _fake_sharepoint(monkeypatch):
    async def up(_site, folder, file):
        return {"name": file.filename, "size": 10, "path": f"{folder}/{file.filename}", "webUrl": None}
    monkeypatch.setattr(rfq_routes, "upload_file_to_sharepoint", up)
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site")


def _upload(client, buyer, rfq, po, ref="PO/0042/26-27", body=PDF, name="tally.pdf", ctype="application/pdf"):
    return client.post(f"{RFQS}/{rfq.id}/po-draft/{po['id']}/document", data={"tally_po_no": ref},
                       files={"file": (name, body, ctype)}, headers=auth_header(buyer))


def _priced(client, buyer, rfq, po):
    assert _patch(client, buyer, rfq, po, [{"id": po["items"][0]["id"], "unit_price": 5}]).status_code == 200


def test_submit_needs_the_tally_po(client, db, monkeypatch):
    _fake_sharepoint(monkeypatch)
    buyer, rfq, po, _pr = _draft(client, db, "T1")
    _priced(client, buyer, rfq, po)
    partner = make_user(db, "tally.partner.t1@premnathrail.com", assigned_apps=("purchase",))
    partner.is_partner = True
    db.commit()
    r = client.post(f"{RFQS}/{rfq.id}/po-draft/{po['id']}/submit", headers=auth_header(buyer))
    assert r.status_code == 400 and "Tally PO" in r.json()["detail"]
    up = _upload(client, buyer, rfq, po)
    assert up.status_code == 200, up.text
    assert up.json()["external_ref"] == "PO/0042/26-27" and up.json()["document_filename"] == "tally.pdf"
    # A wrong file can be replaced while the PO is still a draft.
    assert _upload(client, buyer, rfq, po, ref="PO/0043/26-27", name="fixed.pdf").status_code == 200
    r = client.post(f"{RFQS}/{rfq.id}/po-draft/{po['id']}/submit", headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    # Locked once it is in approval.
    again = _upload(client, buyer, rfq, po, ref="PO/0044/26-27")
    assert again.status_code == 409 and "no longer a draft" in again.json()["detail"]
    assert db.get(P2PPurchaseOrder, po["id"]).external_ref == "PO/0043/26-27"


def test_upload_checks_number_pdf_and_duplicates(client, db, monkeypatch):
    _fake_sharepoint(monkeypatch)
    buyer, rfq, po, _pr = _draft(client, db, "T2")
    assert _upload(client, buyer, rfq, po, ref="  ").status_code == 422
    r = _upload(client, buyer, rfq, po, name="po.docx", ctype="application/msword")
    assert r.status_code == 415 and "PDF" in r.json()["detail"]
    r = _upload(client, buyer, rfq, po, body=b"not a pdf")
    assert r.status_code == 415 and "isn't a real PDF" in r.json()["detail"]
    other = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id != po["id"]).first() or P2PPurchaseOrder(
        po_number="PO-OTHER-T2", status="issued", po_date=date.today())
    other.external_ref = "PO/DUP/1"
    db.add(other)
    db.commit()
    r = _upload(client, buyer, rfq, po, ref="po/dup/1")
    assert r.status_code == 409 and other.po_number in r.json()["detail"]


def test_bulk_tally_upload_is_gone(client, db):
    buyer, _rfq, _po, _pr = _draft(client, db, "T3")
    assert client.post("/api/v1/p2p/tally-po-import/preview", headers=auth_header(buyer)).status_code in (404, 405)
    assert client.post("/api/v1/p2p/tally-po-import/commit", headers=auth_header(buyer)).status_code in (404, 405)
    assert client.get("/api/v1/p2p/tally-po-import/template", headers=auth_header(buyer)).status_code in (404, 405, 422)


def test_pr_stock_availability_per_plant(client, db):
    req = _requester(db, "stock.req.t4@premnathrail.com")
    a = master_item(db, "Stock item A", code="SA-T4")
    b = master_item(db, "Stock item B", code="SB-T4")
    loc = StoreLocation(name="Main store T4", code="MS-T4")
    db.add(loc)
    db.flush()
    db.add(StoreStockBalance(item_id=a.id, location_id=loc.id, on_hand_qty=12, reserved_qty=2))
    db.commit()
    r = client.get("/api/v1/p2p/requests/stock-availability", params={"item_ids": f"{a.id},{b.id}"}, headers=auth_header(req))
    assert r.status_code == 200, r.text
    by_id = {x["store_item_id"]: x for x in r.json()}
    assert by_id[a.id]["available_qty"] == 10 and by_id[a.id]["locations"][0]["store"] == "Main store T4"
    assert by_id[b.id]["available_qty"] == 0 and by_id[b.id]["locations"] == []
    assert client.get("/api/v1/p2p/requests/stock-availability", params={"item_ids": "x"}, headers=auth_header(req)).status_code == 422
    outsider = make_user(db, "stock.out.t4@premnathrail.com", assigned_apps=("hr",))
    assert client.get("/api/v1/p2p/requests/stock-availability", params={"item_ids": str(a.id)}, headers=auth_header(outsider)).status_code == 403
