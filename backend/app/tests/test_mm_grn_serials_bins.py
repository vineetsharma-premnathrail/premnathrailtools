"""MM: GRN gate entry + vendor documents (invoice no. unique per vendor,
blind receipt invoice qty vs received), serial numbers (IQ01) from GRN to
issue / return / RTV with history, WM bin stock (putaway, pick, bin move,
bin-wise count), MB51 filters/paging/export and the PO open-items / history
reports (ME2N / ME23N) — 2026-10-14."""
from datetime import date, timedelta

import pytest

from app.modules.store.models.bin import StoreBin
from app.modules.store.models.serial_number import StoreSerialEvent, StoreSerialNumber
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_item_master_link import _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _approve_and_raise_po, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header,
)
from app.tests.test_quality_phase1 import make_user

GRN = "/api/v1/p2p/goods-receipts"
ISSUES = "/api/v1/store/material-issues"
SERIALS = "/api/v1/store/serials"
BINSTOCK = "/api/v1/store/bin-stock"
MOVES = "/api/v1/store/stock/transactions"
POREP = "/api/v1/p2p/po-reports"
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    import app.middleware.owasp as owasp
    monkeypatch.setitem(owasp.RATE_CONFIG["write"], "limit", 100000)


def _po(client, db, tag, qty=3, serial=False):
    item = master_item(db, f"Hydraulic pump {tag}", code=f"BO-PMP-{tag}")
    item.serial_controlled = serial
    db.commit()
    loc = _store(db, f"S{tag}")
    pr = _create_pr(client, _requester(db, f"req.s{tag.lower()}@premnathrail.com"),
                    items=[{"store_item_id": item.id, "quantity": qty, "project_inhouse": "Project"}])
    buyer = _purchaser(db, f"buyer.s{tag.lower()}@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    return item, loc, buyer, _po_for(client, buyer, pr["id"])


def _bin(db, loc, code):
    b = StoreBin(location_id=loc.id, bin_type="bin", code=code)
    db.add(b)
    db.commit()
    return b


def _grn(client, buyer, po, loc, qty, **line):
    header = {k: line.pop(k) for k in list(line) if k.startswith(("vendor_", "delivery_", "gate_", "eway", "vehicle", "transporter", "lr_"))}
    return client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id, **header, "items": [
        {"po_item_id": po["items"][0]["id"], "received_quantity": qty, **line}]}, headers=auth_header(buyer))


def _inspect(client, buyer, grn, accepted, rejected=0, **extra):
    line = grn["items"][0]
    status = "passed" if not rejected else "failed" if not accepted else "partial"
    return client.post(f"{GRN}/{grn['id']}/inspect", json={"items": [
        {"item_id": line["id"], "accepted_quantity": accepted, "rejected_quantity": rejected, "quality_status": status, **extra}]},
        headers=auth_header(buyer))


def test_grn_documents_gate_entry_blind_receipt_and_duplicate_invoice(client, db):
    item, loc, buyer, po = _po(client, db, "D1", qty=10)
    r = _grn(client, buyer, po, loc, 4, vendor_invoice_number="INV/77")
    assert r.status_code == 422 and "invoice date" in r.json()["detail"]
    r = _grn(client, buyer, po, loc, 4, eway_bill_number="123")
    assert r.status_code == 422 and "12 digits" in r.json()["detail"]
    r = _grn(client, buyer, po, loc, 4, invoice_quantity=5, vendor_invoice_number="INV/77", vendor_invoice_date=YESTERDAY,
             delivery_challan_number="DC-9", delivery_challan_date=YESTERDAY, eway_bill_number="1234 5678 9012",
             vehicle_number="mh 12 ab 1234", transporter_name="VRL", lr_number="LR-55")
    assert r.status_code == 200, r.text
    g = r.json()
    assert g["gate_entry_number"].startswith("GE-") and g["gate_entry_at"]
    assert (g["vehicle_number"], g["eway_bill_number"], g["vendor_invoice_number"]) == ("MH12AB1234", "123456789012", "INV/77")
    line = g["items"][0]
    assert (line["invoice_quantity"], line["received_quantity"], line["receipt_variance"]) == (5, 4, -1)
    # Same vendor bill again (spacing / case ignored) → refused.
    r = _grn(client, buyer, po, loc, 2, vendor_invoice_number="inv/ 77", vendor_invoice_date=YESTERDAY)
    assert r.status_code == 409 and g["grn_number"] in r.json()["detail"]


