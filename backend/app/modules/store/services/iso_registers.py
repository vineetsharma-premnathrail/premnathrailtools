"""The owner's ISO store formats (F/STR/02-06) filled from portal data and
downloaded as Excel, in exactly the owner's layout (2026-11-06).

The owner's own workbooks are kept untouched in store/print_templates/ and are
only read with openpyxl: logos / signature images, the company header, the
Format No / Effective Date / Rev No box, merged cells, borders, landscape A4
and the Prepared / Approved By rows all come from the template. We only write
the data rows. When there are more rows than the template's blank grid, rows
are inserted INSIDE the grid (so the grid's closing border and the footer stay
below the data) and every merge / image / row height under them moves down.

    F/STR/04  Store Requisition Slip     one Material Issue
    F/STR/05  Material Issue Register    issues in a date range
    F/STR/02  Gate Inward Register       GRN lines + Before-PO receipt lines
    F/STR/06  Inventory Register         rack-wise bin card for one month
    F/STR/03  Gate Outward Register      challan issues, returns to vendor,
                                          transfers to another plant

Builders return the workbook as bytes; the routes stream them. Who may see
which rows is decided by the routes (permission + store scope) and passed in
as `location_ids` (None = every store)."""
from __future__ import annotations

import copy
import io
import re
import warnings
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.drawing.image import Image as XlImage
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy.orm import Session, selectinload

from app.core.reporting.xlsx import FORMULA_STARTS
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "print_templates"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DATE_FMT = "DD-MM-YYYY"
MAX_RANGE_DAYS = 366


class RegisterError(ValueError):
    """A request the register can't be made for — the message says how to fix it."""


# ───────────────────────────── template helpers ─────────────────────────────

def load_template(name: str) -> Workbook:
    path = TEMPLATE_DIR / name
    if not path.exists():
        raise RegisterError(f"The print format file '{name}' is missing on the server. Ask the IT team to restore "
                            "backend/app/modules/store/print_templates/ from the code repository.")
    with warnings.catch_warnings():
        # openpyxl can't parse the slip's "Page &P of &N" footer; it is put back below.
        warnings.simplefilter("ignore")
        return load_workbook(path)


def to_bytes(wb: Workbook) -> bytes:
    # Formulas (BALANCE / TOTAL on the inventory register) are worked out by Excel when the file opens.
    wb.calculation.fullCalcOnLoad = True
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _copy_row_style(ws: Worksheet, src_row: int, dst_row: int, max_col: int) -> None:
    for c in range(1, max_col + 1):
        ws.cell(dst_row, c)._style = copy.copy(ws.cell(src_row, c)._style)
    ws.row_dimensions[dst_row].height = ws.row_dimensions[src_row].height


def _row_merges(ws: Worksheet, row: int) -> list[tuple[int, int]]:
    """(min_col, max_col) of the one-row merges on `row` (e.g. C:E on the slip's lines)."""
    return [(m.min_col, m.max_col) for m in ws.merged_cells.ranges if m.min_row == m.max_row == row]


def make_room(ws: Worksheet, first_row: int, last_row: int, needed: int, style_row: int | None = None) -> int:
    """Grow the blank grid first_row..last_row to `needed` rows. New rows go in
    before the grid's last row (which carries the closing border), styled like
    `style_row`; merges, row heights, images and the print area below move down.
    Returns the grid's last row afterwards."""
    capacity = last_row - first_row + 1
    extra = needed - capacity
    if extra <= 0:
        return last_row
    style_row = style_row or first_row
    max_col = ws.max_column
    old_max = ws.max_row
    heights = {r: ws.row_dimensions[r].height for r in range(last_row, old_max + 1)}
    style_merges = _row_merges(ws, style_row)
    style_cells = [copy.copy(ws.cell(style_row, c)._style) for c in range(1, max_col + 1)]
    style_height = ws.row_dimensions[style_row].height

    ws.insert_rows(last_row, extra)
    for m in list(ws.merged_cells.ranges):
        if m.min_row >= last_row:
            m.shift(0, extra)
        elif m.max_row >= last_row:
            m.expand(down=extra)
    for r in range(old_max, last_row - 1, -1):
        ws.row_dimensions[r + extra].height = heights.get(r)
    for img in ws._images:
        anchor = img.anchor
        frm = getattr(anchor, "_from", None)
        if frm is not None and frm.row >= last_row - 1:
            frm.row += extra
            to = getattr(anchor, "to", None)
            if to is not None:
                to.row += extra
    for r in range(last_row, last_row + extra):
        for c in range(1, max_col + 1):
            ws.cell(r, c)._style = copy.copy(style_cells[c - 1])
        ws.row_dimensions[r].height = style_height
        for c1, c2 in style_merges:
            ws.merge_cells(start_row=r, start_column=c1, end_row=r, end_column=c2)
    if ws.print_area:
        ws.print_area = f"A1:{get_column_letter(max_col)}{ws.max_row}"
    return last_row + extra


