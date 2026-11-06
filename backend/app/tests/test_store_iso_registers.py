"""Owner's ISO store formats printed from the portal as Excel (2026-11-06):
F/STR/04 requisition slip, F/STR/05 issue register, F/STR/02 gate inward,
F/STR/06 inventory register (rack-wise bin card), F/STR/03 gate outward.

Each file must open, keep the owner's header (Format No box), logos/signature
images and footer, carry the data rows (grid grown when needed, footer moved
below), and every route is gated by the Print action + Store data access."""
import io
from datetime import date, datetime

import pytest
from openpyxl import load_workbook

from app.auth.jwt_handler import create_access_token
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.vendor_return import P2PVendorReturn, P2PVendorReturnItem
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.models.pre_po_receipt import StorePrePoReceipt, StorePrePoReceiptItem
from app.modules.store.models.stock_transfer import StoreStockTransfer, StoreStockTransferItem
from app.modules.store.services.stock_ledger import post_stock_transaction

API = "/api/v1"


def _h(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def _open(resp):
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return load_workbook(io.BytesIO(resp.content))


def _col(ws, col: int, first: int, last: int) -> list:
    return [ws.cell(r, col).value for r in range(first, last + 1)]


@pytest.fixture
def env(db):
    p1, p2 = Branch(name="Unit 1", code="U1"), Branch(name="Unit 2", code="U2")
    db.add_all([p1, p2])
    db.flush()
    s1 = StoreLocation(name="U1 Main Store", code="U1-MS", branch_id=p1.id)
    s1b = StoreLocation(name="U1 Tool Room", code="U1-TR", branch_id=p1.id)
    s2 = StoreLocation(name="U2 Main Store", code="U2-MS", branch_id=p2.id)
    vendor = Vendor(code="V-001", name="Pune Steels", city="Pune")
    bolt = StoreItem(item_code="01", item_name="Hex Bolt M30", uom="PCS", category="Hardware")
    wire = StoreItem(item_code="02", item_name="Copper Wire", uom="KG", category="Electrical")
    admin = User(email="admin@premnathrail.com", name="admin", role="admin", is_active=True)
    viewer = User(email="viewer@premnathrail.com", name="viewer", role="user", is_active=True,
                  granular_permissions=["store:issues:view", "store:grn:view", "store:stock:view", "store:transfers:view"])
    printer = User(email="printer@premnathrail.com", name="printer", role="user", is_active=True, branch_id=p2.id,
                   data_access_scopes={"store": "plant"},
                   granular_permissions=["store:issues:view", "store:issues:print", "store:grn:view", "store:grn:print",
                                         "store:stock:view", "store:stock:print"])
    db.add_all([s1, s1b, s2, vendor, bolt, wire, admin, viewer, printer])
    db.flush()
    rack = StoreBin(location_id=s1.id, bin_type="rack", code="R1", name="Rack one")
    db.add(rack)
    db.flush()
    b1a = StoreBin(location_id=s1.id, bin_type="bin", code="1A", parent_id=rack.id)
    b1b = StoreBin(location_id=s1.id, bin_type="bin", code="1B", parent_id=rack.id)
    b2a = StoreBin(location_id=s1.id, bin_type="bin", code="2A")
    db.add_all([b1a, b1b, b2a])
    db.flush()
    post_stock_transaction(db, item_id=bolt.id, location_id=s1.id, transaction_type="receipt", quantity=100, bin_id=b1a.id,
                           transaction_date=date(2026, 9, 15))
    post_stock_transaction(db, item_id=bolt.id, location_id=s1.id, transaction_type="receipt", quantity=50, bin_id=b1a.id,
                           transaction_date=date(2026, 10, 3))
    post_stock_transaction(db, item_id=bolt.id, location_id=s1.id, transaction_type="issue", quantity=20, bin_id=b1a.id,
                           transaction_date=date(2026, 10, 9))
    post_stock_transaction(db, item_id=wire.id, location_id=s1.id, transaction_type="receipt", quantity=5, bin_id=b2a.id,
                           transaction_date=date(2026, 10, 5))
    post_stock_transaction(db, item_id=bolt.id, location_id=s2.id, transaction_type="receipt", quantity=10,
                           transaction_date=date(2026, 9, 1))
    db.commit()
    return {"db": db, "s1": s1, "s1b": s1b, "s2": s2, "vendor": vendor, "bolt": bolt, "wire": wire, "b1a": b1a,
            "admin": _h(admin), "viewer": _h(viewer), "printer": _h(printer)}


def _issue(db, env, number, day, lines, **kw):
    issue = StoreMaterialIssue(issue_number=number, location_id=env["s1"].id, issue_date=day, issue_type="production", **kw)
    db.add(issue)
    db.flush()
    for item, qty in lines:
        db.add(StoreMaterialIssueItem(issue_id=issue.id, item_id=item.id, quantity=qty, bin_id=env["b1a"].id))
    db.commit()
    return issue


def _header_ok(ws, fmt: str, fmt_cell: str, images: int = 3):
    assert fmt in str(ws[fmt_cell].value)
    assert len(ws._images) == images, "logos / signature images must survive"
    assert ws.page_setup.orientation == "landscape"
    seen = {}
    for m in ws.merged_cells.ranges:   # overlapping merges make Excel "repair" the file
        for cell in m.cells:
            assert cell not in seen, f"{m} overlaps {seen[cell]}"
            seen[cell] = m


# ── F/STR/04 Store Requisition Slip ─────────────────────────────────────────

def test_issue_slip_fills_grid_and_grows_with_footer_below(client, env):
    db = env["db"]
    lines = [(env["bolt"], i + 1) for i in range(16)]  # template grid holds 14 lines
    issue = _issue(db, env, "ISS-0001", date(2026, 10, 9), lines, project_or_work_order="WO-77")
    wb = _open(client.get(f"{API}/store/material-issues/{issue.id}/print-slip", headers=env["admin"]))
    ws = wb.worksheets[0]
    _header_ok(ws, "F/STR/04", "K1")
    assert "ISS-0001" in ws["A5"].value and "WO-77" in ws["A5"].value
    assert _col(ws, 1, 8, 23) == list(range(1, 17))
    assert ws["C8"].value == "Hex Bolt M30 (01)" and ws["H8"].value == 1 and ws["I8"].value == "PCS"
    assert ws["J8"].value == "U1 Main Store / 1A"
    assert ws["B8"].value.date() == date(2026, 10, 9)
    # Two extra rows: the signature / Prepared-Approved rows moved down by two, merges and images with them.
    assert ws["A26"].value == "Prepared By -" and ws["G26"].value == "Approved By -"
    merges = {str(m) for m in ws.merged_cells.ranges}
    assert {"A24:K25", "A26:F26", "G26:K26", "C22:E22", "C23:E23"} <= merges
    assert sorted(img.anchor._from.row for img in ws._images) == [0, 25, 25]


def test_issue_slip_needs_print_and_scope(client, env):
    issue = _issue(env["db"], env, "ISS-0002", date(2026, 10, 9), [(env["bolt"], 1)])
    denied = client.get(f"{API}/store/material-issues/{issue.id}/print-slip", headers=env["viewer"])
    assert denied.status_code == 403 and "Print" in denied.json()["detail"]
    # printer is plant-scoped to Unit 2; the issue is in a Unit 1 store.
    out = client.get(f"{API}/store/material-issues/{issue.id}/print-slip", headers=env["printer"])
    assert out.status_code == 403 and "data access" in out.json()["detail"]
    missing = client.get(f"{API}/store/material-issues/999999/print-slip", headers=env["admin"])
    assert missing.status_code == 404 and "Issues list" in missing.json()["detail"]


# ── F/STR/05 Material Issue Register ────────────────────────────────────────

def test_issue_register_orders_by_date_then_number_and_filters(client, env):
    db = env["db"]
    _issue(db, env, "ISS-0011", date(2026, 10, 5), [(env["bolt"], 2), (env["wire"], 3)], project_or_work_order="WO-1")
    _issue(db, env, "ISS-0010", date(2026, 10, 5), [(env["bolt"], 1)])
    _issue(db, env, "ISS-0009", date(2026, 10, 7), [(env["bolt"], i + 1) for i in range(9)])  # 12 lines > 10-row grid
    _issue(db, env, "ISS-0008", date(2026, 11, 2), [(env["bolt"], 5)])                      # outside the range
    r = client.get(f"{API}/store/material-issues/print-register", headers=env["admin"],
                   params={"date_from": "2026-10-01", "date_to": "2026-10-31", "location_id": env["s1"].id})
    ws = _open(r).worksheets[0]
    _header_ok(ws, "F/STR/05", "G1")
    assert [str(v).split(" · ")[0] for v in _col(ws, 7, 7, 8)] == ["ISS-0010", "ISS-0011"]
    assert _col(ws, 1, 7, 18) == list(range(1, 13))
    assert ws["C7"].value == "Hex Bolt M30 (01)" and ws["E7"].value == "PCS"
    assert ws["F8"].value == "WO-1"
    assert ws["A19"].value == "Prepared By -"           # footer pushed below the 12 rows
    bad = client.get(f"{API}/store/material-issues/print-register", headers=env["admin"],
                     params={"date_from": "2026-10-31", "date_to": "2026-10-01"})
    assert bad.status_code == 422 and "before 'From' date" in bad.json()["detail"]
    denied = client.get(f"{API}/store/material-issues/print-register", headers=env["viewer"],
                        params={"date_from": "2026-10-01", "date_to": "2026-10-31"})
    assert denied.status_code == 403
    other = client.get(f"{API}/store/material-issues/print-register", headers=env["printer"],
                       params={"date_from": "2026-10-01", "date_to": "2026-10-31", "location_id": env["s1"].id})
    assert other.status_code == 403 and "U1 Main Store" in other.json()["detail"]


# ── F/STR/02 Gate Inward Register ───────────────────────────────────────────

def test_gate_inward_register_lists_grn_and_before_po_lines(client, env):
    db = env["db"]
    po = P2PPurchaseOrder(po_number="PO-0001", vendor_id=env["vendor"].id, vendor_name="Pune Steels", status="issued",
                          po_date=date(2026, 10, 1))
    db.add(po)
    db.flush()
    pol = P2PPurchaseOrderItem(purchase_order_id=po.id, item_name="Hex Bolt M30", unit="PCS", quantity=10, unit_price=5)
    db.add(pol)
    db.flush()
    grn = P2PGoodsReceipt(grn_number="GRN-0001", purchase_order_id=po.id, store_location_id=env["s1"].id, status="completed",
                          received_date=date(2026, 10, 4), vendor_invoice_number="INV-9", vendor_invoice_date=date(2026, 10, 2),
                          vehicle_number="MH12AB1234")
    settled = P2PGoodsReceipt(grn_number="GRN-0002", purchase_order_id=po.id, store_location_id=env["s1"].id, status="completed",
                              received_date=date(2026, 10, 6), delivery_challan_number="DC-5", delivery_challan_date=date(2026, 10, 5))
    db.add_all([grn, settled])
    db.flush()
    db.add(P2PGoodsReceiptItem(goods_receipt_id=grn.id, po_item_id=pol.id, store_item_id=env["bolt"].id, item_name="Hex Bolt M30",
                               unit="PCS", ordered_quantity=10, received_quantity=8, bin_id=env["b1a"].id))
    # Fully settled against a Before-PO receipt: not a new gate entry.
    db.add(P2PGoodsReceiptItem(goods_receipt_id=settled.id, po_item_id=pol.id, store_item_id=env["bolt"].id, item_name="Hex Bolt M30",
                               unit="PCS", ordered_quantity=10, received_quantity=2, pre_po_qty=2))
    bpo = StorePrePoReceipt(receipt_number="BPO-0001", vendor_id=env["vendor"].id, vendor_name="Pune Steels",
                            received_date=date(2026, 10, 3), store_location_id=env["s1"].id, delivery_challan_number="DC-1")
    db.add(bpo)
    db.flush()
    db.add(StorePrePoReceiptItem(receipt_id=bpo.id, store_item_id=env["wire"].id, item_name="Copper Wire", unit="KG", quantity=4))
    db.commit()
    r = client.get(f"{API}/p2p/goods-receipts/print-inward-register", headers=env["admin"],
                   params={"date_from": "2026-10-01", "date_to": "2026-10-31"})
    ws = _open(r).worksheets[0]
    _header_ok(ws, "F/STR/02", "L1")
    assert _col(ws, 3, 7, 8) == ["Pune Steels", "Pune Steels"]
    assert ws["D7"].value == "Copper Wire (02)" and ws["E7"].value == "DC-1" and ws["G7"].value == "4 KG"
    assert ws["D8"].value == "Hex Bolt M30 (01)" and ws["E8"].value == "INV-9" and ws["F8"].value.date() == date(2026, 10, 2)
    assert ws["H8"].value == "MH12AB1234" and ws["I8"].value == "Pune" and ws["J8"].value == "U1 Main Store / 1A"
    assert ws["A9"].value is None                         # settled GRN line skipped
    assert ws["A22"].value == "INSPECTED BY:-"
    denied = client.get(f"{API}/p2p/goods-receipts/print-inward-register", headers=env["viewer"],
                        params={"date_from": "2026-10-01", "date_to": "2026-10-31"})
    assert denied.status_code == 403
    # Plant-scoped printer (Unit 2) sees no Unit 1 receipts.
    ws2 = _open(client.get(f"{API}/p2p/goods-receipts/print-inward-register", headers=env["printer"],
                           params={"date_from": "2026-10-01", "date_to": "2026-10-31"})).worksheets[0]
    assert ws2["A7"].value is None


# ── F/STR/06 Inventory Register ─────────────────────────────────────────────

def test_inventory_register_one_sheet_per_rack_with_daily_in_out(client, env):
    r = client.get(f"{API}/store/bin-stock/print-inventory-register", headers=env["admin"],
                   params={"location_id": env["s1"].id, "month": "2026-10"})
    wb = _open(r)
    assert wb.sheetnames == ["RACK 02", "RACK R1"]       # rack by parent rack, else leading number of the bin code
    ws = wb["RACK R1"]
    _header_ok(ws, "F/STR/06", "AP1")
    assert ws["A6"].value == "RACK NO-R1" and ws["G6"].value == "STOCK QTY 01.10.2026" and ws["AO6"].value == "MONTH/YEAR-  OCT-2026"
    assert ws["B8"].value == "1A" and ws["C8"].value == "Hex Bolt M30 (01)" and ws["D8"].value == "Hardware"
    assert ws["G8"].value == 100                          # opening on 1 Oct
    assert ws.cell(8, 10 + 2).value == 50 and ws.cell(9, 10 + 8).value == 20   # IN on day 3, OUT on day 9
    assert ws["H8"].value == "=+G8+AO8-AO9" and ws["AO8"].value == "=SUM(J8:AN8)"
    assert ws["I8"].value == "IN" and ws["I9"].value == "OUT"
    assert ws["AP104"].value is None and ws["A104"].value == "INSPECTED BY:-"
    assert wb["RACK 02"]["B8"].value == "2A" and len(wb["RACK 02"]._images) == 3
    racks = client.get(f"{API}/store/bin-stock/register-racks", headers=env["admin"], params={"location_id": env["s1"].id})
    assert racks.json() == ["02", "R1"]
    one = _open(client.get(f"{API}/store/bin-stock/print-inventory-register", headers=env["admin"],
                           params={"location_id": env["s1"].id, "month": "2026-10", "rack": "02"}))
    assert one.sheetnames == ["RACK 02"]
    empty = client.get(f"{API}/store/bin-stock/print-inventory-register", headers=env["admin"],
                       params={"location_id": env["s1b"].id, "month": "2026-10"})
    assert empty.status_code == 422 and "nothing to print" in empty.json()["detail"]
    bad = client.get(f"{API}/store/bin-stock/print-inventory-register", headers=env["admin"],
                     params={"location_id": env["s1"].id, "month": "Oct"})
    assert bad.status_code == 422 and "YYYY-MM" in bad.json()["detail"]
    assert client.get(f"{API}/store/bin-stock/print-inventory-register", headers=env["viewer"],
                      params={"location_id": env["s1"].id, "month": "2026-10"}).status_code == 403
    assert client.get(f"{API}/store/bin-stock/print-inventory-register", headers=env["printer"],
                      params={"location_id": env["s1"].id, "month": "2026-10"}).status_code == 403


def test_inventory_register_grows_past_48_items(client, env):
    db = env["db"]
    for n in range(50):
        it = StoreItem(item_code=f"9{n:03d}", item_name=f"Spare {n}", uom="NOS")
        db.add(it)
        db.flush()
        post_stock_transaction(db, item_id=it.id, location_id=env["s1"].id, transaction_type="receipt", quantity=1,
                               bin_id=env["b1a"].id, transaction_date=date(2026, 10, 1))
    db.commit()
    ws = _open(client.get(f"{API}/store/bin-stock/print-inventory-register", headers=env["admin"],
                          params={"location_id": env["s1"].id, "month": "2026-10", "rack": "R1"}))["RACK R1"]
    assert ws["A8"].value == 1 and ws.cell(8 + 2 * 50, 1).value == 51  # 51 items in bin 1A
    assert ws.cell(8 + 2 * 51, 1).value == "INSPECTED BY:-"
    assert any(str(m) == "B8:B109" for m in ws.merged_cells.ranges)


# ── F/STR/03 Gate Outward Register ──────────────────────────────────────────

def test_gate_outward_register_challans_returns_and_inter_plant_transfers(client, env):
    db = env["db"]
    jw =StoreMaterialIssue(issue_number="ISS-0100", location_id=env["s1"].id, issue_date=date(2026, 10, 2), issue_type="job_work",
                            challan_number="DC-OUT-1", vendor_name="Pune Steels", vendor_id=env["vendor"].id, vehicle_number="MH14")
    inside = StoreMaterialIssue(issue_number="ISS-0101", location_id=env["s1"].id, issue_date=date(2026, 10, 2), issue_type="production")
    db.add_all([jw, inside])
    db.flush()
    db.add_all([StoreMaterialIssueItem(issue_id=jw.id, item_id=env["bolt"].id, quantity=3),
                StoreMaterialIssueItem(issue_id=inside.id, item_id=env["bolt"].id, quantity=1)])
    po = P2PPurchaseOrder(po_number="PO-0009", vendor_id=env["vendor"].id, vendor_name="Pune Steels", status="issued", po_date=date(2026, 9, 1))
    db.add(po)
    db.flush()
    pol = P2PPurchaseOrderItem(purchase_order_id=po.id, item_name="Copper Wire", unit="KG", quantity=5, unit_price=5)
    db.add(pol)
    db.flush()
    grn = P2PGoodsReceipt(grn_number="GRN-0009", purchase_order_id=po.id, store_location_id=env["s1"].id, status="completed",
                          received_date=date(2026, 9, 2))
    db.add(grn)
    db.flush()
    gl = P2PGoodsReceiptItem(goods_receipt_id=grn.id, po_item_id=pol.id, item_name="Copper Wire", unit="KG", ordered_quantity=5,
                             received_quantity=5)
    db.add(gl)
    db.flush()
    rtv = P2PVendorReturn(rtv_number="RTV-0001", purchase_order_id=po.id, goods_receipt_id=grn.id, vendor_id=env["vendor"].id,
                          vendor_name="Pune Steels", store_location_id=env["s1"].id, return_date=date(2026, 10, 1),
                          reason="damaged", vehicle_number="MH15")
    db.add(rtv)
    db.flush()
    db.add(P2PVendorReturnItem(vendor_return_id=rtv.id, grn_item_id=gl.id, store_item_id=env["wire"].id, item_name="Copper Wire",
                               unit="KG", source="accepted", quantity=1))
    t_out = StoreStockTransfer(transfer_number="TR-0001", from_location_id=env["s1"].id, to_location_id=env["s2"].id,
                               transfer_date=date(2026, 10, 3), status="in_transit", dispatched_at=datetime(2026, 10, 4, 10, 0),
                               vehicle_number="MH16")
    t_same = StoreStockTransfer(transfer_number="TR-0002", from_location_id=env["s1"].id, to_location_id=env["s1b"].id,
                                transfer_date=date(2026, 10, 3), status="received", dispatched_at=datetime(2026, 10, 4, 10, 0))
    db.add_all([t_out, t_same])
    db.flush()
    db.add_all([StoreStockTransferItem(transfer_id=t_out.id, item_id=env["bolt"].id, quantity=7),
                StoreStockTransferItem(transfer_id=t_same.id, item_id=env["bolt"].id, quantity=2)])
    db.commit()
    r = client.get(f"{API}/store/material-issues/print-outward-register", headers=env["admin"],
                   params={"date_from": "2026-10-01", "date_to": "2026-10-31", "location_id": env["s1"].id})
    ws = _open(r).worksheets[0]
    _header_ok(ws, "F/STR/03", "M1")
    assert _col(ws, 5, 7, 9) == ["RTV-0001", "DC-OUT-1", "TR-0001"]
    assert ws["C7"].value == "Pune Steels" and ws["J7"].value == "Pune" and ws["H7"].value == "MH15"
    assert ws["G8"].value == "3 PCS" and ws["J8"].value == "Pune"
    assert ws["C9"].value == "Own unit: Unit 2 — U2 Main Store" and ws["B9"].value.date() == date(2026, 10, 4)
    assert ws["A10"].value is None                       # same-plant transfer and non-challan issue not listed
    assert ws["A28"].value == "INSPECTED BY:-"
    denied = client.get(f"{API}/store/material-issues/print-outward-register", headers=env["viewer"],
                        params={"date_from": "2026-10-01", "date_to": "2026-10-31"})
    assert denied.status_code == 403 and "Print" in denied.json()["detail"]


# ── Formula injection ───────────────────────────────────────────────────────

def test_user_text_starting_with_equals_stays_text(client, env):
    """An item named '=1+1' or a vendor named '=HYPERLINK(...)' must print as
    text, never run as an Excel formula; the register's own BALANCE / TOTAL
    formulas stay formulas."""
    db = env["db"]
    evil = StoreItem(item_code="=2+2", item_name="=1+1", uom="NOS", category="@cmd")
    db.add(evil)
    db.flush()
    post_stock_transaction(db, item_id=evil.id, location_id=env["s1"].id, transaction_type="receipt", quantity=3,
                           bin_id=env["b1a"].id, transaction_date=date(2026, 10, 2))
    issue = _issue(db, env, "ISS-0500", date(2026, 10, 9), [(evil, 1)], project_or_work_order="-WO")
    bpo = StorePrePoReceipt(receipt_number="BPO-0500", vendor_name='=HYPERLINK("x")', received_date=date(2026, 10, 3),
                            store_location_id=env["s1"].id, delivery_challan_number="+DC")
    db.add(bpo)
    db.flush()
    db.add(StorePrePoReceiptItem(receipt_id=bpo.id, store_item_id=evil.id, item_name="=1+1", unit="NOS", quantity=1))
    db.commit()

    slip = _open(client.get(f"{API}/store/material-issues/{issue.id}/print-slip", headers=env["admin"])).worksheets[0]
    assert slip["C8"].value.startswith("=1+1") and slip["C8"].data_type == "s"

    reg = _open(client.get(f"{API}/store/material-issues/print-register", headers=env["admin"],
                           params={"date_from": "2026-10-01", "date_to": "2026-10-31"})).worksheets[0]
    assert reg["F7"].value == "-WO" and reg["F7"].data_type == "s"

    inward = _open(client.get(f"{API}/p2p/goods-receipts/print-inward-register", headers=env["admin"],
                              params={"date_from": "2026-10-01", "date_to": "2026-10-31"})).worksheets[0]
    assert inward["C7"].value == '=HYPERLINK("x")' and inward["C7"].data_type == "s"
    assert inward["D7"].data_type == "s" and inward["E7"].value == "+DC" and inward["E7"].data_type == "s"

    inv = _open(client.get(f"{API}/store/bin-stock/print-inventory-register", headers=env["admin"],
                           params={"location_id": env["s1"].id, "month": "2026-10", "rack": "R1"}))["RACK R1"]
    cells = {inv.cell(r, 3).value: r for r in range(8, 30) if inv.cell(r, 3).value}
    r = cells["=1+1 (=2+2)"]
    assert inv.cell(r, 3).data_type == "s" and inv.cell(r, 4).value == "@cmd" and inv.cell(r, 4).data_type == "s"
    assert inv.cell(r, 8).data_type == "f" and inv.cell(r, 41).data_type == "f"   # own formulas kept
