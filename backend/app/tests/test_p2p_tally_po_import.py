"""Tally PO upload (2026-10-27): Excel rows -> released portal POs with a new
portal number and the Tally number as reference; vendor and items matched by
code only; all-or-nothing commit; one upload per Tally PO; the store can
receive the PO and Tracking shows it as with the vendor."""
import io
from datetime import date, timedelta

from openpyxl import Workbook

from app.modules.accounts.models.vendor import Vendor
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.store.models.item import StoreItem
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _receiving_store, _sqlite_number_series, auth_header, make_user,
)

URL = "/api/v1/p2p/tally-po-import"
HEADER = ["Tally PO No", "PO Date", "Vendor", "Expected Delivery", "Item Code", "Qty", "Unit", "Rate", "GST %"]
TODAY = date.today().strftime("%d-%m-%Y")


def _xlsx(rows, header=HEADER):
    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return {"file": ("tally.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}


def _setup(db):
    db.add_all([
        Vendor(code="V-TAL1", name="Tally Steels", gstin="27AABCT1234F1Z5", status="active"),
        Vendor(code="V-BLK", name="Blocked Co", status="blocked"),
        StoreItem(item_code="RM-TAL-01", item_name="Hex Bolt", uom="NOS", status="active", legacy_code="TLY-BOLT"),
        StoreItem(item_code="RM-TAL-02", item_name="Seal Kit", uom="SET", status="active"),
    ])
    db.commit()
    return make_user(db, "tally.buyer@premnathrail.com", role="admin", assigned_apps=("purchase",))


def _good_rows(ref="PO/0001/26-27"):
    return [
        [ref, TODAY, "V-TAL1", None, "TLY-BOLT", 100, "nos", "12.50", 18],
        [ref, TODAY, "v-tal1", None, "RM-TAL-02", 2, None, 1500, None],
    ]


def test_preview_matches_by_code_and_saves_nothing(client, db):
    user = _setup(db)
    r = client.post(f"{URL}/preview", files=_xlsx(_good_rows()), headers=auth_header(user))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ready"] == 1 and body["with_errors"] == 0, [p["errors"] for p in body["pos"]]
    assert body["ready"] == 1 and body["with_errors"] == 0
    po = body["pos"][0]
    assert po["vendor_code"] == "V-TAL1"
    assert [ln["item_code"] for ln in po["lines"]] == ["RM-TAL-01", "RM-TAL-02"]  # legacy code TLY-BOLT -> RM-TAL-01
    assert po["total_value"] == round(100 * 12.5 * 1.18 + 3000, 2)
    assert db.query(P2PPurchaseOrder).filter_by(source="tally").count() == 0


def test_problems_are_reported_with_row_and_fix(client, db):
    user = _setup(db)
    future = (date.today() + timedelta(days=3)).strftime("%d-%m-%Y")
    rows = [
        ["A0", TODAY, "27AABCT1234F1Z5", None, "RM-TAL-01", 1, None, 10, None],  # vendor by GSTIN: ok
        ["A1", TODAY, "Tally Steels", None, "RM-TAL-01", 1, None, 10, None],   # vendor by name: refused
        ["A2", TODAY, "V-TAL1", None, "Hex Bolt", 1, None, 10, None],         # item by name: refused
        ["A3", TODAY, "V-TAL1", None, "RM-TAL-02", 1, "NOS", 10, None],       # unit mismatch (SET)
        ["A5", TODAY, "V-TAL1", None, "RM-TAL-01", "nan", None, 10, 0.18],  # NaN qty
        ["A6", TODAY, "V-TAL1", None, "RM-TAL-01", 1, None, 10, 0.18],      # GST as a fraction
        ["A4", future, "V-BLK", None, "RM-TAL-01", 0, None, 10, None],        # future date, blocked vendor, qty 0
    ]
    body = client.post(f"{URL}/preview", files=_xlsx(rows), headers=auth_header(user)).json()
    errs = {p["tally_po_no"]: " ".join(p["errors"]) for p in body["pos"]}
    assert errs["A0"] == ""
    assert "isn't in the vendor master" in errs["A1"]
    assert "Row 4: item code 'Hex Bolt' isn't in the Item Master" in errs["A2"]
    assert "Item Master unit 'SET'" in errs["A3"]
    assert "isn't a number" in errs["A5"]
    assert "looks like a fraction" in errs["A6"]
    assert "in the future" in errs["A4"] and "blocked" in errs["A4"] and "quantity is empty or 0" in errs["A4"]
    r = client.post(f"{URL}/commit", files=_xlsx(rows), headers=auth_header(user))
    assert r.status_code == 422 and "Nothing was uploaded" in r.json()["detail"]
    assert db.query(P2PPurchaseOrder).filter_by(source="tally").count() == 0


def test_commit_creates_released_po_once_and_store_can_receive(client, db):
    user = _setup(db)
    partner = make_user(db, "tally.partner@premnathrail.com", is_partner=True)
    r = client.post(f"{URL}/commit", files=_xlsx(_good_rows()), headers=auth_header(user))
    assert r.status_code == 200, r.text
    created = r.json()["created"]
    assert len(created) == 1 and created[0]["po_number"].startswith("PO-") and created[0]["tally_po_no"] == "PO/0001/26-27"
    po = db.get(P2PPurchaseOrder, created[0]["id"])
    assert po.source == "tally" and po.external_ref == "PO/0001/26-27" and po.status == "issued" and po.p2p_request_id is None
    assert all(i.store_item_id for i in po.items)
    from app.modules.main.models.notification import Notification
    assert db.query(Notification).filter_by(user_id=partner.id, notification_type="p2p_tally_po_uploaded").count() == 1

    # Same Tally PO again (any letter case): refused, names the portal PO it became.
    again = client.post(f"{URL}/preview", files=_xlsx(_good_rows("po/0001/26-27")), headers=auth_header(user)).json()
    assert f"already uploaded as {po.po_number}" in again["pos"][0]["errors"][0]

    # Released: shows on the GRN picker and in Tracking as with the vendor.
    pending = client.get("/api/v1/p2p/goods-receipts/pending-purchase-orders", headers=auth_header(user))
    assert pending.status_code == 200 and po.id in [p["id"] for p in pending.json()]
    from app.modules.p2p.po_tracking import stages_for
    assert stages_for(db, [po])[po.id] == "with_vendor"

    line = next(i for i in po.items if i.store_item_id)
    grn = client.post("/api/v1/p2p/goods-receipts", json={
        "purchase_order_id": po.id, "store_location_id": _receiving_store(client),
        "items": [{"po_item_id": line.id, "received_quantity": 1}],
    }, headers=auth_header(user))
    assert grn.status_code == 200, grn.text


def test_needs_the_upload_feature(client, db):
    _setup(db)
    viewer = make_user(db, "tally.viewer@premnathrail.com", assigned_apps=())
    r = client.post(f"{URL}/preview", files=_xlsx(_good_rows()), headers=auth_header(viewer))
    assert r.status_code == 403


def test_missing_columns_named(client, db):
    user = _setup(db)
    r = client.post(f"{URL}/preview", files=_xlsx([["X", TODAY]], header=["Tally PO No", "PO Date"]), headers=auth_header(user))
    assert r.status_code == 422 and "vendor" in r.json()["detail"] and "item_code" in r.json()["detail"]