def _set(cell, value) -> None:
    """Write user data as data: a string starting with = + - @ (an item named
    '=1+1', a vendor '=HYPERLINK(...)') stays text, never an Excel formula."""
    cell.value = value
    if isinstance(value, str) and value.startswith(FORMULA_STARTS):
        cell.data_type = "s"


def _put(ws: Worksheet, row: int, col: int, value, *, date_cell: bool = False) -> None:
    cell = ws.cell(row, col)
    _set(cell, value)
    if date_cell and value is not None:
        cell.number_format = DATE_FMT


def _qty(v) -> float | int | None:
    if v is None:
        return None
    v = round(float(v), 3)
    return int(v) if v == int(v) else v


def _qty_text(qty, unit) -> str:
    q = _qty(qty)
    return f"{q} {unit}".strip() if unit else f"{q}"


def _check_range(date_from: date, date_to: date) -> None:
    if date_to < date_from:
        raise RegisterError(f"'To' date {date_to:%d-%m-%Y} is before 'From' date {date_from:%d-%m-%Y}. Pick a 'To' date on or after the 'From' date.")
    if (date_to - date_from).days > MAX_RANGE_DAYS:
        raise RegisterError(f"The date range is {(date_to - date_from).days + 1} days long; a register prints at most one year. "
                            "Pick a shorter range (for example one month) and print each part.")


def _fill_grid(ws: Worksheet, first_row: int, last_row: int, rows: list[list], date_cols: set[int] = frozenset(),
               style_row: int | None = None) -> None:
    """Write `rows` (lists of values for columns 1..n) into the template grid."""
    make_room(ws, first_row, last_row, len(rows), style_row)
    for i, values in enumerate(rows):
        r = first_row + i
        for c, v in enumerate(values, start=1):
            if v is None:
                continue
            _put(ws, r, c, v, date_cell=c in date_cols)


def _locations(db: Session, ids) -> dict[int, StoreLocation]:
    ids = {i for i in ids if i}
    return {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_(ids)).all()} if ids else {}


def _bins(db: Session, ids) -> dict[int, StoreBin]:
    ids = {i for i in ids if i}
    return {b.id: b for b in db.query(StoreBin).filter(StoreBin.id.in_(ids)).all()} if ids else {}


def _items(db: Session, ids) -> dict[int, StoreItem]:
    ids = {i for i in ids if i}
    return {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(ids)).all()} if ids else {}


def _vendor_cities(db: Session, ids) -> dict[int, str]:
    from app.modules.accounts.models.vendor import Vendor
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {v.id: v.city for v in db.query(Vendor.id, Vendor.city).filter(Vendor.id.in_(ids)).all() if v.city}


def _desc(item: StoreItem | None, fallback: str | None = None) -> str:
    if item is None:
        return fallback or ""
    return f"{item.item_name} ({item.item_code})" if item.item_code else item.item_name


def _issue_query(db: Session, user, location_ids: set[int] | None):
    from app.core.data_scope import apply_scope
    from app.modules.store.models.material_issue import StoreMaterialIssue
    q = db.query(StoreMaterialIssue).options(selectinload(StoreMaterialIssue.items))
    q = apply_scope(q, user, StoreMaterialIssue)
    if location_ids is not None:
        q = q.filter(StoreMaterialIssue.location_id.in_(location_ids or {-1}))
    return q


def _issued_to(db: Session, issues) -> dict[int, str]:
    """ISSUED TO per issue: department / project / person as stored."""
    from app.modules.main.models.user import User
    from app.modules.organization.models.department import Department
    from app.modules.projects.models.project import PmProject
    from app.modules.store.services import project_stock

    depts = {d.id: d.name for d in db.query(Department).filter(
        Department.id.in_({i.department_id for i in issues} - {None})).all()} if issues else {}
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(
        User.id.in_({i.requested_by_id for i in issues} - {None})).all()} if issues else {}
    projects = {p.id: p.project_code for p in db.query(PmProject).filter(
        PmProject.id.in_({i.order_project_id for i in issues} - {None})).all()} if issues else {}
    out: dict[int, str] = {}
    for i in issues:
        parts = []
        if i.department_id and depts.get(i.department_id):
            parts.append(depts[i.department_id])
        if i.order_project_element_id:
            label = project_stock.element_label(db, i.order_project_element_id)
            if label:
                parts.append(label)
        elif i.order_project_id and projects.get(i.order_project_id):
            parts.append(f"Project {projects[i.order_project_id]}")
        elif i.project_or_work_order:
            parts.append(i.project_or_work_order)
        if i.vendor_name:
            parts.append(i.vendor_name)
        if i.requested_by_id and users.get(i.requested_by_id):
            parts.append(users[i.requested_by_id])
        out[i.id] = " / ".join(parts)
    return out


