"""GRN reversal (SAP 102) and Return to Vendor (SAP 122), 2026-10-11.

Reversal cancels a wrongly entered GRN as a whole — stock out at the same PO
rate, no longer counted as received — and is refused once the receipt is used
downstream (invoiced, returned). Return to Vendor sends accepted goods back
(stock out at the PO rate, PO reopens for the replacement) or records the
return of rejected goods."""
from datetime import date

from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.p2p.models.goods_receipt import P2PGoodsReceiptItem
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_item_master_link import _grn, _inspect_all, _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _approve_and_raise_po, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header,
)

GRN = "/api/v1/p2p/goods-receipts"
RTV = "/api/v1/p2p/vendor-returns"


def _received(client, db, tag, qty=5):
    """PR → approved PO (100 / unit) → GRN of `qty` accepted into a store."""
    db.add(ModuleSetting(module_key="store", key="valuation_enabled", value=True))
    db.commit()
    item = master_item(db, f"Item {tag}", code=f"RM-{tag}", uom="NOS")
    loc = _store(db, tag)
    pr = _create_pr(client, _requester(db, f"req.{tag.lower()}@premnathrail.com"),
                    items=[{"store_item_id": item.id, "quantity": qty, "project_inhouse": "Project"}])
    buyer = _purchaser(db, f"buyer.{tag.lower()}@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    po = _po_for(client, buyer, pr["id"])
    grn = _grn(client, buyer, po, loc, qty)
    assert grn.status_code == 200, grn.text
    done = _inspect_all(client, buyer, grn.json())
    assert done.status_code == 200, done.text
    return item, loc, buyer, po, done.json()


def _on_hand(db, item, loc):
    db.expire_all()
    bal = db.query(StoreStockBalance).filter(StoreStockBalance.item_id == item.id, StoreStockBalance.location_id == loc.id).first()
    return bal.on_hand_qty if bal else 0


def test_reverse_grn_takes_stock_back_at_po_rate_and_reopens_the_po(client, db):
    item, loc, buyer, po, grn = _received(client, db, "REV1")
    assert _on_hand(db, item, loc) == 5

    no_reason = client.post(f"{GRN}/{grn['id']}/reverse", json={"reason": "  "}, headers=auth_header(buyer))
    assert no_reason.status_code == 422, no_reason.text

    r = client.post(f"{GRN}/{grn['id']}/reverse", json={"reason": "Entered against the wrong PO"}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "reversed" and body["reversal_reason"] == "Entered against the wrong PO" and body["reversed_by_name"]
    assert _on_hand(db, item, loc) == 0
    out = db.query(StoreStockTransaction).filter(StoreStockTransaction.reference_type == "grn_reversal").one()
    assert (out.transaction_type, out.quantity, out.unit_cost) == ("return_out", 5, 100)

    po_now = client.get(f"/api/v1/p2p/purchase-orders/{po['id']}", headers=auth_header(buyer)).json()
    assert po_now["status"] == "issued"
    again = client.post(f"{GRN}/{grn['id']}/reverse", json={"reason": "x"}, headers=auth_header(buyer))
    assert again.status_code == 409


def test_reverse_refused_once_invoiced(client, db):
    item, loc, buyer, po, grn = _received(client, db, "REV2")
    vendor = Vendor(code="V-REV2", name="Rev Vendor")
    db.add(vendor)
    db.flush()
    db.add(VendorInvoice(vendor_id=vendor.id, purchase_order_id=po["id"], invoice_number="INV-1", invoice_date=date.today(),
                         qty_invoice=5, invoice_amount=500, invoice_total=500))
    db.commit()
    r = client.post(f"{GRN}/{grn['id']}/reverse", json={"reason": "wrong"}, headers=auth_header(buyer))
    assert r.status_code == 409, r.text
    assert "Return to Vendor" in r.json()["detail"]
    assert _on_hand(db, item, loc) == 5


def test_return_accepted_goods_reduces_stock_and_reopens_po_for_replacement(client, db):
    item, loc, buyer, po, grn = _received(client, db, "RTV1")
    line = grn["items"][0]

    too_many = client.post(RTV, json={"goods_receipt_id": grn["id"], "reason": "damaged",
                                      "items": [{"grn_item_id": line["id"], "source": "accepted", "quantity": 6}]},
                           headers=auth_header(buyer))
    assert too_many.status_code == 422, too_many.text

    r = client.post(RTV, json={"goods_receipt_id": grn["id"], "reason": "damaged", "vehicle_number": "HR55 AB 1234",
                               "items": [{"grn_item_id": line["id"], "source": "accepted", "quantity": 2}]},
                    headers=auth_header(buyer))
    assert r.status_code == 201, r.text
    rtv = r.json()
    assert rtv["rtv_number"].startswith("RTV-") and rtv["total_value"] == 200
    assert rtv["items"][0]["unit_rate"] == 100 and rtv["debit_note_id"] is None
    assert "Not invoiced" in rtv["debit_note_message"]

    assert _on_hand(db, item, loc) == 3
    out = db.query(StoreStockTransaction).filter(StoreStockTransaction.reference_type == "vendor_return").one()
    assert (out.transaction_type, out.quantity, out.unit_cost, out.reference_number) == ("return_out", 2, 100, rtv["rtv_number"])
    assert db.get(P2PGoodsReceiptItem, line["id"]).returned_quantity == 2

    # The vendor owes the replacement: the PO is open again for 2.
    po_now = client.get(f"/api/v1/p2p/purchase-orders/{po['id']}", headers=auth_header(buyer)).json()
    assert po_now["status"] == "partially_fulfilled"
    replacement = _grn(client, buyer, po_now, loc, 2)
    assert replacement.status_code == 200, replacement.text

    # A GRN with goods already returned can't be reversed as a whole.
    rev = client.post(f"{GRN}/{grn['id']}/reverse", json={"reason": "x"}, headers=auth_header(buyer))
    assert rev.status_code == 409 and "already returned" in rev.json()["detail"]

    listed = client.get(RTV, params={"goods_receipt_id": grn["id"]}, headers=auth_header(buyer)).json()
    assert [x["rtv_number"] for x in listed] == [rtv["rtv_number"]]


def test_return_of_rejected_goods_is_recorded_without_stock(client, db):
    db.add(ModuleSetting(module_key="store", key="valuation_enabled", value=True))
    db.commit()
    item = master_item(db, "Item RTV2", code="RM-RTV2", uom="NOS")
    loc = _store(db, "RTV2")
    pr = _create_pr(client, _requester(db, "req.rtv2@premnathrail.com"),
                    items=[{"store_item_id": item.id, "quantity": 5, "project_inhouse": "Project"}])
    buyer = _purchaser(db, "buyer.rtv2@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    po = _po_for(client, buyer, pr["id"])
    grn = _grn(client, buyer, po, loc, 5).json()
    done = client.post(f"{GRN}/{grn['id']}/inspect", json={"items": [{
        "item_id": grn["items"][0]["id"], "accepted_quantity": 3, "rejected_quantity": 2, "quality_status": "partial",
        "rejection_reason": "Dimension out of tolerance"}]}, headers=auth_header(buyer))
    assert done.status_code == 200, done.text
    assert _on_hand(db, item, loc) == 3

    r = client.post(RTV, json={"goods_receipt_id": grn["id"], "reason": "quality_rejection",
                               "items": [{"grn_item_id": grn["items"][0]["id"], "source": "rejected", "quantity": 2}]},
                    headers=auth_header(buyer))
    assert r.status_code == 201, r.text
    assert _on_hand(db, item, loc) == 3  # rejected goods were never in stock
    assert db.get(P2PGoodsReceiptItem, grn["items"][0]["id"]).rejected_returned_quantity == 2
    more = client.post(RTV, json={"goods_receipt_id": grn["id"], "reason": "quality_rejection",
                                  "items": [{"grn_item_id": grn["items"][0]["id"], "source": "rejected", "quantity": 1}]},
                       headers=auth_header(buyer))
    assert more.status_code == 422