def test_serials_from_grn_through_inspection_issue_return_with_history(client, db):
    item, loc, buyer, po = _po(client, db, "S1", qty=3, serial=True)
    r = _grn(client, buyer, po, loc, 3)
    assert r.status_code == 422 and "serial" in r.json()["detail"]
    r = _grn(client, buyer, po, loc, 3, serials=["P-1", "P-2"])
    assert r.status_code == 422 and "exactly one per unit" in r.json()["detail"]
    r = _grn(client, buyer, po, loc, 3, serials=["P-1", "p-1", "P-3"])
    assert r.status_code == 422 and "twice" in r.json()["detail"]
    r = _grn(client, buyer, po, loc, 3, serials=["p-1", "P-2", "P-3"])
    assert r.status_code == 200, r.text
    grn = r.json()
    assert grn["items"][0]["serial_numbers"] == ["P-1", "P-2", "P-3"]
    assert {u.status for u in db.query(StoreSerialNumber).filter_by(item_id=item.id)} == {"quality"}

    # Partly rejected: the rejected unit must be named.
    r = _inspect(client, buyer, grn, 2, 1)
    assert r.status_code == 422 and "name the rejected" in r.json()["detail"]
    r = _inspect(client, buyer, grn, 2, 1, rejected_serials=["P-3"])
    assert r.status_code == 200, r.text
    db.expire_all()
    st = {u.serial_no: u.status for u in db.query(StoreSerialNumber).filter_by(item_id=item.id)}
    assert st == {"P-1": "in_stock", "P-2": "in_stock", "P-3": "blocked"}

    keeper = make_user(db, "keeper.s1@x.com", apps=("store",))
    avail = client.get(f"{SERIALS}/available", params={"item_id": item.id, "location_id": loc.id}, headers=auth_header(keeper)).json()
    assert [a["serial_no"] for a in avail] == ["P-1", "P-2"]
    # Issue: the blocked unit can't go; serials are required.
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "production", "project_or_work_order": "WO-9",
                                  "items": [{"item_id": item.id, "quantity": 1}]}, headers=auth_header(keeper))
    assert r.status_code == 422 and "serial" in r.json()["detail"]
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "production", "project_or_work_order": "WO-9",
                                  "items": [{"item_id": item.id, "quantity": 1, "serials": ["P-3"]}]}, headers=auth_header(keeper))
    assert r.status_code == 422 and "blocked" in r.json()["detail"]
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "production", "project_or_work_order": "WO-9",
                                  "items": [{"item_id": item.id, "quantity": 1, "serials": ["P-2"]}]}, headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    issue = r.json()
    assert issue["items"][0]["serial_numbers"] == ["P-2"]
    p2 = db.query(StoreSerialNumber).filter_by(item_id=item.id, serial_no="P-2").one()
    db.refresh(p2)
    assert p2.status == "issued" and "WO-9" in (p2.issued_to or "")

    detail = client.get(f"{SERIALS}/{p2.id}", headers=auth_header(keeper)).json()
    assert [h["event"] for h in detail["history"]] == ["received", "inspection_accepted", "issued"]
    assert detail["grn_number"] == grn["grn_number"] and detail["issue_number"] == issue["issue_number"]

    listed = client.get(SERIALS, params={"status": "in_stock", "item_id": item.id}, headers=auth_header(keeper))
    assert listed.headers["X-Total-Count"] == "1" and listed.json()[0]["serial_no"] == "P-1"

    # A duplicate serial on a new GRN is refused while the unit is in the books.
    from app.modules.store.services.serials import SerialError, check_new_for_grn
    with pytest.raises(SerialError):
        check_new_for_grn(db, item, 1, ["P-1"])


def test_serial_return_to_vendor_and_grn_reversal(client, db):
    item, loc, buyer, po = _po(client, db, "S2", qty=2, serial=True)
    grn = _grn(client, buyer, po, loc, 2, serials=["G-1", "G-2"]).json()
    assert _inspect(client, buyer, grn, 1, 1, rejected_serials=["G-2"]).status_code == 200
    r = client.post("/api/v1/p2p/vendor-returns", json={"goods_receipt_id": grn["id"], "reason": "quality_rejection",
                                                        "items": [{"grn_item_id": grn["items"][0]["id"], "source": "rejected", "quantity": 1}]},
                    headers=auth_header(buyer))
    assert r.status_code == 201, r.text
    db.expire_all()
    assert db.query(StoreSerialNumber).filter_by(item_id=item.id, serial_no="G-2").one().status == "returned_to_vendor"