# ───────────────────────────── F/STR/04 slip ─────────────────────────────

SLIP_TEMPLATE = "f_str_04_issue_slip.xlsx"


def build_issue_slip(db: Session, issue) -> bytes:
    """Store Requisition Slip for one Material Issue. QTY. REQUIRED is the
    requisition line's quantity when the issue was made from a purchase
    requisition (issue from stock), otherwise the quantity issued (a Material
    Issue keeps no separate requested quantity)."""
    wb = load_template(SLIP_TEMPLATE)
    ws = wb.worksheets[0]
    ws.oddFooter.center.text = "Page &P of &N"
    items = _items(db, [l.item_id for l in issue.items])
    bins = _bins(db, [l.bin_id for l in issue.items])
    location = db.get(StoreLocation, issue.location_id)
    requested: dict[int, float] = {}
    if issue.p2p_request_id:
        from app.modules.p2p.models.p2p_request_item import P2PRequestItem
        for pl in db.query(P2PRequestItem).filter(P2PRequestItem.p2p_request_id == issue.p2p_request_id).all():
            if pl.store_item_id:
                requested[pl.store_item_id] = requested.get(pl.store_item_id, 0) + (pl.quantity or 0)
    rows = []
    for n, line in enumerate(sorted(issue.items, key=lambda l: l.id), start=1):
        item = items.get(line.item_id)
        uom = item.uom if item else None
        desc = _desc(item)
        if line.batch_number:
            desc += f" — Batch {line.batch_number}"
        b = bins.get(line.bin_id)
        where = " / ".join(x for x in (location.name if location else None, b.code if b else None) if x)
        rows.append([n, issue.issue_date, desc, None, None, _qty(requested.get(line.item_id, line.quantity)), uom,
                     _qty(line.quantity), uom, where, None])
    # The owner's sheet has wrap + side borders on Material Location / SIGN only from row 17 on —
    # give every line row the same look (row 20 = a full middle row).
    for r in range(8, 20):
        for c in (10, 11):
            ws.cell(r, c)._style = copy.copy(ws.cell(20, c)._style)
    _fill_grid(ws, 8, 21, rows, date_cols={2}, style_row=20)
    ref = [f"No. {issue.issue_number}"]
    to = _issued_to(db, [issue]).get(issue.id)
    if to:
        ref.append(f"Issued to: {to}")
    _set(ws["A5"], f"{ws['A5'].value}   ({', '.join(ref)})")
    return to_bytes(wb)


# ───────────────────────────── F/STR/05 issue register ─────────────────────────────

ISSUE_REGISTER_TEMPLATE = "f_str_05_material_issue_register.xlsx"


def build_issue_register(db: Session, user, *, date_from: date, date_to: date, location_ids: set[int] | None) -> bytes:
    from app.modules.store.models.material_issue import StoreMaterialIssue
    _check_range(date_from, date_to)
    issues = (_issue_query(db, user, location_ids)
              .filter(StoreMaterialIssue.issue_date >= date_from, StoreMaterialIssue.issue_date <= date_to)
              .order_by(StoreMaterialIssue.issue_date.asc(), StoreMaterialIssue.issue_number.asc()).all())
    items = _items(db, [l.item_id for i in issues for l in i.items])
    issued_to = _issued_to(db, issues)
    rows, n = [], 0
    for issue in issues:
        for line in sorted(issue.items, key=lambda l: l.id):
            n += 1
            item = items.get(line.item_id)
            remarks = " · ".join(x for x in (issue.issue_number, line.batch_number and f"Batch {line.batch_number}",
                                             line.remarks or None) if x)
            rows.append([n, issue.issue_date, _desc(item), _qty(line.quantity), item.uom if item else None,
                         issued_to.get(issue.id) or None, remarks])
    wb = load_template(ISSUE_REGISTER_TEMPLATE)
    ws = wb.worksheets[0]
    _fill_grid(ws, 7, 16, rows, date_cols={2})
    _set(ws["A5"], f"{ws['A5'].value}   ({date_from:%d-%m-%Y} to {date_to:%d-%m-%Y})")
    return to_bytes(wb)


# ───────────────────────────── F/STR/02 gate inward ─────────────────────────────

INWARD_TEMPLATE = "f_str_02_inward_register.xlsx"


