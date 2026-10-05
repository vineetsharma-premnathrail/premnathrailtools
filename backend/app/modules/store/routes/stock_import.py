"""Bulk import of stock entries and Excel export of the Stock page.

Import is all-or-nothing: every row is checked (item, warehouse, entry
type, quantity, enough stock for outward rows) and posted through the same
ledger as Record Stock Entry. If any row has a problem nothing is posted
and every problem comes back with its row number — so a corrected file can
simply be uploaded again without double-posting the rows that were fine.
Adjustments are not allowed here, same as the manual entry form."""
import csv
import io
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.routes.doc_types import doc_type_labels, doc_types
from app.modules.store.routes.item_import import _read_rows
from app.modules.store.routes.stock import _MANUAL_ALLOWED_TYPES
from app.modules.store.services.stock_ledger import post_stock_transaction

router = APIRouter(prefix="/store/stock", tags=["Store"])

COLUMNS = ["item_code", "warehouse", "entry_type", "quantity", "vendor_name", "batch_number", "reference_number", "transaction_date", "remarks"]
MAX_ROWS = 5000

TXN_TYPE_LABELS = {
    "receipt": "Receipt", "issue": "Issue", "return_in": "Return (in)", "return_out": "Return (out)",
    "transfer_in": "Transfer In", "transfer_out": "Transfer Out", "adjustment_in": "Adjustment (+)",
    "adjustment_out": "Adjustment (-)", "damage": "Damage", "manual_in": "Stock in", "manual_out": "Stock out",
    "quarantine_in": "Quarantine (in)", "quarantine_out": "Quarantine (out)",
}


def _parse_date(raw: str) -> date | None:
    """Accepts 2026-10-05, 05-10-2026, 05/10/2026 or an Excel datetime cell."""
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Date '{raw}' isn't readable — use YYYY-MM-DD (e.g. {date.today().isoformat()}) or DD-MM-YYYY.")


@router.get("/import/template")
async def import_template(db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLUMNS)
    loc = db.query(StoreLocation).order_by(StoreLocation.id).first()
    item = db.query(StoreItem).order_by(StoreItem.id).first()
    w.writerow([item.item_code if item else "RM-0001", loc.code if loc else "MAIN", "Receipt", "100", "", "", "OPENING-STOCK", date.today().isoformat(), "Opening balance"])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="stock_entry_import_template.csv"'})