def test_grn_reversal_cancels_serials(client, db):
    item, loc, buyer, po = _po(client, db, "S3", qty=2, serial=True)
    grn = _grn(client, buyer, po, loc, 2, serials=["R-1", "R-2"]).json()
    r = client.post(f"{GRN}/{grn['id']}/reverse", json={"reason": "entered against the wrong PO"}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert {u.status for u in db.query(StoreSerialNumber).filter_by(item_id=item.id)} == {"cancelled"}
    # Same serials can come in again on a correct GRN.
    assert _grn(client, buyer, po, loc, 2, serials=["R-1", "R-2"]).status_code == 200


def test_bin_putaway_pick_move_count_and_mb51(client, db):
    item, loc, buyer, po = _po(client, db, "B1", qty=10)
    a, b = _bin(db, loc, "A-01"), _bin(db, loc, "B-02")
    other = _store(db, "BX")
    foreign = _bin(db, other, "Z-99")
    r = _grn(client, buyer, po, loc, 10, bin_id=foreign.id)
    assert r.status_code == 422 and "another store" in r.json()["detail"]
    grn = _grn(client, buyer, po, loc, 10, bin_id=a.id, vendor_invoice_number="BIN-1", vendor_invoice_date=YESTERDAY).json()
    assert grn["items"][0]["bin_code"] == "A-01"
    assert _inspect(client, buyer, grn, 10).status_code == 200

    keeper = make_user(db, "keeper.b1@x.com", apps=("store",), is_store_manager=True)
    rows = client.get(BINSTOCK, params={"location_id": loc.id}, headers=auth_header(keeper)).json()
    assert [(r["bin_code"], r["quantity"]) for r in rows] == [("A-01", 10)]

    # Everything is in a bin → an issue without a bin is refused with where it is.
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "production", "project_or_work_order": "WO-1",
                                  "items": [{"item_id": item.id, "quantity": 2}]}, headers=auth_header(keeper))
    assert r.status_code == 422 and "A-01" in r.json()["detail"]
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "production", "project_or_work_order": "WO-1",
                                  "items": [{"item_id": item.id, "quantity": 12, "bin_id": a.id}]}, headers=auth_header(keeper))
    assert r.status_code == 422 and "holds only 10" in r.json()["detail"]
    r = client.post(ISSUES, json={"location_id": loc.id, "issue_type": "production", "project_or_work_order": "WO-1",
                                  "items": [{"item_id": item.id, "quantity": 2, "bin_id": a.id}]}, headers=auth_header(keeper))
    assert r.status_code == 200, r.text

    # Bin to bin move.
    r = client.post(f"{BINSTOCK}/moves", json={"item_id": item.id, "location_id": loc.id, "from_bin_id": a.id, "to_bin_id": b.id,
                                               "quantity": 3}, headers=auth_header(keeper))
    assert r.status_code == 201, r.text
    rows = client.get(BINSTOCK, params={"location_id": loc.id}, headers=auth_header(keeper)).json()
    assert sorted((r["bin_code"], r["quantity"]) for r in rows) == [("A-01", 5), ("B-02", 3)]

    # Bin-wise count: book = the bin's stock.
    r = client.post("/api/v1/store/physical-counts", json={"location_id": loc.id, "bin_id": b.id, "blind": False},
                    headers=auth_header(keeper))
    assert r.status_code == 201, r.text
    cnt = r.json()
    assert cnt["bin_code"] == "B-02" and cnt["items"][0]["book_quantity"] == 3

    # MB51: filters, paging header, export.
    r = client.get(MOVES, params={"item_id": item.id, "reference_number": grn["grn_number"], "limit": 1}, headers=auth_header(keeper))
    assert r.status_code == 200 and int(r.headers["X-Total-Count"]) >= 2 and len(r.json()) == 1
    r = client.get(MOVES, params={"item_id": item.id, "transaction_type": "issue,quality_in", "bin_id": a.id}, headers=auth_header(keeper))
    assert {t["transaction_type"] for t in r.json()} == {"issue", "quality_in"}
    r = client.get(MOVES, params={"date_from": date.today().isoformat(), "date_to": YESTERDAY}, headers=auth_header(keeper))
    assert r.status_code == 422
    r = client.get(f"{MOVES}/export", params={"item_id": item.id}, headers=auth_header(keeper))
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert db.query(StoreStockTransaction).filter_by(item_id=item.id, bin_id=a.id).count() >= 2


def test_po_open_items_and_history(client, db):
    item, loc, buyer, po = _po(client, db, "P1", qty=10)
    grn = _grn(client, buyer, po, loc, 4, invoice_quantity=5).json()
    assert _inspect(client, buyer, grn, 3, 1).status_code == 200
    r = client.get(f"{POREP}/open-items", params={"po_number": po["po_number"]}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    row = r.json()["rows"][0]
    assert (row["ordered_qty"], row["received_qty"], row["rejected_qty"], row["delivered_qty"], row["open_qty"]) == (10, 4, 1, 3, 7)
    assert r.json()["by_vendor"][0]["lines"] == 1
    r = client.get(f"{POREP}/open-items/export", params={"po_number": po["po_number"]}, headers=auth_header(buyer))
    assert r.status_code == 200
    h = client.get(f"{POREP}/{po['id']}/history", headers=auth_header(buyer)).json()
    ev = h["lines"][0]["events"]
    assert ev[0]["type"] == "grn" and ev[0]["document_number"] == grn["grn_number"] and ev[0]["receipt_variance"] == -1
    assert client.get(f"{POREP}/999999/history", headers=auth_header(buyer)).status_code == 404