def inward_rows(db: Session, user, *, date_from: date, date_to: date, location_ids: set[int] | None,
                include_grn: bool = True, include_before_po: bool = True) -> list[dict]:
    """One row per received line. A GRN line that only settles goods already
    booked on a Before-PO receipt (pre_po_qty) did not come through the gate
    again, so only the rest of it is listed; the Before-PO receipt line is the
    gate entry for those goods."""
    from app.core.data_scope import apply_scope
    out: list[dict] = []
    if include_grn:
        from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
        from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
        q = db.query(P2PGoodsReceipt).options(selectinload(P2PGoodsReceipt.items)).filter(
            P2PGoodsReceipt.received_date >= date_from, P2PGoodsReceipt.received_date <= date_to,
            P2PGoodsReceipt.status != "reversed")
        if location_ids is not None:
            q = q.filter(P2PGoodsReceipt.store_location_id.in_(location_ids or {-1}))
        grns = apply_scope(q, user, P2PGoodsReceipt).all()
        pos = {p.id: p for p in db.query(P2PPurchaseOrder).filter(
            P2PPurchaseOrder.id.in_({g.purchase_order_id for g in grns})).all()} if grns else {}
        cities = _vendor_cities(db, [p.vendor_id for p in pos.values()])
        locs = _locations(db, [g.store_location_id for g in grns])
        bins = _bins(db, [l.bin_id for g in grns for l in g.items])
        items = _items(db, [l.store_item_id for g in grns for l in g.items])
        for g in grns:
            po = pos.get(g.purchase_order_id)
            if g.delivery_challan_number:
                challan, challan_date = g.delivery_challan_number, g.delivery_challan_date
            else:
                challan, challan_date = g.vendor_invoice_number, g.vendor_invoice_date
            loc = locs.get(g.store_location_id)
            for line in sorted(g.items, key=lambda l: l.id):
                qty = (line.received_quantity or 0) - (line.pre_po_qty or 0)
                if qty <= 1e-9:
                    continue
                b = bins.get(line.bin_id)
                out.append({
                    "date": g.received_date, "number": g.grn_number, "party": po.vendor_name if po else None,
                    "article": _desc(items.get(line.store_item_id), line.item_name), "challan": challan,
                    "challan_date": challan_date, "qty": _qty_text(qty, line.unit), "vehicle": g.vehicle_number,
                    "from": cities.get(po.vendor_id) if po and po.vendor_id else None,
                    "store": " / ".join(x for x in (loc.name if loc else None, b.code if b else None) if x) or None,
                    "remarks": " · ".join(x for x in (g.grn_number, po and f"PO {po.po_number}", line.remarks) if x),
                })
    if include_before_po:
        from app.modules.store.models.pre_po_receipt import StorePrePoReceipt
        from app.modules.store.routes import pre_po_receipts as _bpo_routes  # noqa: F401 — registers its data scope
        q = db.query(StorePrePoReceipt).options(selectinload(StorePrePoReceipt.items)).filter(
            StorePrePoReceipt.received_date >= date_from, StorePrePoReceipt.received_date <= date_to,
            StorePrePoReceipt.status != "cancelled")
        if location_ids is not None:
            q = q.filter(StorePrePoReceipt.store_location_id.in_(location_ids or {-1}))
        receipts = apply_scope(q, user, StorePrePoReceipt).all()
        cities = _vendor_cities(db, [r.vendor_id for r in receipts])
        locs = _locations(db, [r.store_location_id for r in receipts])
        items = _items(db, [l.store_item_id for r in receipts for l in r.items])
        for r in receipts:
            loc = locs.get(r.store_location_id)
            challan = r.delivery_challan_number or r.vendor_invoice_number
            challan_date = r.delivery_challan_date if r.delivery_challan_number else r.vendor_invoice_date
            for line in sorted(r.items, key=lambda l: l.id):
                out.append({
                    "date": r.received_date, "number": r.receipt_number, "party": r.vendor_name,
                    "article": _desc(items.get(line.store_item_id), line.item_name), "challan": challan,
                    "challan_date": challan_date, "qty": _qty_text(line.quantity, line.unit), "vehicle": None,
                    "from": cities.get(r.vendor_id) if r.vendor_id else None,
                    "store": loc.name if loc else None,
                    "remarks": " · ".join(x for x in (f"Before-PO receipt {r.receipt_number}", line.remarks) if x),
                })
    out.sort(key=lambda x: (x["date"], x["number"]))
    return out


def build_inward_register(db: Session, user, *, date_from: date, date_to: date, location_ids: set[int] | None,
                          include_before_po: bool = True) -> bytes:
    _check_range(date_from, date_to)
    data = inward_rows(db, user, date_from=date_from, date_to=date_to, location_ids=location_ids,
                       include_before_po=include_before_po)
    rows = [[n, r["date"], r["party"], r["article"], r["challan"], r["challan_date"], r["qty"], r["vehicle"], r["from"],
             r["store"], None, r["remarks"]] for n, r in enumerate(data, start=1)]
    wb = load_template(INWARD_TEMPLATE)
    ws = wb.worksheets[0]
    _fill_grid(ws, 7, 21, rows, date_cols={2, 6})
    _set(ws["A5"], f"{ws['A5'].value}   ({date_from:%d-%m-%Y} to {date_to:%d-%m-%Y})")
    return to_bytes(wb)