@router.post("/import")
async def import_stock(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    rows = _read_rows(file.filename, await file.read())
    rows = [r for r in rows if any(r.values())]
    if not rows:
        raise HTTPException(status_code=422, detail="The file has no data rows — fill in at least one stock entry under the header row.")
    if len(rows) > MAX_ROWS:
        raise HTTPException(status_code=422, detail=f"The file has {len(rows)} rows — import at most {MAX_ROWS} at a time by splitting it.")
    missing = [c for c in ("item_code", "warehouse", "entry_type", "quantity") if c not in rows[0]]
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing column(s) {', '.join(missing)} — download the template and keep its header row.")

    items = {i.item_code.strip().lower(): i for i in db.query(StoreItem).all() if i.item_code}
    locations = db.query(StoreLocation).all()
    loc_by_key: dict[str, StoreLocation] = {}
    for l in locations:
        loc_by_key[l.name.strip().lower()] = l
        loc_by_key[l.code.strip().lower()] = l  # code wins over a same-text name
    entries = doc_types(db, "stock_entry", active_only=True)
    entry_by_key = {}
    for e in entries:
        entry_by_key[e.label.strip().lower()] = e
        entry_by_key[e.value.strip().lower()] = e
    entry_names = ", ".join(e.label for e in entries)

    posted, errors = [], []
    for idx, r in enumerate(rows, start=2):  # row 1 is the header
        code = r.get("item_code", "")
        def fail(reason: str):
            errors.append({"row": idx, "item_code": code, "reason": reason})

        item = items.get(code.lower())
        if not code:
            fail("Item code is empty — fill in the item_code from the Item Master."); continue
        if not item:
            fail(f"Item '{code}' isn't in the Item Master — check the code or add the item first."); continue
        wh = r.get("warehouse", "")
        loc = loc_by_key.get(wh.lower())
        if not loc:
            fail(f"Store '{wh}' not found — use a store code or name from Store → Settings → Stores." if wh else "Store is empty — fill in the store code or name in the warehouse column."); continue
        et = r.get("entry_type", "")
        if et.lower() in ("adjustment_in", "adjustment_out", "adjustment", "adjustment (+)", "adjustment (-)"):
            fail("Adjustments can't be imported — use Store → Adjustments → New so they get an approver."); continue
        entry = entry_by_key.get(et.lower())
        if not entry:
            fail(f"Entry type '{et}' isn't valid — use one of: {entry_names}." if et else f"Entry type is empty — use one of: {entry_names}."); continue
        try:
            qty = float(r.get("quantity", "").replace(",", ""))
        except ValueError:
            fail(f"Quantity '{r.get('quantity')}' isn't a number."); continue
        if qty <= 0:
            fail("Quantity must be greater than zero."); continue
        try:
            txn_date = _parse_date(r.get("transaction_date", ""))
        except ValueError as e:
            fail(str(e)); continue
        if txn_date and txn_date > date.today():
            fail(f"Date {txn_date.isoformat()} is in the future — stock can only be posted for today or earlier."); continue

        txn_type = entry.value if entry.value in _MANUAL_ALLOWED_TYPES else ("manual_in" if entry.stock_effect == "in" else "manual_out")
        try:
            post_stock_transaction(
                db, item_id=item.id, location_id=loc.id, transaction_type=txn_type, entry_type=entry.value,
                quantity=qty, batch_number=r.get("batch_number") or None, reference_type="manual",
                reference_number=r.get("reference_number") or None, transaction_date=txn_date,
                remarks=r.get("remarks") or None, vendor_name=(r.get("vendor_name") or r.get("vendor") or None), created_by_id=user.id,
            )
        except ValueError as e:
            fail(f"{e} at {loc.name} (counting the rows above it in this file)."); continue
        posted.append({"row": idx, "item_code": item.item_code, "item_name": item.item_name, "warehouse": loc.name,
                       "entry_type": entry.label, "stock_effect": entry.stock_effect, "quantity": qty, "uom": item.uom})

    if errors:
        db.rollback()
        return {"posted": [], "would_post": len(posted), "errors": errors}
    db.commit()
    return {"posted": posted, "would_post": len(posted), "errors": []}


def _match(item: StoreItem | None, loc: StoreLocation | None, location_id, category, subcategory, search) -> bool:
    if location_id and (not loc or loc.id != location_id):
        return False
    if category and (not item or item.category != category):
        return False
    if subcategory and (not item or item.subcategory != subcategory):
        return False
    q = (search or "").strip().lower()
    if q:
        hay = " ".join(filter(None, [item.item_code if item else None, item.item_name if item else None,
                                     loc.name if loc else None, item.category if item else None,
                                     item.subcategory if item else None])).lower()
        if q not in hay:
            return False
    return True


@router.get("/export")
async def export_stock(
    search: str | None = Query(None),
    location_id: int | None = Query(None),
    category: str | None = Query(None),
    subcategory: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    """Excel with two sheets — Balances and Movements — using the same filters as the Stock page."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    items = {i.id: i for i in db.query(StoreItem).all()}
    locs = {l.id: l for l in db.query(StoreLocation).all()}
    users = {u.id: (u.name or u.email) for u in db.query(User.id, User.name, User.email).all()}
    entry_labels = doc_type_labels(db, "stock_entry")

    wb = Workbook()

    def sheet(ws, headers, widths):
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True)
            cell.fill = PatternFill("solid", fgColor="FDF1E6")
        for i, w in enumerate(widths):
            ws.column_dimensions[chr(65 + i)].width = w
        ws.freeze_panes = "A2"

    ws = wb.active
    ws.title = "Balances"
    sheet(ws, ["Item Code", "Item Name", "Category", "Subcategory", "Store", "UOM", "On Hand", "Reserved", "Available", "Quarantine"],
          [16, 34, 22, 20, 22, 8, 12, 12, 12, 12])
    balances = [b for b in db.query(StoreStockBalance).all()
                if _match(items.get(b.item_id), locs.get(b.location_id), location_id, category, subcategory, search)]
    balances.sort(key=lambda b: ((items[b.item_id].item_name if b.item_id in items else ""), (locs[b.location_id].name if b.location_id in locs else "")))
    for b in balances:
        i, l = items.get(b.item_id), locs.get(b.location_id)
        ws.append([i.item_code if i else "", i.item_name if i else "", (i.category or "") if i else "", (i.subcategory or "") if i else "",
                   l.name if l else "", i.uom if i else "", b.on_hand_qty, b.reserved_qty, b.on_hand_qty - b.reserved_qty, b.quarantine_qty or 0])
    ws.auto_filter.ref = ws.dimensions

    ws = wb.create_sheet("Movements")
    sheet(ws, ["Date", "Item Code", "Item Name", "Store", "Type", "Quantity", "UOM", "Vendor", "Batch", "Reference Type", "Reference", "Remarks", "By"],
          [12, 16, 34, 22, 20, 12, 8, 26, 14, 16, 20, 30, 20])
    q = db.query(StoreStockTransaction)
    if location_id:
        q = q.filter(StoreStockTransaction.location_id == location_id)
    for t in q.order_by(StoreStockTransaction.transaction_date.desc(), StoreStockTransaction.id.desc()).limit(50000).all():
        i, l = items.get(t.item_id), locs.get(t.location_id)
        if not _match(i, l, location_id, category, subcategory, search):
            continue
        ws.append([t.transaction_date, i.item_code if i else "", i.item_name if i else "", l.name if l else "",
                   (entry_labels.get(t.entry_type) if t.entry_type else None) or TXN_TYPE_LABELS.get(t.transaction_type, t.transaction_type),
                   t.quantity, i.uom if i else "", t.vendor_name or "", t.batch_number or "", t.reference_type or "", t.reference_number or "",
                   t.remarks or "", users.get(t.created_by_id, "") if t.created_by_id else ""])
    for row in ws.iter_rows(min_row=2, max_col=1):
        row[0].number_format = "yyyy-mm-dd"
    ws.auto_filter.ref = ws.dimensions

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="stock.xlsx"'})