# ───────────────────────────── F/STR/03 gate outward ─────────────────────────────

OUTWARD_TEMPLATE = "f_str_03_outward_register.xlsx"


def outward_rows(db: Session, user, *, date_from: date, date_to: date, location_ids: set[int] | None,
                 include_issues: bool = True, include_vendor_returns: bool = True, include_transfers: bool = True) -> list[dict]:
    """Goods that left through the gate, one row per line:
      * Material Issues that carry a delivery challan (job work, customer
        sample, project / site, service, dispatch, scrap sold) — every issue
        type that leaves the factory needs a challan;
      * Returns to Vendor (the return note is the gate pass);
      * Store transfers to a store of ANOTHER plant, once dispatched (a
        transfer between two stores of the same plant never crosses the gate)."""
    out: list[dict] = []
    if include_issues:
        from app.modules.crm.models.organization import Organization
        from app.modules.store.models.material_issue import StoreMaterialIssue
        issues = (_issue_query(db, user, location_ids)
                  .filter(StoreMaterialIssue.issue_date >= date_from, StoreMaterialIssue.issue_date <= date_to,
                          StoreMaterialIssue.challan_number.isnot(None), StoreMaterialIssue.challan_number != "").all())
        orgs = {o.id: o for o in db.query(Organization).filter(
            Organization.id.in_({i.customer_id for i in issues} - {None})).all()} if issues else {}
        cities = _vendor_cities(db, [i.vendor_id for i in issues])
        locs = _locations(db, [i.location_id for i in issues])
        bins = _bins(db, [l.bin_id for i in issues for l in i.items])
        items = _items(db, [l.item_id for i in issues for l in i.items])
        for i in issues:
            org = orgs.get(i.customer_id)
            party = i.vendor_name or (org.name if org else None) or i.scrap_buyer
            going_to = (cities.get(i.vendor_id) if i.vendor_id else None) or (org.city if org else None) or i.site_address
            loc = locs.get(i.location_id)
            for line in sorted(i.items, key=lambda l: l.id):
                item = items.get(line.item_id)
                b = bins.get(line.bin_id)
                out.append({
                    "date": i.issue_date, "number": i.issue_number, "party": party, "article": _desc(item),
                    "challan": i.challan_number, "challan_date": i.issue_date,
                    "qty": _qty_text(line.quantity, item.uom if item else None), "vehicle": i.vehicle_number,
                    "going_from": loc.name if loc else None, "going_to": going_to,
                    "store": " / ".join(x for x in (loc.name if loc else None, b.code if b else None) if x) or None,
                    "remarks": " · ".join(x for x in (f"Issue {i.issue_number}", line.remarks) if x),
                })
    if include_vendor_returns:
        from app.modules.p2p.models.vendor_return import P2PVendorReturn
        q = db.query(P2PVendorReturn).options(selectinload(P2PVendorReturn.items)).filter(
            P2PVendorReturn.return_date >= date_from, P2PVendorReturn.return_date <= date_to)
        if location_ids is not None:
            q = q.filter(P2PVendorReturn.store_location_id.in_(location_ids or {-1}))
        rtvs = q.all()
        cities = _vendor_cities(db, [r.vendor_id for r in rtvs])
        locs = _locations(db, [r.store_location_id for r in rtvs])
        items = _items(db, [l.store_item_id for r in rtvs for l in r.items])
        for r in rtvs:
            loc = locs.get(r.store_location_id)
            for line in sorted(r.items, key=lambda l: l.id):
                out.append({
                    "date": r.return_date, "number": r.rtv_number, "party": r.vendor_name,
                    "article": _desc(items.get(line.store_item_id), line.item_name), "challan": r.rtv_number,
                    "challan_date": r.return_date, "qty": _qty_text(line.quantity, line.unit), "vehicle": r.vehicle_number,
                    "going_from": loc.name if loc else None,
                    "going_to": cities.get(r.vendor_id) if r.vendor_id else None,
                    "store": loc.name if loc else None,
                    "remarks": " · ".join(x for x in (f"Return to vendor {r.rtv_number}", r.remarks) if x),
                })
    if include_transfers:
        from app.core.data_scope import apply_scope
        from app.modules.organization.models.branch import Branch
        from app.modules.store.models.stock_transfer import StoreStockTransfer
        q = db.query(StoreStockTransfer).options(selectinload(StoreStockTransfer.items)).filter(
            StoreStockTransfer.status.in_(("in_transit", "received")))
        if location_ids is not None:
            q = q.filter(StoreStockTransfer.from_location_id.in_(location_ids or {-1}))
        transfers = apply_scope(q, user, StoreStockTransfer).all()
        locs = _locations(db, [t.from_location_id for t in transfers] + [t.to_location_id for t in transfers])
        plants = {b.id: b.name for b in db.query(Branch).filter(
            Branch.id.in_({l.branch_id for l in locs.values()} - {None})).all()} if locs else {}
        items = _items(db, [l.item_id for t in transfers for l in t.items])
        bins = _bins(db, [l.from_bin_id for t in transfers for l in t.items])
        for t in transfers:
            src, dst = locs.get(t.from_location_id), locs.get(t.to_location_id)
            if src is None or dst is None or src.branch_id == dst.branch_id:
                continue
            day = t.dispatched_at.date() if isinstance(t.dispatched_at, datetime) else t.transfer_date
            if not (date_from <= day <= date_to):
                continue
            to_label = " — ".join(x for x in (plants.get(dst.branch_id), dst.name) if x)
            for line in sorted(t.items, key=lambda l: l.id):
                item = items.get(line.item_id)
                b = bins.get(line.from_bin_id)
                out.append({
                    "date": day, "number": t.transfer_number, "party": f"Own unit: {to_label}",
                    "article": _desc(item), "challan": t.tax_invoice_number or t.transfer_number, "challan_date": day,
                    "qty": _qty_text(line.quantity, item.uom if item else None), "vehicle": t.vehicle_number,
                    "going_from": " — ".join(x for x in (plants.get(src.branch_id), src.name) if x), "going_to": to_label,
                    "store": " / ".join(x for x in (src.name, b.code if b else None) if x),
                    "remarks": " · ".join(x for x in (f"Transfer {t.transfer_number}", line.remarks) if x),
                })
    out.sort(key=lambda x: (x["date"], x["number"]))
    return out


def build_outward_register(db: Session, user, *, date_from: date, date_to: date, location_ids: set[int] | None,
                           include_issues: bool = True, include_vendor_returns: bool = True,
                           include_transfers: bool = True) -> bytes:
    _check_range(date_from, date_to)
    data = outward_rows(db, user, date_from=date_from, date_to=date_to, location_ids=location_ids,
                        include_issues=include_issues, include_vendor_returns=include_vendor_returns,
                        include_transfers=include_transfers)
    rows = [[n, r["date"], r["party"], r["article"], r["challan"], r["challan_date"], r["qty"], r["vehicle"],
             r["going_from"], r["going_to"], r["store"], None, r["remarks"]] for n, r in enumerate(data, start=1)]
    wb = load_template(OUTWARD_TEMPLATE)
    ws = wb.worksheets[0]
    _fill_grid(ws, 7, 27, rows, date_cols={2, 6})
    _set(ws["A5"], f"{ws['A5'].value}   ({date_from:%d-%m-%Y} to {date_to:%d-%m-%Y})")
    return to_bytes(wb)


# ───────────────────────────── F/STR/06 inventory register ─────────────────────────────

INVENTORY_TEMPLATE = "f_str_06_inventory_register.xlsx"
INV_FIRST, INV_LAST, INV_FOOTER = 8, 103, 104   # template grid rows; 104-105 = Inspected / Prepared / Approved By
INV_COLS = 42                                    # A..AP
DAY_COL = 10                                     # J = day 1 … AN = day 31
NO_BIN = "NO BIN"


def rack_of(bin_row: StoreBin, by_id: dict[int, StoreBin]) -> str:
    """Rack (sheet) a bin is printed on:
      1. the rack it sits in (its top-level parent of type 'rack'), by that rack's code;
      2. otherwise the leading number of its own code ('1A' → 01, '12-B' → 12),
         like the owner's sheet (bins 1A..1F on RACK 01);
      3. otherwise its top-level parent's code (or its own code)."""
    node, seen = bin_row, set()
    while node.parent_id and node.parent_id in by_id and node.id not in seen:
        seen.add(node.id)
        node = by_id[node.parent_id]
    if node.bin_type == "rack" and node is not bin_row:
        return node.code
    m = re.match(r"\s*(\d+)", bin_row.code or "")
    if m:
        return f"{int(m.group(1)):02d}"
    return node.code or bin_row.code


def natural_key(s: str) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s or "")]


def _image_specs(src: Worksheet) -> list[tuple]:
    """(bytes, anchor, width, height) of a sheet's images — read once: the
    loaded image's file is closed after the first read."""
    return [(img._data(), img.anchor, img.width, img.height) for img in src._images]


def _add_images(dst: Worksheet, specs: list[tuple]) -> None:
    for data, anchor, width, height in specs:
        new = XlImage(io.BytesIO(data))
        new.anchor = copy.deepcopy(anchor)
        new.width, new.height = width, height
        dst.add_image(new)


def inventory_data(db: Session, *, location_id: int, month_start: date, rack: str | None = None) -> dict[str, list[dict]]:
    """{rack: [row]} for one store and month. A row is an item in a bin with
    opening (stock in that bin on day 1), IN and OUT per day (stock ledger
    rows + bin-to-bin moves; Quality / Blocked stock counts, it is physically
    on the rack) and the projects holding that item in the store."""
    from sqlalchemy import func

    from app.modules.projects.models.project import PmProject
    from app.modules.store.models.bin_move import StoreBinMove
    from app.modules.store.models.stock_reservation import StoreStockReservation
    from app.modules.store.models.stock_transaction import StoreStockTransaction
    from app.modules.store.services.bins import physical_sign

    month_end = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    T = StoreStockTransaction
    opening: dict[tuple, float] = defaultdict(float)
    daily: dict[tuple, dict[int, list[float]]] = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))

    def _add(key, day: date, signed: float):
        if day < month_start:
            opening[key] += signed
        else:
            cell = daily[key][day.day]
            cell[0 if signed > 0 else 1] += abs(signed)

    ledger = (db.query(T.item_id, T.bin_id, T.transaction_type, T.transaction_date, func.sum(T.quantity))
              .filter(T.location_id == location_id, T.transaction_date <= month_end)
              .group_by(T.item_id, T.bin_id, T.transaction_type, T.transaction_date).all())
    for item_id, bin_id, ttype, day, qty in ledger:
        sign = physical_sign(ttype)
        if sign and qty:
            _add((item_id, bin_id), day, sign * float(qty))
    M = StoreBinMove
    moves = (db.query(M.item_id, M.from_bin_id, M.to_bin_id, M.move_date, func.sum(M.quantity))
             .filter(M.location_id == location_id, M.move_date <= month_end)
             .group_by(M.item_id, M.from_bin_id, M.to_bin_id, M.move_date).all())
    for item_id, from_bin, to_bin, day, qty in moves:
        if qty:
            _add((item_id, from_bin), day, -float(qty))
            _add((item_id, to_bin), day, float(qty))

    keys = {k for k, v in opening.items() if abs(v) > 1e-9} | {k for k, d in daily.items() if any(i or o for i, o in d.values())}
    all_bins = {b.id: b for b in db.query(StoreBin).filter(StoreBin.location_id == location_id).all()}
    items = _items(db, [k[0] for k in keys])
    holds: dict[int, set[str]] = defaultdict(set)
    res = db.query(StoreStockReservation).filter(StoreStockReservation.location_id == location_id,
                                                 StoreStockReservation.status == "active").all()
    codes = {p.id: p.project_code for p in db.query(PmProject).filter(
        PmProject.id.in_({r.order_project_id for r in res} - {None})).all()} if res else {}
    for r in res:
        label = codes.get(r.order_project_id) or r.project
        if label:
            holds[r.item_id].add(label)

    racks: dict[str, list[dict]] = defaultdict(list)
    for item_id, bin_id in keys:
        b = all_bins.get(bin_id) if bin_id else None
        rk = rack_of(b, all_bins) if b else NO_BIN
        if rack and rk != rack:
            continue
        item = items.get(item_id)
        racks[rk].append({
            "bin": b.code if b else "—", "item_code": item.item_code if item else "", "item": _desc(item),
            "category": (item.category if item else None), "unit": item.uom if item else None,
            "project": ", ".join(sorted(holds.get(item_id, ()))) or None,
            "opening": round(opening.get((item_id, bin_id), 0.0), 6),
            "days": {d: v for d, v in daily.get((item_id, bin_id), {}).items()},
        })
    for rows in racks.values():
        rows.sort(key=lambda r: (natural_key(r["bin"]), natural_key(r["item_code"])))
    return dict(sorted(racks.items(), key=lambda kv: (kv[0] == NO_BIN, natural_key(kv[0]))))


def _fill_inventory_sheet(ws: Worksheet, rack: str, rows: list[dict], month_start: date, days_in_month: int) -> None:
    # Row styles of the template grid: first item of a bin block, middle items, last OUT row of a block.
    pattern = {key: [copy.copy(ws.cell(r, c)._style) for c in range(1, INV_COLS + 1)]
               for key, r in (("in_first", 8), ("in", 10), ("out", 9), ("out_last", 23))}
    height = ws.row_dimensions[INV_FIRST].height
    for m in list(ws.merged_cells.ranges):
        if INV_FIRST <= m.min_row <= INV_LAST:
            ws.merged_cells.remove(m)
    for r in range(INV_FIRST, INV_LAST + 1):
        for c in range(1, INV_COLS + 1):
            ws._cells.pop((r, c), None)
    pairs = max(len(rows), (INV_LAST - INV_FIRST + 1) // 2)
    last = make_room(ws, INV_FIRST, INV_LAST, pairs * 2)
    # make_room styled/merged inserted rows from row 8 — reset the whole grid below.
    for m in list(ws.merged_cells.ranges):
        if INV_FIRST <= m.min_row <= last:
            ws.merged_cells.remove(m)

    blocks: list[tuple[int, int]] = []          # (first pair index, last pair index) per bin
    for i, row in enumerate(rows):
        if i == 0 or row["bin"] != rows[i - 1]["bin"]:
            blocks.append((i, i))
        else:
            blocks[-1] = (blocks[-1][0], i)
    block_of = {i: (a, b) for a, b in blocks for i in range(a, b + 1)}
    for p in range(pairs):
        r_in, r_out = INV_FIRST + 2 * p, INV_FIRST + 2 * p + 1
        a, b = block_of.get(p, (p, p))
        for c in range(1, INV_COLS + 1):
            ws.cell(r_in, c)._style = copy.copy(pattern["in_first" if p == a else "in"][c - 1])
            ws.cell(r_out, c)._style = copy.copy(pattern["out_last" if p == b else "out"][c - 1])
        ws.row_dimensions[r_in].height = height
        ws.row_dimensions[r_out].height = height
        for col in (1, 3, 4, 5, 6, 7, 8):
            ws.merge_cells(start_row=r_in, start_column=col, end_row=r_out, end_column=col)
        ws.cell(r_in, 9).value, ws.cell(r_out, 9).value = "IN", "OUT"
        ws.cell(r_in, 8).value = f"=+G{r_in}+AO{r_in}-AO{r_out}"
        ws.cell(r_in, 41).value = f"=SUM(J{r_in}:AN{r_in})"
        ws.cell(r_out, 41).value = f"=SUM(J{r_out}:AN{r_out})"
        if p >= len(rows):
            # Blank pair left for hand entries, like the paper register.
            ws.merge_cells(start_row=r_in, start_column=2, end_row=r_out, end_column=2)
            continue
        row = rows[p]
        ws.cell(r_in, 1).value = p - a + 1
        _set(ws.cell(r_in, 3), row["item"])
        _set(ws.cell(r_in, 4), row["category"])
        _set(ws.cell(r_in, 5), row["unit"])
        _set(ws.cell(r_in, 6), row["project"])
        ws.cell(r_in, 7).value = _qty(row["opening"])
        for day, (qin, qout) in row["days"].items():
            if qin:
                ws.cell(r_in, DAY_COL + day - 1).value = _qty(qin)
            if qout:
                ws.cell(r_out, DAY_COL + day - 1).value = _qty(qout)
    for a, b in blocks:
        _set(ws.cell(INV_FIRST + 2 * a, 2), rows[a]["bin"])
        ws.merge_cells(start_row=INV_FIRST + 2 * a, start_column=2, end_row=INV_FIRST + 2 * b + 1, end_column=2)
    label = rack if rack == NO_BIN else f"RACK NO-{rack}"
    _set(ws["A6"], label)
    ws["G6"].value = f"STOCK QTY {month_start:%d.%m.%Y}"
    ws["AO6"].value = f"MONTH/YEAR-  {month_start:%b-%Y}".upper()
    for d in range(days_in_month + 1, 32):
        ws.cell(7, DAY_COL + d - 1).value = None


def build_inventory_register(db: Session, *, location_id: int, month_start: date, rack: str | None = None) -> bytes:
    month_start = month_start.replace(day=1)
    data = inventory_data(db, location_id=location_id, month_start=month_start, rack=rack)
    if not data:
        store = db.get(StoreLocation, location_id)
        what = f"rack {rack}" if rack else "any bin"
        raise RegisterError(f"Store '{store.name if store else location_id}' has no stock in {what} and no movement in "
                            f"{month_start:%B %Y}, so there is nothing to print. Pick another month or store"
                            + (", or clear the rack filter." if rack else "."))
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    days_in_month = (next_month - month_start).days
    wb = load_template(INVENTORY_TEMPLATE)
    base = wb.worksheets[0]
    for extra in wb.worksheets[1:]:
        wb.remove(extra)
    images = _image_specs(base)
    sheets = []
    for rk in data:
        ws = wb.copy_worksheet(base)
        _add_images(ws, images)
        ws.page_setup.orientation = base.page_setup.orientation
        ws.page_setup.paperSize = base.page_setup.paperSize
        ws.sheet_properties.pageSetUpPr = copy.copy(base.sheet_properties.pageSetUpPr)
        title = (rk if rk == NO_BIN else f"RACK {rk}")[:31]
        ws.title = re.sub(r"[\\/*?:\[\]]", "-", title)
        sheets.append((ws, rk))
    wb.remove(base)
    for ws, rk in sheets:
        _fill_inventory_sheet(ws, rk, data[rk], month_start, days_in_month)
    wb.active = 0
    return to_bytes(wb)


def stream_name(prefix: str, *parts) -> str:
    bits = [prefix] + [re.sub(r"[^A-Za-z0-9_-]+", "-", str(p)).strip("-") for p in parts if p]
    return "_".join(b for b in bits if b) + ".xlsx"
